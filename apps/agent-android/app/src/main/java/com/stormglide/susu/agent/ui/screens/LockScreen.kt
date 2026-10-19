package com.stormglide.susu.agent.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Fingerprint
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import com.stormglide.susu.agent.ui.theme.SusuColors

/** Why the lock screen is showing. */
sealed interface LockUi {
    /** The system prompt is up (or about to be). */
    data object Prompting : LockUi

    /** The agent cancelled, or the prompt failed / locked out. They can try again. */
    data class Failed(val message: String) : LockUi

    /** The phone has no screen lock or biometric set up, so the app can't be unlocked yet. */
    data object NoScreenLock : LockUi
}

@Composable
fun LockScreen(ui: LockUi, onUnlock: () -> Unit, onOpenSecuritySettings: () -> Unit) {
    Column(
        Modifier.fillMaxSize().padding(24.dp),
        verticalArrangement = Arrangement.Center,
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Box(
            Modifier.size(88.dp).background(SusuColors.PrimarySoft, CircleShape),
            contentAlignment = Alignment.Center,
        ) {
            Icon(Icons.Outlined.Fingerprint, contentDescription = null, tint = SusuColors.Primary, modifier = Modifier.size(48.dp))
        }
        Spacer(Modifier.height(24.dp))
        Text("Susu Agent is locked", style = MaterialTheme.typography.headlineSmall, textAlign = TextAlign.Center)
        Spacer(Modifier.height(8.dp))
        Text(
            when (ui) {
                LockUi.Prompting -> "Confirm it's you to see your route and records."
                is LockUi.Failed -> ui.message
                LockUi.NoScreenLock -> "Set a fingerprint, PIN or pattern on this phone first. " +
                    "The app holds member names and amounts, so it can't open without one."
            },
            style = MaterialTheme.typography.bodyLarge,
            textAlign = TextAlign.Center,
            color = if (ui is LockUi.Failed) SusuColors.Danger else MaterialTheme.colorScheme.onSurface,
        )
        Spacer(Modifier.height(32.dp))
        if (ui == LockUi.NoScreenLock) {
            Button(onClick = onOpenSecuritySettings, modifier = Modifier.fillMaxWidth().height(56.dp)) {
                Text("Open security settings")
            }
            Spacer(Modifier.height(12.dp))
            OutlinedButton(onClick = onUnlock, modifier = Modifier.fillMaxWidth().height(56.dp)) { Text("Try again") }
        } else {
            Button(onClick = onUnlock, enabled = ui != LockUi.Prompting, modifier = Modifier.fillMaxWidth().height(56.dp)) {
                Text(if (ui is LockUi.Failed) "Try again" else "Unlock")
            }
        }
    }
}

@Composable
fun SigningOutScreen() {
    Column(
        Modifier.fillMaxSize().padding(24.dp),
        verticalArrangement = Arrangement.Center,
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        CircularProgressIndicator()
        Spacer(Modifier.height(16.dp))
        Text("Signing out and clearing this phone…", style = MaterialTheme.typography.bodyLarge, textAlign = TextAlign.Center)
    }
}
