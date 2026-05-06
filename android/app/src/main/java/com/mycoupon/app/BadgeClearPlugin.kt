package com.mycoupon.app

import android.app.NotificationManager
import android.content.ContentValues
import android.content.Context
import android.net.Uri
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin

/**
 * PR-83 (단순화) — OS 앱 아이콘 배지 clear plugin.
 *
 * 사장님 결함 보고: 알림 드롭다운 열어도 폰 홈화면 빨간 배지 "1" 안 사라짐.
 *
 * 2 단계 fallback (BroadcastIntent 제거 — deprecated, cleanup):
 *   1. NotificationManager.cancelAll() — 모든 알림 dismiss + 대부분 OEM 자동 badge clear
 *   2. Samsung BadgeProvider direct write — content://com.sec.badge/apps update/insert
 *      (One UI 6+ S25 핵심 fix — AndroidManifest 의 com.sec.badge READ/WRITE 권한 의존)
 *
 * Pixel/Stock Android = (1) NotificationManager 만으로 충분.
 * Samsung = (1)+(2) 둘 다 시도.
 */
@CapacitorPlugin(name = "BadgeClear")
class BadgeClearPlugin : Plugin() {

    @PluginMethod
    fun clear(call: PluginCall) {
        val context = bridge.context
        val packageName = context.packageName
        val mainActivity = "com.mycoupon.app.MainActivity"

        // 1. NotificationManager.cancelAll() — Android 표준, 대부분 OEM 자동 badge clear
        try {
            val nm = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
            nm.cancelAll()
        } catch (_: Exception) { /* graceful */ }

        // 2. Samsung BadgeProvider direct write (One UI 핵심 fix)
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

        call.resolve()
    }
}
