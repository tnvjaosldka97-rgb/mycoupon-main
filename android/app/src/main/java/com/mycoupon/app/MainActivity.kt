package com.mycoupon.app

import com.getcapacitor.BridgeActivity

/**
 * MyCoupon Android MainActivity
 *
 * Capacitor BridgeActivity를 상속.
 * 모든 Capacitor 플러그인 로드와 WebView 초기화는 BridgeActivity가 처리.
 * 추가 플러그인이 필요하면 이 클래스에 registerPlugin() 호출 추가.
 */
class MainActivity : BridgeActivity()
