package com.getaop.mobile

import android.app.Application
import androidx.lifecycle.DefaultLifecycleObserver
import androidx.lifecycle.LifecycleOwner
import androidx.lifecycle.ProcessLifecycleOwner
import com.getaop.mobile.data.AppStore
import com.getaop.mobile.data.PairState
import com.getaop.mobile.data.SessionHolder
import com.getaop.mobile.notify.ConnectionService
import com.getaop.mobile.notify.NotificationRelay
import com.getaop.mobile.notify.Notifier
import io.ktor.client.HttpClient
import io.ktor.client.engine.okhttp.OkHttp
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import java.util.concurrent.TimeUnit

/** The app's few long-lived objects, made once per process. */
class AopApplication : Application() {
    val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)

    val http: HttpClient by lazy {
        HttpClient(OkHttp) {
            engine {
                config {
                    connectTimeout(10, TimeUnit.SECONDS)
                    // The host sends a heartbeat every 5 s on a stream, so 30 s of silence is a dead link.
                    readTimeout(30, TimeUnit.SECONDS)
                    // Keeps the HTTP/2 connection to tailscale serve honest across network changes.
                    pingInterval(30, TimeUnit.SECONDS)
                    retryOnConnectionFailure(true)
                }
            }
            expectSuccess = false
        }
    }

    val store by lazy { AppStore(this) }
    val sessions by lazy { SessionHolder(store, http, scope) }
    val notifier by lazy { Notifier(this) }

    private val mutableForeground = MutableStateFlow(false)

    /** The app is on screen: notifications would only repeat what the person is looking at. */
    val foreground: StateFlow<Boolean> = mutableForeground.asStateFlow()

    override fun onCreate() {
        super.onCreate()
        notifier.createChannels()
        ProcessLifecycleOwner.get().lifecycle.addObserver(
            object : DefaultLifecycleObserver {
                override fun onStart(owner: LifecycleOwner) {
                    mutableForeground.value = true
                    sessions.session?.goLive()
                }

                override fun onStop(owner: LifecycleOwner) {
                    mutableForeground.value = false
                    scope.launch { pauseUnlessServiceKeepsIt() }
                }
            },
        )
        NotificationRelay(this).start()
        scope.launch {
            sessions.restore()
            if (foreground.value) sessions.session?.goLive()
            ConnectionService.sync(this@AopApplication)
        }
    }

    private suspend fun pauseUnlessServiceKeepsIt() {
        val settings = store.settings.first()
        if (!settings.stayConnected || sessions.state.value !is PairState.Paired) sessions.session?.pause()
    }
}

val android.content.Context.aop: AopApplication get() = applicationContext as AopApplication
