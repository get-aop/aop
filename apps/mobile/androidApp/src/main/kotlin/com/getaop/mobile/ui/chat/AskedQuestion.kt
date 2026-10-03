package com.getaop.mobile.ui.chat

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.Edit
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.LocalContentColor
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.compositionLocalOf
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.getaop.mobile.core.chat.QuestionAnswer
import com.getaop.mobile.core.wire.Block
import com.getaop.mobile.core.wire.BlockedOption
import com.getaop.mobile.ui.theme.AopColors
import com.getaop.mobile.ui.theme.ControlShape

/** A tap on an option being sent, or the reason it failed (the buttons are usable again then). */
data class QuestionSend(val label: String, val error: String? = null)

/**
 * What a question under a coordinator reply needs from its chat: which questions are answered
 * (see `answersOf`), which answer is on its way, and how to answer. Absent outside the coordinator
 * chat, where a question is only shown.
 */
class QuestionAnswering(
    /** Id of a reply with a question -> its answer; absent while the question is open. */
    val answers: Map<String, QuestionAnswer>,
    val sends: Map<String, QuestionSend>,
    /** Why the person cannot answer now (a paused project); null when they can. */
    val disabledReason: String?,
    val onAnswer: (messageId: String, label: String) -> Unit,
    /** "Other…": puts the cursor in the message box for an answer of their own. */
    val onOther: () -> Unit,
)

val LocalQuestionAnswering = compositionLocalOf<QuestionAnswering?> { null }

private enum class QuestionState { OPEN, SENDING, ANSWERED, SHOWN }

/**
 * A question the coordinator asked with ask_person, as the dashboard's AskedQuestion draws it:
 * each option a button that sends its label as the person's reply, the recommended one filled,
 * and "Other…" for an answer of their own. Once the person says anything after it, by a tap or by
 * typing, the buttons are off and the chosen one keeps a check. Buttons wrap, so the cover
 * screen fits them as well as the inner one. `messageId` is null while the reply is being written.
 */
@Composable
fun AskedQuestion(messageId: String?, block: Block) {
    val answering = LocalQuestionAnswering.current?.takeIf { messageId != null }
    val answer = messageId?.let { answering?.answers?.get(it) }
    val send = messageId?.let { answering?.sends?.get(it) }
    val state = when {
        answering == null -> QuestionState.SHOWN
        answer != null -> QuestionState.ANSWERED
        send != null && send.error == null -> QuestionState.SENDING
        else -> QuestionState.OPEN
    }
    val blockedBy = answering?.disabledReason
    val usable = state == QuestionState.OPEN && blockedBy == null
    Column(
        Modifier.fillMaxWidth().testTag("asked-question").semantics { stateDescription = state.name.lowercase() },
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Text(block.question.orEmpty(), style = MaterialTheme.typography.bodyLarge, fontWeight = FontWeight.Medium)
        FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
            block.options.forEach { option ->
                OptionButton(
                    option = option,
                    answered = state == QuestionState.ANSWERED,
                    chosen = answer?.choice == option.label,
                    sending = state == QuestionState.SENDING && send?.label == option.label,
                    enabled = usable,
                    onClick = { messageId?.let { answering?.onAnswer?.invoke(it, option.label) } },
                )
            }
            if (block.other) {
                TextButton(onClick = { answering?.onOther?.invoke() }, enabled = usable, shape = ControlShape, modifier = Modifier.testTag("asked-question-other")) {
                    Icon(Icons.Filled.Edit, contentDescription = null, modifier = Modifier.size(16.dp))
                    Text("Other…", modifier = Modifier.padding(start = 6.dp))
                }
            }
        }
        val note = when {
            answer != null && answer.choice == null -> "You answered in your own words."
            state == QuestionState.OPEN && blockedBy != null -> blockedBy
            else -> null
        }
        note?.let { Text(it, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant) }
        send?.error?.let { Text(it, style = MaterialTheme.typography.bodySmall, color = AopColors.Blocked) }
    }
}

// The recommended option is the filled button while the question is open; once it is answered,
// the one the person chose is the one that stands out.
@Composable
private fun OptionButton(option: BlockedOption, answered: Boolean, chosen: Boolean, sending: Boolean, enabled: Boolean, onClick: () -> Unit) {
    val modifier = Modifier.testTag("asked-question-option").semantics {
        if (answered) selected = chosen
        if (option.recommended) stateDescription = "Recommended"
    }
    val content: @Composable () -> Unit = {
        when {
            sending -> CircularProgressIndicator(Modifier.size(16.dp), strokeWidth = 2.dp)
            chosen -> Icon(Icons.Filled.Check, contentDescription = null, tint = AopColors.Running, modifier = Modifier.size(16.dp))
        }
        Column(Modifier.padding(start = if (sending || chosen) 8.dp else 0.dp)) {
            Text(option.label)
            if (option.recommended) Text("Recommended", style = MaterialTheme.typography.labelSmall, color = LocalContentColor.current.copy(alpha = 0.7f))
        }
    }
    if (option.recommended && !answered) {
        Button(onClick = onClick, enabled = enabled, shape = ControlShape, modifier = modifier) { content() }
    } else {
        OutlinedButton(
            onClick = onClick,
            enabled = enabled,
            shape = ControlShape,
            border = BorderStroke(1.dp, if (chosen) AopColors.Running else AopColors.BorderStrong),
            colors = ButtonDefaults.outlinedButtonColors(disabledContentColor = if (chosen) AopColors.Text else AopColors.TextSubtle),
            modifier = modifier,
        ) { content() }
    }
}
