package com.stormglide.susu.agent.ui

import android.app.Application
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.google.firebase.FirebaseNetworkException
import com.google.firebase.auth.FirebaseAuthException
import com.stormglide.susu.agent.BuildConfig
import com.stormglide.susu.agent.SusuAgentApp
import com.stormglide.susu.agent.data.AuthState
import com.stormglide.susu.agent.data.Commands
import com.stormglide.susu.agent.data.EnrollmentState
import com.stormglide.susu.agent.data.QueuedCommand
import com.stormglide.susu.agent.data.RouteMember
import com.stormglide.susu.agent.data.SyncState
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.emptyFlow
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.time.Instant

/** A collection being entered. The command ID is fixed when the draft starts, so saving twice can't duplicate it. */
data class CollectionDraft(
    val commandId: String,
    val member: RouteMember,
    val saving: Boolean = false,
)

data class SignInUi(val busy: Boolean = false, val error: String? = null)

@OptIn(ExperimentalCoroutinesApi::class)
class AgentViewModel(application: Application) : AndroidViewModel(application) {
    private val app = application as SusuAgentApp

    val auth: StateFlow<AuthState> = app.auth.state()
        .stateIn(viewModelScope, SharingStarted.Eagerly, AuthState.Loading)

    val online: StateFlow<Boolean> = application.onlineFlow()
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), true)

    val queue: StateFlow<List<QueuedCommand>> = auth.flatMapLatest { state ->
        if (state is AuthState.Ready) app.commands.observe(state.session.uid) else emptyFlow()
    }.stateIn(viewModelScope, SharingStarted.Eagerly, emptyList())

    private val routeRefresh = MutableStateFlow(0)
    val route: StateFlow<List<RouteMember>> = combine(auth, routeRefresh) { state, _ -> state }.flatMapLatest { state ->
        if (state is AuthState.Ready) app.routes.today(state.session.agentPairId) else emptyFlow()
    }.stateIn(viewModelScope, SharingStarted.Eagerly, emptyList())

    fun refreshRoute() { routeRefresh.value += 1 }

    /** Records that have not reached the server. Sign-out is blocked while this is above zero. */
    val unsyncedCount: StateFlow<Int> = queue.map { list -> list.count { it.onPhoneOnly } }
        .stateIn(viewModelScope, SharingStarted.Eagerly, 0)

    /** Reached the server or still on the phone, but not yet POSTED/REJECTED (FAILED is retried, so it counts). */
    val pendingCount: StateFlow<Int> = queue.map { list -> list.count { it.state == SyncState.PENDING_SYNC || it.state == SyncState.FAILED } }
        .stateIn(viewModelScope, SharingStarted.Eagerly, 0)

    /** Rejected records: cash the agent holds that the ledger did not accept. FAILED ones are retried by the server. */
    val rejectedCount: StateFlow<Int> = queue.map { list -> list.count { it.state == SyncState.REJECTED } }
        .stateIn(viewModelScope, SharingStarted.Eagerly, 0)

    private val _deviceId = MutableStateFlow("")
    val deviceId: StateFlow<String> = _deviceId.asStateFlow()

    /** Key fingerprint the supervisor compares in the portal before binding (ABCD-EF01-2345-6789). */
    private val _fingerprint = MutableStateFlow("")
    val fingerprint: StateFlow<String> = _fingerprint.asStateFlow()

    val enrollment: StateFlow<EnrollmentState> = app.enrollment.state

    private val _signIn = MutableStateFlow(SignInUi())
    val signIn: StateFlow<SignInUi> = _signIn.asStateFlow()

    private val _draft = MutableStateFlow<CollectionDraft?>(null)
    val draft: StateFlow<CollectionDraft?> = _draft.asStateFlow()

    /** True from an allowed sign-out until the process restarts with a wiped cache. */
    private val _signingOut = MutableStateFlow(false)
    val signingOut: StateFlow<Boolean> = _signingOut.asStateFlow()

    /** One-off messages for a snackbar. */
    private val _notice = MutableStateFlow<String?>(null)
    val notice: StateFlow<String?> = _notice.asStateFlow()

    init {
        viewModelScope.launch { refreshIdentity() }
        // Enrol this phone's key once per signed-in agent. Runs on the app scope so leaving the screen doesn't stop it.
        viewModelScope.launch {
            auth.map { (it as? AuthState.Ready)?.session?.uid }.distinctUntilChanged().collect { uid ->
                if (uid != null) app.appScope.launch {
                    app.enrollment.ensureEnrolled(uid)
                    refreshIdentity()
                }
            }
        }
    }

    private suspend fun refreshIdentity() {
        runCatching { withContext(Dispatchers.IO) { app.identity.ready() } }
            .onSuccess {
                _deviceId.value = it.deviceId
                _fingerprint.value = it.fingerprint
            }
            .onFailure { _notice.value = "This phone's security key could not be set up. Contact your supervisor." }
    }

    fun memberName(memberId: String): String =
        route.value.firstOrNull { it.memberId == memberId }?.fullName ?: "Member ${memberId.take(8)}"

    fun signIn(email: String, password: String) {
        if (_signIn.value.busy) return
        _signIn.value = SignInUi(busy = true)
        viewModelScope.launch {
            _signIn.value = try {
                // The password proves who they are; don't ask for the biometric straight after.
                app.lock.unlock()
                app.auth.signIn(email, password)
                SignInUi()
            } catch (e: FirebaseNetworkException) {
                SignInUi(error = "No connection. Sign-in needs the network once; after that you can work offline.")
            } catch (e: FirebaseAuthException) {
                SignInUi(error = "Email or password is not correct.")
            } catch (e: Exception) {
                SignInUi(error = "Sign-in failed. Please try again.")
            }
        }
    }

    fun refreshAccess() = viewModelScope.launch { runCatching { app.auth.refresh() } }

    /**
     * Returns false (and explains why) while any record is still only on this phone. Otherwise signs out,
     * wipes the Firestore cache (member names, amounts) and restarts the app process.
     */
    fun signOut(): Boolean {
        if (_signingOut.value) return true
        val unsynced = unsyncedCount.value
        if (unsynced > 0) {
            _notice.value = "$unsynced ${if (unsynced == 1) "record is" else "records are"} still on this phone. " +
                "Connect to the internet and wait for “Synced” before signing out."
            return false
        }
        _signingOut.value = true
        viewModelScope.launch { app.signOutAndWipe() }
        return true
    }

    fun startCollection(member: RouteMember) {
        _draft.value = CollectionDraft(commandId = Commands.newCommandId(), member = member)
    }

    fun cancelCollection() {
        if (_draft.value?.saving != true) _draft.value = null
    }

    /**
     * Save a collection to the offline queue. Reserves the next per-device seq, builds the exact
     * envelope from API.md §3 and writes `commands/{commandId}`. Shows as Pending sync until POSTED.
     */
    fun saveCollection(amountPesewas: Long, onSaved: (String) -> Unit) {
        val draft = _draft.value ?: return
        val session = (auth.value as? AuthState.Ready)?.session ?: return
        if (draft.saving || !Commands.isValidCollectionAmount(amountPesewas)) return
        _draft.value = draft.copy(saving = true)
        viewModelScope.launch {
            val command = try {
                withContext(Dispatchers.IO) {
                    val identity = app.identity.ready()
                    val seq = app.device.nextSeq()
                    Commands.collection(
                        commandId = draft.commandId,
                        agentUid = session.uid,
                        deviceId = identity.deviceId,
                        seq = seq,
                        capturedAt = Commands.capturedAt(Instant.now()),
                        appVersion = BuildConfig.VERSION_NAME,
                        memberId = draft.member.memberId,
                        susuAccountId = draft.member.susuAccountId,
                        amountPesewas = amountPesewas,
                        sign = app.identity::sign,
                    )
                }
            } catch (e: Exception) {
                // Nothing was written; the draft (and its command ID) stays so the agent can try again.
                _draft.value = draft.copy(saving = false)
                _notice.value = "Could not sign this record on the phone. Try again, or contact your supervisor."
                return@launch
            }
            app.commands.enqueue(draft.commandId, command)
            _draft.value = null
            onSaved(draft.commandId)
        }
    }

    fun consumeNotice() {
        _notice.value = null
    }
}
