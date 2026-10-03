package com.getaop.mobile.notify

import com.getaop.mobile.AopApplication
import com.getaop.mobile.core.notify.NotificationPolicy
import com.getaop.mobile.core.session.HostChange
import com.getaop.mobile.data.PairState
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.emptyFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.launch

/**
 * Turns what changes on the host into phone notifications, and takes one back once its thread
 * is dealt with anywhere: answered here, or read on the Mac (the host's `unread` clears), so the
 * phone never keeps nagging about something the desktop app already showed and the person saw.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class NotificationRelay(private val app: AopApplication, private val policy: NotificationPolicy = NotificationPolicy()) {
    fun start() {
        app.scope.launch {
            app.sessions.state
                .flatMapLatest { (it as? PairState.Paired)?.session?.changes ?: emptyFlow() }
                .collect(::onChange)
        }
    }

    private suspend fun onChange(change: HostChange) {
        if (change is HostChange.ThreadChanged && policy.isSettled(change.thread)) {
            app.notifier.cancel(change.project.id, change.thread.id)
        }
        if (app.foreground.value) return
        val prefs = app.store.settings.first().notifications
        policy.decide(change, prefs, System.currentTimeMillis())?.let(app.notifier::post)
    }
}
