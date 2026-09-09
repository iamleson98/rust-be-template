package com.datxevui.support_agent

import android.content.Context
import io.flutter.embedding.android.FlutterActivity
import io.flutter.embedding.engine.FlutterEngine
import io.flutter.plugin.common.MethodChannel

class MainActivity : FlutterActivity() {
    /// Channel: start/stop the duty-mode foreground service that keeps
    /// the process (and the chat + /ws-call WebSockets) alive while the
    /// agent is on duty — phones keep ringing after the app is swiped
    /// away. Dart side owns the persisted toggle + re-applies it at
    /// boot; this only bridges the native start/stop calls.
    private val dutyChannel = "datxevui/duty"

    override fun configureFlutterEngine(flutterEngine: FlutterEngine) {
        super.configureFlutterEngine(flutterEngine)
        MethodChannel(flutterEngine.dartExecutor.binaryMessenger, dutyChannel)
            .setMethodCallHandler { call, result ->
                when (call.method) {
                    "start" -> {
                        try {
                            DutyModeService.start(applicationContext)
                            result.success(true)
                        } catch (e: Exception) {
                            result.error("START_FAILED", e.message, null)
                        }
                    }
                    "stop" -> {
                        try {
                            DutyModeService.stop(applicationContext)
                            result.success(true)
                        } catch (e: Exception) {
                            result.error("STOP_FAILED", e.message, null)
                        }
                    }
                    "isSupported" -> result.success(true)
                    else -> result.notImplemented()
                }
            }
    }
}
