package com.mycoupon.app

import android.app.NotificationManager
import android.content.Context
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import androidx.core.app.NotificationManagerCompat
import me.leolin.shortcutbadger.ShortcutBadger
import android.util.Log

/**
 * PR-84 / PR-91-D — OS 앱 아이콘 배지 clear plugin.
 *
 * 사장님 결함 보고: 알림 드롭다운 열어도 폰 홈화면 빨간 배지 "1" 안 사라짐.
 *
 * 동작 단계 (각 vendor try-catch graceful):
 *   1. NotificationManager.cancelAll() — Android 표준
 *   1b. NotificationManagerCompat.cancelAll — AndroidX 표준 (추가 안전망)
 *   2. ShortcutBadger.applyCount(0) — 폭넓은 OEM 호환 (Samsung/Sony/LG/Huawei/Xiaomi/Vivo/OPPO 등)
 *
 * PR-91-D 제거 (사장님 logcat raw 검증 — PermissionDenial 영구 fail):
 *   ❌ Samsung BadgeProvider direct write
 *      → com.sec.android.provider.badge.permission.WRITE = Samsung 시스템 signature 권한
 *      → AndroidManifest 선언해도 OS 자동 deny (third-party 앱 영원히 X)
 *      → 호출 시도 자체가 시간 낭비 + logcat spam
 *   PR-91-A 의 setShowBadge(false) 채널 정공법 적용 후 = 이 step 자체 무의미.
 */
@CapacitorPlugin(name = "BadgeClear")
class BadgeClearPlugin : Plugin() {

    @PluginMethod
    fun clear(call: PluginCall) {
        val context = bridge.context
        Log.d("BadgeClear", "[BadgeClear:CALLED] start")

        try {
            val nm = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
            nm.cancelAll()
            Log.d("BadgeClear", "[BadgeClear:STEP1] NotificationManager.cancelAll OK")
        } catch (e: Exception) {
            Log.e("BadgeClear", "[BadgeClear:STEP1] failed: ${e.message}")
        }

        try {
            NotificationManagerCompat.from(context).cancelAll()
            Log.d("BadgeClear", "[BadgeClear:STEP1b] NotificationManagerCompat.cancelAll OK")
        } catch (e: Exception) {
            Log.e("BadgeClear", "[BadgeClear:STEP1b] failed: ${e.message}")
        }

        try {
            val ok = ShortcutBadger.applyCount(context, 0)
            Log.d("BadgeClear", "[BadgeClear:STEP2] ShortcutBadger result=$ok")
        } catch (e: Exception) {
            Log.e("BadgeClear", "[BadgeClear:STEP2] failed: ${e.message}")
        }

        Log.d("BadgeClear", "[BadgeClear:DONE]")
        call.resolve()
    }
}
