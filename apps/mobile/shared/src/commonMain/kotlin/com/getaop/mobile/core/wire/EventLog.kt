package com.getaop.mobile.core.wire

import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.decodeFromJsonElement
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonPrimitive

/** What an event-log entry carries, read by its `type`. Unknown types read as [Other]. */
sealed interface EntryPayload {
    data class ProjectUpserted(val project: Project) : EntryPayload
    data object ProjectRemoved : EntryPayload
    data class ThreadUpserted(val thread: Thread) : EntryPayload
    data class ThreadRemoved(val threadId: String) : EntryPayload
    data class MessageCreated(val message: Message) : EntryPayload
    data class MessageUpdated(val message: Message) : EntryPayload
    data object Other : EntryPayload
}

/** Null when the payload does not match its type: the caller resyncs instead of guessing. */
fun EventLogEntry.read(): EntryPayload? = runCatching {
    when (type) {
        "project.upserted" -> EntryPayload.ProjectUpserted(decode(payload["project"]))
        "project.removed" -> EntryPayload.ProjectRemoved
        "thread.upserted" -> EntryPayload.ThreadUpserted(decode(payload["thread"]))
        "thread.removed" ->
            EntryPayload.ThreadRemoved(payload["threadId"]!!.jsonPrimitive.contentOrNull!!)
        "message.created" -> EntryPayload.MessageCreated(decode(payload["message"]))
        "message.updated" -> EntryPayload.MessageUpdated(decode(payload["message"]))
        else -> EntryPayload.Other
    }
}.getOrNull()

private inline fun <reified T> decode(element: JsonElement?): T =
    WireJson.decodeFromJsonElement(requireNotNull(element))
