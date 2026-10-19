package com.stormglide.susu.agent.data

import android.content.Context
import androidx.datastore.core.DataStore
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map
import org.json.JSONArray
import org.json.JSONObject

private val Context.refusedDataStore: DataStore<Preferences> by preferencesDataStore(name = "refused_writes")

/**
 * A command the server refused before processing it (PERMISSION_DENIED / INVALID_ARGUMENT from the rules).
 * Firestore rolls such a write back locally, so without this record the agent would lose track of cash
 * they collected. Kept per agent, so another agent signing in on the same phone never sees it.
 */
data class RefusedWrite(
    val agentUid: String,
    val id: String,
    val seq: Long,
    val capturedAt: String,
    val memberId: String,
    val susuAccountId: String,
    val amountPesewas: Long,
) {
    fun toQueued(): QueuedCommand = QueuedCommand(
        id = id,
        seq = seq,
        capturedAt = capturedAt,
        memberId = memberId,
        susuAccountId = susuAccountId,
        amountPesewas = amountPesewas,
        state = SyncState.REJECTED,
        // It will never reach the server, so it doesn't hold up sign-out; it stays listed as Rejected.
        onPhoneOnly = false,
        reason = REASON,
        message = "The server refused this record before processing it.",
    )

    companion object {
        const val REASON = "LOCAL_PERMISSION_DENIED"

        /** Build from the exact envelope that was written (Commands.collection). Null if it isn't one. */
        fun fromCommand(commandId: String, command: Map<String, Any>): RefusedWrite? {
            val payload = command["payload"] as? Map<*, *> ?: return null
            return RefusedWrite(
                agentUid = command["agentUid"] as? String ?: return null,
                id = commandId,
                seq = (command["seq"] as? Number)?.toLong() ?: return null,
                capturedAt = command["capturedAt"] as? String ?: "",
                memberId = payload["memberId"] as? String ?: "",
                susuAccountId = payload["susuAccountId"] as? String ?: "",
                amountPesewas = (payload["amountPesewas"] as? Number)?.toLong() ?: return null,
            )
        }
    }
}

/** JSON form stored in DataStore. Amounts stay integer pesewas. Unreadable entries are skipped, never fatal. */
object RefusedWritesJson {
    fun encode(writes: Collection<RefusedWrite>): String {
        val array = JSONArray()
        writes.sortedBy { it.seq }.forEach { w ->
            array.put(
                JSONObject()
                    .put("agentUid", w.agentUid)
                    .put("id", w.id)
                    .put("seq", w.seq)
                    .put("capturedAt", w.capturedAt)
                    .put("memberId", w.memberId)
                    .put("susuAccountId", w.susuAccountId)
                    .put("amountPesewas", w.amountPesewas),
            )
        }
        return array.toString()
    }

    fun decode(json: String?): List<RefusedWrite> {
        if (json.isNullOrBlank()) return emptyList()
        val array = runCatching { JSONArray(json) }.getOrNull() ?: return emptyList()
        return (0 until array.length()).mapNotNull { i ->
            runCatching {
                val o = array.getJSONObject(i)
                RefusedWrite(
                    agentUid = o.getString("agentUid"),
                    id = o.getString("id"),
                    seq = o.getLong("seq"),
                    capturedAt = o.optString("capturedAt", ""),
                    memberId = o.optString("memberId", ""),
                    susuAccountId = o.optString("susuAccountId", ""),
                    amountPesewas = o.getLong("amountPesewas"),
                )
            }.getOrNull()
        }
    }

    /** Add one write. The command ID is the key, so recording the same refusal twice keeps one entry. */
    fun add(json: String?, write: RefusedWrite): String =
        encode((decode(json).associateBy { it.id } + (write.id to write)).values)
}

/** Refused writes on disk. Survives restarts and sign-out (it is not the Firestore cache). */
interface RefusedWriteStore {
    val writes: Flow<List<RefusedWrite>>
    suspend fun add(write: RefusedWrite)
}

class DataStoreRefusedWriteStore(private val context: Context) : RefusedWriteStore {
    private val key = stringPreferencesKey("writes")

    override val writes: Flow<List<RefusedWrite>> =
        context.refusedDataStore.data.map { prefs -> RefusedWritesJson.decode(prefs[key]) }

    override suspend fun add(write: RefusedWrite) {
        context.refusedDataStore.edit { prefs -> prefs[key] = RefusedWritesJson.add(prefs[key], write) }
    }
}
