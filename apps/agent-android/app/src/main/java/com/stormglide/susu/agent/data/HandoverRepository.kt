package com.stormglide.susu.agent.data

import com.google.firebase.firestore.FirebaseFirestore
import kotlinx.coroutines.channels.awaitClose
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.callbackFlow

/** Pair-scoped read model written by the server; both agents see the cashier's independent count. */
class HandoverRepository(private val db: FirebaseFirestore) {
    fun observe(agentPairId: String): Flow<List<HandoverDeclaration>> = callbackFlow {
        val registration = db.collection("agentPairs").document(agentPairId)
            .collection("handovers")
            .orderBy("receivedAt", com.google.firebase.firestore.Query.Direction.DESCENDING)
            .limit(100)
            .addSnapshotListener { snapshot, _ ->
                if (snapshot == null) return@addSnapshotListener
                val declarations = snapshot.documents.mapNotNull { doc ->
                    val rawLines = doc.get("lines") as? List<*> ?: return@mapNotNull null
                    val lines = rawLines.mapNotNull { raw ->
                        val line = raw as? Map<*, *> ?: return@mapNotNull null
                        HandoverLine(
                            businessId = line["businessId"] as? String ?: return@mapNotNull null,
                            businessName = line["businessName"] as? String ?: "Business",
                            declaredPesewas = (line["declaredPesewas"] as? Number)?.toLong() ?: 0L,
                            status = line["status"] as? String ?: "DECLARED",
                            countedPesewas = (line["countedPesewas"] as? Number)?.toLong(),
                            differencePesewas = (line["differencePesewas"] as? Number)?.toLong(),
                        )
                    }
                    HandoverDeclaration(doc.id, doc.getString("capturedAt").orEmpty(), doc.getString("agentUid").orEmpty(), lines)
                }
                trySend(declarations)
            }
        awaitClose { registration.remove() }
    }
}
