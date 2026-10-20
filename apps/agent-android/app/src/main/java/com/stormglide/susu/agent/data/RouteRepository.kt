package com.stormglide.susu.agent.data

import com.google.firebase.firestore.FirebaseFirestore
import com.google.firebase.firestore.ListenerRegistration
import kotlinx.coroutines.channels.awaitClose
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.callbackFlow
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import java.time.Duration
import java.time.LocalDate
import java.time.ZoneOffset

/** Today's route for the agent's pair: a read-only copy written by Functions (API.md §4). Empty until a supervisor assigns members. */
class RouteRepository(private val db: FirebaseFirestore) {

    fun today(agentPairId: String): Flow<List<RouteMember>> = callbackFlow {
        // Accra is on GMT all year, so the UTC date is the local date.
        var day = LocalDate.now(ZoneOffset.UTC)
        var registration: ListenerRegistration? = null
        fun listen(date: LocalDate) {
            registration?.remove()
            // An old cached route must not remain visible while today's document loads.
            trySend(emptyList())
            registration = db.collection("agentPairs").document(agentPairId)
                .collection("routes").document(date.toString())
                .addSnapshotListener { snapshot, _ ->
                    if (date != day) return@addSnapshotListener
                    @Suppress("UNCHECKED_CAST")
                    val members = (snapshot?.get("members") as? List<Map<String, Any?>>).orEmpty().mapNotNull { m ->
                        RouteMember(
                            memberId = m["memberId"] as? String ?: return@mapNotNull null,
                            susuAccountId = m["susuAccountId"] as? String ?: return@mapNotNull null,
                            fullName = m["fullName"] as? String ?: "Member",
                            phoneMasked = m["phoneMasked"] as? String ?: "",
                            expectedPesewas = (m["expectedPesewas"] as? Number)?.toLong() ?: 0L,
                        )
                    }
                    trySend(members)
                }
        }
        listen(day)
        val rollover = launch {
            while (isActive) {
                val now = java.time.ZonedDateTime.now(ZoneOffset.UTC)
                val nextMidnight = now.toLocalDate().plusDays(1).atStartOfDay(ZoneOffset.UTC)
                delay(Duration.between(now, nextMidnight).toMillis().coerceAtLeast(1_000L))
                val current = LocalDate.now(ZoneOffset.UTC)
                if (current != day) {
                    day = current
                    listen(day)
                }
            }
        }
        awaitClose {
            rollover.cancel()
            registration?.remove()
        }
    }
}
