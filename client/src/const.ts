/**
 * ✅ Google OAuth 직접 연동 - 로그인 URL 생성
 * Google OAuth를 직접 사용하여 성능 최적화
 * 
 * 주의: 대부분의 파일은 @/lib/const를 사용합니다.
 * 이 파일은 레거시 호환성을 위해 유지됩니다.
 */
export const getLoginUrl = () => {
  const currentUrl = window.location.href;
  // Google OAuth 직접 호출 (Railway 서버)
  return `/api/oauth/google/login?redirect=${encodeURIComponent(currentUrl)}`;
};
