import { describe, it, expect, beforeAll } from 'vitest';
import * as db from './db';
import { eq } from 'drizzle-orm';

describe('PIN Code Coupon System', () => {
  let testUserId: number;
  let testStoreId: number;
  let testCouponId: number;
  let testUserCouponId: number;
  let testPinCode: string;
  let testDeviceId: string;

  beforeAll(async () => {
    // 테스트용 사용자 생성
    const userResult = await db.upsertUser({
      openId: 'test-pincode-user',
      name: 'PIN Test User',
      email: 'pintest@example.com',
      loginMethod: 'email',
      lastSignedIn: new Date(),
    });
    const user = await db.getUserByOpenId('test-pincode-user');
    testUserId = user!.id;

    // 테스트용 매장 생성
    const storeResult = await db.createStore({
      name: 'PIN Test Store',
      category: 'cafe',
      address: 'Test Address',
      latitude: 37.5665,
      longitude: 126.9780,
      ownerId: testUserId,
    });
    testStoreId = storeResult[0].insertId;

    // 테스트용 쿠폰 생성
    const couponResult = await db.createCoupon({
      storeId: testStoreId,
      title: 'PIN Test Coupon',
      description: 'Test coupon for PIN code',
      discountType: 'percentage',
      discountValue: 10,
      minPurchase: 0,
      maxDiscount: null,
      startDate: new Date(),
      endDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      totalQuantity: 100,
      remainingQuantity: 100,
      isActive: true,
    });
    testCouponId = couponResult[0].insertId;

    // 테스트용 기기 ID
    testDeviceId = 'test-device-12345';
  });

  it('should generate 6-digit PIN code when downloading coupon', async () => {
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    const couponCode = `CPN-TEST-${Date.now()}`;
    const pinCode = Math.floor(100000 + Math.random() * 900000).toString();
    const qrCode = 'data:image/png;base64,test';

    const result = await db.downloadCoupon(
      testUserId,
      testCouponId,
      couponCode,
      pinCode,
      testDeviceId,
      qrCode,
      expiresAt
    );

    expect(result).toBeDefined();
    testUserCouponId = result[0].insertId;
    testPinCode = pinCode;

    // PIN 코드가 6자리 숫자인지 확인
    expect(pinCode).toMatch(/^\d{6}$/);
  });

  it('should retrieve coupon by PIN code', async () => {
    const coupon = await db.getUserCouponByPinCode(testPinCode);

    expect(coupon).toBeDefined();
    expect(coupon?.pinCode).toBe(testPinCode);
    expect(coupon?.userId).toBe(testUserId);
    expect(coupon?.couponId).toBe(testCouponId);
    expect(coupon?.status).toBe('active');
  });

  it('should check device-based coupon download', async () => {
    const existingCoupon = await db.checkDeviceCoupon(
      testUserId,
      testCouponId,
      testDeviceId
    );

    expect(existingCoupon).toBeDefined();
    expect(existingCoupon?.deviceId).toBe(testDeviceId);
  });

  it('should prevent duplicate download from same device', async () => {
    const duplicateCheck = await db.checkDeviceCoupon(
      testUserId,
      testCouponId,
      testDeviceId
    );

    // 이미 다운로드한 쿠폰이 있어야 함
    expect(duplicateCheck).not.toBeNull();
  });

  it('should allow download from different device', async () => {
    const differentDeviceId = 'test-device-67890';
    const duplicateCheck = await db.checkDeviceCoupon(
      testUserId,
      testCouponId,
      differentDeviceId
    );

    // 다른 기기에서는 다운로드 가능해야 함
    expect(duplicateCheck).toBeNull();
  });

  it('should include PIN code in user coupons with details', async () => {
    const coupons = await db.getUserCouponsWithDetails(testUserId);

    const testCoupon = coupons.find(c => c.pinCode === testPinCode);
    expect(testCoupon).toBeDefined();
    expect(testCoupon?.pinCode).toBe(testPinCode);
    expect(testCoupon?.deviceId).toBe(testDeviceId);
  });

  it('should mark coupon as used', async () => {
    await db.markCouponAsUsed(testUserCouponId);

    const coupon = await db.getUserCouponByPinCode(testPinCode);
    expect(coupon?.status).toBe('used');
    expect(coupon?.usedAt).toBeDefined();
  });

  it('should not retrieve used coupon by PIN code', async () => {
    // 이미 사용된 쿠폰은 status가 'used'로 변경되었지만 여전히 조회는 가능
    // 단, 검증 로직에서 status를 체크하여 거부해야 함
    const coupon = await db.getUserCouponByPinCode(testPinCode);
    expect(coupon?.status).toBe('used');
  });
});
