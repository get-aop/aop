package com.getaop.mobile.core.session

import com.getaop.mobile.core.wire.EntryPayload
import com.getaop.mobile.core.wire.Message
import com.getaop.mobile.core.wire.MessageDelta
import com.getaop.mobile.core.wire.MessagePage
import com.getaop.mobile.core.wire.Project
import com.getaop.mobile.core.wire.Thread

/** Something that changed on the host, with what the phone knew before: what notifications are decided from. */
sealed interface HostChange {
    val project: Project

    data class ThreadChanged(
        override val project: Project,
        val previous: Thread?,
        val thread: Thread,
    ) : HostChange

    data class MessageArrived(
        override val project: Project,
        val message: Message,
        val threadTitle: String?,
    ) : HostChange
}

/**
 * The pure state transitions of a session. Entities arrive whole and are applied by id, so
 * replaying an entry, or a range of them, leaves the same state (the event log's promise).
 */
object StateReducer {
    fun withProjects(state: HostState, projects: List<Project>): HostState {
        val visible = projects.filter { it.status != "archived" }.sortedByDescending { it.updatedAt }
        val ids = visible.map { it.id }.toSet()
        return state.copy(
            projects = visible,
            threads = state.threads.filterKeys { it in ids },
            loadedProjects = state.loadedProjects intersect ids,
        )
    }

    fun withThreads(state: HostState, projectId: String, threads: List<Thread>): HostState =
        state.copy(
            threads = state.threads + (projectId to sortThreads(threads)),
            loadedProjects = state.loadedProjects + projectId,
        )

    fun withChat(state: HostState, key: ChatKey, page: MessagePage): HostState {
        val previous = state.chats[key] ?: Chat()
        val ids = page.messages.map { it.id }.toSet()
        return state.copy(
            chats = state.chats + (
                key to previous.copy(
                    messages = page.messages,
                    loaded = true,
                    hasMore = page.hasMore,
                    live = previous.live.filter { it.messageId !in ids },
                )
                ),
        )
    }

    /** Applies one entry; returns the new state and what changed, when it is news. */
    fun apply(state: HostState, projectId: String, payload: EntryPayload): Pair<HostState, HostChange?> =
        when (payload) {
            is EntryPayload.ProjectUpserted -> {
                val others = state.projects.filter { it.id != payload.project.id }
                withProjects(state, others + payload.project) to null
            }
            is EntryPayload.ProjectRemoved ->
                withProjects(state, state.projects.filter { it.id != projectId }) to null
            is EntryPayload.ThreadUpserted -> upsertThread(state, payload.thread)
            is EntryPayload.ThreadRemoved -> state.copy(
                threads = state.threads + (projectId to state.threads[projectId].orEmpty().filter { it.id != payload.threadId }),
            ) to null
            is EntryPayload.MessageCreated -> upsertMessage(state, payload.message, isNew = true)
            is EntryPayload.MessageUpdated -> upsertMessage(state, payload.message, isNew = false)
            EntryPayload.Other -> state to null
        }

    fun applyDelta(state: HostState, delta: MessageDelta): HostState {
        val key = ChatKey(delta.projectId, delta.threadId)
        val chat = state.chats[key] ?: Chat()
        if (chat.messages.any { it.id == delta.messageId }) return state
        val current = chat.live.firstOrNull { it.messageId == delta.messageId }
        val next = com.getaop.mobile.core.session.applyDelta(current, delta)
        val others = chat.live.filter { it.messageId != delta.messageId }
        return state.copy(chats = state.chats + (key to chat.copy(live = if (next == null) others else others + next)))
    }

    /** The turns being written as a connection opened: any other live turn of the project ended unheard. */
    fun withLiveSnapshot(state: HostState, projectId: String, turns: List<MessageDelta>): HostState {
        val cleared = state.chats.mapValues { (key, chat) ->
            if (key.projectId == projectId) chat.copy(live = emptyList()) else chat
        }
        return turns.fold(state.copy(chats = cleared)) { acc, turn -> applyDelta(acc, turn) }
    }

    private fun upsertThread(state: HostState, thread: Thread): Pair<HostState, HostChange?> {
        val list = state.threads[thread.projectId].orEmpty()
        val previous = list.firstOrNull { it.id == thread.id }
        val next = state.copy(
            threads = state.threads + (thread.projectId to sortThreads(list.filter { it.id != thread.id } + thread)),
        )
        val project = state.project(thread.projectId) ?: return next to null
        return next to HostChange.ThreadChanged(project, previous, thread)
    }

    private fun upsertMessage(state: HostState, message: Message, isNew: Boolean): Pair<HostState, HostChange?> {
        val key = ChatKey(message.projectId, message.threadId)
        val chat = state.chats[key]
        val next = if (chat == null || !chat.loaded) {
            state
        } else {
            val messages = if (chat.messages.any { it.id == message.id }) {
                chat.messages.map { if (it.id == message.id) message else it }
            } else {
                chat.messages + message
            }
            state.copy(
                chats = state.chats + (key to chat.copy(messages = messages, live = chat.live.filter { it.messageId != message.id })),
            )
        }
        val project = state.project(message.projectId)
        if (!isNew || project == null) return next to null
        val title = message.reportedThreadId?.let { state.thread(message.projectId, it)?.title }
        return next to HostChange.MessageArrived(project, message, title)
    }

    /** What needs the person first, then what moved most recently. */
    private fun sortThreads(threads: List<Thread>): List<Thread> =
        threads.sortedWith(compareByDescending<Thread> { it.needsYou }.thenByDescending { it.lastActivityAt })
}
