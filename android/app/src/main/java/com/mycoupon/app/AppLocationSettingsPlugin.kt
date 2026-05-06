package com.mycoupon.app

import android.content.Intent
import android.net.Uri
import android.provider.Settings
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin

/**
 * PR-72 — Android 앱 권한 페이지 직진 plugin (multi-tier fallback).
 *
 * 사장님 명시: 모달 [설정으로 이동] 클릭 시 권한 페이지 직진.
 *
 * 시도 순서 (try-catch 으로 OEM 차이 자동 fallback):
 *   1) Action string "android.intent.action.MANAGE_APP_PERMISSIONS" — 앱 권한 카테고리 (일부 OEM 지원)
 *   2) Settings.ACTION_APPLICATION_DETAILS_SETTINGS — 앱 정보 페이지 (100% 작동)
 *
 * Note (자기 보고):
 *   - Intent.ACTION_APP_LOCATION_SETTINGS / ACTION_MANAGE_APP_PERMISSIONS 정적 field 미존재.
 *   - String action 으로만 직접 사용 가능 (Android docs raw 확인).
 *   - apply { } 블록 = Intent generic type 추론 실패 가능 → step-by-step 으로 단순화.
 */
@CapacitorPlugin(name = "AppLocationSettings")
class AppLocationSettingsPlugin : Plugin() {

    @PluginMethod
    fun open(call: PluginCall) {
        val context = bridge.context
        // 시도 1: 앱 권한 카테고리 페이지 (system action string, 일부 OEM 지원)
        try {
            val intent = Intent("android.intent.action.MANAGE_APP_PERMISSIONS")
            intent.putExtra("android.intent.extra.PACKAGE_NAME", context.packageName)
            intent.flags = Intent.FLAG_ACTIVITY_NEW_TASK
            context.startActivity(intent)
            call.resolve()
            return
        } catch (e: Exception) {
            // 시도 2 fallback
        }
        // 시도 2: 앱 정보 페이지 (모든 Android, 100% 작동)
        try {
            val intent = Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS)
            intent.data = Uri.fromParts("package", context.packageName, null)
            intent.flags = Intent.FLAG_ACTIVITY_NEW_TASK
            context.startActivity(intent)
            call.resolve()
        } catch (e: Exception) {
            call.reject("openAppLocationSettings failed: ${e.message}")
        }
    }
}
