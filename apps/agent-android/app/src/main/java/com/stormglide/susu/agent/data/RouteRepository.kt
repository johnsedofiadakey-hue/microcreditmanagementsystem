package com.stormglide.susu.agent.data

import com.google.firebase.firestore.FirebaseFirestore
import com.stormglide.susu.agent.BuildConfig
import kotlinx.coroutines.channels.awaitClose
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.callbackFlow
import java.time.LocalDate
import java.time.ZoneOffset

/** Today's route for the agent's pair: a read-only copy written by Functions (API.md §4, planned — Step 4). */
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
                // TODO(api): remove the sample route once Functions write routes (Step 4).
                trySend(if (members.isEmpty() && BuildConfig.DEBUG) SAMPLE_ROUTE else members)
            }
        awaitClose { registration.remove() }
    }

    companion object {
        /** Debug-only sample rows. They will be REJECTED by the server (ACCOUNT_NOT_FOUND) — that is expected. */
        val SAMPLE_ROUTE = listOf(
            RouteMember("2b7c9a10-1f2e-4d3c-8b4a-5e6f7a8b9c01", "7d1e2f30-4a5b-4c6d-9e7f-8a9b0c1d2e01", "Ama Owusu", "024 ••• ••12", 2000, sample = true),
            RouteMember("2b7c9a10-1f2e-4d3c-8b4a-5e6f7a8b9c02", "7d1e2f30-4a5b-4c6d-9e7f-8a9b0c1d2e02", "Kwabena Mensah", "055 ••• ••47", 5000, sample = true),
            RouteMember("2b7c9a10-1f2e-4d3c-8b4a-5e6f7a8b9c03", "7d1e2f30-4a5b-4c6d-9e7f-8a9b0c1d2e03", "Abena Serwaa", "020 ••• ••90", 1000, sample = true),
            RouteMember("2b7c9a10-1f2e-4d3c-8b4a-5e6f7a8b9c04", "7d1e2f30-4a5b-4c6d-9e7f-8a9b0c1d2e04", "Yaw Boakye", "027 ••• ••33", 3000, sample = true),
        )
    }
}
