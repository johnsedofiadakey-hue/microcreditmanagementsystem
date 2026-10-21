package com.stormglide.susu.agent.ui.screens

import android.animation.ValueAnimator
import androidx.compose.animation.Crossfade
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.unit.dp
import com.stormglide.susu.agent.BuildConfig
import com.stormglide.susu.agent.ui.SignInUi
import com.stormglide.susu.agent.ui.theme.SusuColors
import kotlin.math.cos
import kotlin.math.sin

private val signInQuotes = listOf(
    "Every cedi deserves a clear record.",
    "Good records make trust visible.",
    "Care is counted in the details.",
)

@Composable
fun SignInScreen(ui: SignInUi, onSignIn: (String, String) -> Unit) {
    var email by rememberSaveable { mutableStateOf("") }
    var password by rememberSaveable { mutableStateOf("") }
    var showPassword by rememberSaveable { mutableStateOf(false) }
    var quoteIndex by rememberSaveable { mutableStateOf(0) }
    val motionEnabled = remember { ValueAnimator.areAnimatorsEnabled() }

    Column(
        Modifier.fillMaxSize().background(SusuColors.Background).verticalScroll(rememberScrollState()).imePadding(),
    ) {
        Box(
            Modifier.fillMaxWidth().height(328.dp).background(
                Brush.linearGradient(listOf(SusuColors.Ink, Color(0xFF1B493B), Color(0xFF102E27))),
            ),
        ) {
            LedgerOrbit(motionEnabled)
            Column(Modifier.fillMaxSize().statusBarsPadding().padding(horizontal = 24.dp, vertical = 18.dp)) {
                Box(
                    Modifier.size(42.dp).background(SusuColors.Accent, RoundedCornerShape(13.dp)),
                    contentAlignment = Alignment.Center,
                ) {
                    Text("S", style = MaterialTheme.typography.headlineSmall, color = SusuColors.Ink)
                }
                Spacer(Modifier.height(24.dp))
                Text("SUSU AGENT", style = MaterialTheme.typography.labelMedium, color = Color(0xFFE7C98F))
                Spacer(Modifier.height(5.dp))
                Text("Your day, accounted for.", style = MaterialTheme.typography.headlineLarge, color = Color(0xFFFFFAF0))
                if (motionEnabled) {
                    Crossfade(targetState = quoteIndex, animationSpec = tween(260), label = "Financial thought") { index ->
                        Text(signInQuotes[index], style = MaterialTheme.typography.bodyMedium, color = Color(0xFFE4EEE5))
                    }
                } else {
                    Text(signInQuotes[quoteIndex], style = MaterialTheme.typography.bodyMedium, color = Color(0xFFE4EEE5))
                }
                TextButton(
                    onClick = { quoteIndex = (quoteIndex + 1) % signInQuotes.size },
                    contentPadding = androidx.compose.foundation.layout.PaddingValues(horizontal = 0.dp, vertical = 0.dp),
                ) {
                    Text("Another thought  →", color = Color(0xFFE7C98F), style = MaterialTheme.typography.labelMedium)
                }
            }
        }
        Column(Modifier.fillMaxWidth().navigationBarsPadding().padding(horizontal = 24.dp, vertical = 25.dp)) {
            Text("Welcome back.", style = MaterialTheme.typography.headlineSmall, color = SusuColors.Ink)
            Spacer(Modifier.height(5.dp))
            Text("Sign in with the work email your branch set up for you.", style = MaterialTheme.typography.bodyMedium, color = SusuColors.Muted)
            if (BuildConfig.USE_EMULATORS) {
                Spacer(Modifier.height(8.dp))
                Text("Development build · local emulators", style = MaterialTheme.typography.labelMedium, color = SusuColors.Muted)
            }
            Spacer(Modifier.height(22.dp))
            OutlinedTextField(
                value = email,
                onValueChange = { email = it },
                label = { Text("Work email") },
                singleLine = true,
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Email, imeAction = ImeAction.Next),
                shape = RoundedCornerShape(14.dp),
                modifier = Modifier.fillMaxWidth(),
            )
            Spacer(Modifier.height(12.dp))
            OutlinedTextField(
                value = password,
                onValueChange = { password = it },
                label = { Text("Password") },
                singleLine = true,
                visualTransformation = if (showPassword) VisualTransformation.None else PasswordVisualTransformation(),
                trailingIcon = {
                    TextButton(onClick = { showPassword = !showPassword }) {
                        Text(if (showPassword) "Hide" else "Show", color = SusuColors.Primary)
                    }
                },
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password, imeAction = ImeAction.Done),
                keyboardActions = KeyboardActions(onDone = { if (email.isNotBlank() && password.isNotEmpty() && !ui.busy) onSignIn(email, password) }),
                shape = RoundedCornerShape(14.dp),
                modifier = Modifier.fillMaxWidth(),
            )
            ui.error?.let {
                Spacer(Modifier.height(12.dp))
                Text(it, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodyMedium)
            }
            Spacer(Modifier.height(18.dp))
            Button(
                onClick = { onSignIn(email, password) },
                enabled = !ui.busy && email.isNotBlank() && password.isNotEmpty(),
                shape = RoundedCornerShape(14.dp),
                modifier = Modifier.fillMaxWidth().height(56.dp),
            ) {
                if (ui.busy) CircularProgressIndicator(Modifier.size(22.dp), strokeWidth = 2.dp) else Text("Sign in  →")
            }
            Spacer(Modifier.height(15.dp))
            Text("Secure field access · Every collection stays pending until confirmed.", style = MaterialTheme.typography.labelMedium, color = SusuColors.Muted)
        }
    }
}

@Composable
private fun LedgerOrbit(motionEnabled: Boolean) {
    val progress = if (motionEnabled) {
        val transition = rememberInfiniteTransition(label = "Ledger orbit")
        val animated by transition.animateFloat(
            initialValue = 0f,
            targetValue = 1f,
            animationSpec = infiniteRepeatable(tween(durationMillis = 28000, easing = LinearEasing)),
            label = "Orbit progress",
        )
        animated
    } else 0f
    Canvas(Modifier.fillMaxSize()) {
        val center = Offset(size.width * 0.9f, size.height * 0.47f)
        val radius = size.width * 0.47f
        val line = Color(0xFFE7C98F).copy(alpha = 0.17f)
        drawCircle(line, radius, center, style = Stroke(width = 1.dp.toPx()))
        drawCircle(line, radius * 0.68f, center, style = Stroke(width = 1.dp.toPx()))
        drawCircle(line, radius * 0.36f, center, style = Stroke(width = 1.dp.toPx()))
        val angle = progress * (Math.PI * 2) - Math.PI / 2
        drawCircle(
            color = SusuColors.Accent.copy(alpha = 0.88f),
            radius = 4.dp.toPx(),
            center = Offset(center.x + cos(angle).toFloat() * radius, center.y + sin(angle).toFloat() * radius),
        )
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
