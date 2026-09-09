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
 * Foreground service that runs WHILE A CALL IS LIVE.
 *
 * Why this exists (production incident 2026-09-09): the employee answers
 * a call, the proximity sensor blanks the screen (or the user switches
 * away), Android caches/freezes the process — the /ws-call WebSocket's
 * heartbeat AND its protocol-level auto-pong stop. The server's idle
 * timeout then closed the signaling socket exactly 90s into the call,
 * the customer's side was torn down, and the (still-frozen) agent app
 * woke up to a ZOMBIE call UI that never ended.
 *
 * A microphone-type foreground service fixes all three at once:
 *  - the process is exempt from cached-app freezing / Doze throttling,
 *    so the WS heartbeat (20s) and auto-pong keep flowing;
 *  - microphone access is guaranteed while backgrounded (Android 9+
 *    silently mutes backgrounded apps without one);
 *  - the user sees an ongoing "call in progress" notification, matching
 *    every other phone app on the platform.
 *
 * Like DutyModeService this is intentionally DUMB: no sockets, no call
 * logic — just the notification + a partial wake lock. The Dart call
 * controller starts it when a call connects and stops it when it ends.
 *
 * - foregroundServiceType=microphone: requires FOREGROUND_SERVICE_MICROPHONE
 *   (declared in the manifest) on Android 14+; the type exists since
 *   API 30, so it is applied conditionally.
 * - Started from the FOREGROUND only (call accept/offer happens with
 *   the activity visible) — legal under Android 12+ FGS-from-background
 *   restrictions.
 */
class CallKeepAliveService : Service() {

    private var wakeLock: PowerManager.WakeLock? = null

    override fun onCreate() {
        super.onCreate()
        createChannel()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent?.action == ACTION_STOP) {
            stopSelf()
            return START_NOT_STICKY
        }
        startForegroundWithType()
        acquireWakeLock()
        // NOT sticky: if the system kills us mid-call the call is dead
        // anyway (the WS dropped) — restarting a notification for a
        // finished call would be wrong.
        return START_NOT_STICKY
    }

    override fun onDestroy() {
        releaseWakeLock()
        super.onDestroy()
    }

    override fun onBind(intent: Intent?): IBinder? = null

    // ── internals ──────────────────────────────────────────────────

    private fun createChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val channel = NotificationChannel(
            CHANNEL_ID,
            "Cuộc gọi",
            NotificationManager.IMPORTANCE_LOW,
        ).apply {
            description = "Thông báo cuộc gọi đang diễn ra"
            setShowBadge(false)
        }
        getSystemService(NotificationManager::class.java).createNotificationChannel(channel)
    }

    private fun startForegroundWithType() {
        val notification = buildNotification()
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            startForeground(NOTIFICATION_ID, notification,
                android.content.pm.ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE)
        } else {
            startForeground(NOTIFICATION_ID, notification)
        }
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
            .setContentTitle("Cuộc gọi đang diễn ra")
            .setContentText("đặt xe vui — hỗ trợ khách hàng")
            .setSmallIcon(android.R.drawable.stat_sys_phone_call_forward)
            .setContentIntent(pending)
            .setOngoing(true)
            .setForegroundServiceBehavior(Notification.FOREGROUND_SERVICE_IMMEDIATE)
            .build()
    }

    private fun acquireWakeLock() {
        if (wakeLock != null) return
        val pm = getSystemService(Context.POWER_SERVICE) as PowerManager
        wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "datxevui:call").apply {
            setReferenceCounted(false)
            // Hard cap: 2h — far beyond any support call; a leaked
            // service can never hold the CPU forever.
            acquire(2 * 60 * 60 * 1000L)
        }
    }

    private fun releaseWakeLock() {
        wakeLock?.let { if (it.isHeld) it.release() }
        wakeLock = null
    }

    companion object {
        const val CHANNEL_ID = "vexevn_call"
        const val NOTIFICATION_ID = 43
        const val ACTION_STOP = "datxevui.call.STOP"

        fun start(context: Context) {
            val intent = Intent(context, CallKeepAliveService::class.java)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                context.startForegroundService(intent)
            } else {
                @Suppress("DEPRECATION")
                context.startService(intent)
            }
        }

        fun stop(context: Context) {
            context.stopService(Intent(context, CallKeepAliveService::class.java))
        }
    }
}
