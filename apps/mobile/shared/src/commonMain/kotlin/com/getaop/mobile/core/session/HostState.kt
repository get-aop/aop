package com.getaop.mobile.core.session

import com.getaop.mobile.core.wire.Block
import com.getaop.mobile.core.wire.Message
import com.getaop.mobile.core.wire.Project
import com.getaop.mobile.core.wire.Thread
import com.getaop.mobile.core.wire.ThreadStatus

/** Whether the phone hears from the host, in the terms the app shows. */
sealed interface Connection {
    data object Connecting : Connection
    data object Live : Connection

    /** No answer: offline, Tailscale off, or the host is down. The app keeps retrying. */
    data class Unreachable(val since: Long) : Connection

    /** The host removed this phone. Nothing retries; the person pairs again. */
    data object Unauthorized : Connection
    data class Incompatible(val message: String) : Connection
}

/** A conversation: a project's coordinator chat (`threadId` null) or one thread's. */
data class ChatKey(val projectId: String, val threadId: String?)

/** A reply being written, keyed by the id the finished message will have. */
data class LiveTurn(
    val messageId: String,
    val threadId: String?,
    val inReplyTo: String?,
    val parts: List<Block>,
)

data class Chat(
    val messages: List<Message> = emptyList(),
    val loaded: Boolean = false,
    val hasMore: Boolean = false,
    val live: List<LiveTurn> = emptyList(),
)

data class HostState(
    val connection: Connection = Connection.Connecting,
    /** Active and paused projects, the most recently changed first. Archived ones are hidden. */
    val projects: List<Project> = emptyList(),
    val threads: Map<String, List<Thread>> = emptyMap(),
    val chats: Map<ChatKey, Chat> = emptyMap(),
    /** Projects whose threads have loaded at least once. */
    val loadedProjects: Set<String> = emptySet(),
) {
    fun project(id: String): Project? = projects.firstOrNull { it.id == id }

    fun thread(projectId: String, threadId: String): Thread? =
        threads[projectId]?.firstOrNull { it.id == threadId }

    fun badges(projectId: String): ProjectBadges {
        val list = threads[projectId].orEmpty()
        return ProjectBadges(
            needsYou = list.count { it.needsYou },
            working = list.count { it.status in RUNNING },
            unread = list.count { it.unread },
        )
    }

    private companion object {
        val RUNNING = setOf(ThreadStatus.WORKING, ThreadStatus.QUEUED, ThreadStatus.LANDING)
    }
}

data class ProjectBadges(val needsYou: Int, val working: Int, val unread: Int)
