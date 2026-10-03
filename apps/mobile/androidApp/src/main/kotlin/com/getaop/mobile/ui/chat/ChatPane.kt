package com.getaop.mobile.ui.chat

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.platform.LocalSoftwareKeyboardController
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.getaop.mobile.core.chat.answersOf
import com.getaop.mobile.core.session.HostState
import com.getaop.mobile.ui.main.Detail
import com.getaop.mobile.ui.main.MainViewModel

/** A project's coordinator chat: the conversation, replies as they are written, and the message box. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ChatPane(
    viewModel: MainViewModel,
    host: HostState,
    detail: Detail,
    showBack: Boolean,
    onBack: () -> Unit,
    onOpen: (Detail) -> Unit,
) {
    LaunchedEffect(detail) { viewModel.load(detail) }
    val project = host.project(detail.projectId)
    val composer = remember { FocusRequester() }
    val keyboard = LocalSoftwareKeyboardController.current
    val messages = host.chats[detail.chatKey]?.messages.orEmpty()
    val answers = remember(messages) { answersOf(messages) }
    val sends by viewModel.questionSends.collectAsStateWithLifecycle()
    val paused = project?.status == "paused"
    val answering = remember(answers, sends, paused, detail.projectId) {
        QuestionAnswering(
            answers = answers,
            sends = sends,
            disabledReason = if (paused) "Paused. Resume the project to talk to the coordinator." else null,
            onAnswer = { messageId, label -> viewModel.answerQuestion(detail.projectId, messageId, label) },
            onOther = {
                composer.requestFocus()
                keyboard?.show()
            },
        )
    }
    Column(Modifier.fillMaxSize()) {
        TopAppBar(
            navigationIcon = {
                if (showBack) IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Back") }
            },
            title = {
                Column {
                    Text("Coordinator", style = MaterialTheme.typography.titleMedium)
                    Text(project?.name.orEmpty(), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1, overflow = TextOverflow.Ellipsis)
                }
            },
            windowInsets = WindowInsets(0),
        )
        CompositionLocalProvider(LocalQuestionAnswering provides answering) {
            Conversation(host, detail, onOpenThread = { onOpen(Detail(detail.projectId, it)) }, modifier = Modifier.weight(1f))
        }
        Composer(
            initial = viewModel.draft(detail.chatKey),
            placeholder = "Message the coordinator",
            onDraft = { viewModel.setDraft(detail.chatKey, it) },
            onSend = { viewModel.send(detail.chatKey, it) },
            focusRequester = composer,
        )
    }
}

/** Messages newest at the bottom, with the turns being written after them; `footer` sits below all. */
@Composable
fun Conversation(
    host: HostState,
    detail: Detail,
    onOpenThread: (String) -> Unit,
    modifier: Modifier = Modifier,
    header: (@Composable () -> Unit)? = null,
    footer: (@Composable () -> Unit)? = null,
) {
    val chat = host.chats[detail.chatKey]
    if (chat == null || !chat.loaded) {
        Box(modifier.fillMaxWidth(), contentAlignment = Alignment.Center) {
            Text("Loading…", color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        return
    }
    val messages = chat.messages.asReversed()
    val live = chat.live.asReversed()
    val list = rememberLazyListState()
    // The list keeps its place by item key, so a message added below what is shown would stay out
    // of sight: when the person is reading the newest messages, follow the new one in.
    val newest = live.firstOrNull()?.let { "live-${it.messageId}" } ?: messages.firstOrNull()?.id
    LaunchedEffect(newest) {
        if (list.firstVisibleItemIndex <= 2) list.animateScrollToItem(0)
    }
    LazyColumn(
        modifier.fillMaxWidth(),
        state = list,
        reverseLayout = true,
        contentPadding = PaddingValues(horizontal = 16.dp, vertical = 12.dp),
        verticalArrangement = Arrangement.spacedBy(14.dp, Alignment.Bottom),
    ) {
        footer?.let { item(key = "footer") { it() } }
        items(live, key = { "live-${it.messageId}" }) { LiveTurnView(it, host, onOpenThread) }
        items(messages, key = { it.id }) { MessageView(it, host, onOpenThread) }
        if (chat.hasMore) {
            item(key = "older") {
                Text(
                    "Older messages are in AOP on your computer.",
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.fillMaxWidth().padding(vertical = 8.dp),
                )
            }
        }
        header?.let { item(key = "header") { it() } }
    }
}
