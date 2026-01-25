/**
 * ✅ Google OAuth 직접 연동 - 로그인 URL 생성
 * MANUS OAuth를 거치지 않고 Google OAuth를 직접 사용하여 성능 최적화
 * 
 * 🚨 현재 활성화: Google OAuth만 사용 (my-coupon-bridge.com)
 * 
 * 주의: 대부분의 파일은 @/lib/const를 사용합니다.
 * 이 파일은 레거시 호환성을 위해 유지됩니다.
 */
export const getLoginUrl = () => {
  const currentUrl = window.location.href;
  // ✅ Google OAuth 직접 호출 (Railway 서버 사용)
  return `/api/oauth/google/login?redirect=${encodeURIComponent(currentUrl)}`;
};

// ❌ DEPRECATED: MANUS OAuth 완전 제거
// 레거시 함수 삭제됨 - 더 이상 사용하지 않음
