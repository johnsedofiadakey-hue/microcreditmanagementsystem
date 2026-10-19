package com.stormglide.susu.agent.data

import java.text.DecimalFormat
import java.text.DecimalFormatSymbols
import java.util.Locale

/**
 * Money is integer pesewas (1 GH₵ = 100 pesewas) everywhere. Kotlin mirror of
 * packages/shared/src/money.ts — keep the two in step.
 */
object Cedis {
    /** packages/shared MAX_PESEWAS: GH₵ 1,000,000,000.00. */
    const val MAX_PESEWAS: Long = 100_000_000_000L

    private val formatter = DecimalFormat("#,##0", DecimalFormatSymbols(Locale.US))
    private val strict = Regex("""^(\d+)(?:\.(\d{1,2}))?$""")

    /** 123450 -> "GH₵ 1,234.50". Negative amounts render as "-GH₵ 1,234.50". */
    fun format(pesewas: Long): String {
        val sign = if (pesewas < 0) "-" else ""
        val abs = kotlin.math.abs(pesewas)
        val whole = abs / 100
        val fraction = abs % 100
        val text = formatter.format(whole) + "." + fraction.toString().padStart(2, '0')
        return "${sign}GH₵ $text"
    }

    /**
     * Strict parser for typed amounts: "12", "12.5", "12.50", "1,234.50", "GH₵ 0.05".
     * Returns pesewas, or null for anything ambiguous (more than two decimals, negatives, letters).
     */
    fun parse(input: String): Long? {
        val cleaned = input.trim().removePrefix("GH₵").trim().replace(",", "")
        val match = strict.matchEntire(cleaned) ?: return null
        val wholeText = match.groupValues[1]
        if (wholeText.length > 12) return null
        val whole = wholeText.toLong()
        val fraction = match.groupValues[2].padEnd(2, '0').toLong()
        val pesewas = whole * 100 + fraction
        return if (pesewas in 0..MAX_PESEWAS) pesewas else null
    }
}
