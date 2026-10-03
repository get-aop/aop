package com.getaop.mobile.notify

import android.Manifest
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import com.getaop.mobile.R
import com.getaop.mobile.core.notify.NotificationIntent
import com.getaop.mobile.core.notify.NotificationKind
import com.getaop.mobile.ui.MainActivity

/** Posts and takes back the app's notifications. One per conversation: a newer one replaces it. */
class Notifier(private val context: Context) {
    private val manager = NotificationManagerCompat.from(context)
    private val system = context.getSystemService(NotificationManager::class.java)

    fun createChannels() {
        CHANNELS.forEach { (id, spec) ->
            system.createNotificationChannel(NotificationChannel(id, spec.first, spec.second))
        }
    }

    fun canNotify(): Boolean =
        Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU ||
            ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED

    fun post(intent: NotificationIntent) {
        if (!canNotify()) return
        val key = key(intent.projectId, intent.threadId)
        val notification = NotificationCompat.Builder(context, channelOf(intent.kind))
            .setSmallIcon(R.drawable.ic_stat_aop)
            .setContentTitle(intent.title)
            .setContentText(intent.body)
            .setStyle(NotificationCompat.BigTextStyle().bigText(intent.body))
            .setCategory(if (intent.kind == NotificationKind.NEEDS_YOU) Notification.CATEGORY_MESSAGE else Notification.CATEGORY_STATUS)
            .setContentIntent(openIntent(intent.projectId, intent.threadId))
            .setAutoCancel(true)
            .setGroup(intent.projectId)
            .build()
        try {
            manager.notify(key, ID, notification)
        } catch (_: SecurityException) {
            // The permission was withdrawn between the check and the post.
        }
    }

    /**
     * Takes back a conversation's notification: the person dealt with it here or on another
     * device. Asks Android what is showing, so one posted before the app restarted goes too.
     */
    fun cancel(projectId: String, threadId: String?) {
        val key = key(projectId, threadId)
        if (system.activeNotifications.any { it.tag == key && it.id == ID }) manager.cancel(key, ID)
    }

    fun connectionNotification(text: String): Notification =
        NotificationCompat.Builder(context, CONNECTION_CHANNEL)
            .setSmallIcon(R.drawable.ic_stat_aop)
            .setContentTitle(text)
            .setContentText("Tap to open AOP. Turn this off in AOP's settings.")
            .setContentIntent(openIntent(null, null))
            .setOngoing(true)
            .setSilent(true)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .setForegroundServiceBehavior(NotificationCompat.FOREGROUND_SERVICE_IMMEDIATE)
            .build()

    private fun openIntent(projectId: String?, threadId: String?): PendingIntent {
        val open = Intent(context, MainActivity::class.java)
            .addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP)
            .putExtra(MainActivity.EXTRA_PROJECT, projectId)
            .putExtra(MainActivity.EXTRA_THREAD, threadId)
        return PendingIntent.getActivity(
            context,
            key(projectId ?: "", threadId).hashCode(),
            open,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
    }

    private fun key(projectId: String, threadId: String?) = "$projectId/${threadId ?: "chat"}"

    private fun channelOf(kind: NotificationKind): String = when (kind) {
        NotificationKind.NEEDS_YOU -> "needs-you"
        NotificationKind.FAILED -> "failed"
        NotificationKind.PULL_REQUEST -> "pull-requests"
        NotificationKind.COORDINATOR -> "coordinator"
        NotificationKind.TURN_FINISHED -> "turns"
    }

    companion object {
        const val CONNECTION_CHANNEL = "connection"
        const val CONNECTION_ID = 1
        private const val ID = 2

        private val CHANNELS = linkedMapOf(
            "needs-you" to ("Needs you" to NotificationManager.IMPORTANCE_HIGH),
            "failed" to ("Failed runs" to NotificationManager.IMPORTANCE_HIGH),
            "pull-requests" to ("Pull requests" to NotificationManager.IMPORTANCE_DEFAULT),
            "coordinator" to ("Coordinator replies" to NotificationManager.IMPORTANCE_DEFAULT),
            "turns" to ("Finished turns" to NotificationManager.IMPORTANCE_LOW),
            CONNECTION_CHANNEL to ("Connection to the host" to NotificationManager.IMPORTANCE_LOW),
        )
    }
}
