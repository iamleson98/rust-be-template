package com.datxevui.support_agent

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.IBinder
import android.os.PowerManager

/**
 * Foreground service that keeps the app PROCESS alive while the agent
 * is "on duty" — the WebSocket (chat + /ws-call signaling) keeps
 * running with its auto-reconnect, so incoming calls ring through the
 * existing local-notification flow (ringtone + vibration + full
 * screen intent) even after the user swipes the app away.
 *
 * The service itself is intentionally DUMB: no sockets, no logic —
 * only the foreground notification + a partial wake lock. All
 * signalling stays in the Flutter isolate that outlives the activity.
 *
 * - START_STICKY: if the system reclaims the process anyway, the
 *   service restarts (the Flutter engine restarts with it and the
 *   Dart side re-runs boot logic, including WS reconnect).
 * - stopWithTask=false: swiping the app from recents does NOT stop
 *   the service — the whole point.
 * - foregroundServiceType=dataSync: a persistent connection is
 *   exactly the dataSync category (Android 14+ typing requirement).
 */
class DutyModeService : Service() {

    private var wakeLock: PowerManager.WakeLock? = null

    override fun onCreate() {
        super.onCreate()
        createChannel()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        startForeground(NOTIFICATION_ID, buildNotification())
        acquireWakeLock()
        return START_STICKY
    }

    override fun onDestroy() {
        releaseWakeLock()
        super.onDestroy()
    }

    override fun onBind(intent: Intent?): IBinder? = null

    // ── internals ──────────────────────────────────────────────────

    private fun createChannel() {
        val channel = NotificationChannel(
            CHANNEL_ID,
            "Chế độ trực",
            NotificationManager.IMPORTANCE_LOW,
        ).apply {
            description = "Giữ kết nối để nhận cuộc gọi và tin nhắn khi app đóng"
            setShowBadge(false)
        }
        getSystemService(NotificationManager::class.java).createNotificationChannel(channel)
    }

    private fun buildNotification(): Notification {
        val launch = Intent(this, MainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_SINGLE_TOP
        }
        val pending = PendingIntent.getActivity(
            this, 0, launch,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
        val builder = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            Notification.Builder(this, CHANNEL_ID)
        } else {
            @Suppress("DEPRECATION")
            Notification.Builder(this)
        }
        return builder
            .setContentTitle("Đang trực — đặt xe vui")
            .setContentText("Nhận cuộc gọi và tin nhắn khách hàng")
            .setSmallIcon(android.R.drawable.stat_sys_phone_call)
            .setContentIntent(pending)
            .setOngoing(true)
            .setForegroundServiceBehavior(Notification.FOREGROUND_SERVICE_IMMEDIATE)
            .build()
    }

    private fun acquireWakeLock() {
        if (wakeLock != null) return
        val pm = getSystemService(Context.POWER_SERVICE) as PowerManager
        wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "datxevui:duty").apply {
            setReferenceCounted(false)
            // 12h cap; the Dart heartbeat re-acquires via service restart
            // if the process is ever reclaimed anyway (START_STICKY).
            acquire(12 * 60 * 60 * 1000L)
        }
    }

    private fun releaseWakeLock() {
        wakeLock?.let { if (it.isHeld) it.release() }
        wakeLock = null
    }

    companion object {
        const val CHANNEL_ID = "vexevn_duty"
        const val NOTIFICATION_ID = 42

        fun start(context: Context) {
            val intent = Intent(context, DutyModeService::class.java)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                context.startForegroundService(intent)
            } else {
                @Suppress("DEPRECATION")
                context.startService(intent)
            }
        }

        fun stop(context: Context) {
            context.stopService(Intent(context, DutyModeService::class.java))
        }
    }
}
