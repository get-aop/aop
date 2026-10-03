package com.getaop.mobile.ui.chat

import androidx.compose.animation.animateContentSize
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.getaop.mobile.core.session.HostState
import com.getaop.mobile.core.session.LiveTurn
import com.getaop.mobile.core.wire.Artifact
import com.getaop.mobile.core.wire.Block
import com.getaop.mobile.core.wire.Message
import com.getaop.mobile.core.wire.MessageRole
import com.getaop.mobile.ui.common.PullRequestChip
import com.getaop.mobile.ui.common.ThreadStatusLine
import com.getaop.mobile.ui.theme.AopColors
import com.getaop.mobile.ui.theme.CardShape

/** One message of a conversation, drawn by who wrote it. */
@Composable
fun MessageView(message: Message, host: HostState, onOpenThread: (String) -> Unit) {
    when (message.role) {
        MessageRole.USER -> UserBubble(message)
        MessageRole.ASSISTANT -> AssistantReply(message.id, message.blocks, host, failed = message.failed, onOpenThread = onOpenThread)
        MessageRole.THREAD_REPORT -> ThreadReportLine(message, host, onOpenThread)
    }
}

@Composable
fun LiveTurnView(turn: LiveTurn, host: HostState, onOpenThread: (String) -> Unit) {
    Column {
        AssistantReply(null, turn.parts, host, failed = false, onOpenThread = onOpenThread)
        Text("Writing…", style = MaterialTheme.typography.labelSmall, color = AopColors.Running, modifier = Modifier.padding(top = 2.dp))
    }
}

@Composable
private fun UserBubble(message: Message) {
    val from = when (message.sender) {
        "coordinator" -> if (message.brief) "Brief from the coordinator" else "Coordinator"
        "routine" -> "Routine"
        "system" -> "AOP"
        else -> null
    }
    Box(Modifier.fillMaxWidth(), contentAlignment = if (from == null) Alignment.CenterEnd else Alignment.CenterStart) {
        Column(
            Modifier
                .widthIn(max = 560.dp)
                .background(MaterialTheme.colorScheme.surfaceContainerHigh, CardShape)
                .padding(horizontal = 14.dp, vertical = 10.dp),
        ) {
            from?.let { Text(it, style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant) }
            message.quote?.let { Text("“$it”", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant) }
            val text = message.text.orEmpty()
            if (from == null) Text(text, style = MaterialTheme.typography.bodyLarge) else Markdown(text, onThreadLink = {})
        }
    }
}

/**
 * A reply's parts in order: prose, folded reasoning, tool calls folded into one line, cards.
 * `messageId` is null while the reply is being written.
 */
@Composable
private fun AssistantReply(messageId: String?, blocks: List<Block>, host: HostState, failed: Boolean, onOpenThread: (String) -> Unit) {
    val modifier = if (failed) {
        Modifier.border(1.dp, AopColors.Blocked.copy(alpha = 0.5f), CardShape).padding(12.dp)
    } else {
        Modifier
    }
    Column(modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        if (failed) Text("Run failed", style = MaterialTheme.typography.labelMedium, color = AopColors.Blocked)
        for (group in groupTools(blocks)) {
            when {
                group.size > 1 || group.first().type == "tool" -> ToolsLine(group)
                else -> BlockView(messageId, group.first(), host, onOpenThread)
            }
        }
    }
}

/** Consecutive tool calls become one group, so a reply that ran forty commands stays readable. */
fun groupTools(blocks: List<Block>): List<List<Block>> {
    val groups = mutableListOf<MutableList<Block>>()
    for (block in blocks) {
        val last = groups.lastOrNull()
        if (block.type == "tool" && last != null && last.first().type == "tool") last += block else groups += mutableListOf(block)
    }
    return groups
}

