package com.getaop.mobile.core

import com.getaop.mobile.core.stream.SseEvent
import com.getaop.mobile.core.stream.StreamEvent
import com.getaop.mobile.core.stream.decodeStreamEvent
import com.getaop.mobile.core.wire.EntryPayload
import com.getaop.mobile.core.wire.EventLogEntry
import com.getaop.mobile.core.wire.HostHealth
import com.getaop.mobile.core.wire.MessagePage
import com.getaop.mobile.core.wire.PairedDevice
import com.getaop.mobile.core.wire.ProjectList
import com.getaop.mobile.core.wire.ThreadList
import com.getaop.mobile.core.wire.WireJson
import com.getaop.mobile.core.wire.read
import java.io.File
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertIs
import kotlin.test.assertTrue

/** Decodes the samples apps/mobile/wire-contract.test.ts checks against the zod schemas. */
class WireFixturesTest {
    private fun fixture(name: String): String =
        listOf("../wire-fixtures", "wire-fixtures", "apps/mobile/wire-fixtures")
            .map { File(it, name) }
            .first { it.exists() }
            .readText()

    @Test
    fun healthAndPairing() {
        assertEquals(1, WireJson.decodeFromString<HostHealth>(fixture("health.json")).apiVersion)
        assertTrue(WireJson.decodeFromString<PairedDevice>(fixture("paired-device.json")).token.startsWith("aop_"))
    }

    @Test
    fun projectsAndThreads() {
        assertEquals("aop", WireJson.decodeFromString<ProjectList>(fixture("projects.json")).projects.single().name)
        val threads = WireJson.decodeFromString<ThreadList>(fixture("threads.json")).threads
        val asked = threads.first { it.status == "waiting-on-you" }
        assertEquals("Native", asked.blockedQuestion!!.options.single { it.recommended }.label)
        assertEquals("Approve the release on GitHub", threads.first { it.id == "thr_w" }.waitingOn!!.reason)
        assertEquals(71, threads.first { it.id == "thr_r" }.pullRequest!!.number)
    }

    @Test
    fun messagesOfEveryRole() {
        val page = WireJson.decodeFromString<MessagePage>(fixture("coordinator-messages.json"))
        assertEquals(listOf("user", "assistant", "thread-report", "assistant", "assistant"), page.messages.map { it.role })
        assertEquals(listOf("thinking", "tool", "text", "thread-card", "pr-chip", "routing-receipt"), page.messages[1].blocks.map { it.type })
        assertTrue(page.messages[3].failed)
        val question = page.messages[4].blocks.single { it.type == "question" }
        assertEquals("Merge it by itself, or wait for you?", question.question)
        assertEquals("Merge by itself", question.options.single { it.recommended }.label)
        assertTrue(question.other)
        assertTrue(page.hasMore)
    }

    @Test
    fun streamEntriesReadByType() {
        val entries = WireJson.decodeFromString<List<EventLogEntry>>(fixture("stream-entries.json"))
        val payloads = entries.map { it.read() }
        assertIs<EntryPayload.ThreadUpserted>(payloads[0])
        assertEquals("failed", assertIs<EntryPayload.MessageCreated>(payloads[1]).message.outcome)
        assertEquals("thr_d", assertIs<EntryPayload.ThreadRemoved>(payloads[2]).threadId)
        assertEquals(EntryPayload.Other, payloads[3])
    }

    @Test
    fun streamFrames() {
        assertIs<StreamEvent.Delta>(decodeStreamEvent(SseEvent("delta", null, fixture("delta.json"))))
        assertIs<StreamEvent.Live>(decodeStreamEvent(SseEvent("live", null, fixture("live.json"))))
        assertEquals(40L, assertIs<StreamEvent.Resync>(decodeStreamEvent(SseEvent("resync", "40", fixture("resync.json")))).resync.cursor)
        assertEquals(StreamEvent.Unreadable, decodeStreamEvent(SseEvent("entry", "1", "{\"nope\":true}")))
    }
}
