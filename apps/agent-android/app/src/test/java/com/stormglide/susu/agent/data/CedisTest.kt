package com.stormglide.susu.agent.data

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/** Same cases as packages/shared/src/money.test.ts, so the Kotlin mirror can't drift. */
class CedisTest {
    @Test fun formatsPesewasAsCedis() {
        assertEquals("GH₵ 1,234.50", Cedis.format(123450))
        assertEquals("GH₵ 0.05", Cedis.format(5))
        assertEquals("-GH₵ 1.00", Cedis.format(-100))
    }

    @Test fun parsesTypedAmounts() {
        assertEquals(1200L, Cedis.parse("12"))
        assertEquals(1250L, Cedis.parse("12.5"))
        assertEquals(123450L, Cedis.parse("1,234.50"))
        assertEquals(5L, Cedis.parse("GH₵ 0.05"))
    }

    @Test fun rejectsAmbiguousInput() {
        for (bad in listOf("", "-1", "1.234", "abc", "1e3", "0.0.1")) {
            assertNull("\"$bad\" should be rejected", Cedis.parse(bad))
        }
    }
}
