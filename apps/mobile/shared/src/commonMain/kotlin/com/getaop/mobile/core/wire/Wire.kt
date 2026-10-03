package com.getaop.mobile.core.wire

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject

/**
 * The host's wire types, as this app reads them. The source of truth is the zod schemas in
 * `@aop/common` (packages/common/src/projects); `apps/mobile/wire-contract.test.ts` checks the
 * JSON samples in commonTest against them, and the Kotlin tests decode the same samples.
 *
 * Unions are read flat (one class, the variant's fields optional) rather than as sealed
 * hierarchies: a host one release ahead may add a thread status or a block type, and an app
 * that cannot name it should still show the rest instead of failing to read the whole list.
 */
val WireJson: Json = Json {
    ignoreUnknownKeys = true
    explicitNulls = false
    coerceInputValues = true
}

@Serializable
data class HostHealth(
    val service: String,
    val version: String,
    val channel: String? = null,
    val port: Int? = null,
    val apiVersion: Int,
    val minClientApiVersion: Int,
)

@Serializable
data class Device(
    val id: String,
    val name: String,
    val createdAt: String,
    val lastSeenAt: String? = null,
)

@Serializable
data class PairedDevice(val device: Device, val token: String)

@Serializable
data class Project(
    val id: String,
    val name: String,
    val icon: String? = null,
    val color: String? = null,
    val goal: String = "",
    val status: String,
    val notificationLevel: String = NotificationLevel.COORDINATOR,
    val createdAt: String,
    val updatedAt: String,
)

object NotificationLevel {
    const val COORDINATOR = "coordinator"
    const val EVERY_TURN = "every-turn"
    const val OFF = "off"
}

@Serializable
data class ThreadStep(val label: String, val state: String)

@Serializable
data class BlockedOption(val label: String, val recommended: Boolean = false)

@Serializable
data class BlockedQuestion(val question: String, val options: List<BlockedOption> = emptyList())

@Serializable
data class ThreadWait(val reason: String, val link: String? = null, val since: String)

@Serializable
data class ThreadDegraded(val reason: String, val since: String)

@Serializable
data class PullRequestChecks(
    val state: String,
    val successful: Int = 0,
    val failing: Int = 0,
    val pending: Int = 0,
)

/** `pr` or `doc`; a `pr` carries number, url and state. */
@Serializable
data class Artifact(
    val type: String,
    val number: Int? = null,
    val url: String? = null,
    val state: String? = null,
    val checks: PullRequestChecks? = null,
    val name: String? = null,
)

@Serializable
data class Thread(
    val id: String,
    val projectId: String,
    val title: String,
    val status: String,
    val branch: String? = null,
    val steps: List<ThreadStep> = emptyList(),
    val liveStatusLine: String? = null,
    val artifacts: List<Artifact> = emptyList(),
    val repliesCount: Int = 0,
    val unread: Boolean = false,
    val lastActivityAt: String,
    val createdAt: String,
    val blockedQuestion: BlockedQuestion? = null,
    val waitingOn: ThreadWait? = null,
    val degraded: ThreadDegraded? = null,
    val resumesAt: String? = null,
    val resolvedAt: String? = null,
) {
    val pullRequest: Artifact? get() = artifacts.firstOrNull { it.type == "pr" }

    /** Something only the person can move: a question, or a wait outside AOP. */
    val needsYou: Boolean get() = status == ThreadStatus.WAITING_ON_YOU || waitingOn != null
}

object ThreadStatus {
    const val WAITING_ON_YOU = "waiting-on-you"
    const val WORKING = "working"
    const val QUEUED = "queued"
    const val RATE_LIMITED = "rate-limited"
    const val READY_FOR_REVIEW = "ready-for-review"
    const val LANDING = "landing"
    const val IDLE = "idle"
    const val RESOLVED = "resolved"
}

/** One block of a message or one part of a turn being written; which fields are set depends on `type`. */
@Serializable
data class Block(
    val type: String,
    val text: String? = null,
    val id: String? = null,
    val name: String? = null,
    val detail: String? = null,
    val status: String? = null,
    val threadId: String? = null,
    val threadIds: List<String> = emptyList(),
    val variant: String? = null,
    val number: Int? = null,
    val url: String? = null,
    val state: String? = null,
    val messageId: String? = null,
)

/** `user`, `assistant` or `thread-report`; see `MessageSchema`. */
@Serializable
data class Message(
    val id: String,
    val projectId: String,
    val threadId: String? = null,
    val createdAt: String,
    val role: String,
    val text: String? = null,
    val blocks: List<Block> = emptyList(),
    val failed: Boolean = false,
    val sender: String? = null,
    val quote: String? = null,
    val brief: Boolean = false,
    val steers: String? = null,
    val inReplyTo: String? = null,
    val reportedThreadId: String? = null,
    val outcome: String? = null,
)

object MessageRole {
    const val USER = "user"
    const val ASSISTANT = "assistant"
    const val THREAD_REPORT = "thread-report"
}

@Serializable
data class MessagePage(val messages: List<Message>, val hasMore: Boolean = false)

/** One durable entry of a project's event log; `payload` is read by `type` (see EventLog.kt). */
@Serializable
data class EventLogEntry(
    val id: Long,
    val projectId: String,
    val type: String,
    val payload: JsonObject,
)

/** One change to a turn being written; see `LiveOpSchema`. */
@Serializable
data class LiveOp(
    val op: String,
    val parts: List<Block> = emptyList(),
    val index: Int? = null,
    val part: Block? = null,
    val text: String? = null,
    val status: String? = null,
    val detail: String? = null,
)

@Serializable
data class MessageDelta(
    val projectId: String,
    val threadId: String? = null,
    val messageId: String,
    val inReplyTo: String? = null,
    val ops: List<LiveOp>,
)

@Serializable
data class LiveSnapshot(val turns: List<MessageDelta> = emptyList())

@Serializable
data class Resync(val cursor: Long, val reason: String)

@Serializable
internal data class ProjectList(val projects: List<Project>)

@Serializable
internal data class ThreadList(val threads: List<Thread>)

@Serializable
internal data class ThreadEnvelope(val thread: Thread)

@Serializable
internal data class MessageEnvelope(val message: Message)

@Serializable
internal data class ApiErrorBody(val error: String? = null, val code: String? = null)
