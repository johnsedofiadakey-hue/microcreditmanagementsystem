package com.stormglide.susu.agent.ui.screens

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ArrowBack
import androidx.compose.material.icons.automirrored.outlined.Backspace
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.AssistChip
import androidx.compose.material3.Button
import androidx.compose.material3.FilledTonalButton
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.stormglide.susu.agent.data.Cedis
import com.stormglide.susu.agent.data.Commands
import com.stormglide.susu.agent.ui.Avatar
import com.stormglide.susu.agent.ui.CollectionDraft
import com.stormglide.susu.agent.ui.theme.SusuColors

/**
 * Enter the cash the member handed over. Big keys for one-handed outdoor use. The amount is kept
 * as typed text and parsed strictly into integer pesewas; nothing here does float arithmetic.
 */
@Composable
fun CollectScreen(draft: CollectionDraft, onBack: () -> Unit, onSave: (Long) -> Unit) {
    var typed by rememberSaveable(draft.commandId) { mutableStateOf("") }
    var confirming by rememberSaveable(draft.commandId) { mutableStateOf(false) }
    val pesewas = Cedis.parse(typed)
    val valid = pesewas != null && Commands.isValidCollectionAmount(pesewas)
    val tooHigh = pesewas != null && pesewas > Commands.COLLECTION_MAX_PESEWAS

    fun press(key: String) {
        val next = when (key) {
            "⌫" -> typed.dropLast(1)
            "." -> if (typed.contains('.')) typed else (typed.ifEmpty { "0" } + ".")
            else -> {
                val decimals = typed.substringAfter('.', "")
                if (typed.contains('.') && decimals.length >= 2) typed
                else if (typed == "0") key
                else typed + key
            }
        }
        if (next.length <= 9) typed = next
    }

    Column(Modifier.fillMaxSize().padding(16.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            IconButton(onClick = onBack, enabled = !draft.saving) {
                Icon(Icons.AutoMirrored.Outlined.ArrowBack, contentDescription = "Back to route")
            }
            Spacer(Modifier.padding(4.dp))
            Avatar(draft.member.fullName)
            Spacer(Modifier.padding(6.dp))
            Column {
                Text(draft.member.fullName, style = MaterialTheme.typography.titleLarge)
                Text(draft.member.phoneMasked, style = MaterialTheme.typography.bodyMedium, color = SusuColors.Muted)
            }
        }

        Spacer(Modifier.height(24.dp))
        Text("Amount received", style = MaterialTheme.typography.labelLarge, color = SusuColors.Muted)
        Text(
            text = if (typed.isEmpty()) "GH₵ 0.00" else "GH₵ $typed",
            fontSize = 48.sp,
            style = MaterialTheme.typography.displaySmall,
            color = if (typed.isEmpty()) SusuColors.Muted else MaterialTheme.colorScheme.onBackground,
            modifier = Modifier.semantics { liveRegion = LiveRegionMode.Polite },
        )
        Text(
            when {
                tooHigh -> "Above the ${Cedis.format(Commands.COLLECTION_MAX_PESEWAS)} limit per collection."
                pesewas != null && pesewas > 0 -> "Will be recorded as ${Cedis.format(pesewas)}"
                else -> "Count the cash with the member, then type it."
            },
            style = MaterialTheme.typography.bodyMedium,
            color = if (tooHigh) MaterialTheme.colorScheme.error else SusuColors.Muted,
        )

        if (draft.member.expectedPesewas > 0) {
            Spacer(Modifier.height(10.dp))
            AssistChip(
                onClick = { typed = (draft.member.expectedPesewas / 100).toString() + (draft.member.expectedPesewas % 100).let { if (it == 0L) "" else ".${it.toString().padStart(2, '0')}" } },
                label = { Text("Expected ${Cedis.format(draft.member.expectedPesewas)}") },
            )
        }

        Spacer(Modifier.weight(1f))
        Keypad(onKey = ::press)
        Spacer(Modifier.height(12.dp))
        Button(
            onClick = { confirming = true },
            enabled = valid && !draft.saving,
            modifier = Modifier.fillMaxWidth().height(60.dp),
        ) { Text("Review collection", style = MaterialTheme.typography.labelLarge) }
    }

    if (confirming && pesewas != null) {
        AlertDialog(
            onDismissRequest = { if (!draft.saving) confirming = false },
            title = { Text("Save ${Cedis.format(pesewas)}?") },
            text = {
                Text(
                    "From ${draft.member.fullName}. Say the amount back to the member before saving. " +
                        "A saved collection can't be edited or deleted — corrections go through the branch.",
                )
            },
            confirmButton = {
                Button(onClick = { onSave(pesewas) }, enabled = !draft.saving, modifier = Modifier.height(48.dp)) {
                    Text(if (draft.saving) "Saving…" else "Save collection")
                }
            },
            dismissButton = {
                TextButton(onClick = { confirming = false }, enabled = !draft.saving, modifier = Modifier.height(48.dp)) {
                    Text("Change amount")
                }
            },
        )
    }
}

@Composable
private fun Keypad(onKey: (String) -> Unit) {
    val rows = listOf(listOf("1", "2", "3"), listOf("4", "5", "6"), listOf("7", "8", "9"), listOf(".", "0", "⌫"))
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        rows.forEach { row ->
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                row.forEach { key ->
                    FilledTonalButton(
                        onClick = { onKey(key) },
                        modifier = Modifier.weight(1f).height(64.dp),
                    ) {
                        if (key == "⌫") {
                            Icon(Icons.AutoMirrored.Outlined.Backspace, contentDescription = "Delete")
                        } else {
                            Text(key, fontSize = 26.sp, textAlign = TextAlign.Center)
                        }
                    }
                }
            }
        }
    }
}
