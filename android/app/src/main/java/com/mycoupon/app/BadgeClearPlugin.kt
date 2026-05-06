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
import androidx.core.app.NotificationManagerCompat
import me.leolin.shortcutbadger.ShortcutBadger
import android.util.Log

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
        // PR-89 (사장님 logcat 검증용 — raw 진단 핵심)
        Log.d("BadgeClear", "[BadgeClear:CALLED] start packageName=$packageName")

        // 1. NotificationManager.cancelAll() — Android 표준
        try {
            val nm = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
            nm.cancelAll()
            Log.d("BadgeClear", "[BadgeClear:STEP1] NotificationManager.cancelAll OK")
        } catch (e: Exception) {
            Log.e("BadgeClear", "[BadgeClear:STEP1] failed: ${e.message}")
        }

        // 1-b. NotificationManagerCompat.cancelAll — AndroidX 표준 (추가 안전망)
        try {
            NotificationManagerCompat.from(context).cancelAll()
            Log.d("BadgeClear", "[BadgeClear:STEP1b] NotificationManagerCompat.cancelAll OK")
        } catch (e: Exception) {
            Log.e("BadgeClear", "[BadgeClear:STEP1b] failed: ${e.message}")
        }

        // 2. PR-87: ShortcutBadger — 가장 폭넓은 OEM 호환 라이브러리
        //    Samsung / Sony / LG / Huawei / Xiaomi / Vivo / OPPO / HTC 등
        try {
            val ok = ShortcutBadger.applyCount(context, 0)
            Log.d("BadgeClear", "[BadgeClear:STEP2] ShortcutBadger.applyCount(0) result=$ok")
        } catch (e: Exception) {
            Log.e("BadgeClear", "[BadgeClear:STEP2] failed: ${e.message}")
        }

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
                Log.d("BadgeClear", "[BadgeClear:STEP3] Samsung BadgeProvider INSERT OK")
            } else {
                Log.d("BadgeClear", "[BadgeClear:STEP3] Samsung BadgeProvider UPDATE OK rows=$updated")
            }
        } catch (e: Exception) {
            Log.e("BadgeClear", "[BadgeClear:STEP3] Samsung BadgeProvider failed: ${e.message}")
        }

        Log.d("BadgeClear", "[BadgeClear:DONE] all steps complete")
        call.resolve()
        return  // ← 4, 5 단계 (deprecated BroadcastIntent) 는 현실적 효과 0, 호출 X

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
