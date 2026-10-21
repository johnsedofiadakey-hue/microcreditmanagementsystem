package com.stormglide.susu.agent.ui.screens

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.unit.dp
import com.stormglide.susu.agent.data.Cedis
import com.stormglide.susu.agent.data.Commands
import com.stormglide.susu.agent.data.QueuedCommand
import com.stormglide.susu.agent.data.RejectionGuidance
import com.stormglide.susu.agent.data.SyncState
import com.stormglide.susu.agent.ui.SyncChip
import com.stormglide.susu.agent.ui.theme.SusuColors

/** Everything this agent recorded, newest first. Nothing here can be edited or deleted. */
@Composable
fun QueueScreen(queue: List<QueuedCommand>, memberName: (String) -> String) {
    LazyColumn(
        Modifier.fillMaxSize(),
        contentPadding = PaddingValues(16.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        item {
            Text("Records", style = MaterialTheme.typography.headlineSmall)
            Text(
                "Pending sync means the branch can't see it yet. The member gets an SMS receipt once it's synced.",
                style = MaterialTheme.typography.bodyMedium,
                color = SusuColors.Muted,
            )
        }
        if (queue.isEmpty()) {
            item {
                Text(
                    "No records yet. Collections you save appear here.",
                    style = MaterialTheme.typography.bodyLarge,
                    color = SusuColors.Muted,
                    modifier = Modifier.padding(vertical = 24.dp),
                )
            }
        }
        items(queue, key = { it.id }) { item ->
            Card(
                colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
                modifier = Modifier.fillMaxWidth(),
            ) {
                Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Column(Modifier.weight(1f)) {
                            Text(if (item.type == Commands.HANDOVER_DECLARATION) "Cash handover declaration" else memberName(item.memberId), style = MaterialTheme.typography.titleMedium)
                            Text(
                                "${item.capturedAt.replace('T', ' ').removeSuffix("Z")} · #${item.seq}",
                                style = MaterialTheme.typography.labelMedium,
                                color = SusuColors.Muted,
                            )
                        }
                        if (item.type == Commands.COLLECTION) Text(Cedis.format(item.amountPesewas), style = MaterialTheme.typography.titleMedium)
                    }
                    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                        SyncChip(item.state)
                        when {
                            item.state == SyncState.SYNCED && item.receiptRef != null -> Text(
                                "Receipt ${item.receiptRef}",
                                fontFamily = FontFamily.Monospace,
                                style = MaterialTheme.typography.labelMedium,
                            )
                            item.state == SyncState.RECORDED -> Text(
                                "Declared — waiting for the cashier${item.recordRef?.let { " · $it" } ?: ""}",
                                style = MaterialTheme.typography.labelMedium,
                                color = SusuColors.Muted,
                            )
                            item.state == SyncState.PENDING_SYNC && item.onPhoneOnly -> Text(
                                "Saved on this phone",
                                style = MaterialTheme.typography.labelMedium,
                                color = SusuColors.Muted,
                            )
                            item.state == SyncState.PENDING_SYNC -> Text(
                                "Received, processing",
                                style = MaterialTheme.typography.labelMedium,
                                color = SusuColors.Muted,
                            )
                        }
                    }
                    if (item.state == SyncState.REJECTED || item.state == SyncState.FAILED) {
                        item.message?.let { Text(it, style = MaterialTheme.typography.bodyMedium) }
                        Text(
                            if (item.state == SyncState.FAILED) RejectionGuidance.FAILED_GUIDANCE
                            else RejectionGuidance.forReason(item.reason),
                            style = MaterialTheme.typography.bodyMedium,
                            color = if (item.state == SyncState.FAILED) SusuColors.Warning else MaterialTheme.colorScheme.error,
                        )
                    }
                }
            }
        }
    }
}
