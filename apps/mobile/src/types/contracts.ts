/**
 * apps/mobile 임시 DTO 선언 파일
 * - server/ 직접 import 금지
 * - Option B 완료 후 @server-router 타입으로 전면 교체 예정
 * - 각 타입에 TODO로 향후 교체 소스 명시
 */

// ── 사용자 ──────────────────────────────────────────────────
// TODO: replace → infer from AppRouter['auth']['me']
export type UserRole = 'user' | 'merchant' | 'admin';

export interface UserInfo {
  id: number;
  name: string | null;
  email: string | null;
  role: UserRole;
  signupCompletedAt: string | null;
  trialEndsAt: string | null;
}

// ── 쿠폰 ──────────────────────────────────────────────────
// TODO: replace → infer from AppRouter['coupons']['listMy']
export type DiscountType = 'percentage' | 'fixed' | 'freebie';

export interface CouponSummary {
  id: number;
  title: string;
  discountType: DiscountType;
  discountValue: number;
  remainingQuantity: number;
  totalQuantity: number;
  startDate: string;
  endDate: string;
  approvedBy: number | null;
  pinCode?: string;
}

// ── 가게 ──────────────────────────────────────────────────
// TODO: replace → infer from AppRouter['stores']['mapStores']
export type StoreCategory =
  | 'cafe' | 'restaurant' | 'beauty'
  | 'hospital' | 'fitness' | 'other';

export interface StoreSummary {
  id: number;
  name: string;
  category: StoreCategory;
  address: string;
  latitude: string | null;
  longitude: string | null;
  distance?: number;
  ownerIsDormant?: boolean;
  couponCount?: number;
}

// ── 플랜 (2주차 이후) ─────────────────────────────────────
// TODO: replace → infer from AppRouter['packOrders']['getMyPlan']
export type TierKey = 'FREE' | 'WELCOME' | 'REGULAR' | 'BUSY';
export type TrialState = 'trial_free' | 'non_trial_free' | 'paid';

export interface PlanInfo {
  tier: TierKey;
  expiresAt: string | null;
  defaultCouponQuota: number;
  defaultDurationDays: number;
  isAdmin: boolean;
  trialState: TrialState;
}
