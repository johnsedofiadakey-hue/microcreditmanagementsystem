package com.stormglide.susu.agent.ui.screens

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import com.stormglide.susu.agent.BuildConfig
import com.stormglide.susu.agent.ui.SignInUi
import com.stormglide.susu.agent.ui.theme.SusuColors

@Composable
fun SignInScreen(ui: SignInUi, onSignIn: (String, String) -> Unit) {
    var email by rememberSaveable { mutableStateOf("") }
    var password by rememberSaveable { mutableStateOf("") }

    Column(
        Modifier.fillMaxSize().padding(24.dp).imePadding(),
        verticalArrangement = Arrangement.Center,
    ) {
        Text("Susu Agent", style = MaterialTheme.typography.displaySmall, color = SusuColors.Primary)
        Spacer(Modifier.height(8.dp))
        Text("Sign in with the work email your branch set up for you.", style = MaterialTheme.typography.bodyLarge)
        if (BuildConfig.USE_EMULATORS) {
            Spacer(Modifier.height(8.dp))
            Text("Development build · local emulators", style = MaterialTheme.typography.labelMedium, color = SusuColors.Muted)
        }
        Spacer(Modifier.height(28.dp))
        OutlinedTextField(
            value = email,
            onValueChange = { email = it },
            label = { Text("Work email") },
            singleLine = true,
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Email, imeAction = ImeAction.Next),
            modifier = Modifier.fillMaxWidth(),
        )
        Spacer(Modifier.height(12.dp))
        OutlinedTextField(
            value = password,
            onValueChange = { password = it },
            label = { Text("Password") },
            singleLine = true,
            visualTransformation = PasswordVisualTransformation(),
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password, imeAction = ImeAction.Done),
            keyboardActions = KeyboardActions(onDone = { if (email.isNotBlank() && password.isNotEmpty()) onSignIn(email, password) }),
            modifier = Modifier.fillMaxWidth(),
        )
        ui.error?.let {
            Spacer(Modifier.height(12.dp))
            Text(it, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodyMedium)
        }
        Spacer(Modifier.height(20.dp))
        Button(
            onClick = { onSignIn(email, password) },
            enabled = !ui.busy && email.isNotBlank() && password.isNotEmpty(),
            modifier = Modifier.fillMaxWidth().height(56.dp),
        ) {
            if (ui.busy) CircularProgressIndicator(Modifier.size(22.dp), strokeWidth = 2.dp) else Text("Sign in")
        }
    }
}

@Composable
fun NotReadyScreen(email: String?, message: String, onRetry: () -> Unit, onSignOut: () -> Unit) {
    Column(Modifier.fillMaxSize().padding(24.dp), verticalArrangement = Arrangement.Center) {
        Text("Almost there", style = MaterialTheme.typography.headlineSmall)
        Spacer(Modifier.height(8.dp))
        Text(message, style = MaterialTheme.typography.bodyLarge)
        email?.let {
            Spacer(Modifier.height(8.dp))
            Text("Signed in as $it", style = MaterialTheme.typography.bodyMedium, color = SusuColors.Muted)
        }
        Spacer(Modifier.height(24.dp))
        Button(onClick = onRetry, modifier = Modifier.fillMaxWidth().height(56.dp)) { Text("Check again") }
        Spacer(Modifier.height(12.dp))
        OutlinedButton(onClick = onSignOut, modifier = Modifier.fillMaxWidth().height(56.dp)) { Text("Sign out") }
    }
}
