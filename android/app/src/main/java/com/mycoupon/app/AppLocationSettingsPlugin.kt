package com.mycoupon.app

import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.Settings
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin

/**
 * PR-72 — Android 앱 위치 권한 페이지 직진 plugin.
 *
 * 사장님 명시: 모달 [설정으로 이동] 클릭 시 사용자가 [권한]→[위치]→[항상 허용]
 * 추가 클릭 없이 1 step 으로 위치 권한 라디오 페이지 직진.
 *
 * Android 12+ (API 31+):
 *   Settings.ACTION_APP_LOCATION_SETTINGS = 앱별 위치 권한 페이지 직접 진입
 *   사용자가 라디오 ([항상 허용] / [앱 사용 중] / [거부]) 1단계 클릭
 *
 * Android 11 이하 fallback:
 *   ACTION_APPLICATION_DETAILS_SETTINGS — 앱 정보 페이지 (사용자가 권한→위치 추가 클릭)
 */
@CapacitorPlugin(name = "AppLocationSettings")
class AppLocationSettingsPlugin : Plugin() {

    @PluginMethod
    fun open(call: PluginCall) {
        try {
            val context = bridge.context
            val intent = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                // Android 12+ — 앱 위치 권한 페이지 직진
                Intent(Settings.ACTION_APP_LOCATION_SETTINGS).apply {
                    data = Uri.fromParts("package", context.packageName, null)
                }
            } else {
                // Android 11 이하 fallback — 앱 정보 페이지
                Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS).apply {
                    data = Uri.fromParts("package", context.packageName, null)
                }
            }
            intent.flags = Intent.FLAG_ACTIVITY_NEW_TASK
            context.startActivity(intent)
            call.resolve()
        } catch (e: Exception) {
            call.reject("openAppLocationSettings failed: ${e.message}")
        }
    }
}
