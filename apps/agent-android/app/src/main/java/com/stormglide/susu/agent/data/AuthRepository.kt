package com.stormglide.susu.agent.data

import com.google.firebase.auth.FirebaseAuth
import kotlinx.coroutines.channels.awaitClose
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.callbackFlow
import kotlinx.coroutines.tasks.await

sealed interface AuthState {
    data object Loading : AuthState
    data object SignedOut : AuthState
    /** Signed in but not an agent with a pair yet (no claims, wrong role, or pair not assigned). */
    data class NotReady(val email: String?, val message: String) : AuthState
    data class Ready(val session: AgentSession) : AuthState
}

class AuthRepository(private val auth: FirebaseAuth) {

    /** Re-reads custom claims whenever the ID token changes. */
    fun state(): Flow<AuthState> = callbackFlow {
        val listener = FirebaseAuth.IdTokenListener { firebaseAuth ->
            val user = firebaseAuth.currentUser
            if (user == null) {
                trySend(AuthState.SignedOut)
            } else {
                user.getIdToken(false).addOnCompleteListener { task ->
                    val claims: Map<String, Any?> = if (task.isSuccessful) task.result?.claims.orEmpty() else emptyMap()
                    trySend(resolve(user.uid, user.email, user.displayName, claims))
                }
            }
        }
        auth.addIdTokenListener(listener)
        awaitClose { auth.removeIdTokenListener(listener) }
    }

    suspend fun signIn(email: String, password: String) {
        auth.signInWithEmailAndPassword(email.trim(), password).await()
    }

    /** Pick up changed claims (e.g. after the agent was added to a pair). */
    suspend fun refresh() {
        auth.currentUser?.getIdToken(true)?.await()
    }

    fun signOut() = auth.signOut()

    companion object {
        fun resolve(uid: String, email: String?, displayName: String?, claims: Map<String, Any?>): AuthState {
            val role = claims["role"] as? String
                ?: return AuthState.NotReady(email, "Your account is not set up yet. Contact your administrator.")
            if (role != "AGENT") {
                return AuthState.NotReady(email, "This app is for field agents. Branch staff use the Susu portal.")
            }
            val pair = claims["agentPairId"] as? String
                ?: return AuthState.NotReady(email, "You are not in an agent pair yet. Ask your branch manager to pair you.")
            val branches = (claims["branchIds"] as? List<*>)?.filterIsInstance<String>().orEmpty()
            return AuthState.Ready(AgentSession(uid, email, displayName, pair, branches))
        }
    }
}
