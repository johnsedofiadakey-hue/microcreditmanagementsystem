package com.stormglide.susu.agent.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.CheckCircle
import androidx.compose.material.icons.outlined.CloudOff
import androidx.compose.material.icons.outlined.CloudSync
import androidx.compose.material.icons.outlined.ErrorOutline
import androidx.compose.material.icons.outlined.Schedule
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import com.stormglide.susu.agent.data.SyncState
import com.stormglide.susu.agent.ui.theme.SusuColors

/** Every cash-relevant state is visible and worded the same everywhere (UI brief). */
@Composable
fun SyncChip(state: SyncState, modifier: Modifier = Modifier) {
    val (label, fg, bg) = when (state) {
        SyncState.PENDING_SYNC -> Triple("Pending sync", SusuColors.Warning, SusuColors.WarningSoft)
        SyncState.SYNCED -> Triple("Synced ✓", SusuColors.Success, SusuColors.SuccessSoft)
        SyncState.REJECTED -> Triple("Rejected", SusuColors.Danger, SusuColors.DangerSoft)
        SyncState.FAILED -> Triple("Retrying", SusuColors.Warning, SusuColors.WarningSoft)
    }
    val icon = when (state) {
        SyncState.PENDING_SYNC -> Icons.Outlined.Schedule
        SyncState.SYNCED -> Icons.Outlined.CheckCircle
        else -> Icons.Outlined.ErrorOutline
    }
    Row(
        modifier
            .clip(RoundedCornerShape(50))
            .background(bg)
            .padding(horizontal = 10.dp, vertical = 5.dp)
            .semantics { contentDescription = label },
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(icon, contentDescription = null, tint = fg, modifier = Modifier.size(16.dp))
        Spacer(Modifier.width(6.dp))
        Text(label, color = fg, style = MaterialTheme.typography.labelMedium)
    }
}

/** Sticky banner: how many records are waiting, and whether we're offline. */
@Composable
fun SyncBanner(unsynced: Int, pending: Int, rejected: Int, online: Boolean) {
    val (text, fg, bg, icon) = when {
        rejected > 0 && unsynced == 0 -> Quad(
            "$rejected ${plural(rejected)} rejected · open Records and speak to your supervisor",
            SusuColors.Danger, SusuColors.DangerSoft, Icons.Outlined.ErrorOutline,
        )
        unsynced > 0 && !online -> Quad(
            "Offline · $unsynced saved on this phone, will sync when you're back online",
            SusuColors.Warning, SusuColors.WarningSoft, Icons.Outlined.CloudOff,
        )
        unsynced > 0 -> Quad("Syncing $unsynced ${plural(unsynced)}…", SusuColors.Warning, SusuColors.WarningSoft, Icons.Outlined.CloudSync)
        pending > 0 -> Quad("$pending ${plural(pending)} received, waiting for the server", SusuColors.Warning, SusuColors.WarningSoft, Icons.Outlined.Schedule)
        !online -> Quad("Offline · you can keep recording collections", SusuColors.Muted, Color(0xFFEEF1EE), Icons.Outlined.CloudOff)
        else -> Quad("All records synced", SusuColors.Success, SusuColors.SuccessSoft, Icons.Outlined.CheckCircle)
    }
    Row(
        Modifier
            .fillMaxWidth()
            .background(bg)
            // Edge-to-edge (targetSdk 35+): keep the text below the status bar, the colour behind it.
            .statusBarsPadding()
            .heightIn(min = 48.dp)
            .padding(horizontal = 16.dp, vertical = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        Icon(icon, contentDescription = null, tint = fg, modifier = Modifier.size(20.dp))
        Text(text, color = fg, style = MaterialTheme.typography.labelLarge)
    }
}

@Composable
fun Avatar(name: String, modifier: Modifier = Modifier) {
    val initials = name.split(" ").filter { it.isNotBlank() }.take(2).joinToString("") { it.first().uppercase() }
    Row(
        modifier.size(44.dp).clip(CircleShape).background(SusuColors.PrimarySoft),
        horizontalArrangement = Arrangement.Center,
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(initials, color = SusuColors.Primary, style = MaterialTheme.typography.titleMedium)
    }
}

private fun plural(n: Int) = if (n == 1) "record" else "records"

private data class Quad<A, B, C, D>(val a: A, val b: B, val c: C, val d: D)