@Composable
private fun BlockView(messageId: String?, block: Block, host: HostState, onOpenThread: (String) -> Unit) {
    val uri = LocalUriHandler.current
    when (block.type) {
        "text" -> Markdown(block.text.orEmpty(), onThreadLink = onOpenThread)
        "thinking" -> Folded("Thought", block.text.orEmpty())
        "thread-card" -> block.threadId?.let { InlineThreadCard(it, host, onOpenThread) }
        "thread-chip" -> block.threadId?.let { id ->
            val title = host.threads.values.flatten().firstOrNull { it.id == id }?.title ?: "a thread"
            Text(title, color = AopColors.Running, modifier = Modifier.clickable(role = Role.Button) { onOpenThread(id) })
        }
        "pr-chip" -> {
            val pr = Artifact(type = "pr", number = block.number, url = block.url, state = block.state)
            PullRequestChip(pr, Modifier.clickable(role = Role.Button) { block.url?.let(uri::openUri) })
        }
        "routing-receipt" -> {
            val count = block.threadIds.size
            Text(if (count == 1) "Sent to one thread" else "Sent to $count threads", style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        "artifact" -> Text("Made an artifact. Open it in AOP on your computer.", style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
        "question" -> AskedQuestion(messageId, block)
        // Marks where a steer reached the turn; the steer itself shows as the person's message.
        "steer" -> Unit
        else -> OpenOnDesktop()
    }
}

/** A block this version of the app cannot draw (a newer host, or one only the desktop shows): say so rather than drop it. */
@Composable
private fun OpenOnDesktop() {
    Text(
        "Open on desktop to see this",
        style = MaterialTheme.typography.labelMedium,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
        modifier = Modifier
            .testTag("unknown-block")
            .border(1.dp, AopColors.BorderStrong, CardShape)
            .padding(horizontal = 12.dp, vertical = 8.dp),
    )
}

@Composable
private fun ToolsLine(tools: List<Block>) {
    var open by rememberSaveable { mutableStateOf(false) }
    val failed = tools.count { it.status == "failed" }
    val running = tools.any { it.status == "running" }
    val label = buildString {
        append(if (tools.size == 1) "Used ${tools.first().name}" else "Used ${tools.size} tools")
        if (running) append(" · running")
        if (failed > 0) append(" · $failed failed")
    }
    Column(Modifier.animateContentSize()) {
        Text(
            (if (open) "▾ " else "▸ ") + label,
            style = MaterialTheme.typography.labelMedium,
            color = if (failed > 0) AopColors.Blocked else MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.clickable(onClickLabel = if (open) "Hide tools" else "Show tools", role = Role.Button) { open = !open }.padding(vertical = 4.dp),
        )
        if (open) {
            tools.forEach { tool ->
                Text(
                    "${tool.name}${tool.detail?.let { ": $it" } ?: ""}",
                    style = MaterialTheme.typography.bodySmall,
                    color = AopColors.TextSubtle,
                    maxLines = 2,
                    overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.padding(start = 14.dp, bottom = 2.dp),
                )
            }
        }
    }
}

@Composable
private fun Folded(label: String, text: String) {
    var open by rememberSaveable { mutableStateOf(false) }
    Column(Modifier.animateContentSize()) {
        Text(
            (if (open) "▾ " else "▸ ") + label,
            style = MaterialTheme.typography.labelMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.clickable(role = Role.Button) { open = !open }.padding(vertical = 4.dp),
        )
        if (open) Text(text, style = MaterialTheme.typography.bodySmall, color = AopColors.TextSubtle)
    }
}

@Composable
private fun InlineThreadCard(threadId: String, host: HostState, onOpenThread: (String) -> Unit) {
    val thread = host.threads.values.flatten().firstOrNull { it.id == threadId }
    Column(
        Modifier
            .fillMaxWidth()
            .background(MaterialTheme.colorScheme.surfaceContainer, CardShape)
            .clickable(onClickLabel = "Open thread", role = Role.Button) { onOpenThread(threadId) }
            .padding(12.dp),
        verticalArrangement = Arrangement.spacedBy(4.dp),
    ) {
        Text(thread?.title ?: "Thread", style = MaterialTheme.typography.titleSmall)
        thread?.let { ThreadStatusLine(it) }
        (thread?.blockedQuestion?.question ?: thread?.liveStatusLine)?.let {
            Text(it, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 2, overflow = TextOverflow.Ellipsis)
        }
    }
}

@Composable
private fun ThreadReportLine(message: Message, host: HostState, onOpenThread: (String) -> Unit) {
    val id = message.reportedThreadId
    val title = id?.let { tid -> host.threads.values.flatten().firstOrNull { it.id == tid }?.title } ?: "A thread"
    val (verb, color) = when (message.outcome) {
        "failed" -> "failed" to AopColors.Blocked
        "needs-you" -> "needs you" to AopColors.Waiting
        else -> "finished a turn" to MaterialTheme.colorScheme.onSurfaceVariant
    }
    Text(
        "$title $verb · ${message.text.orEmpty()}",
        style = MaterialTheme.typography.labelMedium,
        color = color,
        textAlign = TextAlign.Center,
        maxLines = 3,
        overflow = TextOverflow.Ellipsis,
        modifier = Modifier
            .fillMaxWidth()
            .clickable(enabled = id != null, role = Role.Button) { id?.let(onOpenThread) }
            .padding(vertical = 4.dp, horizontal = 16.dp),
    )
}
