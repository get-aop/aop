package com.getaop.mobile.core

import com.getaop.mobile.core.host.HostClient
import com.getaop.mobile.core.host.HostError
import com.getaop.mobile.core.session.ChatKey
import com.getaop.mobile.core.session.Connection
import com.getaop.mobile.core.session.HostChange
import com.getaop.mobile.core.session.HostSession
import io.ktor.client.HttpClient
import io.ktor.client.engine.mock.MockEngine
import io.ktor.client.engine.mock.MockRequestHandleScope
import io.ktor.client.engine.mock.respond
import io.ktor.client.request.HttpRequestData
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpStatusCode
import io.ktor.http.headersOf
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlinx.coroutines.test.runTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertIs
import kotlin.test.assertTrue

class HostSessionTest {
    private val requests = mutableListOf<HttpRequestData>()

    private val projectsJson = """{"projects":[{"id":"prj_1","name":"aop","status":"active","notificationLevel":"coordinator","createdAt":"$NOW_ISO","updatedAt":"$NOW_ISO"}]}"""
    private val threadJson = """{"id":"thr_1","projectId":"prj_1","title":"Pick","status":"waiting-on-you","steps":[],"artifacts":[],"unread":true,"lastActivityAt":"$NOW_ISO","createdAt":"$NOW_ISO","blockedQuestion":{"question":"Native?","options":[]}}"""
    private val streamBody = listOf(
        "event: entry", "id: 7", """data: {"id":7,"projectId":"prj_1","type":"thread.upserted","payload":{"thread":$threadJson}}""", "",
        "event: live", """data: {"turns":[]}""", "",
    ).joinToString("\n", postfix = "\n")

    private fun client(handler: suspend MockRequestHandleScope.(HttpRequestData) -> io.ktor.client.request.HttpResponseData): Pair<HostClient, HttpClient> {
        val http = HttpClient(MockEngine { request -> requests += request; handler(request) })
        return HostClient("https://soulf.example.ts.net", "aop_token", http) to http
    }

    private fun MockRequestHandleScope.json(body: String, status: HttpStatusCode = HttpStatusCode.OK) =
        respond(body, status, headersOf(HttpHeaders.ContentType, "application/json"))

    @Test
    fun catchUpReplaysMissedEntriesAndReportsThem() = runTest {
        val (client, http) = client { request ->
            when (request.url.encodedPath) {
                "/api/projects" -> json(projectsJson)
                "/api/projects/prj_1/stream" -> respond(streamBody, HttpStatusCode.OK, headersOf(HttpHeaders.ContentType, "text/event-stream"))
                else -> json("{}", HttpStatusCode.NotFound)
            }
        }
        val session = HostSession(client, http, backgroundScope, clock = { NOW })
        val changes = mutableListOf<HostChange>()
        backgroundScope.launch { session.changes.collect { changes += it } }

        realTime { session.catchUp() }
        assertEquals(Connection.Live, session.state.value.connection)
        assertEquals("waiting-on-you", session.state.value.thread("prj_1", "thr_1")!!.status)
        assertEquals("thr_1", assertIs<HostChange.ThreadChanged>(changes.single()).thread.id)
        assertTrue(requests.all { it.headers[HttpHeaders.Authorization] == "Bearer aop_token" })

        // The next look resumes after the newest entry it saw.
        realTime { session.catchUp() }
        assertEquals("after=7", requests.last().url.encodedQuery)
    }

    @Test
    fun aRemovedPhoneIsUnauthorized() = runTest {
        val (client, http) = client { json("""{"error":"no","code":"UNAUTHENTICATED"}""", HttpStatusCode.Unauthorized) }
        val session = HostSession(client, http, backgroundScope, clock = { NOW })
        realTime { session.catchUp() }
        assertEquals(Connection.Unauthorized, session.state.value.connection)
    }

    @Test
    fun noAnswerIsUnreachable() = runTest {
        val (client, http) = client { throw RuntimeException("connect timed out") }
        val session = HostSession(client, http, backgroundScope, clock = { NOW })
        realTime { session.catchUp() }
        assertEquals(Connection.Unreachable(NOW), session.state.value.connection)
    }

    @Test
    fun answeringAQuestionPostsTheLabelAndAppliesTheThread() = runTest {
        val answered = threadJson.replace("\"waiting-on-you\"", "\"working\"").replace(""","blockedQuestion":{"question":"Native?","options":[]}""", "")
        val (client, http) = client { request ->
            when (request.url.encodedPath) {
                "/api/projects" -> json(projectsJson)
                "/api/threads/thr_1/reply" -> json("""{"thread":$answered}""")
                else -> json("{}", HttpStatusCode.NotFound)
            }
        }
        val session = HostSession(client, http, backgroundScope, clock = { NOW })
        session.refreshProjects()
        session.answer("thr_1", "Native")
        assertEquals("""{"text":"Native"}""", (requests.last().body as io.ktor.http.content.TextContent).text)
        assertEquals("working", session.state.value.thread("prj_1", "thr_1")!!.status)
    }

    @Test
    fun pairingMapsTheHostsRefusals() = runTest {
        val (wrong, _) = client { json("""{"code":"INVALID_PAIRING_CODE"}""", HttpStatusCode.Unauthorized) }
        assertFailsWith<HostError.InvalidPairingCode> { wrong.pair("ABCD-EFGH", "Fold") }
        val (limited, _) = client { respond("{}", HttpStatusCode.TooManyRequests, headersOf(HttpHeaders.RetryAfter, "42")) }
        assertEquals(42, assertFailsWith<HostError.RateLimited> { limited.pair("ABCD-EFGH", "Fold") }.retryAfterSeconds)
    }

    @Test
    fun healthRefusesOtherServicesAndOtherApiVersions() = runTest {
        val (other, _) = client { json("""{"service":"nginx","version":"1","apiVersion":1,"minClientApiVersion":1}""") }
        assertFailsWith<HostError.Incompatible> { other.health() }
        val (newer, _) = client { json("""{"service":"aop","version":"9","apiVersion":3,"minClientApiVersion":2}""") }
        assertFailsWith<HostError.Incompatible> { newer.health() }
    }

    @Test
    fun loadingAChatStoresItsPage() = runTest {
        val (client, http) = client { request ->
            when (request.url.encodedPath) {
                "/api/projects/prj_1/messages" -> json("""{"messages":[{"id":"m1","projectId":"prj_1","threadId":null,"createdAt":"$NOW_ISO","role":"user","text":"hi"}],"hasMore":false}""")
                else -> json("{}", HttpStatusCode.NotFound)
            }
        }
        val session = HostSession(client, http, backgroundScope, clock = { NOW })
        session.loadChat(ChatKey("prj_1", null))
        assertEquals(listOf("hi"), session.state.value.chats[ChatKey("prj_1", null)]!!.messages.map { it.text })
    }

    // The catch-up timeout must run on the clock: the test scheduler would skip it while the
    // mock engine answers on another dispatcher.
    private suspend fun realTime(block: suspend () -> Unit) = withContext(Dispatchers.Default) { block() }
}
