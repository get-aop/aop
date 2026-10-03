package com.getaop.mobile.notify

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import com.getaop.mobile.aop
import kotlinx.coroutines.launch

/** Reconnects after the phone restarts or the app is updated, which Android allows from here. */
class BootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != Intent.ACTION_BOOT_COMPLETED && intent.action != Intent.ACTION_MY_PACKAGE_REPLACED) return
        val pending = goAsync()
        val app = context.aop
        app.scope.launch {
            try {
                app.sessions.restore()
                ConnectionService.sync(context)
            } finally {
                pending.finish()
            }
        }
    }
}
