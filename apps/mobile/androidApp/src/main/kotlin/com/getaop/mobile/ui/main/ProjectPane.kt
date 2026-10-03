package com.getaop.mobile.ui.main

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.navigationBars
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.windowInsetsBottomHeight
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.getaop.mobile.core.session.ChatKey
import com.getaop.mobile.core.session.HostState
import com.getaop.mobile.core.wire.MessageRole
import com.getaop.mobile.core.wire.Project
import com.getaop.mobile.core.wire.Thread
import com.getaop.mobile.core.wire.ThreadStatus
import com.getaop.mobile.ui.common.PullRequestChip
import com.getaop.mobile.ui.common.ThreadStatusLine
import com.getaop.mobile.ui.common.ago
import com.getaop.mobile.ui.theme.AopColors
import com.getaop.mobile.ui.theme.CardShape

/** One project: its coordinator chat first, then its threads, what needs the person on top. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ProjectPane(
    host: HostState,
    project: Project,
    selected: Detail?,
    onBack: () -> Unit,
    onOpen: (Detail) -> Unit,
    onOpenSettings: () -> Unit,
) {
    val threads = host.threads[project.id].orEmpty()
    val open = threads.filter { it.status != ThreadStatus.RESOLVED }
    val done = threads.filter { it.status == ThreadStatus.RESOLVED }.take(10)

    Column(Modifier.fillMaxSize()) {
        TopAppBar(
            navigationIcon = {
                IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "All projects") }
            },
            title = { Text(project.name, maxLines = 1, overflow = TextOverflow.Ellipsis) },
            actions = { IconButton(onClick = onOpenSettings) { Icon(Icons.Filled.Settings, contentDescription = "Settings") } },
            windowInsets = WindowInsets(0),
        )
        LazyColumn(
            contentPadding = PaddingValues(horizontal = 12.dp, vertical = 4.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            item(key = "coordinator") {
                CoordinatorCard(host, project, isSelected = selected == Detail(project.id, null), onClick = { onOpen(Detail(project.id, null)) })
            }
            item(key = "threads-header") { SectionLabel(if (open.isEmpty() && host.loadedProjects.contains(project.id)) "No open threads" else "Threads") }
            items(open, key = { it.id }) { thread ->
                ThreadCard(thread, isSelected = selected?.threadId == thread.id, onClick = { onOpen(Detail(project.id, thread.id)) })
            }
            if (done.isNotEmpty()) {
                item(key = "done-header") { SectionLabel("Done") }
                items(done, key = { it.id }) { thread ->
                    ThreadCard(thread, isSelected = selected?.threadId == thread.id, onClick = { onOpen(Detail(project.id, thread.id)) })
                }
            }
            item { Spacer(Modifier.windowInsetsBottomHeight(WindowInsets.navigationBars)) }
        }
    }
}

@Composable
private fun SectionLabel(text: String) {
    Text(text, Modifier.padding(start = 4.dp, top = 8.dp), style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.onSurfaceVariant)
}

@Composable
private fun CoordinatorCard(host: HostState, project: Project, isSelected: Boolean, onClick: () -> Unit) {
    val last = host.chats[ChatKey(project.id, null)]?.messages?.lastOrNull()
    val preview = when (last?.role) {
        MessageRole.USER -> "You: ${last.text.orEmpty()}"
        MessageRole.ASSISTANT -> last.blocks.firstOrNull { it.type == "text" }?.text.orEmpty()
        MessageRole.THREAD_REPORT -> last.text.orEmpty()
        else -> "Ask the coordinator to start or steer threads."
    }
    Column(
        Modifier
            .fillMaxWidth()
            .selectable(isSelected)
            .clickable(onClickLabel = "Open the coordinator chat", role = Role.Button, onClick = onClick)
            .padding(14.dp),
    ) {
        Text("Coordinator chat", style = MaterialTheme.typography.titleSmall)
        Text(preview, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 2, overflow = TextOverflow.Ellipsis)
    }
}

/** A thread at a glance: title, status, the line it reports, its progress and pull request. */
@Composable
fun ThreadCard(thread: Thread, isSelected: Boolean, onClick: () -> Unit) {
    Column(
        Modifier
            .fillMaxWidth()
            .selectable(isSelected, accent = if (thread.needsYou) AopColors.Waiting else null)
            .clickable(onClickLabel = "Open ${thread.title}", role = Role.Button, onClick = onClick)
            .padding(14.dp),
        verticalArrangement = Arrangement.spacedBy(4.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(
                thread.title,
                style = MaterialTheme.typography.titleSmall,
                maxLines = 2,
                overflow = TextOverflow.Ellipsis,
                modifier = Modifier.weight(1f),
                color = if (thread.unread) MaterialTheme.colorScheme.onSurface else MaterialTheme.colorScheme.onSurface.copy(alpha = 0.9f),
            )
            Spacer(Modifier.width(8.dp))
            Text(ago(thread.lastActivityAt), style = MaterialTheme.typography.labelSmall, color = AopColors.TextSubtle)
        }
        ThreadStatusLine(thread)
        val line = thread.blockedQuestion?.question ?: thread.waitingOn?.reason ?: thread.liveStatusLine
        line?.let { Text(it, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 2, overflow = TextOverflow.Ellipsis) }
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
            if (thread.steps.isNotEmpty()) {
                val done = thread.steps.count { it.state == "done" }
                Text("$done/${thread.steps.size} steps", style = MaterialTheme.typography.labelSmall, color = AopColors.TextSubtle)
            }
            thread.pullRequest?.let { PullRequestChip(it) }
        }
    }
}

@Composable
private fun Modifier.selectable(selected: Boolean, accent: Color? = null): Modifier {
    val base = background(if (selected) MaterialTheme.colorScheme.surfaceContainerHigh else MaterialTheme.colorScheme.surfaceContainer, CardShape)
    val edge = accent ?: if (selected) AopColors.BorderStrong else null
    return if (edge != null) base.border(1.dp, edge.copy(alpha = if (accent != null) 0.5f else 1f), CardShape) else base
}
