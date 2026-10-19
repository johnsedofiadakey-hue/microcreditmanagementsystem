package com.stormglide.susu.agent.ui.screens

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Search
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.unit.dp
import com.stormglide.susu.agent.data.Cedis
import com.stormglide.susu.agent.data.QueuedCommand
import com.stormglide.susu.agent.data.RouteMember
import com.stormglide.susu.agent.data.SyncState
import com.stormglide.susu.agent.ui.Avatar
import com.stormglide.susu.agent.ui.SyncChip
import com.stormglide.susu.agent.ui.theme.SusuColors

@Composable
fun RouteScreen(
    members: List<RouteMember>,
    queue: List<QueuedCommand>,
    onCollect: (RouteMember) -> Unit,
) {
    var query by rememberSaveable { mutableStateOf("") }
    val visible = members.filter { it.fullName.contains(query.trim(), ignoreCase = true) || it.phoneMasked.contains(query.trim()) }
    val today = java.time.LocalDate.now(java.time.ZoneOffset.UTC).toString()
    val latestToday = queue.filter { it.capturedAt.startsWith(today) && it.state != SyncState.REJECTED }
        .groupBy { it.memberId }

    LazyColumn(
        Modifier.fillMaxSize(),
        contentPadding = PaddingValues(16.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        item {
            Text("Today's route", style = MaterialTheme.typography.headlineSmall)
            Text(
                "${members.size} members · tap a member to record a collection",
                style = MaterialTheme.typography.bodyMedium,
                color = SusuColors.Muted,
            )
        }
        item {
            OutlinedTextField(
                value = query,
                onValueChange = { query = it },
                leadingIcon = { Icon(Icons.Outlined.Search, contentDescription = null) },
                placeholder = { Text("Search by name or phone") },
                singleLine = true,
                modifier = Modifier.fillMaxWidth(),
            )
        }
        if (visible.isEmpty()) {
            item {
                Text(
                    if (members.isEmpty()) "No members on today's route yet. Your supervisor assigns routes; pull down later or check with them."
                    else "No member matches “$query”.",
                    style = MaterialTheme.typography.bodyLarge,
                    color = SusuColors.Muted,
                    modifier = Modifier.padding(vertical = 24.dp),
                )
            }
        }
        items(visible, key = { it.susuAccountId }) { member ->
            val recorded = latestToday[member.memberId].orEmpty()
            Card(
                colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
                modifier = Modifier
                    .fillMaxWidth()
                    .heightIn(min = 72.dp)
                    .clickable(role = Role.Button, onClickLabel = "Record collection") { onCollect(member) },
            ) {
                Row(
                    Modifier.padding(14.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(12.dp),
                ) {
                    Avatar(member.fullName)
                    Column(Modifier.weight(1f)) {
                        Text(member.fullName + if (member.sample) "  · sample" else "", style = MaterialTheme.typography.titleMedium)
                        Text(member.phoneMasked, style = MaterialTheme.typography.bodyMedium, color = SusuColors.Muted)
                        if (recorded.isNotEmpty()) {
                            Text(
                                "Recorded today: ${Cedis.format(recorded.sumOf { it.amountPesewas })}",
                                style = MaterialTheme.typography.labelMedium,
                                color = SusuColors.Primary,
                            )
                        }
                    }
                    Column(horizontalAlignment = Alignment.End) {
                        Text("Expected", style = MaterialTheme.typography.labelMedium, color = SusuColors.Muted)
                        Text(Cedis.format(member.expectedPesewas), style = MaterialTheme.typography.titleMedium)
                        recorded.firstOrNull()?.let { SyncChip(it.state, Modifier.padding(top = 4.dp)) }
                    }
                }
            }
        }
    }
}
