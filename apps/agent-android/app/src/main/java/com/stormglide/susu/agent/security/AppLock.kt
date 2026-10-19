package com.stormglide.susu.agent.security

import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

/**
 * When the agent must prove it is them (biometric or screen lock) before a signed-in screen shows.
 * Locked on every cold start, and again when the app comes back after [timeoutMs] or more in the background.
 *
 * Lives on the Application, so it survives activity recreation but not a new process. Times come from a
 * monotonic clock (SystemClock.elapsedRealtime), so changing the phone's clock can't skip the lock.
 */
class AppLock(private val timeoutMs: Long = DEFAULT_TIMEOUT_MS) {
    private val _locked = MutableStateFlow(true)
    val locked: StateFlow<Boolean> = _locked.asStateFlow()

    private var backgroundedAt: Long? = null

    /** The app left the foreground (Activity.onStop). */
    fun onBackground(nowMs: Long) {
        if (backgroundedAt == null) backgroundedAt = nowMs
    }

    /** The app is visible again (Activity.onStart). Locks if it was away for [timeoutMs] or more. */
    fun onForeground(nowMs: Long) {
        val since = backgroundedAt ?: return
        backgroundedAt = null
        if (nowMs - since >= timeoutMs || nowMs < since) _locked.value = true
    }

    /** The agent passed BiometricPrompt, or just signed in with their password. */
    fun unlock() {
        _locked.value = false
    }

    fun lock() {
        _locked.value = true
    }

    companion object {
        const val DEFAULT_TIMEOUT_MS: Long = 5 * 60 * 1000L
    }
}
