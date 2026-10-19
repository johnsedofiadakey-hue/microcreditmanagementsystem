package com.stormglide.susu.agent.security

import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Test

class DeviceIdentityTest {
    private class FakeStore(var id: String = "device-1", var fp: String? = null) : IdentityStore {
        var rotations = 0
        override suspend fun deviceId() = id
        override suspend fun keyFingerprint() = fp
        override suspend fun setKeyFingerprint(fingerprint: String) { fp = fingerprint }
        override suspend fun rotateDeviceId(): String { rotations++; id = "device-${rotations + 1}"; fp = null; return id }
    }

    /** Each generated key gets distinct bytes, so fingerprints differ like real keys. */
    private class FakeKey : DeviceKey {
        var spki: ByteArray? = null
        val challenges = mutableListOf<String>()
        override fun publicKeySpki() = spki
        override fun generate(deviceId: String) { challenges += deviceId; spki = "key-for-$deviceId-${challenges.size}".toByteArray() }
        override fun delete() { spki = null }
        override fun attestationChain() = emptyList<String>()
        override fun sign(message: String) = "sig"
    }

    @Test fun firstKeyGetsAFreshDeviceId() = runTest {
        // device-1 may have been bound before commands were signed; it must not be reused with a key.
        val store = FakeStore()
        val key = FakeKey()
        val identity = DeviceIdentity(store, key).ready()
        assertEquals("device-2", identity.deviceId)
        assertEquals(listOf("device-2"), key.challenges)
        assertEquals(DeviceKeys.fingerprint(key.spki!!), store.fp)
    }

    @Test fun laterLaunchesReuseTheSameKey() = runTest {
        val store = FakeStore()
        val key = FakeKey()
        val first = DeviceIdentity(store, key).ready()
        val second = DeviceIdentity(store, key).ready()
        assertEquals(first, second)
        assertEquals(1, key.challenges.size)
    }

    @Test fun lostKeyRetiresTheDeviceId() = runTest {
        val store = FakeStore()
        val key = FakeKey()
        val first = DeviceIdentity(store, key).ready()
        key.spki = null // e.g. Keystore wiped while app data survived
        val second = DeviceIdentity(store, key).ready()
        assertNotEquals(first.deviceId, second.deviceId)
        assertNotEquals(first.fingerprint, second.fingerprint)
        assertEquals(listOf("device-2", "device-3"), key.challenges)
    }

    @Test fun differentKeyRetiresTheDeviceId() = runTest {
        val store = FakeStore()
        val key = FakeKey()
        val first = DeviceIdentity(store, key).ready()
        key.spki = "some-other-key".toByteArray()
        val second = DeviceIdentity(store, key).ready()
        assertNotEquals(first.deviceId, second.deviceId)
        assertEquals(DeviceKeys.fingerprint(key.spki!!), second.fingerprint)
    }

    @Test fun keyMadeButFingerprintNotSavedIsKept() = runTest {
        val store = FakeStore()
        val key = FakeKey().apply { generate("device-1") }
        val identity = DeviceIdentity(store, key).ready()
        assertEquals("device-1", identity.deviceId)
        assertEquals(1, key.challenges.size)
    }
}
