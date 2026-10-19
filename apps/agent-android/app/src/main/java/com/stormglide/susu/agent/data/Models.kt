package com.stormglide.susu.agent.data

/** Signed-in agent, from Firebase Auth custom claims (API.md §1). */
data class AgentSession(
    val uid: String,
    val email: String?,
    val displayName: String?,
    val agentPairId: String,
    val branchIds: List<String>,
)

/** One member on today's route (API.md §4 `agentPairs/{id}/routes/{yyyy-mm-dd}`). */
data class RouteMember(
    val memberId: String,
    val susuAccountId: String,
    val fullName: String,
    val phoneMasked: String,
    val expectedPesewas: Long,
    /** UI-only: true for sample rows shown in debug builds until the route read model exists. */
    val sample: Boolean = false,
)

enum class SyncState { PENDING_SYNC, SYNCED, REJECTED, FAILED }

/** A command document as the agent sees it, including ones still only on this phone. */
data class QueuedCommand(
    val id: String,
    val seq: Long,
    val capturedAt: String,
    val memberId: String,
    val susuAccountId: String,
    val amountPesewas: Long,
    val state: SyncState,
    /** True while the write has not reached the server (still in Firestore's offline cache). */
    val onPhoneOnly: Boolean,
    val receiptRef: String? = null,
    val reason: String? = null,
    val message: String? = null,
)

/** What to tell the agent for each rejection reason (API.md §3). */
object RejectionGuidance {
    private val deviceProblems = setOf("DEVICE_NOT_BOUND", "DEVICE_REVOKED", "DEVICE_AGENT_MISMATCH")
    private val memberProblems = setOf("MEMBER_NOT_ACTIVE", "ACCOUNT_NOT_ACTIVE", "ACCOUNT_OUTSIDE_BRANCH", "ACCOUNT_NOT_FOUND")
    private val appBugs = setOf("INVALID_COMMAND", "SEQUENCE_REUSED")

    fun forReason(reason: String?): String = when (reason) {
        in deviceProblems -> "This phone can't record collections. Sign out and contact your supervisor."
        in memberProblems -> "This member can't be collected from right now. Refer them to the branch and return the cash."
        in appBugs -> "The app made a mistake with this record. Report it to your supervisor."
        "LOCAL_PERMISSION_DENIED" -> "The server refused this record. Sign out, sign back in and contact your supervisor."
        else -> "Speak to your supervisor about this record."
    }

    fun isDeviceProblem(reason: String?): Boolean = reason in deviceProblems
}
