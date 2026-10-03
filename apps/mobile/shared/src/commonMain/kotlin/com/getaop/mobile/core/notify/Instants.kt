package com.getaop.mobile.core.notify

import kotlin.time.ExperimentalTime
import kotlin.time.Instant

/** Epoch millis of an ISO-8601 timestamp as the host writes them, or null when it isn't one. */
@OptIn(ExperimentalTime::class)
fun parseInstantMillis(timestamp: String): Long? =
    runCatching { Instant.parse(timestamp).toEpochMilliseconds() }.getOrNull()
