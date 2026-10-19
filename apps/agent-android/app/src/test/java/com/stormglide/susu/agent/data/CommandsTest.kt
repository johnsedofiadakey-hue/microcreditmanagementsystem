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
        val command = Commands.collection(
            agentUid = "agent-a",
            deviceId = "device-a",
            seq = 42,
            capturedAt = Commands.capturedAt(Instant.parse("2026-10-18T09:15:00.987Z")),
            appVersion = "0.1.0",
            memberId = "2b7c9a10-1f2e-4d3c-8b4a-5e6f7a8b9c01",
            susuAccountId = "7d1e2f30-4a5b-4c6d-9e7f-8a9b0c1d2e01",
            amountPesewas = 2000,
        )
        // firestore.rules: keys().hasOnly([...]) && hasAll([...])
        assertEquals(setOf("type", "agentUid", "deviceId", "seq", "capturedAt", "appVersion", "payload"), command.keys)
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

    @Test fun deviceProblemsTellTheAgentToStop() {
        assertTrue(RejectionGuidance.isDeviceProblem("DEVICE_REVOKED"))
        assertFalse(RejectionGuidance.isDeviceProblem("MEMBER_NOT_ACTIVE"))
    }
}
