package com.getaop.mobile.ui.common

import android.content.Context
import android.content.Intent
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import com.getaop.mobile.core.session.Connection
import com.getaop.mobile.ui.theme.AopColors

private const val TAILSCALE_PACKAGE = "com.tailscale.ipn"

/**
 * Says plainly when the phone can't hear the host, and what to do. A host reached over
 * Tailscale is unreachable most often because Tailscale is off on the phone, so that comes first.
 */
@Composable
fun ConnectionBanner(
    connection: Connection,
    hostName: String,
    onRetry: () -> Unit,
    onPairAgain: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val context = LocalContext.current
    val content: Triple<String, String, @Composable () -> Unit>? = when (connection) {
        is Connection.Unreachable -> Triple(
            "Can't reach $hostName. Is Tailscale on?",
            "Turn on Tailscale on this phone, and check that $hostName is awake and AOP is running there. The app keeps trying.",
        ) {
            Row(horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                tailscaleLaunch(context)?.let { launch ->
                    TextButton(onClick = { context.startActivity(launch) }) { Text("Open Tailscale") }
                }
                TextButton(onClick = onRetry) { Text("Try again") }
            }
        }
        Connection.Unauthorized -> Triple(
            "This phone was removed from $hostName",
            "Pair it again with a new code from AOP settings › Devices on the host.",
        ) { TextButton(onClick = onPairAgain) { Text("Pair again") } }
        is Connection.Incompatible -> Triple(connection.message, "The app and the host need matching versions.") {}
        Connection.Live, Connection.Connecting -> null
    }
    content ?: return
    val (title, body, actions) = content
    Column(
        modifier
            .fillMaxWidth()
            .background(AopColors.Waiting.copy(alpha = 0.12f))
            .padding(start = 16.dp, end = 8.dp, top = 10.dp, bottom = 2.dp)
            .semantics { liveRegion = LiveRegionMode.Polite },
    ) {
        Text(title, style = MaterialTheme.typography.titleSmall, color = AopColors.Waiting)
        Text(body, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        actions()
    }
}

private fun tailscaleLaunch(context: Context): Intent? =
    context.packageManager.getLaunchIntentForPackage(TAILSCALE_PACKAGE)
