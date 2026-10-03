package com.getaop.mobile.ui.chat

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBars
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.Send
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp
import com.getaop.mobile.ui.theme.AopColors
import com.getaop.mobile.ui.theme.ComposerShape
import kotlinx.coroutines.launch

/**
 * The message box under a conversation. The text is the view model's draft, so it survives a
 * fold or unfold; on a failed send it stays, with the reason, so nothing typed is lost.
 */
@Composable
fun Composer(
    initial: String,
    placeholder: String,
    onDraft: (String) -> Unit,
    onSend: suspend (String) -> String?,
    enabled: Boolean = true,
    /** Lets the conversation put the cursor here, as a question's "Other…" does. */
    focusRequester: FocusRequester? = null,
) {
    var text by remember(initial) { mutableStateOf(initial) }
    var sending by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    val scope = rememberCoroutineScope()
    val send = {
        val message = text.trim()
        if (message.isNotEmpty() && !sending) {
            sending = true
            error = null
            scope.launch {
                val failure = onSend(message)
                sending = false
                if (failure == null) text = "" else error = failure
            }
        }
    }
    Column(Modifier.fillMaxWidth().windowInsetsPadding(WindowInsets.navigationBars).imePadding().padding(horizontal = 10.dp, vertical = 8.dp)) {
        error?.let { Text(it, color = AopColors.Blocked, style = MaterialTheme.typography.bodySmall, modifier = Modifier.padding(start = 12.dp, bottom = 4.dp)) }
        Row(verticalAlignment = Alignment.Bottom) {
            OutlinedTextField(
                value = text,
                onValueChange = {
                    text = it
                    onDraft(it)
                },
                enabled = enabled,
                placeholder = { Text(placeholder) },
                shape = ComposerShape,
                maxLines = 6,
                modifier = Modifier
                    .weight(1f)
                    .heightIn(min = 48.dp)
                    .then(focusRequester?.let { Modifier.focusRequester(it) } ?: Modifier)
                    .testTag("composer"),
            )
            IconButton(onClick = { send() }, enabled = enabled && text.isNotBlank() && !sending) {
                if (sending) CircularProgressIndicator(Modifier.padding(4.dp), strokeWidth = 2.dp) else Icon(Icons.AutoMirrored.Filled.Send, contentDescription = "Send")
            }
        }
    }
}
