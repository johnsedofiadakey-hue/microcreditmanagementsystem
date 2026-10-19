package com.stormglide.susu.agent.security

import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock

/** The parts of DeviceStore that tie a deviceId to exactly one key. */
interface IdentityStore {
    suspend fun deviceId(): String
    suspend fun keyFingerprint(): String?
    suspend fun setKeyFingerprint(fingerprint: String)
    suspend fun rotateDeviceId(): String
}

data class Identity(val deviceId: String, val fingerprint: String)

/**
 * Makes sure this install has a deviceId and a Keystore key that belong together (API.md §3a).
 * A deviceId is never used with a second key: if the key it was enrolled with is missing or different,
 * the phone gets a new deviceId and a new key, and must be enrolled and bound again.
 */
class DeviceIdentity(private val store: IdentityStore, private val key: DeviceKey) {
    private val mutex = Mutex()

    suspend fun ready(): Identity = mutex.withLock {
        val deviceId = store.deviceId()
        val stored = store.keyFingerprint()
        val current = key.publicKeySpki()?.let(DeviceKeys::fingerprint)
        when {
            // The normal case: the key made for this deviceId.
            current != null && current == stored -> Identity(deviceId, current)
            // The app died between creating the key and saving its fingerprint: the key belongs to this ID.
            stored == null && current != null -> {
                store.setKeyFingerprint(current)
                Identity(deviceId, current)
            }
            // First key on this install, or the key this deviceId was enrolled with is gone or different.
            // Either way start a new deviceId: an ID used before (even one bound before commands were
            // signed) must never be paired with a new key.
            else -> {
                key.delete()
                val newId = store.rotateDeviceId()
                key.generate(newId)
                val fp = DeviceKeys.fingerprint(checkNotNull(key.publicKeySpki()))
                store.setKeyFingerprint(fp)
                Identity(newId, fp)
            }
        }
    }

    /** Signature for a command; [ready] must have run for the current deviceId. */
    fun sign(message: String): String = key.sign(message)

    fun attestationChain(): List<String> = key.attestationChain()

    fun publicKeySpki(): ByteArray = checkNotNull(key.publicKeySpki()) { "no device key" }
}
