package com.stormglide.susu.agent.data

import com.google.firebase.firestore.DocumentSnapshot
import com.google.firebase.firestore.FirebaseFirestore
import com.google.firebase.firestore.FirebaseFirestoreException
import com.google.firebase.firestore.MetadataChanges
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.channels.awaitClose
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.callbackFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.launch

/**
 * The offline queue is Firestore itself (BUILD_PLAN §5): each action is one `commands/{uuid}` document.
 * Firestore's persistent cache keeps the write on the phone until the network returns and retries it
 * on its own, always with the same document ID — so a retry can never become a second collection.
 *
 * The app never updates or deletes a command (rules forbid it) and never writes status fields.
 */
class CommandQueue(
    private val db: FirebaseFirestore,
    private val refused: RefusedWriteStore,
    private val scope: CoroutineScope,
) {

    /**
     * Record a command. Returns immediately: offline, the write waits in the local cache. The
     * listener in [observe] reports Pending sync → Synced / Rejected from the document itself.
     */
    fun enqueue(commandId: String, command: Map<String, Any>) {
        require(Commands.isUuidV4(commandId)) { "command IDs are UUID v4" }
        db.collection(COLLECTION).document(commandId).set(command).addOnFailureListener { error ->
            val code = (error as? FirebaseFirestoreException)?.code
            if (code == FirebaseFirestoreException.Code.PERMISSION_DENIED || code == FirebaseFirestoreException.Code.INVALID_ARGUMENT) {
                // Firestore has rolled the write back locally. Keep it on disk so it outlives a restart.
                val write = RefusedWrite.fromCommand(commandId, command) ?: return@addOnFailureListener
                scope.launch { refused.add(write) }
            }
        }
    }

    /** Every command this agent has written, newest first, including ones that have not left the phone. */
    fun observe(agentUid: String): Flow<List<QueuedCommand>> {
        val fromFirestore = callbackFlow {
            // Rules only allow listing your own commands, so the query must filter on agentUid.
            val registration = db.collection(COLLECTION)
                .whereEqualTo("agentUid", agentUid)
                .limit(500)
                .addSnapshotListener(MetadataChanges.INCLUDE) { snapshot, _ ->
                    if (snapshot != null) trySend(snapshot.documents.mapNotNull(::toQueued))
                }
            awaitClose { registration.remove() }
        }
        return combine(fromFirestore, refused.writes) { docs, local -> merge(docs, local, agentUid) }
    }

    companion object {
        const val COLLECTION = "commands"

        /** Firestore's view wins for any ID it knows; refused writes fill in the ones it rolled back. */
        fun merge(docs: List<QueuedCommand>, refused: List<RefusedWrite>, agentUid: String): List<QueuedCommand> {
            val ids = docs.map { it.id }.toSet()
            val local = refused.filter { it.agentUid == agentUid && it.id !in ids }.map { it.toQueued() }
            return (docs + local).sortedByDescending { it.seq }
        }

        fun toQueued(doc: DocumentSnapshot): QueuedCommand? {
            val payload = doc.get("payload") as? Map<*, *> ?: return null
            val pendingWrites = doc.metadata.hasPendingWrites()
            val status = doc.getString("status")
            val state = when {
                pendingWrites || status == null -> SyncState.PENDING_SYNC
                status == "POSTED" -> SyncState.SYNCED
                status == "RECORDED" -> SyncState.RECORDED
                status == "REJECTED" -> SyncState.REJECTED
                else -> SyncState.FAILED
            }
            return QueuedCommand(
                id = doc.id,
                seq = doc.getLong("seq") ?: 0L,
                capturedAt = doc.getString("capturedAt").orEmpty(),
                memberId = payload["memberId"] as? String ?: "",
                susuAccountId = payload["susuAccountId"] as? String ?: "",
                amountPesewas = (payload["amountPesewas"] as? Number)?.toLong() ?: 0L,
                type = doc.getString("type") ?: Commands.COLLECTION,
                state = state,
                onPhoneOnly = pendingWrites,
                receiptRef = doc.getString("postingId")?.take(8)?.uppercase(),
                recordRef = doc.getString("recordId")?.take(8)?.uppercase(),
                reason = doc.getString("reason"),
                message = doc.getString("message"),
            )
        }
    }
}
