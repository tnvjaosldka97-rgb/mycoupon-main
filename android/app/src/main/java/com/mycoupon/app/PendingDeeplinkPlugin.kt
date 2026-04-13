package com.mycoupon.app

import android.util.Log
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin

/**
 * PendingDeeplinkPlugin
 *
 * MainActivity가 App Links로 시작될 때 intent URL을 정적으로 보관한다.
 * JS 측에서 부트 타임에 getPendingUrl()로 읽어 processDeepLink()를 실행한다.
 *
 * 필요 이유:
 *   Cold start / Capacitor loadUrl 완료 전에 Android가 intent를 전달하면
 *   appUrlOpen 이벤트가 JS 리스너 등록 전에 발화되어 누락된다.
 *   정적 홀더에 보관 → JS가 준비된 후 꺼내가면 타이밍 의존 없음.
 */
@CapacitorPlugin(name = "PendingDeeplink")
class PendingDeeplinkPlugin : Plugin() {

    companion object {
        private const val TAG = "NATIVE-DEEPLINK"

        @Volatile
        private var pendingUrl: String? = null

        fun setPendingUrl(url: String) {
            Log.d(TAG, "[APP-AUTH-N3] setPendingUrl — url = ${url.take(200)}")
            pendingUrl = url
        }
    }

    @PluginMethod
    fun getPendingUrl(call: PluginCall) {
        val url = pendingUrl
        Log.d(TAG, "[getPendingUrl] returning = ${url?.take(100) ?: "(null)"}")
        val ret = JSObject()
        ret.put("url", url ?: "")
        call.resolve(ret)
    }

    @PluginMethod
    fun clearPendingUrl(call: PluginCall) {
        Log.d(TAG, "[clearPendingUrl] clearing = ${pendingUrl?.take(100) ?: "(null)"}")
        pendingUrl = null
        call.resolve()
    }
}
