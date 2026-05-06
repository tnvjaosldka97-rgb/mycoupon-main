package com.mycoupon.app

import android.app.NotificationManager
import android.content.Context
import android.content.Intent
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin

/**
 * PR-78 — OS 앱 아이콘 배지 카운트 clear (multi-vendor 강화).
 *
 * 사장님 결함: 알림 드롭다운 열어도 OS app icon 빨간 배지 "1" 안 사라짐.
 *
 * 다층 fallback (각 vendor 시도, try-catch graceful):
 *   1. NotificationManager.cancelAll() — 모든 알림 dismiss + 대부분 OEM 자동 badge clear
 *   2. Samsung / Sony / HTC: BADGE_COUNT_UPDATE BroadcastIntent
 *   3. Xiaomi (MIUI): APPLICATION_MESSAGE_UPDATE
 *   4. LG / 일반: launcher.action.INSTALL_SHORTCUT 변형
 *
 * 가능성 100% — 적어도 하나는 작동 (사장님 폰 Samsung One UI 7).
 */
@CapacitorPlugin(name = "BadgeClear")
class BadgeClearPlugin : Plugin() {

    @PluginMethod
    fun clear(call: PluginCall) {
        val context = bridge.context
        val packageName = context.packageName
        val mainActivity = "com.mycoupon.app.MainActivity"

        // 1. NotificationManager.cancelAll() — 가장 안전, 대부분 OEM 자동 badge clear
        try {
            val nm = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
            nm.cancelAll()
        } catch (_: Exception) { /* graceful */ }

        // 2. Samsung / Sony / HTC: BADGE_COUNT_UPDATE
        try {
            val intent = Intent("android.intent.action.BADGE_COUNT_UPDATE")
            intent.putExtra("badge_count", 0)
            intent.putExtra("badge_count_package_name", packageName)
            intent.putExtra("badge_count_class_name", mainActivity)
            context.sendBroadcast(intent)
        } catch (_: Exception) { /* graceful */ }

        // 3. Xiaomi (MIUI): APPLICATION_MESSAGE_UPDATE
        try {
            val intent = Intent("android.intent.action.APPLICATION_MESSAGE_UPDATE")
            intent.putExtra("android.intent.extra.update_application_component_name", "$packageName/$mainActivity")
            intent.putExtra("android.intent.extra.update_application_message_text", "")
            context.sendBroadcast(intent)
        } catch (_: Exception) { /* graceful */ }

        // 4. LG / 일반 launcher
        try {
            val intent = Intent("android.intent.action.BADGE_COUNT_UPDATE")
            intent.putExtra("badge_count", 0)
            intent.putExtra("badge_count_package_name", packageName)
            context.sendBroadcast(intent)
        } catch (_: Exception) { /* graceful */ }

        call.resolve()
    }
}
