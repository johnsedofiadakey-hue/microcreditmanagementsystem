package com.stormglide.susu.agent.data

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.Instant

class CommandsTest {
    @Test fun commandIdsAreFreshUuidV4() {
        val a = Commands.newCommandId()
        val b = Commands.newCommandId()
        assertTrue(Commands.isUuidV4(a))
        assertNotEquals(a, b)
    }

    @Test fun collectionHasExactlyTheContractFields() {
        var signed = ""
        val command = Commands.collection(
            commandId = "0f8fad5b-d9cb-469f-a165-70867728950e",
            agentUid = "agent-a",
            deviceId = "device-a",
            seq = 42,
            capturedAt = Commands.capturedAt(Instant.parse("2026-10-18T09:15:00.987Z")),
            appVersion = "0.1.0",
            memberId = "2b7c9a10-1f2e-4d3c-8b4a-5e6f7a8b9c01",
            susuAccountId = "7d1e2f30-4a5b-4c6d-9e7f-8a9b0c1d2e01",
            amountPesewas = 2000,
            sign = { message -> signed = message; "c2lnbmF0dXJlLWZvci10ZXN0" },
        )
        // firestore.rules: keys().hasOnly([...]) && hasAll([...])
        assertEquals(setOf("type", "agentUid", "deviceId", "seq", "capturedAt", "appVersion", "payload", "sig"), command.keys)
        assertEquals("c2lnbmF0dXJlLWZvci10ZXN0", command["sig"])
        assertTrue(signed.startsWith("susu-cmd-v1|0f8fad5b-d9cb-469f-a165-70867728950e|COLLECTION|agent-a|device-a|42|"))
        assertEquals("COLLECTION", command["type"])
        assertEquals("2026-10-18T09:15:00Z", command["capturedAt"])
        assertTrue((command["capturedAt"] as String).length <= 40)
        @Suppress("UNCHECKED_CAST")
        val payload = command["payload"] as Map<String, Any>
        assertEquals(setOf("memberId", "susuAccountId", "amountPesewas"), payload.keys)
        assertEquals(2000L, payload["amountPesewas"])
    }

    @Test fun amountLimitsMatchTheContract() {
        assertFalse(Commands.isValidCollectionAmount(0))
        assertTrue(Commands.isValidCollectionAmount(1))
        assertTrue(Commands.isValidCollectionAmount(1_000_000))
        assertFalse(Commands.isValidCollectionAmount(1_000_001))
    }

    @Test fun handoverDeclarationSignsCanonicalBusinessLinesWithoutMovingMoney() {
        var signed = ""
        val id = "0f8fad5b-d9cb-469f-a165-70867728950e"
        val business = "0b5e55e5-0000-4000-8000-000000000001"
        val command = Commands.handoverDeclaration(
            commandId = id,
            agentUid = "agent-a",
            deviceId = "device-a",
            seq = 43,
            capturedAt = "2026-10-21T12:00:00Z",
            appVersion = "0.1.0",
            lines = listOf(HandoverAmount(business, 2_000)),
            sign = { signed = it; "c2lnbmF0dXJlLWZvci10ZXN0" },
        )
        assertEquals(Commands.HANDOVER_DECLARATION, command["type"])
        assertEquals(setOf("type", "agentUid", "deviceId", "seq", "capturedAt", "appVersion", "payload", "sig"), command.keys)
        assertEquals(
            "susu-cmd-v1|$id|HANDOVER_DECLARATION|agent-a|device-a|43|2026-10-21T12:00:00Z|{\"lines\":[{\"businessId\":\"$business\",\"declaredPesewas\":2000}]}",
            signed,
        )
    }

    @Test fun deviceProblemsTellTheAgentToStop() {
        assertTrue(RejectionGuidance.isDeviceProblem("DEVICE_REVOKED"))
        assertTrue(RejectionGuidance.isDeviceProblem("DEVICE_NOT_ENROLLED"))
        assertTrue(RejectionGuidance.isDeviceProblem("AGENT_NOT_IN_PAIR"))
        assertFalse(RejectionGuidance.isDeviceProblem("MEMBER_NOT_ACTIVE"))
        assertTrue(RejectionGuidance.forReason("AGENT_PAIR_NOT_ACTIVE").contains("Sign out"))
        assertTrue(RejectionGuidance.forReason("INVALID_SIGNATURE").contains("Report"))
    }
}
