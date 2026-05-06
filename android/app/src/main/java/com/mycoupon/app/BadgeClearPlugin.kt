package com.mycoupon.app

import android.content.Intent
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin

/**
 * PR-77 — OS 앱 아이콘 배지 카운트 clear plugin.
 *
 * 사장님 결함 보고: NotificationBadge 의 removeAllDeliveredNotifications() 가
 * OS notification tray clear 만, OS app icon 의 빨간 배지 "1" 안 사라짐.
 *
 * 해법: Samsung One UI / Sony / HTC 호환 BADGE_COUNT_UPDATE BroadcastIntent.
 *   intent action = "android.intent.action.BADGE_COUNT_UPDATE" (string 직접)
 *   extras: badge_count=0, package_name, class_name
 *
 * Pixel/Stock Android = 미지원 (단 사장님 폰 Samsung 호환 OK).
 */
@CapacitorPlugin(name = "BadgeClear")
class BadgeClearPlugin : Plugin() {

    @PluginMethod
    fun clear(call: PluginCall) {
        try {
            val context = bridge.context
            val intent = Intent("android.intent.action.BADGE_COUNT_UPDATE")
            intent.putExtra("badge_count", 0)
            intent.putExtra("badge_count_package_name", context.packageName)
            intent.putExtra("badge_count_class_name", "com.mycoupon.app.MainActivity")
            context.sendBroadcast(intent)
            call.resolve()
        } catch (e: Exception) {
            call.reject("BadgeClear failed: ${e.message}")
        }
    }
}
