export { COOKIE_NAME, ONE_YEAR_MS } from "@shared/const";

// Generate login URL at runtime so redirect URI reflects the current origin.
export const getLoginUrl = () => {
  // Google OAuth로 직접 연결 (성능 최적화)
  const currentUrl = window.location.href;
  return `/api/oauth/google/login?redirect=${encodeURIComponent(currentUrl)}`;
};
