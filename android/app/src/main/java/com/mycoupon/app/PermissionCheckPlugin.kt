package com.mycoupon.app

import android.Manifest
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.content.ContextCompat
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import android.util.Log

/**
 * PR-95 — 위치 권한 상태 정확 구분 plugin (단순 read API).
 *
 * 사장님 명시: "앱 사용 중에만 허용" vs "항상 허용" 구분 의무.
 *
 * 단순 Read API:
 *   ContextCompat.checkSelfPermission() 호출만 (Activity 진입 X, Intent 호출 X)
 *   → crash 위험 0 (PR-72 자작 plugin 결함과 다른 패턴)
 *
 * 반환 status:
 *   "always"      - 항상 허용 (foreground + background grant)
 *   "while-using" - 앱 사용 중에만 허용 (foreground only)
 *   "denied"      - 거부 (foreground X)
 */
@CapacitorPlugin(name = "PermissionCheck")
class PermissionCheckPlugin : Plugin() {

    @PluginMethod
    fun getLocationStatus(call: PluginCall) {
        val context = bridge.context
        try {
            val foregroundGranted = ContextCompat.checkSelfPermission(
                context,
                Manifest.permission.ACCESS_FINE_LOCATION
            ) == PackageManager.PERMISSION_GRANTED

            // ACCESS_BACKGROUND_LOCATION = Android 10 (API 29) 이상만 의미 있음
            // API 29 미만 = ACCESS_FINE_LOCATION 만 있으면 background 도 자동 허용
            val backgroundGranted = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                ContextCompat.checkSelfPermission(
                    context,
                    Manifest.permission.ACCESS_BACKGROUND_LOCATION
                ) == PackageManager.PERMISSION_GRANTED
            } else {
                foregroundGranted  // API 29 미만 = foreground 권한 = background 자동
            }

            val status = when {
                !foregroundGranted -> "denied"
                backgroundGranted -> "always"
                else -> "while-using"
            }

            Log.d("PermissionCheck", "[getLocationStatus] foreground=$foregroundGranted background=$backgroundGranted status=$status")

            val ret = JSObject()
            ret.put("status", status)
            ret.put("foreground", foregroundGranted)
            ret.put("background", backgroundGranted)
            call.resolve(ret)
        } catch (e: Exception) {
            Log.e("PermissionCheck", "[getLocationStatus] failed: ${e.message}")
            call.reject("permission check failed: ${e.message}")
        }
    }
}
