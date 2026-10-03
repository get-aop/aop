package com.getaop.mobile.notify

import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import androidx.core.app.ServiceCompat
import androidx.core.content.ContextCompat
import com.getaop.mobile.aop
import com.getaop.mobile.core.host.HostAddress
import com.getaop.mobile.core.session.Connection
import com.getaop.mobile.data.PairState
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.emptyFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.launch

/**
 * Keeps the phone connected to the host while the app is closed, so notifications arrive
 * without a push service: the host lives on the person's tailnet, where nothing from Google can
 * reach it. Android shows this as a quiet ongoing notification. Its type is `remoteMessaging`,
 * which has no daily time limit (unlike `dataSync`, which Android 15 stops after six hours).
 */
class ConnectionService : Service() {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    private var follower: kotlinx.coroutines.Job? = null

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val app = aop
        val paired = app.sessions.state.value as? PairState.Paired ?: return stop()
        val host = HostAddress.shortName(paired.pairing.baseUrl)
        val type = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
            ServiceInfo.FOREGROUND_SERVICE_TYPE_REMOTE_MESSAGING
        } else {
            0
        }
        ServiceCompat.startForeground(this, Notifier.CONNECTION_ID, app.notifier.connectionNotification("Connected to $host"), type)
        paired.session.goLive()
        follower?.cancel()
        follower = scope.launch { followConnection(host) }
        return START_STICKY
    }

    override fun onDestroy() {
        scope.cancel()
        if (!aop.foreground.value) aop.sessions.session?.pause()
        super.onDestroy()
    }

    @OptIn(ExperimentalCoroutinesApi::class)
    private suspend fun followConnection(host: String) {
        aop.sessions.state
            .flatMapLatest { (it as? PairState.Paired)?.session?.state?.map { s -> s.connection } ?: emptyFlow() }
            .map { connection -> describe(connection, host) }
            .distinctUntilChanged()
            .collect { text ->
                val manager = getSystemService(android.app.NotificationManager::class.java)
                manager.notify(Notifier.CONNECTION_ID, aop.notifier.connectionNotification(text))
            }
    }

    private fun describe(connection: Connection, host: String): String = when (connection) {
        Connection.Live, Connection.Connecting -> "Connected to $host"
        is Connection.Unreachable -> "Can't reach $host. Is Tailscale on?"
        Connection.Unauthorized -> "This phone was removed from $host"
        is Connection.Incompatible -> connection.message
    }

    private fun stop(): Int {
        stopSelf()
        return START_NOT_STICKY
    }

    companion object {
        /** Starts or stops the service to match the pairing and the person's setting. */
        suspend fun sync(context: Context) {
            val app = context.aop
            val wanted = app.store.settings.first().stayConnected && app.sessions.state.value is PairState.Paired
            val intent = Intent(context, ConnectionService::class.java)
            if (!wanted) {
                context.stopService(intent)
                return
            }
            try {
                ContextCompat.startForegroundService(context, intent)
            } catch (_: IllegalStateException) {
                // Android refuses to start it from the background; the app starts it when next opened.
            }
        }
    }
}
