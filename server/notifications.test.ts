import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { appRouter } from './routers';
import * as db from './db';

describe('Notifications API', () => {
  let testUserId: number;
  let testStoreId: number;
  let testCouponId: number;

  beforeAll(async () => {
    // 테스트용 사용자 생성
    const db_connection = await db.getDb();
    if (!db_connection) throw new Error('Database connection failed');

    const [userResult] = await db_connection.execute(
      `INSERT INTO users (openId, name, email, role) VALUES ('test-notification-user', 'Test User', 'test@example.com', 'user')`
    ) as any;
    testUserId = userResult.insertId;

    // 테스트용 가게 생성
    const [storeResult] = await db_connection.execute(
      `INSERT INTO stores (ownerId, name, category, address, latitude, longitude) 
       VALUES (${testUserId}, 'Test Store', 'cafe', 'Test Address', '37.5665', '126.9780')`
    ) as any;
    testStoreId = storeResult.insertId;

    // 테스트용 쿠폰 생성 (24시간 이내)
    const now = new Date();
    const endDate = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000); // 7일 후
    const [couponResult] = await db_connection.execute(
      `INSERT INTO coupons (storeId, title, description, discountType, discountValue, totalQuantity, remainingQuantity, startDate, endDate, isActive, createdAt) 
       VALUES (${testStoreId}, 'Test Coupon', 'Test Description', 'percentage', 10, 100, 100, NOW(), '${endDate.toISOString().slice(0, 19).replace('T', ' ')}', 1, NOW())`
    ) as any;
    testCouponId = couponResult.insertId;
  });

  afterAll(async () => {
    // 테스트 데이터 정리
    const db_connection = await db.getDb();
    if (!db_connection) return;

    await db_connection.execute(`DELETE FROM coupons WHERE id = ${testCouponId}`);
    await db_connection.execute(`DELETE FROM stores WHERE id = ${testStoreId}`);
    await db_connection.execute(`DELETE FROM users WHERE id = ${testUserId}`);
  });

  it('should return unread notification count for new coupons', async () => {
    const caller = appRouter.createCaller({
      user: {
        id: testUserId,
        openId: 'test-notification-user',
        name: 'Test User',
        email: 'test@example.com',
        role: 'user',
        createdAt: new Date(),
        updatedAt: new Date(),
        lastSignedIn: new Date(),
      },
      req: {} as any,
      res: {} as any,
    });

    const count = await caller.notifications.getUnreadCount();
    
    // 24시간 이내에 생성된 쿠폰이 있으므로 count > 0
    expect(count).toBeGreaterThanOrEqual(1);
  });

  it('should mark notifications as read', async () => {
    const caller = appRouter.createCaller({
      user: {
        id: testUserId,
        openId: 'test-notification-user',
        name: 'Test User',
        email: 'test@example.com',
        role: 'user',
        createdAt: new Date(),
        updatedAt: new Date(),
        lastSignedIn: new Date(),
      },
      req: {} as any,
      res: {} as any,
    });

    const result = await caller.notifications.markAsRead();
    
    expect(result.success).toBe(true);
  });

  it('should return 0 for old coupons (created more than 24 hours ago)', async () => {
    const db_connection = await db.getDb();
    if (!db_connection) throw new Error('Database connection failed');

    // 쿠폰 생성 시간을 25시간 전으로 변경
    await db_connection.execute(
      `UPDATE coupons SET createdAt = DATE_SUB(NOW(), INTERVAL 25 HOUR) WHERE id = ${testCouponId}`
    );

    const caller = appRouter.createCaller({
      user: {
        id: testUserId,
        openId: 'test-notification-user',
        name: 'Test User',
        email: 'test@example.com',
        role: 'user',
        createdAt: new Date(),
        updatedAt: new Date(),
        lastSignedIn: new Date(),
      },
      req: {} as any,
      res: {} as any,
    });

    const count = await caller.notifications.getUnreadCount();
    
    // 24시간 이상 지난 쿠폰은 카운트되지 않음
    expect(count).toBe(0);

    // 원래대로 복구
    await db_connection.execute(
      `UPDATE coupons SET createdAt = NOW() WHERE id = ${testCouponId}`
    );
  });
});
