package com.mycoupon.app

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.PowerManager
import android.provider.Settings
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
 *   JS 부팅 후 PendingDeeplink.getPendingUrl() 로 꺼내 consumeFromRaw 실행.
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
        val launchUrl = intent?.data?.toString()
        // [APP-LINK-N1] onCreate intent data — cold start
        Log.d(TAG, "[APP-LINK-N1] onCreate intent data=${launchUrl?.take(300) ?: "(null)"} | action=${intent?.action}")
        if (launchUrl != null) {
            storeDeepLink(launchUrl, "onCreate-pre")
        }
        registerPlugin(PendingDeeplinkPlugin::class.java)
        // PR-83 (가): AppLocationSettingsPlugin 영구 제거 — Samsung crash 차단 + cleanup
        registerPlugin(BadgeClearPlugin::class.java)            // PR-77: OS 앱 아이콘 배지 clear
        super.onCreate(savedInstanceState)
        // super.onCreate 이후 재확인 (intent 교체 방어)
        val postUrl = intent?.data?.toString()
        if (postUrl != null && postUrl != launchUrl) {
            Log.d(TAG, "[APP-LINK-N1] onCreate post-super changed data=${postUrl.take(300)}")
            storeDeepLink(postUrl, "onCreate-post")
        }
        // 카톡/네이버/배민 패턴: 배터리 최적화 제외 권한 자동 요청
        // OEM aggressive battery optimization 이 background FCM push 를 silent 처리하는 것 방지
        requestIgnoreBatteryOptimizations()
    }

    /**
     * 배터리 최적화 제외 권한 요청 — 시스템 다이얼로그 발화.
     * 사용자가 "허용" 클릭 시 영구 제외 → background FCM push 100% 도착.
     * 이미 제외된 상태면 다이얼로그 안 뜸.
     */
    private fun requestIgnoreBatteryOptimizations() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M) return
        try {
            val pm = getSystemService(Context.POWER_SERVICE) as PowerManager
            if (pm.isIgnoringBatteryOptimizations(packageName)) {
                Log.d(TAG, "[BATTERY-OPT] already ignoring optimization — skip dialog")
                return
            }
            val intent = Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS)
            intent.data = Uri.parse("package:$packageName")
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            startActivity(intent)
            Log.d(TAG, "[BATTERY-OPT] request dialog shown — user will choose")
        } catch (e: Exception) {
            Log.e(TAG, "[BATTERY-OPT] request failed: ${e.message}")
        }
    }

    override fun onNewIntent(intent: Intent) {
        val url = intent.data?.toString()
        // [APP-LINK-N2] onNewIntent data — warm start
        Log.d(TAG, "[APP-LINK-N2] onNewIntent data=${url?.take(300) ?: "(null)"} | action=${intent.action}")
        if (url != null) storeDeepLink(url, "newIntent-pre")
        // CRITICAL: setIntent() 호출 필수 — 없으면 getIntent()가 이전 intent를 반환
        // Capacitor App.getLaunchUrl()이 getIntent().getData()를 사용하므로 갱신 필수
        setIntent(intent)
        super.onNewIntent(intent)
        if (url != null) storeDeepLink(url, "newIntent-post")
    }

    /**
     * 인식 가능한 딥링크 URL이면 PendingDeeplinkPlugin에 보관.
     * [APP-LINK-N3] pending stored
     */
    private fun storeDeepLink(url: String, tag: String) {
        val isMycoupon = url.startsWith("mycoupon://")
        val isHttps = url.startsWith("https://my-coupon-bridge.com")
        // legacy com.mycoupon.app:// 도 인식 (캐시된 브리지 페이지 방어)
        val isLegacy = url.startsWith("com.mycoupon.app://")
        if (isMycoupon || isHttps || isLegacy) {
            Log.d(TAG, "[APP-LINK-N3] pending stored raw=${url.take(300)} | tag=$tag | hasTicket=${url.contains("ticket=")}")
            PendingDeeplinkPlugin.setPendingUrl(url)
        } else {
            Log.d(TAG, "[APP-LINK-N3] NOT recognized — skip | url=${url.take(100)} | tag=$tag")
        }
    }
}
