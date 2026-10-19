package com.stormglide.susu.agent.security

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class AppLockTest {
    private val fiveMinutes = AppLock.DEFAULT_TIMEOUT_MS

    @Test fun lockedOnColdStart() {
        assertTrue(AppLock().locked.value)
    }

    @Test fun unlockOpensIt() {
        val lock = AppLock()
        lock.unlock()
        assertFalse(lock.locked.value)
    }

    @Test fun shortTripToBackgroundStaysUnlocked() {
        val lock = AppLock().apply { unlock() }
        lock.onBackground(1_000)
        lock.onForeground(1_000 + fiveMinutes - 1)
        assertFalse(lock.locked.value)
    }

    @Test fun fiveMinutesInBackgroundLocks() {
        val lock = AppLock().apply { unlock() }
        lock.onBackground(1_000)
        lock.onForeground(1_000 + fiveMinutes)
        assertTrue(lock.locked.value)
    }

    @Test fun backgroundTimeIsMeasuredFromTheFirstStop() {
        val lock = AppLock().apply { unlock() }
        lock.onBackground(0)
        lock.onBackground(fiveMinutes - 10) // a second onStop must not restart the clock
        lock.onForeground(fiveMinutes)
        assertTrue(lock.locked.value)
    }

    @Test fun eachForegroundUsesItsOwnBackgroundTime() {
        val lock = AppLock().apply { unlock() }
        lock.onBackground(0)
        lock.onForeground(10)
        lock.onForeground(fiveMinutes * 2) // no background since the last foreground
        assertFalse(lock.locked.value)
    }

    @Test fun clockGoingBackwardsLocks() {
        val lock = AppLock().apply { unlock() }
        lock.onBackground(10_000)
        lock.onForeground(5_000)
        assertTrue(lock.locked.value)
    }
}
