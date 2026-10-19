package com.stormglide.susu.agent.ui.screens

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.Logout
import androidx.compose.material.icons.outlined.ContentCopy
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.unit.dp
import com.stormglide.susu.agent.BuildConfig
import com.stormglide.susu.agent.data.AgentSession
import com.stormglide.susu.agent.ui.theme.SusuColors

@Composable
fun PhoneScreen(session: AgentSession, deviceId: String, unsynced: Int, onSignOut: () -> Unit) {
    @Suppress("DEPRECATION")
    val clipboard = LocalClipboardManager.current
    Column(
        Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        Text("This phone", style = MaterialTheme.typography.headlineSmall)

        Card(colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface)) {
            Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                Text("Device ID", style = MaterialTheme.typography.labelLarge, color = SusuColors.Muted)
                SelectionContainer {
                    Text(deviceId, fontFamily = FontFamily.Monospace, style = MaterialTheme.typography.titleMedium)
                }
                Text(
                    "Your supervisor binds this ID to you in the portal (Devices → Bind phone). " +
                        "Until then, collections you record will be rejected.",
                    style = MaterialTheme.typography.bodyMedium,
                )
                OutlinedButton(onClick = { clipboard.setText(AnnotatedString(deviceId)) }, modifier = Modifier.height(48.dp)) {
                    Icon(Icons.Outlined.ContentCopy, contentDescription = null)
                    Text("  Copy device ID")
                }
            }
        }

        Card(colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface)) {
            Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                Text(session.displayName ?: session.email ?: "Agent", style = MaterialTheme.typography.titleMedium)
                session.email?.let { Text(it, style = MaterialTheme.typography.bodyMedium, color = SusuColors.Muted) }
                Text("Agent pair ${session.agentPairId.take(8)}", style = MaterialTheme.typography.bodyMedium, color = SusuColors.Muted)
                Text("App ${BuildConfig.VERSION_NAME}", style = MaterialTheme.typography.bodyMedium, color = SusuColors.Muted)
            }
        }

        if (unsynced > 0) {
            Text(
                "You can't sign out yet: $unsynced ${if (unsynced == 1) "record is" else "records are"} still only on this phone. " +
                    "Signing out now could lose them. Connect to the internet and wait for “Synced”.",
                style = MaterialTheme.typography.bodyLarge,
                color = SusuColors.Warning,
            )
        }
        OutlinedButton(
            onClick = onSignOut,
            enabled = unsynced == 0,
            modifier = Modifier.fillMaxWidth().height(56.dp),
        ) {
            Icon(Icons.AutoMirrored.Outlined.Logout, contentDescription = null)
            Text(if (unsynced == 0) "  Sign out" else "  Sign out blocked · $unsynced unsynced")
        }
    }
}
