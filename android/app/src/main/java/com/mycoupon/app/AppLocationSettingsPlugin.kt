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
 * 시도 순서:
 *   1) Intent.ACTION_MANAGE_APP_PERMISSIONS (Android 6.0+) — 앱 권한 카테고리 페이지
 *      → 사용자 [위치] 1번 클릭 → 라디오 (2 단계)
 *   2) Settings.ACTION_APPLICATION_DETAILS_SETTINGS (모든 Android) — 앱 정보 페이지
 *      → Samsung One UI = 자동 권한 펼침 (1~2 단계), Pixel = 3 단계
 *
 * Android 표준에 "위치 권한 라디오 페이지 직진 1 클릭" Intent 자체는 미지원.
 * MANAGE_APP_PERMISSIONS 가 가장 가까운 정공 (1 클릭 단축).
 */
@CapacitorPlugin(name = "AppLocationSettings")
class AppLocationSettingsPlugin : Plugin() {

    @PluginMethod
    fun open(call: PluginCall) {
        val context = bridge.context
        // 시도 1: 앱 권한 카테고리 페이지 (Android 6.0+ public API)
        try {
            val intent = Intent(Intent.ACTION_MANAGE_APP_PERMISSIONS)
            intent.putExtra(Intent.EXTRA_PACKAGE_NAME, context.packageName)
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
