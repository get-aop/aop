package com.getaop.mobile.core.session

import com.getaop.mobile.core.host.HostClient
import com.getaop.mobile.core.host.HostError
import com.getaop.mobile.core.stream.StreamEvent
import com.getaop.mobile.core.stream.openProjectStream
import com.getaop.mobile.core.wire.EntryPayload
import com.getaop.mobile.core.wire.Message
import com.getaop.mobile.core.wire.Thread
import com.getaop.mobile.core.wire.read
import io.ktor.client.HttpClient
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.transformWhile
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withTimeoutOrNull

/** How often the session looks again; tests shorten them. */
data class SessionTiming(
    val projectsPollMs: Long = 15_000,
    val unreachableRetryMs: Long = 5_000,
    val streamBackoffMs: List<Long> = listOf(1_000, 2_000, 5_000, 10_000, 30_000),
    val catchUpTimeoutMs: Long = 20_000,
)

/**
 * The phone's view of one host. While the app is on screen it is [goLive]: one stream per
 * project, so replies appear as they are written. In the background the service calls
 * [catchUp] now and then instead: each project's stream is read up to the present and closed,
 * which replays exactly the entries missed since the last look and keeps the radio quiet
 * between looks. Both paths apply entries the same way and publish [changes].
 */
class HostSession(
    val client: HostClient,
    private val http: HttpClient,
    private val scope: CoroutineScope,
    private val clock: () -> Long,
    private val timing: SessionTiming = SessionTiming(),
) {
    private val mutableState = MutableStateFlow(HostState())
    val state: StateFlow<HostState> = mutableState.asStateFlow()

    private val mutableChanges = MutableSharedFlow<HostChange>(extraBufferCapacity = 128)
    val changes: SharedFlow<HostChange> = mutableChanges.asSharedFlow()

    private val cursors = mutableMapOf<String, Long>()
    private val cursorLock = Mutex()
    private var liveJob: Job? = null

    fun goLive() {
        if (liveJob?.isActive == true) return
        liveJob = scope.launch { runLive() }
    }

    fun pause() {
        liveJob?.cancel()
        liveJob = null
    }

    val isLive: Boolean get() = liveJob?.isActive == true

    /** One look at the host: the project list, then each project's missed entries. */
    suspend fun catchUp() {
        if (!refreshProjects()) return
        for (project in streamedProjects()) {
            val finished = withTimeoutOrNull(timing.catchUpTimeoutMs) {
                runCatching {
                    openProjectStream(client, http, project, cursor(project))
                        .transformWhile { event ->
                            emit(event)
                            event !is StreamEvent.Live
                        }
                        .collect { handle(project, it) }
                }.onFailure(::noteFailure)
            }
            if (finished == null || state.value.connection == Connection.Unauthorized) return
        }
    }

    suspend fun loadChat(key: ChatKey) {
        val page = guarded {
            if (key.threadId == null) client.coordinatorMessages(key.projectId) else client.threadMessages(key.threadId)
        } ?: return
        mutableState.update { StateReducer.withChat(it, key, page) }
    }

    suspend fun loadThreads(projectId: String) {
        val threads = guarded { client.threads(projectId) } ?: return
        mutableState.update { StateReducer.withThreads(it, projectId, threads) }
    }

    /** Throws [HostError] so the composer can keep the text and say why. */
    suspend fun sendCoordinatorMessage(projectId: String, text: String): Message {
        val message = client.sendCoordinatorMessage(projectId, text)
        applyLocally(projectId, EntryPayload.MessageCreated(message))
        return message
    }

    suspend fun sendThreadMessage(threadId: String, text: String): Thread =
        client.sendThreadMessage(threadId, text).also { applyLocally(it.projectId, EntryPayload.ThreadUpserted(it)) }

    suspend fun answer(threadId: String, text: String): Thread =
        client.reply(threadId, text).also { applyLocally(it.projectId, EntryPayload.ThreadUpserted(it)) }

    suspend fun markRead(threadId: String) {
        val thread = guarded { client.markRead(threadId) } ?: return
        applyLocally(thread.projectId, EntryPayload.ThreadUpserted(thread))
    }

    /** Refreshes the project list; false when the host could not be asked. */
    suspend fun refreshProjects(): Boolean {
        val projects = guarded { client.projects() } ?: return false
        mutableState.update { StateReducer.withProjects(it, projects).copy(connection = Connection.Live) }
        return true
    }

    private suspend fun runLive() = coroutineScope {
        val streams = mutableMapOf<String, Job>()
        while (isActive && state.value.connection != Connection.Unauthorized) {
            val reached = refreshProjects()
            if (reached) {
                val wanted = streamedProjects()
                (streams.keys - wanted.toSet()).forEach { streams.remove(it)?.cancel() }
                wanted.filter { it !in streams }.forEach { id -> streams[id] = launch { superviseStream(id) } }
            }
            delay(if (reached) timing.projectsPollMs else timing.unreachableRetryMs)
        }
        streams.values.forEach(Job::cancel)
    }

    private suspend fun superviseStream(projectId: String) {
        var failures = 0
        while (currentCoroutineContext().isActive) {
            try {
                openProjectStream(client, http, projectId, cursor(projectId)).collect { event ->
                    if (event is StreamEvent.Open) failures = 0
                    handle(projectId, event)
                }
            } catch (unauthorized: HostError.Unauthorized) {
                noteFailure(unauthorized)
                return
            } catch (_: HostError) {
                // Reconnects below, from the newest entry seen.
            }
            delay(timing.streamBackoffMs[failures.coerceAtMost(timing.streamBackoffMs.lastIndex)])
            failures += 1
        }
    }

    private suspend fun handle(projectId: String, event: StreamEvent) {
        when (event) {
            StreamEvent.Open, StreamEvent.Heartbeat -> markLive()
            is StreamEvent.Entry -> {
                val payload = event.entry.read() ?: return resync(projectId)
                remember(projectId, event.entry.id)
                applyLocally(projectId, payload)
            }
            is StreamEvent.Delta -> mutableState.update { StateReducer.applyDelta(it, event.delta) }
            is StreamEvent.Live -> mutableState.update { StateReducer.withLiveSnapshot(it, projectId, event.snapshot.turns) }
            is StreamEvent.Resync -> {
                // Set, not raised: after a restored database the log's newest entry is older than ours.
                cursorLock.withLock { cursors[projectId] = event.resync.cursor }
                resync(projectId)
            }
            StreamEvent.Unreadable -> resync(projectId)
        }
    }

    /** Refetches what the log could not replay: the project's threads and its open chats. */
    private suspend fun resync(projectId: String) {
        loadThreads(projectId)
        state.value.chats.keys.filter { it.projectId == projectId }.forEach { loadChat(it) }
    }

    private fun applyLocally(projectId: String, payload: EntryPayload) {
        var change: HostChange? = null
        mutableState.update { current ->
            val (next, news) = StateReducer.apply(current, projectId, payload)
            change = news
            next
        }
        change?.let { mutableChanges.tryEmit(it) }
    }

    private fun streamedProjects(): List<String> =
        state.value.projects.filter { it.status == "active" }.take(MAX_STREAMS).map { it.id }

    private suspend fun cursor(projectId: String): Long? = cursorLock.withLock { cursors[projectId] }

    private suspend fun remember(projectId: String, id: Long) = cursorLock.withLock {
        val current = cursors[projectId]
        if (current == null || id > current) cursors[projectId] = id
    }

    private fun markLive() {
        if (state.value.connection != Connection.Live) mutableState.update { it.copy(connection = Connection.Live) }
    }

    private suspend fun <T> guarded(call: suspend () -> T): T? = try {
        call()
    } catch (error: HostError) {
        noteFailure(error)
        null
    }

    private fun noteFailure(error: Throwable) {
        val connection = when (error) {
            is HostError.Unauthorized -> Connection.Unauthorized
            is HostError.Incompatible -> Connection.Incompatible(error.message ?: "")
            is HostError.Unreachable -> (state.value.connection as? Connection.Unreachable) ?: Connection.Unreachable(clock())
            else -> return
        }
        mutableState.update { it.copy(connection = connection) }
    }

    companion object {
        /** The desktop app follows as many; HTTP/2 over `tailscale serve` carries them on one socket. */
        const val MAX_STREAMS = 16
    }
}
