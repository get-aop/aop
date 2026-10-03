package com.getaop.mobile.ui.connect

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.OffsetMapping
import androidx.compose.ui.text.input.TransformedText
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.getaop.mobile.ui.theme.AopColors
import com.getaop.mobile.ui.theme.ControlShape

/** First run, and after this phone was removed: pair with a host. */
@Composable
fun ConnectScreen(viewModel: ConnectViewModel) {
    val form by viewModel.form.collectAsStateWithLifecycle()
    var scanning by rememberSaveable { mutableStateOf(false) }

    if (scanning) {
        QrScanner(
            onResult = { payload ->
                viewModel.usePayload(payload)
                scanning = false
            },
            onClose = { scanning = false },
        )
        return
    }

    Box(Modifier.fillMaxSize().safeDrawingPadding().imePadding(), contentAlignment = Alignment.TopCenter) {
        Column(
            Modifier
                .widthIn(max = 480.dp)
                .fillMaxWidth()
                .verticalScroll(rememberScrollState())
                .padding(horizontal = 24.dp, vertical = 32.dp),
            verticalArrangement = Arrangement.spacedBy(14.dp),
        ) {
            Text("Connect to your AOP host", style = MaterialTheme.typography.headlineSmall)
            Text(
                "In AOP on your computer, open AOP settings › Host › Pair a device and choose Generate pairing code, or run aop pair on the host. " +
                    "This phone reaches the host over Tailscale, so keep Tailscale on.",
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            OutlinedButton(
                onClick = { scanning = true },
                shape = ControlShape,
                modifier = Modifier.fillMaxWidth(),
            ) { Text("Scan the pairing QR code") }
            OutlinedTextField(
                value = form.address,
                onValueChange = viewModel::setAddress,
                label = { Text("Host address") },
                placeholder = { Text("https://your-host.your-tailnet.ts.net:25150") },
                singleLine = true,
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Uri, imeAction = ImeAction.Next, autoCorrectEnabled = false),
                shape = ControlShape,
                modifier = Modifier.fillMaxWidth(),
            )
            OutlinedTextField(
                value = form.code,
                onValueChange = viewModel::setCode,
                label = { Text("Pairing code") },
                placeholder = { Text("ABCD-EFGH") },
                visualTransformation = PairingCodeTransformation,
                singleLine = true,
                keyboardOptions = KeyboardOptions(
                    capitalization = KeyboardCapitalization.Characters,
                    keyboardType = KeyboardType.Ascii,
                    imeAction = ImeAction.Next,
                    autoCorrectEnabled = false,
                ),
                shape = ControlShape,
                modifier = Modifier.fillMaxWidth(),
            )
            OutlinedTextField(
                value = form.deviceName,
                onValueChange = viewModel::setDeviceName,
                label = { Text("Name for this phone") },
                supportingText = { Text("Shown in the host's device list.") },
                singleLine = true,
                keyboardOptions = KeyboardOptions(imeAction = ImeAction.Done),
                keyboardActions = KeyboardActions(onDone = { viewModel.submit() }),
                shape = ControlShape,
                modifier = Modifier.fillMaxWidth(),
            )
            form.error?.let {
                Text(
                    it,
                    color = AopColors.Blocked,
                    style = MaterialTheme.typography.bodyMedium,
                    modifier = Modifier.semantics { contentDescription = "Error: $it" },
                )
            }
            Button(
                onClick = viewModel::submit,
                enabled = form.canSubmit,
                shape = ControlShape,
                modifier = Modifier.fillMaxWidth().height(48.dp),
            ) {
                if (form.busy) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 2.dp)
                        Spacer(Modifier.size(10.dp))
                        Text("Connecting…")
                    }
                } else {
                    Text("Connect")
                }
            }
        }
    }
}

/**
 * Shows a typed code in capitals, and as the host prints it (`ABCD-EFGH`) when it was typed
 * without the dash. Only the display changes; what was typed is kept.
 */
object PairingCodeTransformation : VisualTransformation {
    override fun filter(text: AnnotatedString): TransformedText {
        val raw = text.text.uppercase()
        if (raw.length <= 4 || !raw.all(Char::isLetterOrDigit)) {
            return TransformedText(AnnotatedString(raw), OffsetMapping.Identity)
        }
        val mapping = object : OffsetMapping {
            override fun originalToTransformed(offset: Int): Int = if (offset <= 4) offset else offset + 1

            override fun transformedToOriginal(offset: Int): Int = (if (offset <= 4) offset else offset - 1).coerceAtMost(raw.length)
        }
        return TransformedText(AnnotatedString("${raw.take(4)}-${raw.drop(4)}"), mapping)
    }
}
