package com.getaop.mobile.ui.main

import android.app.Application
import android.os.Parcelable
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.SavedStateHandle
import androidx.lifecycle.viewModelScope
import com.getaop.mobile.aop
import com.getaop.mobile.core.host.HostAddress
import com.getaop.mobile.core.host.HostError
import com.getaop.mobile.core.session.ChatKey
import com.getaop.mobile.core.session.HostState
import com.getaop.mobile.data.PairState
import com.getaop.mobile.data.PhoneSettings
import com.getaop.mobile.notify.ConnectionService
import com.getaop.mobile.ui.chat.QuestionSend
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.parcelize.Parcelize

/** What the detail pane shows: a project's coordinator chat (`threadId` null) or one thread. */
@Parcelize
data class Detail(val projectId: String, val threadId: String?) : Parcelable {
    val chatKey: ChatKey get() = ChatKey(projectId, threadId)
}

/** A request to show a conversation, from a notification or a link in a message. */
data class OpenRequest(val detail: Detail)

@OptIn(ExperimentalCoroutinesApi::class)
class MainViewModel(application: Application, private val saved: SavedStateHandle) : AndroidViewModel(application) {
    private val app = application.aop

    val host: StateFlow<HostState> = app.sessions.state
        .flatMapLatest { (it as? PairState.Paired)?.session?.state ?: flowOf(HostState()) }
        .stateIn(viewModelScope, SharingStarted.Eagerly, HostState())

    val hostName: StateFlow<String> = app.sessions.state
        .map { (it as? PairState.Paired)?.pairing?.baseUrl?.let(HostAddress::shortName) ?: "the host" }
        .stateIn(viewModelScope, SharingStarted.Eagerly, "the host")

    val hostAddress: String? get() = (app.sessions.state.value as? PairState.Paired)?.pairing?.baseUrl

    val settings: StateFlow<PhoneSettings> = app.store.settings.stateIn(viewModelScope, SharingStarted.Eagerly, PhoneSettings())

    /** The project the list pane shows; null shows every project. Kept across process death. */
    val selectedProject: StateFlow<String?> = saved.getStateFlow(KEY_PROJECT, null)

    private val openRequests = MutableSharedFlow<OpenRequest>(extraBufferCapacity = 4)
    val opens = openRequests.asSharedFlow()

    /** Drafts per conversation, so text typed on the cover screen is still there unfolded. */
    private val drafts = mutableMapOf<ChatKey, String>()

    private val sendingAnswers = MutableStateFlow<Map<String, QuestionSend>>(emptyMap())

    /**
     * Taps on a coordinator question's options on their way, by the id of the reply that asks.
     * Kept here, not in the pane, so a fold or unfold mid-send keeps the button busy.
     */
    val questionSends: StateFlow<Map<String, QuestionSend>> = sendingAnswers.asStateFlow()

    fun selectProject(projectId: String?) {
        saved[KEY_PROJECT] = projectId
        if (projectId != null) viewModelScope.launch { app.sessions.session?.loadThreads(projectId) }
    }

    fun open(detail: Detail) {
        selectProject(detail.projectId)
        openRequests.tryEmit(OpenRequest(detail))
    }

    fun load(detail: Detail) {
        val session = app.sessions.session ?: return
        viewModelScope.launch {
            if (!host.value.loadedProjects.contains(detail.projectId)) session.loadThreads(detail.projectId)
            session.loadChat(detail.chatKey)
            detail.threadId?.let { threadId ->
                if (host.value.thread(detail.projectId, threadId)?.unread == true) session.markRead(threadId)
                app.notifier.cancel(detail.projectId, threadId)
            } ?: app.notifier.cancel(detail.projectId, null)
        }
    }

    fun draft(key: ChatKey): String = drafts[key] ?: ""

    fun setDraft(key: ChatKey, text: String) {
        drafts[key] = text
    }

    /** Sends to the coordinator or a thread; returns why it failed, or null. The draft clears on success. */
    suspend fun send(key: ChatKey, text: String): String? =
        deliver(key, text).also { if (it == null) drafts.remove(key) }

    /**
     * Answers a coordinator question with an option's label, as the person's reply. A draft in
     * the message box stays. The button stays busy until the reply is in the chat, which closes
     * the question; on failure it is usable again, with the reason.
     */
    fun answerQuestion(projectId: String, messageId: String, label: String) {
        if (sendingAnswers.value[messageId]?.let { it.error == null } == true) return
        sendingAnswers.update { it + (messageId to QuestionSend(label)) }
        viewModelScope.launch {
            val failure = deliver(ChatKey(projectId, null), label)
            if (failure == null) app.notifier.cancel(projectId, null)
            sendingAnswers.update { if (failure == null) it - messageId else it + (messageId to QuestionSend(label, failure)) }
        }
    }

    private suspend fun deliver(key: ChatKey, text: String): String? {
        val session = app.sessions.session ?: return "Not connected."
        return try {
            val threadId = key.threadId
            if (threadId == null) session.sendCoordinatorMessage(key.projectId, text) else session.sendThreadMessage(threadId, text)
            session.loadChat(key)
            null
        } catch (error: HostError) {
            failure(error)
        }
    }

    /** Answers the question a thread waits on; returns why it failed, or null. */
    suspend fun answer(detail: Detail, text: String): String? {
        val session = app.sessions.session ?: return "Not connected."
        val threadId = detail.threadId ?: return null
        return try {
            session.answer(threadId, text)
            app.notifier.cancel(detail.projectId, threadId)
            session.loadChat(detail.chatKey)
            null
        } catch (error: HostError) {
            failure(error)
        }
    }

    fun retry() {
        val session = app.sessions.session ?: return
        viewModelScope.launch {
            session.refreshProjects()
            session.pause()
            session.goLive()
        }
    }

    fun updateSettings(change: (PhoneSettings) -> PhoneSettings) {
        viewModelScope.launch {
            app.store.updateSettings(change)
            ConnectionService.sync(app)
        }
    }

    fun disconnect() {
        viewModelScope.launch {
            app.sessions.disconnect()
            saved[KEY_PROJECT] = null
            ConnectionService.sync(app)
        }
    }

    fun pairAgain() {
        viewModelScope.launch {
            app.sessions.forget()
            ConnectionService.sync(app)
        }
    }

    private fun failure(error: HostError): String = when (error) {
        is HostError.Unreachable -> "Couldn't send: can't reach ${hostName.value}. Is Tailscale on?"
        is HostError.Unauthorized -> "Couldn't send: this phone was removed from ${hostName.value}."
        else -> "Couldn't send: ${error.message}"
    }

    private companion object {
        const val KEY_PROJECT = "project"
    }
}
