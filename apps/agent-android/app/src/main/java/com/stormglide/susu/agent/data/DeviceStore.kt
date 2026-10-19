package com.stormglide.susu.agent.data

import android.content.Context
import androidx.datastore.core.DataStore
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.longPreferencesKey
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import kotlinx.coroutines.flow.first
import java.util.UUID

private val Context.deviceDataStore: DataStore<Preferences> by preferencesDataStore(name = "device")

/**
 * Per-install identity and the per-device command counter. Excluded from backup and device transfer
 * (res/xml/data_extraction_rules.xml), so a restored or cloned phone never reuses either.
 */
class DeviceStore(private val context: Context) {
    private val deviceIdKey = stringPreferencesKey("deviceId")
    private val lastSeqKey = longPreferencesKey("lastSeq")

    /** Stable for this install. A supervisor binds it to the agent with bindDevice in the portal. */
    suspend fun deviceId(): String {
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
}
