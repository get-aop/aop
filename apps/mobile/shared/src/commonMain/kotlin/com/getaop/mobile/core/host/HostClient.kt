package com.getaop.mobile.core.host

import com.getaop.mobile.core.wire.ApiErrorBody
import com.getaop.mobile.core.wire.HostHealth
import com.getaop.mobile.core.wire.Message
import com.getaop.mobile.core.wire.MessageEnvelope
import com.getaop.mobile.core.wire.MessagePage
import com.getaop.mobile.core.wire.PairedDevice
import com.getaop.mobile.core.wire.Project
import com.getaop.mobile.core.wire.ProjectList
import com.getaop.mobile.core.wire.Thread
import com.getaop.mobile.core.wire.ThreadEnvelope
import com.getaop.mobile.core.wire.ThreadList
import com.getaop.mobile.core.wire.WireJson
import kotlinx.serialization.decodeFromString
import io.ktor.client.HttpClient
import io.ktor.client.request.HttpRequestBuilder
import io.ktor.client.request.header
import io.ktor.client.request.request
import io.ktor.client.request.setBody
import io.ktor.client.statement.HttpResponse
import io.ktor.client.statement.bodyAsText
import io.ktor.http.ContentType
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpMethod
import io.ktor.http.contentType
import io.ktor.http.encodeURLPathPart
import io.ktor.utils.io.CancellationException
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

/** The API version this app was built against (`API_VERSION` in packages/common/src/host-api.ts). */
const val CLIENT_API_VERSION = 1

/**
 * The host's HTTP API, as a paired phone uses it. Every call either returns the host's answer
 * or throws a [HostError]; nothing here retries, which is the caller's decision.
 */
class HostClient(
    val baseUrl: String,
    private val token: String?,
    private val http: HttpClient,
) {
    suspend fun health(): HostHealth {
        val health = get<HostHealth>("/health")
        if (health.service != "aop") throw HostError.Incompatible("That address isn't an AOP host.")
        if (CLIENT_API_VERSION < health.minClientApiVersion) {
            throw HostError.Incompatible("This app is too old for the host. Update the app.")
        }
        if (CLIENT_API_VERSION > health.apiVersion) {
            throw HostError.Incompatible("The host is too old for this app. Update the host.")
        }
        return health
    }

    suspend fun pair(code: String, deviceName: String): PairedDevice {
        val body = buildJsonObject {
            put("code", code)
            put("name", deviceName)
        }
        val response = send(HttpMethod.Post, "/auth/pair") {
            contentType(ContentType.Application.Json)
            setBody(body.toString())
        }
        when (response.status.value) {
            401 -> throw HostError.InvalidPairingCode()
            429 -> throw HostError.RateLimited(response.headers[HttpHeaders.RetryAfter]?.toIntOrNull())
        }
        return decode(response)
    }

    /** Checks the token: [HostError.Unauthorized] once the host has removed this phone. */
    suspend fun verify() {
        ensureOk(send(HttpMethod.Get, "/auth/me"))
    }

    /** Removes this phone from the host. */
    suspend fun signOut() {
        ensureOk(send(HttpMethod.Delete, "/auth/session"))
    }

    suspend fun projects(): List<Project> = get<ProjectList>("/projects").projects

    suspend fun threads(projectId: String): List<Thread> =
        get<ThreadList>("/projects/${projectId.path()}/threads").threads

    suspend fun coordinatorMessages(projectId: String): MessagePage =
        get("/projects/${projectId.path()}/messages")

    suspend fun threadMessages(threadId: String): MessagePage =
        get("/threads/${threadId.path()}/messages")

    suspend fun sendCoordinatorMessage(projectId: String, text: String): Message =
        post<MessageEnvelope>("/projects/${projectId.path()}/messages", text).message

    suspend fun sendThreadMessage(threadId: String, text: String): Thread =
        post<ThreadEnvelope>("/threads/${threadId.path()}/messages", text).thread

    /** Answers the question a thread is waiting on you with. */
    suspend fun reply(threadId: String, text: String): Thread =
        post<ThreadEnvelope>("/threads/${threadId.path()}/reply", text).thread

    suspend fun markRead(threadId: String): Thread =
        decode<ThreadEnvelope>(send(HttpMethod.Post, "/threads/${threadId.path()}/read")).thread

    /** `?after=` resumes the stream after the newest entry this client holds. */
    fun streamUrl(projectId: String, after: Long?): String =
        "$baseUrl/api/projects/${projectId.path()}/stream" + (after?.let { "?after=$it" } ?: "")

    fun authorize(builder: HttpRequestBuilder) {
        token?.let { builder.header(HttpHeaders.Authorization, "Bearer $it") }
    }

    private suspend inline fun <reified T> get(path: String): T = decode(send(HttpMethod.Get, path))

    private suspend inline fun <reified T> post(path: String, text: String): T =
        decode(
            send(HttpMethod.Post, path) {
                contentType(ContentType.Application.Json)
                setBody(buildJsonObject { put("text", text) }.toString())
            },
        )

    private suspend fun send(
        method: HttpMethod,
        path: String,
        configure: HttpRequestBuilder.() -> Unit = {},
    ): HttpResponse = try {
        http.request("$baseUrl/api$path") {
            this.method = method
            authorize(this)
            configure()
        }
    } catch (cancelled: CancellationException) {
        throw cancelled
    } catch (failure: Throwable) {
        throw HostError.Unreachable(failure)
    }

    private suspend inline fun <reified T> decode(response: HttpResponse): T {
        ensureOk(response)
        val text = response.bodyAsText()
        return runCatching { WireJson.decodeFromString<T>(text) }.getOrElse {
            throw HostError.Incompatible("The host sent something this app can't read.")
        }
    }

    private suspend fun ensureOk(response: HttpResponse) {
        val status = response.status.value
        if (status in 200..299) return
        if (status == 401) throw HostError.Unauthorized()
        val body = runCatching { WireJson.decodeFromString<ApiErrorBody>(response.bodyAsText()) }
            .getOrNull()
        throw HostError.Http(status, body?.error ?: "The host answered $status")
    }

    private fun String.path(): String = encodeURLPathPart()
}
