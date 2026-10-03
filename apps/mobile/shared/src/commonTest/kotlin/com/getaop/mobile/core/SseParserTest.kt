package com.getaop.mobile.core

import com.getaop.mobile.core.stream.SseEvent
import com.getaop.mobile.core.stream.SseParser
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

class SseParserTest {
    private fun parse(vararg lines: String): List<SseEvent> {
        val parser = SseParser()
        return lines.mapNotNull(parser::feed)
    }

    @Test
    fun readsNamedEventsWithIds() {
        assertEquals(
            listOf(SseEvent("entry", "41", "{\"a\":1}")),
            parse("event: entry", "id: 41", "data: {\"a\":1}", ""),
        )
    }

    @Test
    fun joinsMultiLineDataAndDefaultsTheName() {
        assertEquals(listOf(SseEvent("message", null, "one\ntwo")), parse("data: one", "data:two", ""))
    }

    @Test
    fun ignoresCommentsAndEventsWithoutData() {
        assertEquals(emptyList(), parse(": keep-alive", "", "event: heartbeat", ""))
    }

    @Test
    fun resetsBetweenEvents() {
        val events = parse("event: a", "id: 1", "data: x", "", "data: y", "")
        assertEquals(SseEvent("message", null, "y"), events[1])
    }

    @Test
    fun anUnfinishedEventIsNotEmitted() {
        assertNull(SseParser().feed("data: half"))
    }
}
