/**
 * Google OAuth 직접 연동 - 로그인 URL 생성
 * MANUS OAuth를 거치지 않고 Google OAuth를 직접 사용하여 성능 최적화
 */
export const getLoginUrl = () => {
  const currentUrl = window.location.href;
  // Google OAuth 직접 호출 (MANUS 서버 경유 제거)
  return `/api/oauth/google/login?redirect=${encodeURIComponent(currentUrl)}`;
};

// 기존 MANUS OAuth URL (필요시 폴백용)
export const getManuLoginUrl = () => {
  const oauthPortalUrl = import.meta.env.VITE_OAUTH_PORTAL_URL || 'https://portal.manus.im';
  const appId = import.meta.env.VITE_APP_ID || 'mycoupon-app';
  const redirectUri = `${window.location.origin}/api/oauth/callback`;
  const currentUrl = window.location.href;
  const state = btoa(currentUrl);

  try {
    const url = new URL(`${oauthPortalUrl}/app-auth`);
    url.searchParams.set("appId", appId);
    url.searchParams.set("redirectUri", redirectUri);
    url.searchParams.set("state", state);
    return url.toString();
  } catch (error) {
    console.error('[getManuLoginUrl] Invalid URL:', error);
    // 에러 발생 시 Google OAuth로 폴백
    return getLoginUrl();
  }
};
