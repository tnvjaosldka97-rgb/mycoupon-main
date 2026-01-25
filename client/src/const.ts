/**
 * ✅ Google OAuth 직접 연동 - 로그인 URL 생성
 * MANUS OAuth를 거치지 않고 Google OAuth를 직접 사용하여 성능 최적화
 * 
 * 🚨 현재 활성화: Google OAuth만 사용 (my-coupon-bridge.com)
 */
export const getLoginUrl = () => {
  const currentUrl = window.location.href;
  // ✅ Google OAuth 직접 호출 (MANUS 서버 경유 완전 제거)
  return `/api/oauth/google/login?redirect=${encodeURIComponent(currentUrl)}`;
};

// ❌ DEPRECATED: 기존 MANUS OAuth (사용 안 함)
// 레거시 함수 - 하위 호환성을 위해 유지하지만 사용하지 않음
export const getManuLoginUrl = () => {
  console.warn('⚠️ [DEPRECATED] getManuLoginUrl is deprecated. Use getLoginUrl() instead.');
  // 에러 발생 시 Google OAuth로 자동 폴백
  return getLoginUrl();
};
