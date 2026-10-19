package com.stormglide.susu.agent.data

import java.time.Instant
import java.time.ZoneOffset
import java.time.format.DateTimeFormatter
import java.time.temporal.ChronoUnit
import java.util.UUID

/**
 * The agent command envelope, exactly as docs/contracts/API.md §3 and firestore.rules define it.
 * The client writes these seven fields and nothing else; the rules reject extra keys.
 */
object Commands {
    const val COLLECTION = "COLLECTION"

    /** packages/shared COLLECTION_MAX_PESEWAS: GH₵ 10,000.00 per collection until product rules say otherwise. */
    const val COLLECTION_MAX_PESEWAS: Long = 1_000_000L

    private val uuidV4 = Regex("^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$")

    /** A fresh UUID v4 for one action. Generated once and reused for every retry of that action. */
    fun newCommandId(): String = UUID.randomUUID().toString().also { check(isUuidV4(it)) }

    fun isUuidV4(id: String): Boolean = uuidV4.matches(id)

    /** Phone clock at capture, ISO 8601 with offset ("2026-10-18T09:15:00Z"). Evidence only; server time is official. */
    fun capturedAt(now: Instant): String =
        DateTimeFormatter.ISO_OFFSET_DATE_TIME.format(now.truncatedTo(ChronoUnit.SECONDS).atOffset(ZoneOffset.UTC))

    fun isValidCollectionAmount(pesewas: Long): Boolean = pesewas in 1..COLLECTION_MAX_PESEWAS

    fun collection(
        agentUid: String,
        deviceId: String,
        seq: Long,
        capturedAt: String,
        appVersion: String,
        memberId: String,
        susuAccountId: String,
        amountPesewas: Long,
    ): Map<String, Any> {
        require(seq >= 1) { "seq starts at 1" }
        require(isValidCollectionAmount(amountPesewas)) { "amount out of range: $amountPesewas" }
        return mapOf(
            "type" to COLLECTION,
            "agentUid" to agentUid,
            "deviceId" to deviceId,
            "seq" to seq,
            "capturedAt" to capturedAt,
            "appVersion" to appVersion,
            "payload" to mapOf(
                "memberId" to memberId,
                "susuAccountId" to susuAccountId,
                "amountPesewas" to amountPesewas,
            ),
        )
    }
}
