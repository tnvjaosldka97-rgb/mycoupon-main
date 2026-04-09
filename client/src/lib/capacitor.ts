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
    // 웹 (PC/모바일 Chrome/Safari): 항상 /api/oauth/google/login 경로로 직접 이동
    // app-login, _app_ 관련 로직 없음 — 이 분기는 절대 app 플로우를 탈 수 없음
    const webUrl = relativeOrAbsoluteUrl.includes('/api/oauth/google/app-login')
      ? '/?error=invalid_flow' // 혹시라도 app-login URL이 web에서 호출된 경우 차단
      : relativeOrAbsoluteUrl;
    console.log('[AUTH-URL] web login →', webUrl.slice(0, 120));
    window.location.href = webUrl;
    return;
  }

  // ── Capacitor 네이티브 앱 전용 ──────────────────────────────────────────────
  // 1) nonce 발급: 서버에서 60s TTL one-time nonce 수령
  // 2) /api/oauth/google/app-login?app_nonce=XXX 열기 (Chrome Custom Tabs)
  // 3) nonce 없으면 서버가 /?error=invalid_app_nonce 로 fallback → app 플로우 차단
  try {
    const { Browser } = await import('@capacitor/browser');

    // nonce 발급
    let appNonce = '';
    try {
      const nonceResp = await fetch('/api/oauth/app-login-nonce');
      const nonceData = await nonceResp.json() as { nonce?: string };
      appNonce = nonceData.nonce ?? '';
      console.log('[OAUTH] nonce issued:', appNonce.slice(0, 8) + '...');
    } catch (e) {
      console.error('[OAUTH] nonce fetch 실패 — app login 차단:', e);
      return;
    }

    // 항상 app-login 전용 엔드포인트 사용 (web login 엔드포인트와 완전 분리)
    const appLoginPath = `/api/oauth/google/app-login?app_nonce=${appNonce}`;
    const fullUrl = `https://my-coupon-bridge.com${appLoginPath}`;

    console.log('[AUTH-URL] native app login → /api/oauth/google/app-login?app_nonce=***');
    await Browser.open({
      url: fullUrl,
      windowName: '_blank',
      presentationStyle: 'fullscreen',
    });
  } catch (error) {
    console.error('[OAUTH] openGoogleLogin 실패 (nonce 또는 Browser.open):', error);
    // 호출부(login())가 _oauthInProgress를 리셋할 수 있도록 에러 전파
    throw error;
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
