import type { CouponSummary } from '../types/contracts';

export const MOCK_COUPONS: CouponSummary[] = [
  {
    id: 1,
    title: '아메리카노 1잔 무료',
    discountType: 'freebie',
    discountValue: 0,
    remainingQuantity: 8,
    totalQuantity: 10,
    startDate: '2026-03-01T00:00:00Z',
    endDate: '2026-05-01T00:00:00Z',
    approvedBy: 1,
    pinCode: '384921',
  },
  {
    id: 2,
    title: '올리브영 20% 할인',
    discountType: 'percentage',
    discountValue: 20,
    remainingQuantity: 5,
    totalQuantity: 30,
    startDate: '2026-03-15T00:00:00Z',
    endDate: '2026-04-15T00:00:00Z',
    approvedBy: 1,
    pinCode: '192837',
  },
  {
    id: 3,
    title: '돼지국밥 3,000원 할인',
    discountType: 'fixed',
    discountValue: 3000,
    remainingQuantity: 0,
    totalQuantity: 20,
    startDate: '2026-02-01T00:00:00Z',
    endDate: '2026-03-01T00:00:00Z',
    approvedBy: 1,
  },
];
