import { describe, it, expect, beforeAll } from 'vitest';
import { appRouter } from './routers';
import * as db from './db';
import type { TrpcContext } from './_core/context';

describe('Coupon markAsUsed', () => {
  let caller: ReturnType<typeof appRouter.createCaller>;
  let testUserId: number;
  let testStoreId: number;
  let testCouponId: number;
  let testUserCouponId: number;

  beforeAll(async () => {
    // 테스트용 사용자 생성
    const testOpenId = 'test-user-markused-' + Date.now();
    await db.upsertUser({
      openId: testOpenId,
      name: '테스트 사용자',
      email: 'test-markused@example.com',
    });
    
    const user = await db.getUserByOpenId(testOpenId);
    if (!user) throw new Error('사용자 생성 실패');
    testUserId = user.id;

    // Caller 생성
    const ctx: TrpcContext = {
      user: {
        id: testUserId,
        openId: user.openId,
        name: user.name!,
        email: user.email!,
        loginMethod: 'manus',
        role: 'user',
        createdAt: new Date(),
        updatedAt: new Date(),
        lastSignedIn: new Date(),
      },
      req: {} as any,
      res: {} as any,
    };
    caller = appRouter.createCaller(ctx);

    // 테스트용 매장 생성
    const store = await db.createStore({
      name: '테스트 매장 (사용완료)',
      category: '카페',
      address: '서울시 테스트구',
      latitude: '37.5665',
      longitude: '126.9780',
      ownerId: testUserId,
    });
    testStoreId = store.id;

    // 테스트용 쿠폰 생성
    const couponResult = await db.createCoupon({
      storeId: testStoreId,
      title: '테스트 쿠폰 (사용완료)',
      description: '사용 완료 테스트용 쿠폰',
      discountType: 'percentage',
      discountValue: 10,
      totalQuantity: 10,
      remainingQuantity: 10,
      startDate: new Date(),
      endDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    });
    // 생성된 쿠폰 ID 가져오기
    const createdCoupons = await db.getCouponsByStoreId(testStoreId);
    const createdCoupon = createdCoupons[0];
    if (!createdCoupon) throw new Error('쿠폰 생성 실패');
    testCouponId = createdCoupon.id;

    // 쿠폰 다운로드
    const downloadResult = await caller.coupons.download({
      couponId: testCouponId,
      deviceId: 'test-device-markused',
    });
    expect(downloadResult.success).toBe(true);

    // 다운로드한 쿠폰 ID 가져오기
    const userCoupons = await db.getUserCoupons(testUserId);
    const downloadedCoupon = userCoupons.find(c => c.couponId === testCouponId);
    expect(downloadedCoupon).toBeDefined();
    testUserCouponId = downloadedCoupon!.id;
  });

  it('사용자가 쿠폰을 사용 완료할 수 있어야 함', async () => {
    const result = await caller.coupons.markAsUsed({
      userCouponId: testUserCouponId,
    });

    expect(result.success).toBe(true);

    // 쿠폰 상태 확인
    const userCoupon = await db.getUserCouponById(testUserCouponId);
    expect(userCoupon).toBeDefined();
    expect(userCoupon!.status).toBe('used');
    expect(userCoupon!.usedAt).toBeDefined();
  });

  it('이미 사용된 쿠폰은 다시 사용할 수 없어야 함', async () => {
    await expect(
      caller.coupons.markAsUsed({
        userCouponId: testUserCouponId,
      })
    ).rejects.toThrow('이미 사용된 쿠폰입니다');
  });

  it('다른 사용자의 쿠폰은 사용할 수 없어야 함', async () => {
    // 다른 사용자 생성
    const otherOpenId = 'test-user-other-' + Date.now();
    await db.upsertUser({
      openId: otherOpenId,
      name: '다른 사용자',
      email: 'test-other@example.com',
    });
    
    const otherUser = await db.getUserByOpenId(otherOpenId);
    if (!otherUser) throw new Error('사용자 생성 실패');

    const otherCtx: TrpcContext = {
      user: {
        id: otherUser.id,
        openId: otherUser.openId,
        name: otherUser.name!,
        email: otherUser.email!,
        loginMethod: 'manus',
        role: 'user',
        createdAt: new Date(),
        updatedAt: new Date(),
        lastSignedIn: new Date(),
      },
      req: {} as any,
      res: {} as any,
    };
    const otherCaller = appRouter.createCaller(otherCtx);

    // 새 쿠폰 다운로드 (원래 사용자)
    const downloadResult = await caller.coupons.download({
      couponId: testCouponId,
      deviceId: 'test-device-other',
    });
    expect(downloadResult.success).toBe(true);

    const userCoupons = await db.getUserCoupons(testUserId);
    const newUserCoupon = userCoupons.find(
      c => c.couponId === testCouponId && c.status === 'active'
    );
    expect(newUserCoupon).toBeDefined();

    // 다른 사용자가 사용 시도
    await expect(
      otherCaller.coupons.markAsUsed({
        userCouponId: newUserCoupon!.id,
      })
    ).rejects.toThrow('권한이 없습니다');
  });
});
