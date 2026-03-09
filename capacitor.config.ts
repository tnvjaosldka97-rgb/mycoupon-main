import type { CapacitorConfig } from '@capacitor/cli';

/**
 * Capacitor 설정 — MyCoupon Android 앱 래퍼
 *
 * 핵심 설정 이유:
 *  - server.androidScheme: 'https'
 *      Capacitor WebView는 기본으로 'http://localhost'를 origin으로 사용.
 *      httpOnly + Secure 쿠키는 HTTPS origin에서만 저장되므로 반드시 'https' 설정 필요.
 *  - server.hostname: 'my-coupon-bridge.com'
 *      WebView origin을 실제 서버 도메인과 일치시켜 쿠키 SameSite 정책 통과.
 *      → Railway 서버의 Set-Cookie가 Capacitor WebView에서 정상 저장됨.
 *  - webDir: 'dist/client'
 *      vite.config.ts의 build.outDir 기준. 'pnpm build' 후 sync 가능 상태.
 */
const config: CapacitorConfig = {
  appId: 'com.mycoupon.app',
  appName: '마이쿠폰',
  webDir: 'dist/public',

  server: {
    // CRITICAL: Capacitor WebView가 실제 서버에서 콘텐츠를 로드하도록 설정
    //
    // 문제 원인:
    //   server.hostname만 설정하면 'my-coupon-bridge.com'이 Capacitor의 가상 로컬 호스트가 됨.
    //   WebViewAssetLoader가 이 도메인의 모든 요청을 가로채서 로컬 assets에서 찾으려 함.
    //   /api/* 요청은 로컬 assets에 없으므로 실제 서버로 전달되지 않음 → 연결 실패.
    //
    // 해결:
    //   server.url을 실제 서버로 지정하면 WebView가 로컬 assets 대신 실제 서버에서 로드.
    //   /api/trpc, /api/health 등 API 요청이 정상적으로 실제 서버로 전달됨.
    //   쿠키도 동일 origin(my-coupon-bridge.com)에서 발급되므로 SameSite 정상 동작.
    url: 'https://my-coupon-bridge.com',

    // androidScheme: 'https'는 url이 설정된 경우 직접 영향 없으나 유지 (하위 호환)
    androidScheme: 'https',
  },

  android: {
    // Android 최소 SDK 버전 (Google Play 정책 기준)
    minWebViewVersion: 60,
    // 앱 내에서 외부 링크 처리 방식
    allowMixedContent: false,
    // 백그라운드에서 WebView 유지
    captureInput: true,
  },

  plugins: {
    // App 플러그인: 딥링크 / 앱 상태(foreground/background) 감지
    // OAuth 콜백 딥링크 수신에 필요 (추후 appUrlOpen 이벤트 활용)
    App: {
      // 추후 OAuth 앱 scheme 등록 시: 'com.mycoupon.app://'
    },
    // 스플래시 스크린 (설치 후 별도 구성 가능)
    SplashScreen: {
      launchShowDuration: 2000,
      backgroundColor: '#FFF5F0',
      showSpinner: false,
    },
  },
};

export default config;
