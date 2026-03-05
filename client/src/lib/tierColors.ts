/**
 * 마이쿠폰 구독 등급 색상 체계 (공통 상수)
 * - 플랜 카드, 현재 등급 배지, 쿠폰 카드, 지도 마커에 공통 적용
 */

export const TIER_COLOR_MAP = {
  FREE: {
    main:   '#98A2B3',
    bg:     '#F8FAFC',
    border: '#E4E7EC',
    text:   '#344054',
    marker: '#98A2B3',
    label:  '무료(7일 체험)',
  },
  WELCOME: {
    main:   '#2563EB',
    bg:     '#EFF6FF',
    border: '#BFDBFE',
    text:   '#1E40AF',
    marker: '#2563EB',
    label:  '손님마중',
  },
  REGULAR: {
    main:   '#7C3AED',
    bg:     '#F5F3FF',
    border: '#DDD6FE',
    text:   '#5B21B6',
    marker: '#7C3AED',
    label:  '단골손님',
  },
  BUSY: {
    main:   '#D97706',
    bg:     '#FFFBEB',
    border: '#FDE68A',
    text:   '#92400E',
    marker: '#D97706',
    label:  '북적북적',
  },
} as const;

export type TierKey = keyof typeof TIER_COLOR_MAP;

/** packCode → TierKey 매핑 */
export const PACK_TO_TIER: Record<string, TierKey> = {
  WELCOME_19800: 'WELCOME',
  REGULAR_29700: 'REGULAR',
  BUSY_49500:    'BUSY',
};

/** 안전하게 TierColor 반환 — 알 수 없는 값은 FREE로 폴백 */
export function getTierColor(tier?: string | null) {
  if (tier && tier in TIER_COLOR_MAP) {
    return TIER_COLOR_MAP[tier as TierKey];
  }
  return TIER_COLOR_MAP.FREE;
}
