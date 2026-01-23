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
  const oauthPortalUrl = import.meta.env.VITE_OAUTH_PORTAL_URL;
  const appId = import.meta.env.VITE_APP_ID;
  const redirectUri = `${window.location.origin}/api/oauth/callback`;
  const currentUrl = window.location.href;
  const state = btoa(currentUrl);

  const url = new URL(`${oauthPortalUrl}/app-auth`);
  url.searchParams.set("appId", appId);
  url.searchParams.set("redirectUri", redirectUri);
  url.searchParams.set("state", state);
  return url.toString();
};
