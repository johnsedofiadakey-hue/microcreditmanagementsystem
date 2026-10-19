package com.stormglide.susu.agent

import android.content.Intent
import android.os.Build
import android.os.Bundle
import android.os.SystemClock
import android.provider.Settings
import android.view.WindowManager
import androidx.activity.compose.setContent
import androidx.activity.viewModels
import androidx.biometric.BiometricManager
import androidx.biometric.BiometricManager.Authenticators.BIOMETRIC_STRONG
import androidx.biometric.BiometricManager.Authenticators.BIOMETRIC_WEAK
import androidx.biometric.BiometricManager.Authenticators.DEVICE_CREDENTIAL
import androidx.biometric.BiometricPrompt
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.core.content.ContextCompat
import androidx.fragment.app.FragmentActivity
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.stormglide.susu.agent.ui.AgentApp
import com.stormglide.susu.agent.ui.AgentViewModel
import com.stormglide.susu.agent.ui.screens.LockUi
import com.stormglide.susu.agent.ui.theme.SusuTheme

/** A FragmentActivity because BiometricPrompt hosts its UI in a fragment. */
class MainActivity : FragmentActivity() {
    private val vm: AgentViewModel by viewModels()
    private val lock get() = (application as SusuAgentApp).lock

    private var lockUi by mutableStateOf<LockUi>(LockUi.Prompting)
    private var prompting = false
    private lateinit var prompt: BiometricPrompt

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        // Member names and amounts on screen: keep them out of screenshots and the recents view.
        if (!BuildConfig.DEBUG) window.addFlags(WindowManager.LayoutParams.FLAG_SECURE)

        // BiometricPrompt must be created before the activity is started.
        prompt = BiometricPrompt(this, ContextCompat.getMainExecutor(this), object : BiometricPrompt.AuthenticationCallback() {
            override fun onAuthenticationSucceeded(result: BiometricPrompt.AuthenticationResult) {
                prompting = false
                lockUi = LockUi.Prompting
                lock.unlock()
            }

            override fun onAuthenticationError(errorCode: Int, errString: CharSequence) {
                prompting = false
                lockUi = when (errorCode) {
                    BiometricPrompt.ERROR_NO_DEVICE_CREDENTIAL, BiometricPrompt.ERROR_NO_BIOMETRICS -> LockUi.NoScreenLock
                    BiometricPrompt.ERROR_USER_CANCELED, BiometricPrompt.ERROR_NEGATIVE_BUTTON, BiometricPrompt.ERROR_CANCELED ->
                        LockUi.Failed("Not unlocked. Tap Try again to confirm it's you.")
                    BiometricPrompt.ERROR_LOCKOUT, BiometricPrompt.ERROR_LOCKOUT_PERMANENT ->
                        LockUi.Failed("Too many attempts. Use your PIN or pattern, or wait and try again.")
                    else -> LockUi.Failed("$errString. Tap Try again.")
                }
            }

            // A fingerprint that didn't match: the system prompt stays up and lets them retry.
            override fun onAuthenticationFailed() = Unit
        })

        setContent {
            val locked by lock.locked.collectAsStateWithLifecycle()
            SusuTheme {
                AgentApp(
                    vm = vm,
                    locked = locked,
                    lockUi = lockUi,
                    onUnlock = ::authenticate,
                    onOpenSecuritySettings = { startActivity(Intent(Settings.ACTION_SECURITY_SETTINGS)) },
                )
            }
        }
    }

    override fun onStart() {
        super.onStart()
        lock.onForeground(SystemClock.elapsedRealtime())
    }

    override fun onStop() {
        super.onStop()
        // Not while our own prompt is up: on older Android the PIN screen is a separate activity.
        if (!prompting) lock.onBackground(SystemClock.elapsedRealtime())
    }

    private fun authenticate() {
        if (prompting || !lock.locked.value) return
        val allowed = allowedAuthenticators()
        if (BiometricManager.from(this).canAuthenticate(allowed) != BiometricManager.BIOMETRIC_SUCCESS) {
            lockUi = LockUi.NoScreenLock
            return
        }
        val info = BiometricPrompt.PromptInfo.Builder()
            .setTitle("Unlock Susu Agent")
            .setSubtitle("Confirm it's you to see your route and records")
            .setAllowedAuthenticators(allowed)
            .setConfirmationRequired(false)
            .build()
        prompting = true
        lockUi = LockUi.Prompting
        prompt.authenticate(info)
    }

    /**
     * Strong biometric, or the phone's PIN / pattern / password. Android 9–10 can't combine STRONG with
     * DEVICE_CREDENTIAL, so there the biometric class is WEAK (still backed up by the device credential).
     */
    private fun allowedAuthenticators(): Int =
        if (Build.VERSION.SDK_INT in Build.VERSION_CODES.P..Build.VERSION_CODES.Q) BIOMETRIC_WEAK or DEVICE_CREDENTIAL
        else BIOMETRIC_STRONG or DEVICE_CREDENTIAL
}
