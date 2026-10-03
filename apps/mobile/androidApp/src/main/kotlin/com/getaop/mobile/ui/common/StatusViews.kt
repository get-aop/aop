package com.getaop.mobile.ui.common

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import com.getaop.mobile.core.wire.Artifact
import com.getaop.mobile.core.wire.Thread
import com.getaop.mobile.core.wire.ThreadStatus
import com.getaop.mobile.ui.theme.AopColors

/** What a thread's status reads as and the colour of its dot. */
fun threadStatusLabel(thread: Thread): Pair<String, Color> = when {
    thread.status == ThreadStatus.WAITING_ON_YOU -> "Needs your answer" to AopColors.Waiting
    thread.waitingOn != null -> "Waiting on you" to AopColors.Waiting
    thread.degraded != null -> "Lost its AOP tools" to AopColors.Blocked
    else -> when (thread.status) {
        ThreadStatus.WORKING -> "Working" to AopColors.Running
        ThreadStatus.QUEUED -> "Queued" to AopColors.Queued
        ThreadStatus.RATE_LIMITED -> "Usage limit, resumes later" to AopColors.Queued
        ThreadStatus.READY_FOR_REVIEW -> "Ready for review" to AopColors.Ok
        ThreadStatus.LANDING -> "Landing" to AopColors.Merged
        ThreadStatus.IDLE -> "Idle" to AopColors.TextSubtle
        ThreadStatus.RESOLVED -> "Done" to AopColors.TextSubtle
        else -> thread.status to AopColors.TextSubtle
    }
}

@Composable
fun StatusDot(color: Color, modifier: Modifier = Modifier) {
    Box(modifier.size(8.dp).background(color, CircleShape))
}

@Composable
fun ThreadStatusLine(thread: Thread, modifier: Modifier = Modifier) {
    val (label, color) = threadStatusLabel(thread)
    Row(modifier, verticalAlignment = Alignment.CenterVertically) {
        StatusDot(color)
        Text(
            label,
            Modifier.padding(start = 6.dp),
            style = MaterialTheme.typography.labelMedium,
            color = color,
        )
    }
}

/** "PR #71", coloured by its state, with its checks when GitHub reported them. */
@Composable
fun PullRequestChip(pr: Artifact, modifier: Modifier = Modifier) {
    val color = when (pr.state) {
        "merged" -> AopColors.Merged
        "closed" -> AopColors.Blocked
        else -> AopColors.Ok
    }
    val checks = when (pr.checks?.state) {
        "failure" -> " · checks failing"
        "pending" -> " · checks running"
        "success" -> " · checks pass"
        else -> ""
    }
    Text(
        "PR #${pr.number} ${pr.state ?: ""}$checks",
        modifier
            .background(color.copy(alpha = 0.14f), RoundedCornerShape(6.dp))
            .padding(horizontal = 8.dp, vertical = 3.dp),
        style = MaterialTheme.typography.labelMedium,
        color = color,
    )
}

/** A small count, as on a project row: how many threads need you, are working, or are unread. */
@Composable
fun CountBadge(count: Int, color: Color, label: String, modifier: Modifier = Modifier) {
    if (count <= 0) return
    Text(
        "$count $label",
        modifier
            .background(color.copy(alpha = 0.16f), RoundedCornerShape(6.dp))
            .padding(horizontal = 7.dp, vertical = 2.dp),
        style = MaterialTheme.typography.labelSmall,
        color = color,
    )
}
