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
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import com.stormglide.susu.agent.data.Cedis
import com.stormglide.susu.agent.data.HandoverAmount
import com.stormglide.susu.agent.data.HandoverDeclaration
import com.stormglide.susu.agent.ui.theme.SusuColors

/** Pair-scoped handover history and declaration form. Server-confirmed lines are read-only. */
@Composable
fun HandoverScreen(
    handovers: List<HandoverDeclaration>,
    saving: Boolean,
    onDeclare: (List<HandoverAmount>) -> Unit,
) {
    val knownBusinesses = remember(handovers) {
        handovers.flatMap { it.lines }.distinctBy { it.businessId }.map { it.businessId to it.businessName }
    }
    val amounts = remember { mutableStateMapOf<String, String>() }
    var confirming by remember { mutableStateOf(false) }
    val lines = knownBusinesses.mapNotNull { (id, _) ->
        Cedis.parse(amounts[id].orEmpty())?.takeIf { it > 0 }?.let { HandoverAmount(id, it) }
    }
    val invalid = amounts.values.any { it.isNotBlank() && (Cedis.parse(it) == null || Cedis.parse(it)!! > 100_000_000L) }

    LazyColumn(
        Modifier.fillMaxSize(),
        contentPadding = PaddingValues(16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        item {
            Text("Cash handover", style = MaterialTheme.typography.headlineSmall)
            Text("Count your pair's cash by business, then declare it. The cashier counts it independently before it reaches the branch vault.", style = MaterialTheme.typography.bodyMedium, color = SusuColors.Muted)
        }
        item {
            Card(Modifier.fillMaxWidth()) {
                Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                    Text("Declare cash to cashier", style = MaterialTheme.typography.titleMedium)
                    if (knownBusinesses.isEmpty()) {
                        Text("Business details are not available for this pair yet. Ask your supervisor to prepare the handover; do not choose a business by guesswork.", style = MaterialTheme.typography.bodyMedium, color = SusuColors.Warning)
                    } else {
                        Text("Enter the cash counted for each business. This phone has no current custody figure, so compare against your paper tally before sending.", style = MaterialTheme.typography.bodyMedium, color = SusuColors.Warning)
                        knownBusinesses.forEach { (id, name) ->
                            OutlinedTextField(
                                value = amounts[id].orEmpty(),
                                onValueChange = { amounts[id] = it },
                                label = { Text(name) },
                                prefix = { Text("GH₵ ") },
                                singleLine = true,
                                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal),
                                modifier = Modifier.fillMaxWidth(),
                            )
                        }
                        if (invalid) Text("Enter valid amounts up to GH₵ 1,000,000 per business.", color = MaterialTheme.colorScheme.error)
                        Button(onClick = { confirming = true }, enabled = lines.isNotEmpty() && !invalid && !saving, modifier = Modifier.fillMaxWidth()) {
                            Text("Review declaration")
                        }
                    }
                }
            }
        }
        item { Text("Pair handover history", style = MaterialTheme.typography.titleMedium) }
        if (handovers.isEmpty()) item { Text("No declarations yet.", color = SusuColors.Muted) }
        items(handovers, key = { it.id }) { declaration ->
            Card(Modifier.fillMaxWidth()) {
                Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text("Declaration ${declaration.id.take(8).uppercase()}", style = MaterialTheme.typography.titleMedium)
                    Text(declaration.capturedAt.replace('T', ' ').removeSuffix("Z"), style = MaterialTheme.typography.labelMedium, color = SusuColors.Muted)
                    declaration.lines.forEach { line ->
                        Column {
                            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                                Text(line.businessName, style = MaterialTheme.typography.bodyMedium)
                                Text(Cedis.format(line.declaredPesewas), style = MaterialTheme.typography.bodyMedium)
                            }
                            Text(when (line.status) {
                                "CONFIRMED" -> "Cashier counted ${Cedis.format(line.countedPesewas ?: 0)}${line.differencePesewas?.takeIf { it != 0L }?.let { " · difference ${Cedis.format(it)}" } ?: ""}"
                                "SUPERSEDED" -> "Replaced by a newer declaration"
                                else -> "Declared — waiting for the cashier"
                            }, style = MaterialTheme.typography.labelMedium, color = if (line.status == "CONFIRMED" && line.differencePesewas?.let { it != 0L } == true) SusuColors.Warning else SusuColors.Muted)
                        }
                    }
                }
            }
        }
    }

    if (confirming && lines.isNotEmpty()) AlertDialog(
        onDismissRequest = { if (!saving) confirming = false },
        title = { Text("Declare this cash?") },
        text = { Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
            lines.forEach { line ->
                Text("${knownBusinesses.first { it.first == line.businessId }.second}: ${Cedis.format(line.declaredPesewas)}", fontFamily = FontFamily.Monospace)
            }
            Text("This is your signed statement. The cashier's independent count will appear here when confirmed.")
        } },
        confirmButton = { Button(onClick = { onDeclare(lines); confirming = false }, enabled = !saving) { Text("Sign and save") } },
        dismissButton = { TextButton(onClick = { confirming = false }, enabled = !saving) { Text("Change amounts") } },
    )
}
