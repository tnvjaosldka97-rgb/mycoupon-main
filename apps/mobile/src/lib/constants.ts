/** 마이쿠폰 모바일 앱 상수 */

export const API_BASE    = 'https://my-coupon-bridge.com';
export const API_URL     = `${API_BASE}/api/trpc`;

/** 구글 OAuth 진입 URL (redirect=_app_ → 서버가 티켓 발급 후 딥링크로 복귀) */
export const OAUTH_URL   = `${API_BASE}/api/oauth/google/login?redirect=_app_`;

/** 앱 딥링크 scheme — app.json scheme과 반드시 일치 */
export const APP_SCHEME  = 'com.mycoupon.app';
export const OAUTH_CALLBACK_PREFIX = `${APP_SCHEME}://auth/callback`;

/** 서버 세션 쿠키명 — server/shared/const.ts COOKIE_NAME과 동일 */
export const COOKIE_NAME = 'app_session_id';

export const COLORS = {
  primary:   '#F97316',
  accent:    '#EC4899',
  bg:        '#F8F9FA',
  white:     '#FFFFFF',
  text:      '#1F2937',
  subtext:   '#6B7280',
  border:    '#E5E7EB',
  muted:     '#F3F4F6',
  red:       '#EF4444',
  green:     '#22C55E',
  blue:      '#3B82F6',
  amber:     '#F59E0B',
} as const;

export const CATEGORY_LABEL: Record<string, string> = {
  cafe: '☕ 카페', restaurant: '🍽️ 음식점', beauty: '💅 뷰티',
  hospital: '🏥 병원', fitness: '💪 헬스장', other: '🎁 기타',
};

export const TIER_LABEL: Record<string, string> = {
  FREE: '무료', WELCOME: '손님마중', REGULAR: '단골손님', BUSY: '북적북적',
};
