/**
 * Capacitor Android 앱 환경 유틸
 *
 * 핵심 문제:
 *   Google OAuth는 WebView에서 명시적으로 차단됨 (WebView User-Agent 감지).
 *   Capacitor 앱에서 window.location.href = googleAuthUrl 하면
 *   "This browser may not be secure" 오류로 로그인이 불가능하다.
 *
 * 해결:
 *   @capacitor/browser 의 Chrome Custom Tabs에서 OAuth를 실행.
 *   Android에서 Chrome Custom Tabs와 WebView는 쿠키 저장소를 공유하므로
 *   OAuth 완료 후 서버가 Set-Cookie 응답하면 WebView에서도 세션이 유효하다.
 */

/** Capacitor 네이티브 환경(Android/iOS)인지 감지 */
export function isCapacitorNative(): boolean {
  try {
    // @capacitor/core의 Capacitor 전역 객체는 native 앱 환경에서만 주입됨
    return typeof (window as any).Capacitor !== 'undefined'
      && (window as any).Capacitor.isNativePlatform?.() === true;
  } catch {
    return false;
  }
}

/**
 * Google 로그인 트리거 (웹/앱 분기)
 *
 * 웹:       window.location.href = url  (기존 동작 유지)
 * Android:  @capacitor/browser → Chrome Custom Tabs 실행
 *           → Google OAuth 완료 → 서버 Set-Cookie → Custom Tabs 닫힘
 *           → WebView에서 쿠키 공유 → auth.me 성공
 *
 * @param relativeOrAbsoluteUrl  상대 URL('/api/oauth/...') 또는 절대 URL
 */
/**
 * Android 앱 OAuth 복귀 bridge route.
 * 앱이 로그인 시작 시 이 경로를 redirect 목적지로 설정한다.
 * 서버는 OAuth 완료 후 이 경로로 redirect → 이 경로는 custom scheme으로 다시 redirect.
 * Custom Tabs가 custom scheme을 만나면 Android가 탭을 닫고 앱에 appUrlOpen을 발화함.
 */
export const APP_OAUTH_RETURN_PATH = '/api/oauth/app-return';

export async function openGoogleLogin(relativeOrAbsoluteUrl: string): Promise<void> {
  if (!isCapacitorNative()) {
    // 웹: 기존 동작 그대로 (window.location.href)
    window.location.href = relativeOrAbsoluteUrl;
    return;
  }

  // Capacitor 앱:
  // 핵심 변경: redirect 목적지를 APP_OAUTH_RETURN_PATH 로 고정.
  // 이전 방식(쿠키 기반)은 쿠키 동기화 타이밍에 의존해 불안정했음.
  // 새 방식: URL redirect 체인으로 Custom Tabs 종료를 보장.
  //
  // 흐름:
  //   /api/oauth/google/login?redirect=/api/oauth/app-return
  //   → Google OAuth
  //   → /api/oauth/app-return (서버 bridge route)
  //   → com.mycoupon.app://auth/callback (custom scheme)
  //   → Custom Tabs 종료 → appUrlOpen 발화 → auth.me 1회
  try {
    const { Browser } = await import('@capacitor/browser');

    // ── 네이티브 전용 엔드포인트 사용 ───────────────────────────────────────────
    // /api/oauth/google/login 은 웹 전용 (redirect=_app_ 수신 시 무시).
    // 네이티브 앱은 반드시 /api/oauth/google/app-login 을 사용해야 함.
    // 서버가 /app-login 에서 state=_app_ 를 직접 설정 → 클라이언트가 _app_ 전달 불필요.
    let loginUrl: string;
    if (relativeOrAbsoluteUrl.includes('/api/oauth/google/login')) {
      loginUrl = `/api/oauth/google/app-login`;
    } else {
      loginUrl = relativeOrAbsoluteUrl;
    }

    const fullUrl = loginUrl.startsWith('/')
      ? `https://my-coupon-bridge.com${loginUrl}`
      : loginUrl;

    console.log('[OAUTH] login start — Custom Tabs 열기 (ticket 방식):', fullUrl);
    await Browser.open({
      url: fullUrl,
      windowName: '_blank',
      presentationStyle: 'fullscreen',
    });
  } catch (error) {
    console.error('[OAUTH] Browser.open 실패 → window.location fallback:', error);
    window.location.href = relativeOrAbsoluteUrl;
  }
}

/**
 * Capacitor Browser Custom Tabs 닫기
 * OAuth 완료 후 수동으로 닫아야 할 때 사용
 */
export async function closeCapacitorBrowser(): Promise<void> {
  if (!isCapacitorNative()) return;
  try {
    const { Browser } = await import('@capacitor/browser');
    await Browser.close();
  } catch (_) {}
}
