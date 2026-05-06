package com.mycoupon.app

import android.app.NotificationManager
import android.content.ContentValues
import android.content.Context
import android.content.Intent
import android.net.Uri
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import me.leolin.shortcutbadger.ShortcutBadger

/**
 * PR-84 — OS 앱 아이콘 배지 clear plugin (multi-vendor 안전망 복원).
 *
 * 사장님 결함 보고: 알림 드롭다운 열어도 폰 홈화면 빨간 배지 "1" 안 사라짐.
 *
 * 4 단계 fallback (각 vendor try-catch graceful):
 *   1. NotificationManager.cancelAll() — Android 표준, 대부분 OEM 자동 badge clear
 *   2. Samsung BadgeProvider direct write — content://com.sec.badge/apps update/insert
 *      (One UI 6+ S25 핵심 fix — AndroidManifest 의 com.sec.badge READ/WRITE 권한 의존)
 *   3. Samsung / Sony / HTC / LG: BADGE_COUNT_UPDATE BroadcastIntent (legacy 안전망)
 *   4. Xiaomi (MIUI): APPLICATION_MESSAGE_UPDATE
 *
 * 가드레일: 사장님 "안정성 우선" 명시 — 모든 vendor 안전망 보존.
 */
@CapacitorPlugin(name = "BadgeClear")
class BadgeClearPlugin : Plugin() {

    @PluginMethod
    fun clear(call: PluginCall) {
        val context = bridge.context
        val packageName = context.packageName
        val mainActivity = "com.mycoupon.app.MainActivity"

        // 1. NotificationManager.cancelAll() — Android 표준
        try {
            val nm = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
            nm.cancelAll()
        } catch (_: Exception) { /* graceful */ }

        // 2. PR-87: ShortcutBadger — 가장 폭넓은 OEM 호환 라이브러리
        //    Samsung / Sony / LG / Huawei / Xiaomi / Vivo / OPPO / HTC 등
        //    Samsung One UI 7+ 도 호환 (라이브러리 내부 다중 fallback)
        try {
            ShortcutBadger.applyCount(context, 0)
        } catch (_: Exception) { /* graceful */ }

        // 3. Samsung BadgeProvider direct write (One UI 6 이하 핵심 fix, 안전망)
        try {
            val cv = ContentValues().apply {
                put("package", packageName)
                put("class", mainActivity)
                put("badgecount", 0)
            }
            val uri = Uri.parse("content://com.sec.badge/apps")
            val updated = context.contentResolver.update(
                uri, cv, "package=?", arrayOf(packageName)
            )
            if (updated == 0) {
                context.contentResolver.insert(uri, cv)
            }
        } catch (_: Exception) { /* Samsung 외 OEM = graceful skip */ }

        // 4. Samsung / Sony / HTC / LG: BADGE_COUNT_UPDATE (legacy 안전망)
        try {
            val intent = Intent("android.intent.action.BADGE_COUNT_UPDATE")
            intent.putExtra("badge_count", 0)
            intent.putExtra("badge_count_package_name", packageName)
            intent.putExtra("badge_count_class_name", mainActivity)
            context.sendBroadcast(intent)
        } catch (_: Exception) { /* graceful */ }

        // 5. Xiaomi (MIUI): APPLICATION_MESSAGE_UPDATE
        try {
            val intent = Intent("android.intent.action.APPLICATION_MESSAGE_UPDATE")
            intent.putExtra("android.intent.extra.update_application_component_name", "$packageName/$mainActivity")
            intent.putExtra("android.intent.extra.update_application_message_text", "")
            context.sendBroadcast(intent)
        } catch (_: Exception) { /* graceful */ }

        call.resolve()
    }
}
