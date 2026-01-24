export { COOKIE_NAME, ONE_YEAR_MS } from "@shared/const";

// Google OAuth 직접 연동 - 로그인 URL 생성 (Manus 제거)
export const getLoginUrl = () => {
  const currentUrl = window.location.href;
  // Google OAuth 직접 호출 (Railway 서버 사용)
  return `/api/oauth/google/login?redirect=${encodeURIComponent(currentUrl)}`;
};
