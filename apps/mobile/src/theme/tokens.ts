/** 마이쿠폰 모바일 디자인 토큰 */

export const Colors = {
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

export const Spacing = {
  xs:  4,
  sm:  8,
  md:  16,
  lg:  24,
  xl:  32,
  xxl: 48,
} as const;

export const Radius = {
  sm:  8,
  md:  12,
  lg:  16,
  xl:  20,
  full: 9999,
} as const;

export const Typography = {
  h1:       { fontSize: 28, fontWeight: '800' as const, color: Colors.text },
  h2:       { fontSize: 22, fontWeight: '800' as const, color: Colors.text },
  h3:       { fontSize: 18, fontWeight: '700' as const, color: Colors.text },
  body:     { fontSize: 15, fontWeight: '400' as const, color: Colors.text },
  bodyBold: { fontSize: 15, fontWeight: '700' as const, color: Colors.text },
  caption:  { fontSize: 12, fontWeight: '400' as const, color: Colors.subtext },
  label:    { fontSize: 13, fontWeight: '600' as const, color: Colors.subtext },
} as const;

export const Shadow = {
  sm: {
    shadowColor: '#000',
    shadowOpacity: 0.04,
    shadowRadius: 8,
    elevation: 2,
  },
  md: {
    shadowColor: '#000',
    shadowOpacity: 0.08,
    shadowRadius: 12,
    elevation: 4,
  },
  primary: {
    shadowColor: Colors.primary,
    shadowOpacity: 0.2,
    shadowRadius: 10,
    elevation: 4,
  },
} as const;
