package com.mycoupon.app

import android.content.Intent
import android.os.Bundle
import android.util.Log
import com.getcapacitor.BridgeActivity

/**
 * MyCoupon Android MainActivity
 *
 * Capacitor BridgeActivity를 상속.
 * 모든 Capacitor 플러그인 로드와 WebView 초기화는 BridgeActivity가 처리.
 *
 * PendingDeeplinkPlugin:
 *   Cold start 시 App Links / custom scheme intent URL을 JS가 준비되기 전에 수신할 수 있음.
 *   onCreate / onNewIntent에서 URL을 캡처해 PendingDeeplinkPlugin.setPendingUrl() 에 보관.
 *   JS 부팅 후 PendingDeeplink.getPendingUrl() 로 꺼내 processDeepLink 실행.
 */
class MainActivity : BridgeActivity() {

    companion object {
        private const val TAG = "NATIVE-DEEPLINK"
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        // PendingDeeplinkPlugin은 super.onCreate 전에 등록해야 Capacitor Bridge에 인식됨
        registerPlugin(PendingDeeplinkPlugin::class.java)
        super.onCreate(savedInstanceState)
        Log.d(TAG, "[APP-AUTH-INTENT] onCreate — intent action: ${intent?.action} | data: ${intent?.data?.toString()?.take(100) ?: "(null)"}")
        captureDeepLinkIntent(intent)
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        Log.d(TAG, "[APP-AUTH-INTENT] onNewIntent — action: ${intent.action} | data: ${intent.data?.toString()?.take(100) ?: "(null)"}")
        captureDeepLinkIntent(intent)
    }

    private fun captureDeepLinkIntent(intent: Intent?) {
        val url = intent?.data?.toString() ?: return
        val isAppDeepLink = url.startsWith("com.mycoupon.app://")
        val isHttpsTicket = url.startsWith("https://my-coupon-bridge.com") && url.contains("ticket=")
        if (isAppDeepLink || isHttpsTicket) {
            Log.d(TAG, "[APP-AUTH-INTENT] deep link captured → setPendingUrl: ${url.take(100)}")
            PendingDeeplinkPlugin.setPendingUrl(url)
        }
    }
}
