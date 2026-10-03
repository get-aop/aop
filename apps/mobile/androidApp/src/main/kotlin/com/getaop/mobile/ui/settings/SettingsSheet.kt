package com.getaop.mobile.ui.settings

import android.Manifest
import android.annotation.SuppressLint
import android.content.Intent
import android.os.Build
import android.os.PowerManager
import android.provider.Settings
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.unit.dp
import androidx.core.net.toUri
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.getaop.mobile.aop
import com.getaop.mobile.ui.main.MainViewModel
import com.getaop.mobile.ui.theme.AopColors
import com.getaop.mobile.ui.theme.ControlShape

/** This phone's settings: what notifies it, staying connected, and the host it is paired with. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SettingsSheet(viewModel: MainViewModel, hostName: String, onDismiss: () -> Unit) {
    val settings by viewModel.settings.collectAsStateWithLifecycle()
    val context = LocalContext.current
    var canNotify by remember { mutableStateOf(context.aop.notifier.canNotify()) }
    var confirmDisconnect by rememberSaveable { mutableStateOf(false) }
    val askNotifications = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { canNotify = it }

    ModalBottomSheet(onDismissRequest = onDismiss) {
        Column(
            Modifier.fillMaxWidth().verticalScroll(rememberScrollState()).padding(horizontal = 20.dp).navigationBarsPadding(),
            verticalArrangement = Arrangement.spacedBy(6.dp),
        ) {
            Text("Settings", style = MaterialTheme.typography.titleLarge)
            Text("Paired with $hostName${viewModel.hostAddress?.let { " · $it" } ?: ""}", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)

            HorizontalDivider(Modifier.padding(vertical = 8.dp))
            Text("Notifications", style = MaterialTheme.typography.titleMedium)
            if (!canNotify && Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                Text("Notifications are off for AOP on this phone.", color = AopColors.Waiting, style = MaterialTheme.typography.bodySmall)
                OutlinedButton(onClick = { askNotifications.launch(Manifest.permission.POST_NOTIFICATIONS) }, shape = ControlShape) {
                    Text("Allow notifications")
                }
            }
            Toggle("A thread needs you", "A question to answer, or something to do outside AOP.", settings.notifications.needsYou) { on ->
                viewModel.updateSettings { it.copy(notifications = it.notifications.copy(needsYou = on)) }
            }
            Toggle("A run failed", null, settings.notifications.failed) { on ->
                viewModel.updateSettings { it.copy(notifications = it.notifications.copy(failed = on)) }
            }
            Toggle("Pull requests", "Ready for review, merged or closed.", settings.notifications.pullRequests) { on ->
                viewModel.updateSettings { it.copy(notifications = it.notifications.copy(pullRequests = on)) }
            }
            Toggle("Coordinator replies", null, settings.notifications.coordinator) { on ->
                viewModel.updateSettings { it.copy(notifications = it.notifications.copy(coordinator = on)) }
            }
            Text(
                "Each project's own notification level, set in AOP on your computer, still applies. A notification goes away once you open its thread here or on your computer.",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )

            HorizontalDivider(Modifier.padding(vertical = 8.dp))
            Toggle(
                "Stay connected",
                "Keeps a connection to $hostName while AOP is closed, so notifications arrive. Android shows it as a quiet notification. Uses some battery.",
                settings.stayConnected,
            ) { on -> viewModel.updateSettings { it.copy(stayConnected = on) } }
            BatteryRow()

            HorizontalDivider(Modifier.padding(vertical = 8.dp))
            OutlinedButton(onClick = { confirmDisconnect = true }, shape = ControlShape, modifier = Modifier.fillMaxWidth()) {
                Text("Disconnect this phone", color = AopColors.Blocked)
            }
            Text(
                "Removes this phone from $hostName. You'll need a new pairing code to connect again.",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.padding(bottom = 16.dp),
            )
        }
    }

    if (confirmDisconnect) {
        AlertDialog(
            onDismissRequest = { confirmDisconnect = false },
            title = { Text("Disconnect from $hostName?") },
            text = { Text("This phone stops getting notifications and is removed from the host's device list.") },
            confirmButton = {
                TextButton(onClick = {
                    confirmDisconnect = false
                    onDismiss()
                    viewModel.disconnect()
                }) { Text("Disconnect", color = AopColors.Blocked) }
            },
            dismissButton = { TextButton(onClick = { confirmDisconnect = false }) { Text("Cancel") } },
        )
    }
}

@Composable
private fun Toggle(title: String, detail: String?, checked: Boolean, onChange: (Boolean) -> Unit) {
    Row(
        Modifier.fillMaxWidth().clickable(role = Role.Switch) { onChange(!checked) }.padding(vertical = 6.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Column(Modifier.weight(1f)) {
            Text(title, style = MaterialTheme.typography.bodyLarge)
            detail?.let { Text(it, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant) }
        }
        Switch(checked = checked, onCheckedChange = null)
    }
}

/**
 * Samsung puts apps it thinks are unused to sleep, which stops their notifications. Being left
 * out of battery optimisation keeps the connection alive; outside the Play Store, asking is allowed.
 */
@SuppressLint("BatteryLife")
@Composable
private fun BatteryRow() {
    val context = LocalContext.current
    val power = context.getSystemService(PowerManager::class.java)
    var exempt by remember { mutableStateOf(power.isIgnoringBatteryOptimizations(context.packageName)) }
    val ask = rememberLauncherForActivityResult(ActivityResultContracts.StartActivityForResult()) {
        exempt = power.isIgnoringBatteryOptimizations(context.packageName)
    }
    if (exempt) return
    Text(
        "Android may pause AOP in the background to save battery, and notifications would stop.",
        style = MaterialTheme.typography.bodySmall,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
    )
    OutlinedButton(
        onClick = {
            ask.launch(Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, "package:${context.packageName}".toUri()))
        },
        shape = ControlShape,
    ) { Text("Let AOP run in the background") }
}
