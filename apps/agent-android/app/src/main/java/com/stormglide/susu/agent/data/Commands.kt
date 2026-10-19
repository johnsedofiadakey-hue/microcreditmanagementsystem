package com.stormglide.susu.agent.data

import java.time.Instant
import java.time.ZoneOffset
import java.time.format.DateTimeFormatter
import java.time.temporal.ChronoUnit
import java.util.UUID

/**
 * The agent command envelope, exactly as docs/contracts/API.md §3 and firestore.rules define it.
 * The client writes these eight fields and nothing else; the rules reject extra or missing keys.
 */
object Commands {
    const val COLLECTION = "COLLECTION"

    /** packages/shared COMMAND_SIGNATURE_VERSION. */
    const val SIGNATURE_VERSION = "susu-cmd-v1"

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

    /**
     * The exact UTF-8 string the phone signs and the server verifies (packages/shared `commandSigningString`):
     * `susu-cmd-v1|{commandId}|{type}|{agentUid}|{deviceId}|{seq}|{capturedAt}|{canonicalJson(payload)}`.
     */
    fun signingString(
        commandId: String,
        type: String,
        agentUid: String,
        deviceId: String,
        seq: Long,
        capturedAt: String,
        payload: Map<String, Any?>,
    ): String = listOf(SIGNATURE_VERSION, commandId, type, agentUid, deviceId, seq.toString(), capturedAt, CanonicalJson.encode(payload))
        .joinToString("|")

    /**
     * Build a signed COLLECTION command. [sign] gets the signing string and returns the base64 DER
     * signature (the device's Keystore key in the app; a test key in unit tests).
     */
    fun collection(
        commandId: String,
        agentUid: String,
        deviceId: String,
        seq: Long,
        capturedAt: String,
        appVersion: String,
        memberId: String,
        susuAccountId: String,
        amountPesewas: Long,
        sign: (String) -> String,
    ): Map<String, Any> {
        require(isUuidV4(commandId)) { "command IDs are UUID v4" }
        require(seq >= 1) { "seq starts at 1" }
        require(isValidCollectionAmount(amountPesewas)) { "amount out of range: $amountPesewas" }
        val payload = mapOf(
            "memberId" to memberId,
            "susuAccountId" to susuAccountId,
            "amountPesewas" to amountPesewas,
        )
        val sig = sign(signingString(commandId, COLLECTION, agentUid, deviceId, seq, capturedAt, payload))
        return mapOf(
            "type" to COLLECTION,
            "agentUid" to agentUid,
            "deviceId" to deviceId,
            "seq" to seq,
            "capturedAt" to capturedAt,
            "appVersion" to appVersion,
            "payload" to payload,
            "sig" to sig,
        )
    }
}

/**
 * Same output as packages/shared `canonicalJson`: object keys sorted by UTF-16 code unit, recursively,
 * no whitespace, null-valued keys kept as `null` (Kotlin has no `undefined`). Strings are escaped the
 * way JSON.stringify does it. Only integers are allowed as numbers; money is integer pesewas.
 */
object CanonicalJson {
    fun encode(value: Any?): String = StringBuilder().also { write(it, value) }.toString()

    private fun write(out: StringBuilder, value: Any?) {
        when (value) {
            null -> out.append("null")
            is String -> string(out, value)
            is Boolean -> out.append(value.toString())
            is Int, is Long, is Short, is Byte -> out.append(value.toString())
            is Number -> throw IllegalArgumentException("only integers can be signed, got $value")
            is Map<*, *> -> {
                out.append('{')
                value.entries
                    .map { (k, v) -> (k as? String ?: throw IllegalArgumentException("map keys must be strings")) to v }
                    .sortedWith { a, b -> a.first.compareTo(b.first) }
                    .forEachIndexed { i, (k, v) ->
                        if (i > 0) out.append(',')
                        string(out, k)
                        out.append(':')
                        write(out, v)
                    }
                out.append('}')
            }
            is List<*> -> {
                out.append('[')
                value.forEachIndexed { i, v ->
                    if (i > 0) out.append(',')
                    write(out, v)
                }
                out.append(']')
            }
            else -> throw IllegalArgumentException("can't sign a ${value::class.simpleName}")
        }
    }

    private fun string(out: StringBuilder, s: String) {
        out.append('"')
        for (c in s) {
            when (c) {
                '"' -> out.append("\\\"")
                '\\' -> out.append("\\\\")
                '\b' -> out.append("\\b")
                '\u000C' -> out.append("\\f")
                '\n' -> out.append("\\n")
                '\r' -> out.append("\\r")
                '\t' -> out.append("\\t")
                else -> if (c < ' ') out.append("\\u").append(String.format(java.util.Locale.ROOT, "%04x", c.code)) else out.append(c)
            }
        }
        out.append('"')
    }
}
