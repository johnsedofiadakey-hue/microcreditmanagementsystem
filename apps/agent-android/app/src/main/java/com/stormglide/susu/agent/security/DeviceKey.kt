package com.stormglide.susu.agent.security

import android.os.Build
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.security.keystore.StrongBoxUnavailableException
import android.util.Log
import java.security.KeyPairGenerator
import java.security.KeyStore
import java.security.MessageDigest
import java.security.PrivateKey
import java.security.Signature
import java.security.spec.ECGenParameterSpec
import java.util.Base64

/** Fingerprint and signature encodings shared with the server (functions/src/lib/deviceKeys.ts). */
object DeviceKeys {
    /** SHA-256 of the SPKI DER, first 16 hex characters, upper-case, grouped `ABCD-EF01-2345-6789`. */
    fun fingerprint(spkiDer: ByteArray): String {
        val hex = MessageDigest.getInstance("SHA-256").digest(spkiDer)
            .joinToString("") { "%02X".format(java.util.Locale.ROOT, it) }
            .take(16)
        return hex.chunked(4).joinToString("-")
    }

    /** Base64 without line breaks (Android `Base64.NO_WRAP`), the encoding the rules and server expect. */
    fun base64(bytes: ByteArray): String = Base64.getEncoder().encodeToString(bytes)

    /** DER ECDSA P-256 / SHA-256 over the UTF-8 message (`SHA256withECDSA`), base64. */
    fun sign(privateKey: PrivateKey, message: String): String {
        val signature = Signature.getInstance("SHA256withECDSA")
        signature.initSign(privateKey)
        signature.update(message.toByteArray(Charsets.UTF_8))
        return base64(signature.sign())
    }
}

/** What the rest of the app needs from the phone's key. */
interface DeviceKey {
    /** X.509 SubjectPublicKeyInfo DER of the current key, or null if there is none. */
    fun publicKeySpki(): ByteArray?

    /** Create a fresh key whose attestation certificate is bound to [deviceId]. Replaces any old key. */
    fun generate(deviceId: String)

    fun delete()

    /** Base64 DER certificates, leaf first. Empty if the phone gave no chain. */
    fun attestationChain(): List<String>

    /** Base64 DER signature over [message]. */
    fun sign(message: String): String
}

/**
 * A non-exportable EC P-256 signing key in the Android Keystore (API.md §3a). The private key never
 * leaves the secure hardware (StrongBox when the phone has it, otherwise the TEE). Android removes the
 * key when the app is uninstalled or its data is cleared, which is why a lost key means a new deviceId.
 */
class KeystoreDeviceKey : DeviceKey {
    private val keyStore: KeyStore = KeyStore.getInstance(ANDROID_KEYSTORE).apply { load(null) }

    override fun publicKeySpki(): ByteArray? = keyStore.getCertificate(ALIAS)?.publicKey?.encoded

    override fun generate(deviceId: String) {
        delete()
        val challenge = deviceId.toByteArray(Charsets.UTF_8)
        // Best first: StrongBox with attestation. Fall back step by step on phones (and emulators) that can't.
        val attempts = buildList {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) add(true to true)
            add(false to true)
            add(false to false)
        }
        var last: Exception? = null
        for ((strongBox, attest) in attempts) {
            try {
                generate(challenge, strongBox, attest)
                return
            } catch (e: Exception) {
                if (e !is StrongBoxUnavailableException) Log.w(TAG, "Key generation failed (strongBox=$strongBox, attest=$attest)", e)
                last = e
                delete()
            }
        }
        throw IllegalStateException("Could not create the device key", last)
    }

    private fun generate(challenge: ByteArray, strongBox: Boolean, attest: Boolean) {
        val spec = KeyGenParameterSpec.Builder(ALIAS, KeyProperties.PURPOSE_SIGN)
            .setAlgorithmParameterSpec(ECGenParameterSpec("secp256r1"))
            .setDigests(KeyProperties.DIGEST_SHA256)
            .apply {
                if (attest) setAttestationChallenge(challenge)
                if (strongBox && Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) setIsStrongBoxBacked(true)
            }
            .build()
        KeyPairGenerator.getInstance(KeyProperties.KEY_ALGORITHM_EC, ANDROID_KEYSTORE).apply { initialize(spec) }.generateKeyPair()
    }

    override fun delete() {
        if (keyStore.containsAlias(ALIAS)) keyStore.deleteEntry(ALIAS)
    }

    override fun attestationChain(): List<String> =
        keyStore.getCertificateChain(ALIAS)?.map { DeviceKeys.base64(it.encoded) }.orEmpty().take(10)

    override fun sign(message: String): String {
        val key = keyStore.getKey(ALIAS, null) as? PrivateKey ?: error("No device key")
        return DeviceKeys.sign(key, message)
    }

    private companion object {
        const val ANDROID_KEYSTORE = "AndroidKeyStore"
        const val ALIAS = "susu-device-key-v1"
        const val TAG = "DeviceKey"
    }
}
