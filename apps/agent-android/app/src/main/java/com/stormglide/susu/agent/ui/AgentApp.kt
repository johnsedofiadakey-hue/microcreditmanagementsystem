package com.stormglide.susu.agent.ui

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Groups
import androidx.compose.material.icons.outlined.PhoneAndroid
import androidx.compose.material.icons.automirrored.outlined.ReceiptLong
import androidx.compose.material3.Badge
import androidx.compose.material3.BadgedBox
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.stormglide.susu.agent.data.AuthState
import com.stormglide.susu.agent.ui.screens.CollectScreen
import com.stormglide.susu.agent.ui.screens.LockScreen
import com.stormglide.susu.agent.ui.screens.LockUi
import com.stormglide.susu.agent.ui.screens.SigningOutScreen
import com.stormglide.susu.agent.ui.screens.NotReadyScreen
import com.stormglide.susu.agent.ui.screens.PhoneScreen
import com.stormglide.susu.agent.ui.screens.QueueScreen
import com.stormglide.susu.agent.ui.screens.RouteScreen
import com.stormglide.susu.agent.ui.screens.SignInScreen

private enum class Tab(val label: String) { ROUTE("Route"), RECORDS("Records"), PHONE("Phone") }

/**
 * @param locked true until the agent passes the biometric / screen-lock prompt (cold start, or 5+ minutes away).
 * @param onUnlock shows the system prompt. Called once automatically whenever the lock screen appears.
 */
@Composable
fun AgentApp(
    vm: AgentViewModel,
    locked: Boolean,
    lockUi: LockUi,
    onUnlock: () -> Unit,
    onOpenSecuritySettings: () -> Unit,
) {
    val auth by vm.auth.collectAsStateWithLifecycle()
    val signingOut by vm.signingOut.collectAsStateWithLifecycle()
    if (signingOut) {
        SigningOutScreen()
        return
    }
    val state = auth
    // Nothing from a signed-in session (names, amounts, device ID) shows until the agent has unlocked.
    if (locked && (state is AuthState.Ready || state is AuthState.NotReady)) {
        LaunchedEffect(Unit) { onUnlock() }
        LockScreen(lockUi, onUnlock = onUnlock, onOpenSecuritySettings = onOpenSecuritySettings)
        return
    }
    when (state) {
        AuthState.Loading -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { CircularProgressIndicator() }
        AuthState.SignedOut -> {
            val ui by vm.signIn.collectAsStateWithLifecycle()
            SignInScreen(ui, vm::signIn)
        }
        is AuthState.NotReady -> NotReadyScreen(state.email, state.message, onRetry = { vm.refreshAccess() }, onSignOut = { vm.signOut() })
        is AuthState.Ready -> SignedIn(vm, state)
    }
}

@Composable
private fun SignedIn(vm: AgentViewModel, state: AuthState.Ready) {
    val route by vm.route.collectAsStateWithLifecycle()
    val queue by vm.queue.collectAsStateWithLifecycle()
    val unsynced by vm.unsyncedCount.collectAsStateWithLifecycle()
    val pending by vm.pendingCount.collectAsStateWithLifecycle()
    val rejected by vm.rejectedCount.collectAsStateWithLifecycle()
    val online by vm.online.collectAsStateWithLifecycle()
    val draft by vm.draft.collectAsStateWithLifecycle()
    val deviceId by vm.deviceId.collectAsStateWithLifecycle()
    val fingerprint by vm.fingerprint.collectAsStateWithLifecycle()
    val enrollment by vm.enrollment.collectAsStateWithLifecycle()
    val notice by vm.notice.collectAsStateWithLifecycle()
    var tab by rememberSaveable { mutableStateOf(Tab.ROUTE) }
    val snackbar = remember { SnackbarHostState() }

    LaunchedEffect(notice) {
        notice?.let {
            snackbar.showSnackbar(it)
            vm.consumeNotice()
        }
    }

    Scaffold(
        snackbarHost = { SnackbarHost(snackbar) },
        topBar = { SyncBanner(unsynced = unsynced, pending = pending, rejected = rejected, online = online) },
        bottomBar = {
            if (draft == null) {
                NavigationBar {
                    Tab.entries.forEach { t ->
                        NavigationBarItem(
                            selected = tab == t,
                            onClick = { tab = t },
                            label = { Text(t.label) },
                            icon = {
                                val icon = when (t) {
                                    Tab.ROUTE -> Icons.Outlined.Groups
                                    Tab.RECORDS -> Icons.AutoMirrored.Outlined.ReceiptLong
                                    Tab.PHONE -> Icons.Outlined.PhoneAndroid
                                }
                                if (t == Tab.RECORDS && pending > 0) {
                                    BadgedBox(badge = { Badge { Text("$pending") } }) { Icon(icon, contentDescription = null) }
                                } else {
                                    Icon(icon, contentDescription = null)
                                }
                            },
                        )
                    }
                }
            }
        },
    ) { padding ->
        Column(Modifier.padding(padding)) {
            val current = draft
            if (current != null) {
                BackHandler { vm.cancelCollection() }
                CollectScreen(
                    draft = current,
                    onBack = vm::cancelCollection,
                    onSave = { amount ->
                        vm.saveCollection(amount) {
                            tab = Tab.RECORDS
                        }
                    },
                )
            } else {
                when (tab) {
                    Tab.ROUTE -> RouteScreen(route, queue, onCollect = vm::startCollection)
                    Tab.RECORDS -> QueueScreen(queue, vm::memberName)
                    Tab.PHONE -> PhoneScreen(state.session, deviceId, fingerprint, enrollment, unsynced, onSignOut = { vm.signOut() })
                }
            }
        }
    }
}
