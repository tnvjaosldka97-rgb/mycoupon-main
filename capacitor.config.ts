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
  webDir: 'dist/client',

  server: {
    // CRITICAL: Secure 쿠키 동작을 위해 androidScheme을 https로 고정
    androidScheme: 'https',
    // WebView origin을 프로덕션 도메인과 일치시켜 쿠키 SameSite 통과
    hostname: 'my-coupon-bridge.com',
    // 개발 시에는 아래 주석을 해제하여 로컬 서버를 가리킬 수 있음
    // url: 'http://10.0.2.2:3000', // Android 에뮬레이터 → localhost
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
