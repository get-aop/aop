package com.getaop.mobile.ui.thread

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.getaop.mobile.core.session.HostState
import com.getaop.mobile.core.wire.Thread
import com.getaop.mobile.core.wire.ThreadStatus
import com.getaop.mobile.ui.chat.Composer
import com.getaop.mobile.ui.chat.Conversation
import com.getaop.mobile.ui.common.PullRequestChip
import com.getaop.mobile.ui.common.ThreadStatusLine
import com.getaop.mobile.ui.main.Detail
import com.getaop.mobile.ui.main.MainViewModel
import com.getaop.mobile.ui.theme.AopColors
import com.getaop.mobile.ui.theme.CardShape

/** One thread: where it is, what it waits on you for, and its conversation. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ThreadPane(
    viewModel: MainViewModel,
    host: HostState,
    detail: Detail,
    showBack: Boolean,
    onBack: () -> Unit,
    onOpen: (Detail) -> Unit,
) {
    LaunchedEffect(detail) { viewModel.load(detail) }
    val thread = detail.threadId?.let { host.thread(detail.projectId, it) }
    Column(Modifier.fillMaxSize()) {
        TopAppBar(
            navigationIcon = {
                if (showBack) IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Back") }
            },
            title = { Text(thread?.title ?: "Thread", maxLines = 1, overflow = TextOverflow.Ellipsis) },
            windowInsets = WindowInsets(0),
        )
        Conversation(
            host,
            detail,
            onOpenThread = { onOpen(Detail(detail.projectId, it)) },
            modifier = Modifier.weight(1f),
            header = thread?.let { { ThreadHeader(it) } },
            // The question sits under the newest message, where the conversation opens.
            footer = thread?.blockedQuestion?.takeIf { thread.status == ThreadStatus.WAITING_ON_YOU }?.let { question ->
                { AnswerCard(question, onAnswer = { text -> viewModel.answer(detail, text) }) }
            },
        )
        val waiting = thread?.status == ThreadStatus.WAITING_ON_YOU
        Composer(
            initial = viewModel.draft(detail.chatKey),
            placeholder = if (waiting) "Answer the question above" else "Message this thread",
            onDraft = { viewModel.setDraft(detail.chatKey, it) },
            onSend = { viewModel.send(detail.chatKey, it) },
            enabled = thread != null && !waiting && thread.status != ThreadStatus.RESOLVED,
        )
    }
}

@Composable
private fun ThreadHeader(thread: Thread) {
    val uri = LocalUriHandler.current
    Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        Column(
            Modifier.fillMaxWidth().background(MaterialTheme.colorScheme.surfaceContainer, CardShape).padding(14.dp),
            verticalArrangement = Arrangement.spacedBy(6.dp),
        ) {
            ThreadStatusLine(thread)
            thread.liveStatusLine?.let { Text(it, style = MaterialTheme.typography.bodyMedium) }
            if (thread.steps.isNotEmpty()) {
                val done = thread.steps.count { it.state == "done" }
                LinearProgressIndicator(progress = { done.toFloat() / thread.steps.size }, modifier = Modifier.fillMaxWidth())
                thread.steps.forEach { step ->
                    val mark = when (step.state) {
                        "done" -> "✓"
                        "active" -> "›"
                        else -> "·"
                    }
                    Text(
                        "$mark  ${step.label}",
                        style = MaterialTheme.typography.bodySmall,
                        color = if (step.state == "active") MaterialTheme.colorScheme.onSurface else MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                thread.pullRequest?.let { pr ->
                    PullRequestChip(pr, Modifier.clickable(onClickLabel = "Open the pull request", role = Role.Button) { pr.url?.let(uri::openUri) })
                }
                thread.branch?.let { Text(it, style = MaterialTheme.typography.labelSmall, color = AopColors.TextSubtle, maxLines = 1, overflow = TextOverflow.Ellipsis) }
            }
        }
        thread.waitingOn?.let { wait ->
            Column(
                Modifier.fillMaxWidth().background(AopColors.Waiting.copy(alpha = 0.08f), CardShape).padding(14.dp),
                verticalArrangement = Arrangement.spacedBy(4.dp),
            ) {
                Text("Waiting on you", style = MaterialTheme.typography.labelMedium, color = AopColors.Waiting)
                Text(wait.reason, style = MaterialTheme.typography.bodyLarge)
                wait.link?.let { link ->
                    Text("Open the link", color = AopColors.Running, modifier = Modifier.clickable(role = Role.Button) { uri.openUri(link) }.padding(vertical = 4.dp))
                }
            }
        }
        thread.degraded?.let {
            Text("This thread lost its AOP tools: ${it.reason}", color = AopColors.Blocked, style = MaterialTheme.typography.bodySmall)
        }
    }
}
