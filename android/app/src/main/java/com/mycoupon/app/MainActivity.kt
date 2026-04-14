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
 *
 * [Cold-start race fix]:
 *   super.onCreate()가 WebView 로딩을 시작(비동기)하고 리턴.
 *   JS는 super.onCreate 중/직후에 실행 시작할 수 있음.
 *   따라서 setPendingUrl을 registerPlugin + super.onCreate **이전**에 호출해야
 *   JS의 getPendingUrl() 호출보다 항상 앞설 수 있음.
 */
class MainActivity : BridgeActivity() {

    companion object {
        private const val TAG = "NATIVE-DEEPLINK"
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        // [APP-AUTH-N1] raw intent 로그 + 딥링크 pre-capture (super.onCreate 이전)
        // 이유: super.onCreate가 WebView 시작 → JS가 getPendingUrl() 호출 타이밍보다
        //       captureDeepLinkIntent가 늦으면 URL 누락. 미리 저장해 race 제거.
        val launchUrl = intent?.data?.toString()
        Log.d(TAG, "[APP-AUTH-N1] onCreate — action:${intent?.action} | url:${launchUrl?.take(300) ?: "(null)"}")
        if (launchUrl != null) {
            storeDeepLinkIfAuth(launchUrl, "N3-PRE-SUPER")
        }
        // PendingDeeplinkPlugin은 super.onCreate 전에 등록해야 Capacitor Bridge에 인식됨
        registerPlugin(PendingDeeplinkPlugin::class.java)
        super.onCreate(savedInstanceState)
        // super.onCreate 이후 재확인 (혹시 intent가 교체된 경우 방어)
        val postUrl = intent?.data?.toString()
        if (postUrl != null && postUrl != launchUrl) {
            Log.d(TAG, "[APP-AUTH-N1B] onCreate post-super intent changed → recheck: ${postUrl.take(300)}")
            storeDeepLinkIfAuth(postUrl, "N3-POST-SUPER")
        }
    }

    override fun onNewIntent(intent: Intent) {
        // [APP-AUTH-N2] onNewIntent: warm start 딥링크
        val url = intent.data?.toString()
        Log.d(TAG, "[APP-AUTH-N2] onNewIntent — action:${intent.action} | url:${url?.take(300) ?: "(null)"}")
        // super.onNewIntent 전에 먼저 저장 (Capacitor가 appUrlOpen 이벤트를 발화하기 전)
        if (url != null) storeDeepLinkIfAuth(url, "N3-NEW-INTENT-PRE")
        super.onNewIntent(intent)
        // super 이후에도 재확인 (안전망)
        if (url != null) storeDeepLinkIfAuth(url, "N3-NEW-INTENT-POST")
    }

    /**
     * auth deeplink 조건(custom scheme 또는 https bridge + ticket) 충족 시 setPendingUrl 호출.
     * 중복 호출 안전: 같은 URL은 같은 값으로 덮어쓰므로 무해함.
     */
    private fun storeDeepLinkIfAuth(url: String, logTag: String) {
        val isMycoupon = url.startsWith("mycoupon://")  // new contract
        val isApp = url.startsWith("com.mycoupon.app://")
        // ticket 없는 경우도 저장 (JS에서 ticket 유무 판별)
        val isHttps = url.startsWith("https://my-coupon-bridge.com")
        if (isMycoupon || isApp || isHttps) {
            Log.d(TAG, "[APP-AUTH-$logTag] setPendingUrl — hasTicket:${url.contains("ticket=")} | url:${url.take(300)}")
            PendingDeeplinkPlugin.setPendingUrl(url)
        } else {
            Log.d(TAG, "[APP-AUTH-$logTag] NOT auth url — skip | url:${url.take(100)}")
        }
    }
}
