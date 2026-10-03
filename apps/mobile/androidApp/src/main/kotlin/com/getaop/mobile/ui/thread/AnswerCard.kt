package com.getaop.mobile.ui.thread

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import com.getaop.mobile.core.wire.BlockedQuestion
import com.getaop.mobile.ui.theme.AopColors
import com.getaop.mobile.ui.theme.CardShape
import com.getaop.mobile.ui.theme.ControlShape
import kotlinx.coroutines.launch

/**
 * The question a thread is waiting on you with. Each option is a button, the recommended one
 * filled; "Your own answer" takes anything else. The answer is sent as the thread's reply, as
 * the dashboard's answer card does.
 */
@Composable
fun AnswerCard(question: BlockedQuestion, onAnswer: suspend (String) -> String?) {
    var own by rememberSaveable { mutableStateOf("") }
    var sending by rememberSaveable { mutableStateOf(false) }
    var error by rememberSaveable { mutableStateOf<String?>(null) }
    val scope = rememberCoroutineScope()
    val answer: (String) -> Unit = { text ->
        if (!sending && text.isNotBlank()) {
            sending = true
            error = null
            scope.launch {
                error = onAnswer(text.trim())
                sending = false
                if (error == null) own = ""
            }
        }
    }
    Column(
        Modifier
            .fillMaxWidth()
            .background(AopColors.Waiting.copy(alpha = 0.08f), CardShape)
            .border(1.dp, AopColors.Waiting.copy(alpha = 0.45f), CardShape)
            .padding(14.dp)
            .semantics { liveRegion = LiveRegionMode.Polite },
        verticalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        Text("Needs your answer", style = MaterialTheme.typography.labelMedium, color = AopColors.Waiting)
        Text(question.question, style = MaterialTheme.typography.bodyLarge)
        question.options.forEach { option ->
            val label = if (option.recommended) "${option.label} (recommended)" else option.label
            if (option.recommended) {
                Button(onClick = { answer(option.label) }, enabled = !sending, shape = ControlShape, modifier = Modifier.fillMaxWidth()) { Text(label) }
            } else {
                OutlinedButton(onClick = { answer(option.label) }, enabled = !sending, shape = ControlShape, modifier = Modifier.fillMaxWidth()) { Text(label) }
            }
        }
        OutlinedTextField(
            value = own,
            onValueChange = { own = it },
            label = { Text(if (question.options.isEmpty()) "Your answer" else "Your own answer") },
            enabled = !sending,
            shape = ControlShape,
            maxLines = 5,
            modifier = Modifier.fillMaxWidth(),
        )
        OutlinedButton(onClick = { answer(own) }, enabled = !sending && own.isNotBlank(), shape = ControlShape, modifier = Modifier.fillMaxWidth()) {
            Text(if (sending) "Sending…" else "Send answer")
        }
        error?.let { Text(it, color = AopColors.Blocked, style = MaterialTheme.typography.bodySmall) }
    }
}
