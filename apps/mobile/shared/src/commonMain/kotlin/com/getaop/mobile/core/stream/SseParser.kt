package com.getaop.mobile.core.stream

/** One server-sent event: its name (`message` when unnamed), its `id` if it carried one, and its data. */
data class SseEvent(val event: String, val id: String?, val data: String)

/**
 * The text/event-stream format, line by line (https://html.spec.whatwg.org/#event-stream-interpretation).
 * Feed it each line without its terminator; it returns an event when a blank line ends one.
 */
class SseParser {
    private var event = ""
    private var id: String? = null
    private val data = StringBuilder()
    private var hasData = false

    fun feed(line: String): SseEvent? {
        if (line.isEmpty()) return dispatch()
        if (line.startsWith(":")) return null
        val colon = line.indexOf(':')
        val field = if (colon == -1) line else line.substring(0, colon)
        var value = if (colon == -1) "" else line.substring(colon + 1)
        if (value.startsWith(" ")) value = value.substring(1)
        when (field) {
            "event" -> event = value
            "data" -> {
                if (hasData) data.append('\n')
                data.append(value)
                hasData = true
            }
            "id" -> if ('\u0000' !in value) id = value
        }
        return null
    }

    private fun dispatch(): SseEvent? {
        val result = if (hasData) SseEvent(event.ifEmpty { "message" }, id, data.toString()) else null
        event = ""
        id = null
        data.clear()
        hasData = false
        return result
    }
}
