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
 * Custom Tabs에서 OAuth 완료 후 앱으로 명시적 복귀를 위한 쿠키 신호 이름.
 * Capacitor WebView와 Chrome Custom Tabs는 같은 앱 내에서 쿠키 저장소를 공유함.
 * → native WebView에서 설정한 쿠키를 Custom Tabs의 React 앱이 읽을 수 있음.
 * → React 앱이 로그인 완료 + 쿠키 감지 시 com.mycoupon.app://auth/callback 으로 이동
 * → Android가 custom scheme 처리 → Custom Tabs 닫힘 → appUrlOpen 발화 → 앱 복귀
 */
export const OAUTH_RETURN_COOKIE = 'cap-oauth-return';

export async function openGoogleLogin(relativeOrAbsoluteUrl: string): Promise<void> {
  if (!isCapacitorNative()) {
    // 웹: 기존 동작 그대로
    window.location.href = relativeOrAbsoluteUrl;
    return;
  }

  // Capacitor: 동적 import (웹 번들에 포함되지 않도록)
  try {
    const { Browser } = await import('@capacitor/browser');
    const fullUrl = relativeOrAbsoluteUrl.startsWith('/')
      ? `https://my-coupon-bridge.com${relativeOrAbsoluteUrl}`
      : relativeOrAbsoluteUrl;

    // ── 앱 복귀 신호 쿠키 설정 ────────────────────────────────────────────────
    // Custom Tabs(Chrome)와 native WebView는 동일 앱 내에서 쿠키를 공유함.
    // Custom Tabs 안의 React 앱이 이 쿠키를 감지하면 OAuth 완료 후 자동으로
    // com.mycoupon.app://auth/callback 으로 이동 → Custom Tabs 명시적 종료 → appUrlOpen
    try {
      const exp = new Date(Date.now() + 10 * 60 * 1000).toUTCString(); // 10분
      document.cookie = `${OAUTH_RETURN_COOKIE}=1; path=/; expires=${exp}; SameSite=Lax`;
      console.log('[OAUTH] cap-oauth-return 쿠키 설정 — Custom Tabs 열기 준비');
    } catch (_) {}

    console.log('[OAUTH] Chrome Custom Tabs 열기:', fullUrl);
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
