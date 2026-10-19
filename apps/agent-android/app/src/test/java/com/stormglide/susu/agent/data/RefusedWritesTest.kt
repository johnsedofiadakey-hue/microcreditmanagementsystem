package com.stormglide.susu.agent.data

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class RefusedWritesTest {
    private val agent = "agent-a"
    private val commandId = "0f8fad5b-d9cb-469f-a165-70867728950e"

    private fun command(seq: Long = 7, amount: Long = 2000, agentUid: String = agent) = Commands.collection(
        agentUid = agentUid,
        deviceId = "device-a",
        seq = seq,
        capturedAt = "2026-10-19T08:00:00Z",
        appVersion = "0.1.0",
        memberId = "2b7c9a10-1f2e-4d3c-8b4a-5e6f7a8b9c01",
        susuAccountId = "7d1e2f30-4a5b-4c6d-9e7f-8a9b0c1d2e01",
        amountPesewas = amount,
    )

    @Test fun buildsFromTheEnvelopeThatWasWritten() {
        val w = RefusedWrite.fromCommand(commandId, command())!!
        assertEquals(agent, w.agentUid)
        assertEquals(commandId, w.id)
        assertEquals(7L, w.seq)
        assertEquals(2000L, w.amountPesewas)
        assertEquals("2b7c9a10-1f2e-4d3c-8b4a-5e6f7a8b9c01", w.memberId)
    }

    @Test fun ignoresSomethingThatIsNotACommand() {
        assertNull(RefusedWrite.fromCommand(commandId, mapOf("type" to "COLLECTION")))
    }

    @Test fun survivesAJsonRoundTripWithIntegerPesewas() {
        val w = RefusedWrite.fromCommand(commandId, command(amount = 1_000_000))!!
        val back = RefusedWritesJson.decode(RefusedWritesJson.encode(listOf(w)))
        assertEquals(listOf(w), back)
        assertTrue(RefusedWritesJson.encode(listOf(w)).contains("\"amountPesewas\":1000000"))
    }

    @Test fun addingTheSameRefusalTwiceKeepsOne() {
        val w = RefusedWrite.fromCommand(commandId, command())!!
        val once = RefusedWritesJson.add(null, w)
        val twice = RefusedWritesJson.add(once, w)
        assertEquals(1, RefusedWritesJson.decode(twice).size)
    }

    @Test fun badStoredDataIsSkippedNotFatal() {
        assertEquals(emptyList<RefusedWrite>(), RefusedWritesJson.decode("not json"))
        assertEquals(emptyList<RefusedWrite>(), RefusedWritesJson.decode(null))
        val good = RefusedWritesJson.encode(listOf(RefusedWrite.fromCommand(commandId, command())!!))
        val mixed = good.dropLast(1) + ",{\"id\":\"broken\"}]"
        assertEquals(1, RefusedWritesJson.decode(mixed).size)
    }

    @Test fun showsAsRejectedWithTheLocalReason() {
        val q = RefusedWrite.fromCommand(commandId, command())!!.toQueued()
        assertEquals(SyncState.REJECTED, q.state)
        assertEquals("LOCAL_PERMISSION_DENIED", q.reason)
        assertFalse("a refused write can never sync, so it must not hold up sign-out", q.onPhoneOnly)
    }

    @Test fun mergeShowsOnlyThisAgentsRefusalsAndPrefersFirestore() {
        val mine = RefusedWrite.fromCommand(commandId, command(seq = 3))!!
        val theirs = RefusedWrite.fromCommand("1b9d6bcd-bbfd-4b2d-9b5d-ab8dfbbd4bed", command(seq = 4, agentUid = "agent-b"))!!
        val synced = QueuedCommand(
            id = "6ec0bd7f-11c0-43da-975e-2a8ad9ebae0b", seq = 5, capturedAt = "", memberId = "", susuAccountId = "",
            amountPesewas = 500, state = SyncState.SYNCED, onPhoneOnly = false,
        )
        val merged = CommandQueue.merge(listOf(synced), listOf(mine, theirs), agent)
        assertEquals(listOf(synced.id, mine.id), merged.map { it.id })

        // If Firestore has a document with the same ID, its state wins.
        val fromServer = synced.copy(id = mine.id, seq = 3)
        assertEquals(listOf(fromServer), CommandQueue.merge(listOf(fromServer), listOf(mine), agent))
    }
}
