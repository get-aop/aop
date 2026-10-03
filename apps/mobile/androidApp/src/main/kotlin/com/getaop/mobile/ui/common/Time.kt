package com.getaop.mobile.ui.common

import com.getaop.mobile.core.notify.parseInstantMillis

/** "now", "5m", "3h", "2d": how long ago, as the dashboard's lists show it. */
fun ago(timestamp: String, now: Long = System.currentTimeMillis()): String {
    val at = parseInstantMillis(timestamp) ?: return ""
    val minutes = (now - at).coerceAtLeast(0) / 60_000
    return when {
        minutes < 1 -> "now"
        minutes < 60 -> "${minutes}m"
        minutes < 60 * 24 -> "${minutes / 60}h"
        else -> "${minutes / (60 * 24)}d"
    }
}
