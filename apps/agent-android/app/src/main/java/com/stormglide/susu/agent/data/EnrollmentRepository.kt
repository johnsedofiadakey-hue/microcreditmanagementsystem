package com.stormglide.susu.agent.data

import android.util.Log
import com.google.firebase.firestore.FieldValue
import com.google.firebase.firestore.FirebaseFirestore
import com.google.firebase.firestore.FirebaseFirestoreException
import com.google.firebase.firestore.Source
import com.stormglide.susu.agent.security.DeviceIdentity
import com.stormglide.susu.agent.security.DeviceKeys
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.tasks.await
import kotlinx.coroutines.withContext

sealed interface EnrollmentState {
    /** Key ready; the enrolment write hasn't been confirmed by the server yet (it may be waiting offline). */
    data object Pending : EnrollmentState
    data object Enrolled : EnrollmentState
    data class Failed(val message: String) : EnrollmentState
}

/**
 * Writes `deviceEnrollments/{deviceId}` once (API.md §3a). The rules allow create only, so writing it a
 * second time is refused; a refusal where the stored key is ours counts as done.
 */
class EnrollmentRepository(
    private val db: FirebaseFirestore,
    private val device: DeviceStore,
    private val identity: DeviceIdentity,
) {
    private val _state = MutableStateFlow<EnrollmentState>(EnrollmentState.Pending)
    val state: StateFlow<EnrollmentState> = _state.asStateFlow()
    private val mutex = Mutex()

    suspend fun ensureEnrolled(agentUid: String) {
        try {
            enroll(agentUid)
        } catch (e: kotlinx.coroutines.CancellationException) {
            throw e
        } catch (e: Exception) {
            Log.w(TAG, "Enrolment did not complete", e)
            _state.value = EnrollmentState.Failed("This phone could not be registered yet. Check the connection and reopen the app.")
        }
    }

    private suspend fun enroll(agentUid: String) = mutex.withLock {
        val id = withContext(Dispatchers.IO) { identity.ready() }
        if (device.enrolledAgentUid() == agentUid) {
            _state.value = EnrollmentState.Enrolled
            return@withLock
        }
        _state.value = EnrollmentState.Pending
        val publicKey = DeviceKeys.base64(identity.publicKeySpki())
        val chain = withContext(Dispatchers.IO) { identity.attestationChain() }
        val doc = db.collection(COLLECTION).document(id.deviceId)
        try {
            // Offline this waits in Firestore's cache and is sent before any command written after it.
            doc.set(
                mapOf(
                    "agentUid" to agentUid,
                    "publicKey" to publicKey,
                    "attestationChain" to chain,
                    "enrolledAt" to FieldValue.serverTimestamp(),
                ),
            ).await()
            device.setEnrolledAgentUid(agentUid)
            _state.value = EnrollmentState.Enrolled
        } catch (e: FirebaseFirestoreException) {
            if (e.code != FirebaseFirestoreException.Code.PERMISSION_DENIED) throw e
            // Already exists? Only readable if it is ours.
            val existing = runCatching { doc.get(Source.SERVER).await() }.getOrNull()
            if (existing?.getString("publicKey") == publicKey && existing.getString("agentUid") == agentUid) {
                device.setEnrolledAgentUid(agentUid)
                _state.value = EnrollmentState.Enrolled
            } else {
                Log.w(TAG, "Enrolment refused for ${id.deviceId}", e)
                _state.value = EnrollmentState.Failed(
                    "This phone could not be registered. It may be registered to another agent. " +
                        "Ask your supervisor; reinstalling the app gives the phone a new ID.",
                )
            }
        }
    }

    private companion object {
        const val COLLECTION = "deviceEnrollments"
        const val TAG = "Enrollment"
    }
}
