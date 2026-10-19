package com.stormglide.susu.agent.data

import com.stormglide.susu.agent.security.DeviceKeys
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.security.KeyFactory
import java.security.KeyPairGenerator
import java.security.Signature
import java.security.spec.ECGenParameterSpec
import java.security.spec.X509EncodedKeySpec
import java.util.Base64

/** Byte-for-byte agreement with packages/shared commandSigningString / canonicalJson and functions deviceKeys.ts. */
class SigningTest {
    private val commandId = "0f8fad5b-d9cb-469f-a165-70867728950e"
    private val payload = mapOf(
        "memberId" to "2b7c9a10-1f2e-4d3c-8b4a-5e6f7a8b9c01",
        "susuAccountId" to "7d1e2f30-4a5b-4c6d-9e7f-8a9b0c1d2e01",
        "amountPesewas" to 2000L,
    )

    @Test fun signingStringMatchesTheTypeScriptReference() {
        // Output of commandSigningString() in @susu/shared for the same command (run with tsx on 19 Oct 2026).
        val expected = "susu-cmd-v1|0f8fad5b-d9cb-469f-a165-70867728950e|COLLECTION|agent-a|" +
            "3f2b1c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d|42|2026-10-18T09:15:00Z|" +
            "{\"amountPesewas\":2000,\"memberId\":\"2b7c9a10-1f2e-4d3c-8b4a-5e6f7a8b9c01\"," +
            "\"susuAccountId\":\"7d1e2f30-4a5b-4c6d-9e7f-8a9b0c1d2e01\"}"
        val actual = Commands.signingString(
            commandId, "COLLECTION", "agent-a", "3f2b1c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d", 42, "2026-10-18T09:15:00Z", payload,
        )
        assertEquals(expected, actual)
        assertEquals(expected.toByteArray(Charsets.UTF_8).toList(), actual.toByteArray(Charsets.UTF_8).toList())
    }

    @Test fun canonicalJsonMatchesTheTypeScriptReference() {
        // canonicalJson({ z: 'q"\\\n\t\u0001é', a: [1, null, true], m: { b: 1, B: 2, _: 3 } }) in @susu/shared.
        val value = mapOf(
            "z" to "q\"\\\n\t\u0001é",
            "a" to listOf(1, null, true),
            "m" to mapOf("b" to 1, "B" to 2, "_" to 3),
        )
        assertEquals("{\"a\":[1,null,true],\"m\":{\"B\":2,\"_\":3,\"b\":1},\"z\":\"q\\\"\\\\\\n\\t\\u0001é\"}", CanonicalJson.encode(value))
    }

    @Test(expected = IllegalArgumentException::class)
    fun fractionalNumbersAreNeverSigned() {
        CanonicalJson.encode(mapOf("amountPesewas" to 20.5))
    }

    @Test fun fingerprintMatchesTheServer() {
        // deviceKeyFingerprint() in functions/src/lib/deviceKeys.ts for this SPKI.
        val spki = Base64.getDecoder().decode(
            "MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEF4VXu7KwTsYwZF3UylfSu+04nlR7fGPzHGIUavq1zCKiH4sv/ukzdTf+TyYv8lzj8YhfZ1ZdbHB7jYkqLFWAHQ==",
        )
        assertEquals("C722-05A9-E454-0385", DeviceKeys.fingerprint(spki))
    }

    @Test fun signatureIsBase64DerThatVerifiesWithThePublicKey() {
        val pair = KeyPairGenerator.getInstance("EC").apply { initialize(ECGenParameterSpec("secp256r1")) }.generateKeyPair()
        val message = Commands.signingString(commandId, "COLLECTION", "agent-a", "device-a", 1, "2026-10-19T08:00:00Z", payload)
        val sig = DeviceKeys.sign(pair.private, message)
        assertTrue("no line breaks", !sig.contains('\n'))
        val der = Base64.getDecoder().decode(sig)
        assertEquals("DER SEQUENCE", 0x30, der[0].toInt() and 0xFF)

        val publicKey = KeyFactory.getInstance("EC").generatePublic(X509EncodedKeySpec(pair.public.encoded))
        val verifier = Signature.getInstance("SHA256withECDSA").apply {
            initVerify(publicKey)
            update(message.toByteArray(Charsets.UTF_8))
        }
        assertTrue(verifier.verify(der))
    }
}
