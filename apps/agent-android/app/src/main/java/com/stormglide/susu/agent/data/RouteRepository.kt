package com.stormglide.susu.agent.data

import com.google.firebase.firestore.FirebaseFirestore
import kotlinx.coroutines.channels.awaitClose
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.callbackFlow
import java.time.LocalDate
import java.time.ZoneOffset

/** Today's route for the agent's pair: a read-only copy written by Functions (API.md §4). Empty until a supervisor assigns members. */
class RouteRepository(private val db: FirebaseFirestore) {

    fun today(agentPairId: String): Flow<List<RouteMember>> = callbackFlow {
        // Accra is on GMT all year, so the UTC date is the local date.
        val day = LocalDate.now(ZoneOffset.UTC).toString()
        val registration = db.collection("agentPairs").document(agentPairId)
            .collection("routes").document(day)
            .addSnapshotListener { snapshot, _ ->
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
        awaitClose { registration.remove() }
    }
}
