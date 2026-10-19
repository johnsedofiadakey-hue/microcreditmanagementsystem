package com.stormglide.susu.agent.data

import android.content.Context
import androidx.datastore.core.DataStore
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.longPreferencesKey
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import com.stormglide.susu.agent.security.IdentityStore
import kotlinx.coroutines.flow.first
import java.util.UUID

private val Context.deviceDataStore: DataStore<Preferences> by preferencesDataStore(name = "device")

/**
 * Per-install identity and the per-device command counter. Excluded from backup and device transfer
 * (res/xml/data_extraction_rules.xml), so a restored or cloned phone never reuses either.
 */
class DeviceStore(private val context: Context) : IdentityStore {
    private val deviceIdKey = stringPreferencesKey("deviceId")
    private val lastSeqKey = longPreferencesKey("lastSeq")
    private val keyFingerprintKey = stringPreferencesKey("keyFingerprint")
    private val enrolledAgentKey = stringPreferencesKey("enrolledAgentUid")

    /** Stable for this install. A supervisor binds it to the agent with bindDevice in the portal. */
    override suspend fun deviceId(): String {
        context.deviceDataStore.data.first()[deviceIdKey]?.let { return it }
        var id = ""
        context.deviceDataStore.edit { prefs ->
            id = prefs[deviceIdKey] ?: UUID.randomUUID().toString().also { prefs[deviceIdKey] = it }
        }
        return id
    }

    /**
     * Reserve the next `seq` (starting at 1). The increment is written to disk before it is returned,
     * so a number is never handed out twice — even if the app dies straight after.
     */
    suspend fun nextSeq(): Long {
        var next = 0L
        context.deviceDataStore.edit { prefs ->
            next = (prefs[lastSeqKey] ?: 0L) + 1
            prefs[lastSeqKey] = next
        }
        return next
    }

    suspend fun lastSeq(): Long = context.deviceDataStore.data.first()[lastSeqKey] ?: 0L

    /** Fingerprint of the Keystore key made for the current deviceId, or null before the first key. */
    override suspend fun keyFingerprint(): String? = context.deviceDataStore.data.first()[keyFingerprintKey]

    override suspend fun setKeyFingerprint(fingerprint: String) {
        context.deviceDataStore.edit { it[keyFingerprintKey] = fingerprint }
    }

    /**
     * The key for this deviceId is gone (or changed), so the old ID must never be used again: issue a new
     * deviceId and forget the old key and enrolment. `lastSeq` carries on, so seq values stay unique.
     */
    override suspend fun rotateDeviceId(): String {
        val id = UUID.randomUUID().toString()
        context.deviceDataStore.edit { prefs ->
            prefs[deviceIdKey] = id
            prefs.remove(keyFingerprintKey)
            prefs.remove(enrolledAgentKey)
        }
        return id
    }

    /** The agent whose `deviceEnrollments/{deviceId}` write the server confirmed. */
    suspend fun enrolledAgentUid(): String? = context.deviceDataStore.data.first()[enrolledAgentKey]

    suspend fun setEnrolledAgentUid(agentUid: String) {
        context.deviceDataStore.edit { it[enrolledAgentKey] = agentUid }
    }
}
