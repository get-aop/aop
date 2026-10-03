package com.getaop.mobile.ui

import android.Manifest
import android.content.Intent
import android.os.Build
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.SystemBarStyle
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContracts
import androidx.activity.viewModels
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.getaop.mobile.aop
import com.getaop.mobile.core.host.PairingPayload
import com.getaop.mobile.data.PairState
import com.getaop.mobile.ui.connect.ConnectScreen
import com.getaop.mobile.ui.connect.ConnectViewModel
import com.getaop.mobile.ui.main.Detail
import com.getaop.mobile.ui.main.MainScreen
import com.getaop.mobile.ui.main.MainViewModel
import com.getaop.mobile.ui.theme.AopTheme

class MainActivity : ComponentActivity() {
    private val main: MainViewModel by viewModels()
    private val connect: ConnectViewModel by viewModels()
    private val askNotifications = registerForActivityResult(ActivityResultContracts.RequestPermission()) {}

    override fun onCreate(savedInstanceState: Bundle?) {
        // The app is dark only, so the system bars keep light icons whatever the phone's theme.
        enableEdgeToEdge(
            statusBarStyle = SystemBarStyle.dark(android.graphics.Color.TRANSPARENT),
            navigationBarStyle = SystemBarStyle.dark(android.graphics.Color.TRANSPARENT),
        )
        super.onCreate(savedInstanceState)
        if (savedInstanceState == null) handle(intent)
        setContent {
            AopTheme {
                Surface(Modifier.fillMaxSize(), color = MaterialTheme.colorScheme.background) {
                    AopApp(main, connect, onPaired = ::askForNotifications)
                }
            }
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        handle(intent)
    }

    /** A notification opens its conversation; an `aop://pair` link fills the pairing form. */
    private fun handle(intent: Intent?) {
        intent ?: return
        intent.data?.toString()?.let(PairingPayload::parse)?.let(connect::usePayload)
        val projectId = intent.getStringExtra(EXTRA_PROJECT) ?: return
        main.open(Detail(projectId, intent.getStringExtra(EXTRA_THREAD)))
    }

    /** Asked right after pairing, when the person knows what the notifications are for. */
    private fun askForNotifications() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU && !aop.notifier.canNotify()) {
            askNotifications.launch(Manifest.permission.POST_NOTIFICATIONS)
        }
    }

    companion object {
        const val EXTRA_PROJECT = "projectId"
        const val EXTRA_THREAD = "threadId"
    }
}

@Composable
private fun AopApp(main: MainViewModel, connect: ConnectViewModel, onPaired: () -> Unit) {
    val context = androidx.compose.ui.platform.LocalContext.current
    val pairState by context.aop.sessions.state.collectAsStateWithLifecycle()
    when (pairState) {
        PairState.Loading -> Box(Modifier.fillMaxSize())
        PairState.Unpaired -> ConnectScreen(connect)
        is PairState.Paired -> {
            LaunchedEffect(Unit) { onPaired() }
            MainScreen(main)
        }
    }
}
