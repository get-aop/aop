package com.getaop.mobile.core

import com.getaop.mobile.core.wire.Artifact
import com.getaop.mobile.core.wire.BlockedOption
import com.getaop.mobile.core.wire.BlockedQuestion
import com.getaop.mobile.core.wire.Message
import com.getaop.mobile.core.wire.Project
import com.getaop.mobile.core.wire.Thread
import com.getaop.mobile.core.wire.ThreadWait

const val NOW_ISO = "2026-10-03T08:10:00Z"
const val NOW = 1_791_015_000_000L // NOW_ISO in epoch millis

fun project(id: String = "prj_1", level: String = "coordinator", status: String = "active", updatedAt: String = NOW_ISO) =
    Project(id = id, name = "Project $id", status = status, notificationLevel = level, createdAt = NOW_ISO, updatedAt = updatedAt)

fun thread(
    id: String = "thr_1",
    status: String = "working",
    projectId: String = "prj_1",
    question: String? = null,
    wait: String? = null,
    pr: String? = null,
    unread: Boolean = false,
    at: String = NOW_ISO,
) = Thread(
    id = id,
    projectId = projectId,
    title = "Thread $id",
    status = status,
    artifacts = listOfNotNull(pr?.let { Artifact(type = "pr", number = 7, url = "https://github.com/o/r/pull/7", state = it) }),
    unread = unread,
    lastActivityAt = at,
    createdAt = at,
    blockedQuestion = question?.let { BlockedQuestion(it, listOf(BlockedOption("Yes", recommended = true), BlockedOption("No"))) },
    waitingOn = wait?.let { ThreadWait(it, null, at) },
)

fun message(
    id: String,
    role: String,
    projectId: String = "prj_1",
    threadId: String? = null,
    text: String? = null,
    outcome: String? = null,
    reported: String? = null,
    at: String = NOW_ISO,
) = Message(
    id = id,
    projectId = projectId,
    threadId = threadId,
    createdAt = at,
    role = role,
    text = text,
    blocks = if (role == "assistant") listOf(com.getaop.mobile.core.wire.Block(type = "text", text = text ?: "Hi")) else emptyList(),
    outcome = outcome,
    reportedThreadId = reported,
)
