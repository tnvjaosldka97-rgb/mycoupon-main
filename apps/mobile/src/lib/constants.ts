// apps/mobile 앱 상수
// 실제 서버 URL — 나중에 tRPC 연동 시 사용

export const API_URL = 'https://my-coupon-bridge.com/api/trpc';

export const APP_NAME = '마이쿠폰';

export const COLORS = {
  primary: '#F97316',    // orange-500
  accent: '#EC4899',     // pink-500
  bg: '#FFF7F0',
  text: '#1F2937',
  subtext: '#6B7280',
  border: '#E5E7EB',
  white: '#FFFFFF',
  red: '#EF4444',
  green: '#22C55E',
  amber: '#F59E0B',
} as const;

export const CATEGORY_LABEL: Record<string, string> = {
  cafe: '☕ 카페',
  restaurant: '🍽️ 음식점',
  beauty: '💅 뷰티',
  hospital: '🏥 병원',
  fitness: '💪 헬스장',
  other: '🎁 기타',
};

export const TIER_LABEL: Record<string, string> = {
  FREE: '무료',
  WELCOME: '손님마중',
  REGULAR: '단골손님',
  BUSY: '북적북적',
};
