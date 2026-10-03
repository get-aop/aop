package com.getaop.mobile.ui.main

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.navigationBars
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.windowInsetsBottomHeight
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
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
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.getaop.mobile.core.session.HostState
import com.getaop.mobile.core.wire.Project
import com.getaop.mobile.ui.common.CountBadge
import com.getaop.mobile.ui.common.ago
import com.getaop.mobile.ui.theme.AopColors
import com.getaop.mobile.ui.theme.CardShape

/** Every project on the host, with what needs the person counted on each. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ProjectsPane(
    host: HostState,
    hostName: String,
    onOpenProject: (String) -> Unit,
    onOpenSettings: () -> Unit,
) {
    Column(Modifier.fillMaxSize()) {
        TopAppBar(
            title = {
                Column {
                    Text("Projects", style = MaterialTheme.typography.titleLarge)
                    Text("on $hostName", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
            },
            actions = {
                IconButton(onClick = onOpenSettings) { Icon(Icons.Filled.Settings, contentDescription = "Settings") }
            },
            windowInsets = WindowInsets(0),
        )
        if (host.projects.isEmpty()) {
            Box(Modifier.fillMaxSize().padding(24.dp), contentAlignment = Alignment.Center) {
                Text(
                    if (host.connection is com.getaop.mobile.core.session.Connection.Live) "No projects on $hostName yet." else "Loading projects…",
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            return
        }
        LazyColumn(
            contentPadding = PaddingValues(horizontal = 12.dp, vertical = 4.dp),
            verticalArrangement = Arrangement.spacedBy(6.dp),
        ) {
            items(host.projects, key = { it.id }) { project ->
                ProjectRow(project, host, onClick = { onOpenProject(project.id) })
            }
            item { Spacer(Modifier.windowInsetsBottomHeight(WindowInsets.navigationBars)) }
        }
    }
}

@Composable
private fun ProjectRow(project: Project, host: HostState, onClick: () -> Unit) {
    val badges = host.badges(project.id)
    Row(
        Modifier
            .fillMaxWidth()
            .background(MaterialTheme.colorScheme.surfaceContainer, CardShape)
            .clickable(onClickLabel = "Open ${project.name}", role = Role.Button, onClick = onClick)
            .padding(14.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        ProjectAvatar(project)
        Spacer(Modifier.width(12.dp))
        Column(Modifier.weight(1f)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(project.name, style = MaterialTheme.typography.titleMedium, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f, fill = false))
                if (project.status == "paused") {
                    Text("  Paused", style = MaterialTheme.typography.labelSmall, color = AopColors.TextSubtle)
                }
            }
            if (project.goal.isNotBlank()) {
                Text(project.goal, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1, overflow = TextOverflow.Ellipsis)
            }
            Row(Modifier.padding(top = 6.dp), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                CountBadge(badges.needsYou, AopColors.Waiting, "need you")
                CountBadge(badges.working, AopColors.Running, "working")
                CountBadge(badges.unread, AopColors.Text, "unread")
            }
        }
        Text(ago(project.updatedAt), style = MaterialTheme.typography.labelSmall, color = AopColors.TextSubtle)
    }
}

/** The project's tile: its colour and first letter, as the dashboard draws a project without an icon. */
@Composable
fun ProjectAvatar(project: Project, size: Int = 36) {
    val color = when (project.color) {
        "green" -> AopColors.Ok
        "orange" -> AopColors.Waiting
        "purple", "indigo" -> AopColors.Merged
        "pink" -> androidx.compose.ui.graphics.Color(0xFFFB7185)
        "teal" -> androidx.compose.ui.graphics.Color(0xFF2DD4BF)
        "yellow" -> androidx.compose.ui.graphics.Color(0xFFE3B341)
        else -> AopColors.Running
    }
    Box(
        Modifier.size(size.dp).background(color.copy(alpha = 0.18f), MaterialTheme.shapes.medium),
        contentAlignment = Alignment.Center,
    ) {
        Text(project.name.take(1).uppercase(), style = MaterialTheme.typography.titleMedium, color = color)
    }
}
