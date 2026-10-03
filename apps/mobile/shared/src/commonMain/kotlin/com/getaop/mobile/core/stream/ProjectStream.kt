package com.getaop.mobile.core.stream

import com.getaop.mobile.core.host.HostClient
import com.getaop.mobile.core.host.HostError
import com.getaop.mobile.core.wire.EventLogEntry
import com.getaop.mobile.core.wire.LiveSnapshot
import com.getaop.mobile.core.wire.MessageDelta
import com.getaop.mobile.core.wire.Resync
import com.getaop.mobile.core.wire.WireJson
import kotlinx.serialization.decodeFromString
import io.ktor.client.HttpClient
import io.ktor.client.request.header
import io.ktor.client.request.prepareGet
import io.ktor.client.statement.bodyAsChannel
import io.ktor.http.HttpHeaders
import io.ktor.utils.io.CancellationException
import io.ktor.utils.io.readLine
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flow

/** What a project stream says, read from its SSE frames (`PROJECT_STREAM_EVENTS`). */
sealed interface StreamEvent {
    data object Open : StreamEvent
    data class Entry(val entry: EventLogEntry) : StreamEvent
    data class Delta(val delta: MessageDelta) : StreamEvent
    data class Live(val snapshot: LiveSnapshot) : StreamEvent
    data class Resync(val resync: com.getaop.mobile.core.wire.Resync) : StreamEvent

    /** An entry this build cannot read: the client refetches rather than silently missing it. */
    data object Unreadable : StreamEvent
    data object Heartbeat : StreamEvent
}

/**
 * One connection to a project's event stream. The flow ends when the connection does, for any
 * reason; it throws [HostError.Unauthorized] when the host turns the phone away, and
 * [HostError.Unreachable] when it can't be reached. Reconnecting, from the newest entry seen,
 * is [StreamSupervisor]'s job.
 */
fun openProjectStream(
    client: HostClient,
    http: HttpClient,
    projectId: String,
    after: Long?,
): Flow<StreamEvent> = flow {
    try {
        http.prepareGet(client.streamUrl(projectId, after)) {
            client.authorize(this)
            header(HttpHeaders.Accept, "text/event-stream")
            header(HttpHeaders.CacheControl, "no-store")
        }.execute { response ->
            when (response.status.value) {
                in 200..299 -> Unit
                401 -> throw HostError.Unauthorized()
                else -> throw HostError.Http(response.status.value, "Stream refused")
            }
            emit(StreamEvent.Open)
            val channel = response.bodyAsChannel()
            val parser = SseParser()
            while (true) {
                val line = channel.readLine() ?: break
                parser.feed(line)?.let { decodeStreamEvent(it) }?.let { emit(it) }
            }
        }
    } catch (cancelled: CancellationException) {
        throw cancelled
    } catch (error: HostError) {
        throw error
    } catch (failure: Throwable) {
        throw HostError.Unreachable(failure)
    }
}

fun decodeStreamEvent(event: SseEvent): StreamEvent? = when (event.event) {
    "entry" -> decodeOrNull<EventLogEntry>(event.data)?.let(StreamEvent::Entry) ?: StreamEvent.Unreadable
    "delta" -> decodeOrNull<MessageDelta>(event.data)?.let(StreamEvent::Delta)
    "live" -> decodeOrNull<LiveSnapshot>(event.data)?.let(StreamEvent::Live)
    "resync" -> decodeOrNull<Resync>(event.data)?.let(StreamEvent::Resync)
    "heartbeat" -> StreamEvent.Heartbeat
    else -> null
}

private inline fun <reified T> decodeOrNull(data: String): T? =
    runCatching { WireJson.decodeFromString<T>(data) }.getOrNull()
