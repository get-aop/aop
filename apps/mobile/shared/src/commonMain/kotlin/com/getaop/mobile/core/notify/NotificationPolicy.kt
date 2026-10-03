package com.getaop.mobile.core.notify

import com.getaop.mobile.core.session.HostChange
import com.getaop.mobile.core.wire.Message
import com.getaop.mobile.core.wire.MessageRole
import com.getaop.mobile.core.wire.NotificationLevel
import com.getaop.mobile.core.wire.Thread
import com.getaop.mobile.core.wire.ThreadStatus

/** The kinds of phone notification; each has its own switch in the app's settings. */
enum class NotificationKind { NEEDS_YOU, FAILED, PULL_REQUEST, COORDINATOR, TURN_FINISHED }

data class NotificationIntent(
    val kind: NotificationKind,
    val title: String,
    val body: String,
    val projectId: String,
    /** Null opens the coordinator chat. */
    val threadId: String?,
)

/** The person's switches. Coordinator replies are off by default on a phone: they are frequent. */
data class NotificationPrefs(
    val needsYou: Boolean = true,
    val failed: Boolean = true,
    val pullRequests: Boolean = true,
    val coordinator: Boolean = false,
) {
    fun allows(kind: NotificationKind): Boolean = when (kind) {
        NotificationKind.NEEDS_YOU -> needsYou
        NotificationKind.FAILED -> failed
        NotificationKind.PULL_REQUEST -> pullRequests
        NotificationKind.COORDINATOR -> coordinator
        NotificationKind.TURN_FINISHED -> true
    }
}

/**
 * Which host changes deserve a phone notification. It follows the desktop app's policy
 * (apps/desktop/electron/notifications/policy.ts) so both say the same things: a thread that
 * needs you or failed, a pull request that landed or was closed, coordinator posts, and each
 * finished turn on `every-turn`. A phone adds one: a pull request that became ready for review.
 *
 * Changes older than [staleAfterMs] are history: a phone that slept replays what it missed,
 * and a burst of old alerts would bury the one that matters. The window is wider than the
 * desktop's two minutes because a phone in Doze looks less often.
 */
class NotificationPolicy(private val staleAfterMs: Long = 30 * 60_000L) {
    fun decide(change: HostChange, prefs: NotificationPrefs, now: Long): NotificationIntent? {
        val project = change.project
        if (project.notificationLevel == NotificationLevel.OFF || project.status != "active") return null
        val intent = when (change) {
            is HostChange.ThreadChanged ->
                if (isFresh(change.thread.lastActivityAt, now)) forThread(change) else null
            is HostChange.MessageArrived ->
                if (isFresh(change.message.createdAt, now)) forMessage(change) else null
        }
        return intent?.takeIf { prefs.allows(it.kind) }
    }

    /** True when a notification about this thread should be taken back: it was dealt with elsewhere. */
    fun isSettled(thread: Thread): Boolean = !thread.unread && !thread.needsYou

    private fun forThread(change: HostChange.ThreadChanged): NotificationIntent? {
        val thread = change.thread
        val previous = change.previous
        val question = thread.blockedQuestion
        if (thread.status == ThreadStatus.WAITING_ON_YOU && question != null) {
            val askedBefore = previous?.status == ThreadStatus.WAITING_ON_YOU &&
                previous.blockedQuestion?.question == question.question
            return if (askedBefore) null else intent(change, NotificationKind.NEEDS_YOU, "${thread.title} · ${question.question}", thread.id)
        }
        forWorkingThread(change)?.let { return it }
        return forPullRequest(change)
    }

    private fun forWorkingThread(change: HostChange.ThreadChanged): NotificationIntent? {
        val thread = change.thread
        if (thread.status != ThreadStatus.WORKING) return null
        val previous = change.previous?.takeIf { it.status == ThreadStatus.WORKING }
        if (thread.degraded != null && previous?.degraded == null) {
            return intent(change, NotificationKind.FAILED, "${thread.title} lost its AOP tools", thread.id)
        }
        val wait = thread.waitingOn
        if (wait != null && wait.reason != previous?.waitingOn?.reason) {
            return intent(change, NotificationKind.NEEDS_YOU, "${thread.title} · ${wait.reason}", thread.id)
        }
        return null
    }

    private fun forPullRequest(change: HostChange.ThreadChanged): NotificationIntent? {
        val thread = change.thread
        val previous = change.previous ?: return null
        val before = previous.pullRequest
        val after = thread.pullRequest ?: return null
        val body = when {
            before?.state == "open" && after.state == "merged" -> "PR #${after.number} merged · ${thread.title}"
            before?.state == "open" && after.state == "closed" -> "PR #${after.number} was closed without merging · ${thread.title}"
            thread.status == ThreadStatus.READY_FOR_REVIEW && previous.status != ThreadStatus.READY_FOR_REVIEW &&
                after.state == "open" -> "PR #${after.number} is ready for review · ${thread.title}"
            else -> return null
        }
        return intent(change, NotificationKind.PULL_REQUEST, body, thread.id)
    }

    private fun forMessage(change: HostChange.MessageArrived): NotificationIntent? {
        val message = change.message
        if (message.role == MessageRole.ASSISTANT && message.threadId == null) {
            return intent(change, NotificationKind.COORDINATOR, firstText(message), null)
        }
        if (message.role != MessageRole.THREAD_REPORT) return null
        val title = change.threadTitle ?: "A thread"
        return when {
            message.outcome == "failed" ->
                intent(change, NotificationKind.FAILED, "$title failed: ${message.text.orEmpty()}", message.reportedThreadId)
            // `needs-you` is announced by the thread's own change of status, so not twice.
            message.outcome == "finished" && change.project.notificationLevel == NotificationLevel.EVERY_TURN ->
                intent(change, NotificationKind.TURN_FINISHED, "$title finished a turn", message.reportedThreadId)
            else -> null
        }
    }

    private fun intent(change: HostChange, kind: NotificationKind, body: String, threadId: String?) =
        NotificationIntent(kind, change.project.name, clip(body), change.project.id, threadId)

    private fun firstText(message: Message): String =
        message.blocks.firstOrNull { it.type == "text" }?.text ?: "The coordinator posted an update."

    private fun isFresh(timestamp: String, now: Long): Boolean {
        val at = parseInstantMillis(timestamp) ?: return true
        return now - at <= staleAfterMs
    }

    private companion object {
        const val BODY_LIMIT = 180

        fun clip(text: String): String {
            val line = text.replace(Regex("\\s+"), " ").trim()
            return if (line.length <= BODY_LIMIT) line else line.take(BODY_LIMIT - 1) + "…"
        }
    }
}
