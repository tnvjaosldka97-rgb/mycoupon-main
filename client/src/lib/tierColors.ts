/**
 * 마이쿠폰 구독 등급 색상 체계 (공통 상수)
 * - 플랜 카드, 현재 등급 배지, 쿠폰 카드, 지도 마커에 공통 적용
 *
 * 색상 정책:
 *   FREE      → 빨간색 포인트 (활성감 강조)
 *   PAID 전체 → 밝은 골드(황금색) 계열 공통 적용
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
    main:   '#EAB308',   // 선명한 황금색 (yellow-500)
    bg:     '#FEFCE8',   // yellow-50
    border: '#FDE047',   // yellow-300
    text:   '#854D0E',   // yellow-900 (가독성)
    marker: '#EAB308',
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

/**
 * 쿠폰 tier 색상 — 지도 InfoWindow, 쿠폰 카드 배지에 사용
 * - FREE (or null): 빨간색 강조
 * - PAID (WELCOME/REGULAR/BUSY): 골드 강조
 */
export function getCouponTierBadgeStyle(tier?: string | null): {
  borderClass: string;
  badgeClass: string;
  badgeText: string;
} {
  const isPaid = tier && tier !== 'FREE';
  if (isPaid) {
    return {
      borderClass: 'border-amber-400',
      badgeClass:  'bg-amber-100 text-amber-800 border border-amber-400',
      badgeText:   TIER_COLOR_MAP[tier as TierKey]?.label ?? '유료',
    };
  }
  return {
    borderClass: 'border-red-400',
    badgeClass:  'bg-red-50 text-red-700 border border-red-300',
    badgeText:   '무료(7일 체험)',
  };
}
