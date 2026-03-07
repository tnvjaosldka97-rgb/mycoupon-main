import { eq, desc, and, sql, like, ne, gte, lte, gt, isNotNull, isNull } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import pkg from "pg";
const { Pool } = pkg;
import { 
  InsertUser, 
  users, 
  stores, 
  InsertStore, 
  Store,
  reviews,
  InsertReview,
  Review,
  visits,
  InsertVisit,
  Visit,
  searchLogs,
  InsertSearchLog,
  adTransactions,
  InsertAdTransaction,
  coupons,
  Coupon,
  InsertCoupon,
  userCoupons,
  UserCoupon,
  InsertUserCoupon,
  couponUsage,
  CouponUsage,
  InsertCouponUsage,
  userStats,
  UserStats,
  InsertUserStats,
  badges,
  Badge,
  InsertBadge,
  userBadges,
  UserBadge,
  InsertUserBadge,
  checkIns,
  CheckIn,
  InsertCheckIn,
  favorites,
  Favorite,
  InsertFavorite,
  missions,
  Mission,
  InsertMission,
  userMissions,
  UserMission,
  InsertUserMission,
  pointTransactions,
  PointTransaction,
  InsertPointTransaction,
  notifications,
  Notification,
  InsertNotification,
  sessionLogs,
  SessionLog,
  InsertSessionLog,
  featureFlags,
  FeatureFlag,
  InsertFeatureFlag,
  adminAuditLogs,
} from "../drizzle/schema";
import { ENV } from './_core/env';

let _db: ReturnType<typeof drizzle> | null = null;

export async function getDb() {
  if (!_db && process.env.DATABASE_URL) {
    const dbConnectStart = Date.now();
    console.log('[Cold Start Measurement] DB connection pool creation started');
    try {
      // PostgreSQL 연결 풀 설정
      const pool = new Pool({
        connectionString: process.env.DATABASE_URL,
        max: 10, // 최대 연결 수
        idleTimeoutMillis: 30000, // 30초 유휴 타임아웃
        connectionTimeoutMillis: 5000, // 5초 연결 타임아웃
      });
      _db = drizzle(pool);
      const dbConnectTime = Date.now() - dbConnectStart;
      console.log(`[Cold Start Measurement] DB connection pool created in ${dbConnectTime}ms`);
    } catch (error) {
      const dbConnectTime = Date.now() - dbConnectStart;
      console.error(`[Cold Start Measurement] DB connection failed after ${dbConnectTime}ms:`, error);
      console.warn("[Database] Failed to connect:", error);
      _db = null;
    }
  }
  return _db;
}

export async function upsertUser(user: InsertUser): Promise<void> {
  if (!user.openId) {
    throw new Error("User openId is required for upsert");
  }

  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot upsert user: database not available");
    return;
  }

  try {
    const values: InsertUser = {
      openId: user.openId,
    };
    const updateSet: Record<string, unknown> = {};

    const textFields = ["name", "email", "loginMethod"] as const;
    type TextField = (typeof textFields)[number];

    const assignNullable = (field: TextField) => {
      const value = user[field];
      if (value === undefined) return;
      const normalized = value ?? null;
      values[field] = normalized;
      updateSet[field] = normalized;
    };

    textFields.forEach(assignNullable);

    if (user.lastSignedIn !== undefined) {
      values.lastSignedIn = user.lastSignedIn;
      updateSet.lastSignedIn = user.lastSignedIn;
    }
    if (user.role !== undefined) {
      values.role = user.role;
      updateSet.role = user.role;
    }
    // NOTE: ENV.ownerOpenId 기반 자동 admin 부여 제거
    // admin 권한은 context.ts의 SUPER_ADMIN_EMAIL 이메일 체크에서만 부여됨

    if (!values.lastSignedIn) {
      values.lastSignedIn = new Date();
    }

    if (Object.keys(updateSet).length === 0) {
      updateSet.lastSignedIn = new Date();
    }

    await db.insert(users).values(values).onConflictDoUpdate({
      target: users.openId,
      set: updateSet,
    });
  } catch (error) {
    console.error("[Database] Failed to upsert user:", error);
    throw error;
  }
}

export async function getUserByOpenId(openId: string) {
  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot get user: database not available");
    return undefined;
  }

  const result = await db.select().from(users).where(eq(users.openId, openId)).limit(1);

  return result.length > 0 ? result[0] : undefined;
}

export async function getUserById(userId: number) {
  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot get user: database not available");
    return undefined;
  }

  const result = await db.select().from(users).where(eq(users.id, userId)).limit(1);

  return result.length > 0 ? result[0] : undefined;
}

export async function updateUser(userId: number, updates: Partial<InsertUser>) {
  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot update user: database not available");
    return;
  }

  try {
    await db.update(users).set(updates).where(eq(users.id, userId));
  } catch (error) {
    console.error("[Database] Failed to update user:", error);
    throw error;
  }
}

// ============ Store Functions ============

export async function createStore(store: InsertStore) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const result = await db.insert(stores).values(store);
  return result;
}

export async function getStoreById(id: number) {
  const db = await getDb();
  if (!db) return undefined;

  const result = await db.select().from(stores).where(eq(stores.id, id)).limit(1);
  return result.length > 0 ? result[0] : undefined;
}

export async function getStoresByOwnerId(ownerId: number) {
  const db = await getDb();
  if (!db) return [];

  // deleted_at IS NULL: soft-deleted 제외 (deletedAt 컬럼이 없는 이전 배포와도 호환)
  return await db.select().from(stores).where(
    and(eq(stores.ownerId, ownerId), sql`(deleted_at IS NULL)`)
  );
}

/** 사장님 soft delete: deleted_at + deleted_by 세팅 */
export async function softDeleteStore(storeId: number, deletedByUserId: number) {
  const db = await getDb();
  if (!db) throw new Error('Database not available');

  return await db.update(stores).set({
    deletedAt: new Date(),
    deletedBy: deletedByUserId,
    updatedAt: new Date(),
  } as any).where(eq(stores.id, storeId));
}

/** 사장님 동의 완료 저장 + role 승급 */
export async function completeUserSignup(userId: number, marketingAgreed: boolean) {
  const dbInstance = await getDb();
  if (!dbInstance) throw new Error('Database not available');

  const now = new Date();
  const trialEndsAt = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000); // 7일 후

  // 1. 동의 완료 필드 업데이트
  await dbInstance.update(users).set({
    signupCompletedAt: now,
    termsAgreedAt: now,
    marketingAgreed,
    marketingAgreedAt: marketingAgreed ? now : null,
    trialEndsAt,
    updatedAt: now,
  } as any).where(eq(users.id, userId));

  // 2. role 'user' → 'merchant' 승급 (admin/merchant는 유지)
  // 계급 관리 목록에 노출되고 merchant 대시보드 접근 가능해지기 위해 필요
  await dbInstance.execute(
    sql`UPDATE users SET role = 'merchant' WHERE id = ${userId} AND role = 'user'`
  );
}

export async function searchStores(query: string, category?: "cafe" | "restaurant" | "beauty" | "hospital" | "fitness" | "other") {
  const db = await getDb();
  if (!db) return [];

  let conditions = and(
    eq(stores.isActive, true),
    like(stores.name, `%${query}%`)
  );

  if (category) {
    conditions = and(conditions, eq(stores.category, category));
  }

  return await db.select().from(stores).where(conditions).limit(50);
}

export async function getAllStores(limit: number = 50) {
  const db = await getDb();
  if (!db) return [];

  return await db
    .select()
    .from(stores)
    .where(
      and(
        eq(stores.isActive, true),
        // soft-delete 제외 (deleted_at IS NULL)
        sql`(${stores.deletedAt} IS NULL)`
      )
    )
    .limit(limit);
}

/**
 * 공개 지도 전용 가게 조회 (엄격 필터)
 * 조건: approved(approvedBy IS NOT NULL) + not deleted + has coordinates
 * pending/rejected/deleted 절대 미포함
 */
export async function getPublicMapStores(limit: number = 100) {
  const db = await getDb();
  if (!db) return [];

  return await db
    .select()
    .from(stores)
    .where(
      and(
        eq(stores.isActive, true),
        isNotNull(stores.approvedBy),         // 승인 완료 필수
        sql`(${stores.deletedAt} IS NULL)`,   // soft-delete 제외
        isNotNull(stores.latitude),            // 좌표 필수
        isNotNull(stores.longitude),
      )
    )
    .orderBy(desc(stores.createdAt))
    .limit(limit);
}

/**
 * 관리자용 가게 목록:
 *   - soft-deleted(deletedAt IS NOT NULL) 제외
 *   - 승인 대기(approvedBy IS NULL, isActive=true) 포함
 *   - 거부(isActive=false, approvedBy IS NULL) 포함
 *   - 승인됨(approvedBy IS NOT NULL, isActive=true) 포함
 *   - 하드삭제/soft-delete만 제외
 */
export async function getAllStoresForAdmin(limit: number = 100) {
  const db = await getDb();
  if (!db) return [];

  return await db
    .select()
    .from(stores)
    .where(sql`(${stores.deletedAt} IS NULL)`)  // soft-deleted 제외
    .orderBy(desc(stores.createdAt))
    .limit(limit);
}

/**
 * 가게 삭제 시 연관 쿠폰 일괄 비활성화
 * @returns 비활성화된 쿠폰 수
 */
export async function deactivateCouponsByStoreId(storeId: number): Promise<number> {
  const db = await getDb();
  if (!db) return 0;

  const result = await db.execute(
    sql`UPDATE coupons SET is_active = FALSE, updated_at = NOW()
        WHERE store_id = ${storeId} AND is_active = TRUE`
  );
  return (result as any)?.rowCount ?? 0;
}

export async function updateStore(id: number, data: Partial<InsertStore>) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  return await db.update(stores).set(data).where(eq(stores.id, id));
}

export async function deleteStore(id: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  return await db.delete(stores).where(eq(stores.id, id));
}

// ============ Review Functions ============

export async function createReview(review: InsertReview) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  return await db.insert(reviews).values(review);
}

export async function getReviewsByStoreId(storeId: number) {
  const db = await getDb();
  if (!db) return [];

  return await db
    .select({
      id: reviews.id,
      storeId: reviews.storeId,
      userId: reviews.userId,
      userCouponId: reviews.userCouponId,
      rating: reviews.rating,
      content: reviews.content,
      imageUrls: reviews.imageUrls,
      createdAt: reviews.createdAt,
      updatedAt: reviews.updatedAt,
      userName: users.name,
    })
    .from(reviews)
    .leftJoin(users, eq(reviews.userId, users.id))
    .where(eq(reviews.storeId, storeId))
    .orderBy(desc(reviews.createdAt));
}

export async function getReviewsByUserId(userId: number) {
  const db = await getDb();
  if (!db) return [];

  return await db
    .select()
    .from(reviews)
    .where(eq(reviews.userId, userId))
    .orderBy(desc(reviews.createdAt));
}

// ============ Visit Functions ============

export async function createVisit(visit: InsertVisit) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  return await db.insert(visits).values(visit);
}

export async function getVisitsByStoreId(storeId: number) {
  const db = await getDb();
  if (!db) return [];

  return await db
    .select()
    .from(visits)
    .where(eq(visits.storeId, storeId))
    .orderBy(desc(visits.visitedAt));
}

export async function getVisitsByUserId(userId: number) {
  const db = await getDb();
  if (!db) return [];

  return await db
    .select()
    .from(visits)
    .where(eq(visits.userId, userId))
    .orderBy(desc(visits.visitedAt));
}

export async function getVisitCountByStoreId(storeId: number) {
  const db = await getDb();
  if (!db) return 0;

  const result = await db
    .select({ count: sql<number>`count(*)` })
    .from(visits)
    .where(eq(visits.storeId, storeId));

  return result[0]?.count || 0;
}

// ============ Search Log Functions ============

export async function createSearchLog(log: InsertSearchLog) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  return await db.insert(searchLogs).values(log);
}

// ============ Ad Transaction Functions ============

export async function createAdTransaction(transaction: InsertAdTransaction) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  return await db.insert(adTransactions).values(transaction);
}

export async function getAdTransactionsByStoreId(storeId: number) {
  const db = await getDb();
  if (!db) return [];

  return await db
    .select()
    .from(adTransactions)
    .where(eq(adTransactions.storeId, storeId))
    .orderBy(desc(adTransactions.createdAt));
}

export async function getTotalAdCostByStoreId(storeId: number) {
  const db = await getDb();
  if (!db) return 0;

  const result = await db
    .select({ total: sql<number>`sum(amount)` })
    .from(adTransactions)
    .where(and(
      eq(adTransactions.storeId, storeId),
      eq(adTransactions.status, "paid")
    ));

  return result[0]?.total || 0;
}

// ============ Coupon Functions ============

export async function createCoupon(coupon: InsertCoupon) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const result = await db.insert(coupons).values(coupon).returning({ id: coupons.id });
  // 삽입된 쿠폰 ID 반환
  return { id: result[0].id };
}

// ────────────────────────────────────────────────────────────
// 공통 쿠폰 필터 (중복 작성 방지)
// ────────────────────────────────────────────────────────────

/**
 * 공개 API(지도/목록)용 활성 쿠폰 조건:
 *   isActive=true + approvedBy IS NOT NULL + endDate > now + remainingQuantity > 0
 * 미승인/만료/소진 쿠폰이 공개 노출되지 않도록 DB 레벨에서 차단.
 */
export function buildPublicCouponFilter(now = new Date()) {
  return and(
    eq(coupons.isActive, true),
    isNotNull(coupons.approvedBy),
    sql`${coupons.endDate} > ${now}`,
    sql`${coupons.remainingQuantity} > 0`
  );
}

/**
 * 가게별 공개 쿠폰 조건 (stores.list / listByStore):
 *   storeId 기준 + 공개 조건 공통 적용
 */
export function buildStoreCouponFilter(storeId: number, now = new Date()) {
  return and(
    eq(coupons.storeId, storeId),
    eq(coupons.isActive, true),
    isNotNull(coupons.approvedBy),
    sql`${coupons.endDate} > ${now}`
  );
}

export async function getCouponsByStoreId(storeId: number) {
  const db = await getDb();
  if (!db) return [];

  // 공개 조건 중앙화: isActive + approvedBy IS NOT NULL + endDate > now
  return await db
    .select()
    .from(coupons)
    .where(buildStoreCouponFilter(storeId))
    .orderBy(desc(coupons.createdAt));
}

export async function getCouponById(id: number) {
  const db = await getDb();
  if (!db) return null;

  const result = await db
    .select()
    .from(coupons)
    .where(eq(coupons.id, id))
    .limit(1);

  return result[0] || null;
}

export async function getActiveCoupons() {
  const db = await getDb();
  if (!db) return [];

  // buildPublicCouponFilter 사용: approvedBy IS NOT NULL 포함 (미승인 쿠폰 공개 차단)
  return await db
    .select()
    .from(coupons)
    .where(buildPublicCouponFilter())
    .orderBy(desc(coupons.createdAt));
}

/**
 * 관리자용 쿠폰 전체 조회 — 승인대기(approvedBy IS NULL) 포함, 거부(isActive=false) 제외
 * ※ buildPublicCouponFilter 사용 금지: admin은 미승인 쿠폰도 검토해야 함
 */
export async function getAllCouponsForAdmin(limit: number = 100) {
  const db = await getDb();
  if (!db) return [];

  return await db
    .select()
    .from(coupons)
    .where(eq(coupons.isActive, true))  // isActive=false(거부)만 제외
    .orderBy(desc(coupons.createdAt))
    .limit(limit);
}

export async function updateCouponQuantity(couponId: number, quantity: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  return await db
    .update(coupons)
    .set({ remainingQuantity: quantity })
    .where(eq(coupons.id, couponId));
}

export async function updateCoupon(id: number, data: Partial<InsertCoupon>) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  return await db.update(coupons).set(data).where(eq(coupons.id, id));
}

export async function deleteCoupon(id: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  return await db.delete(coupons).where(eq(coupons.id, id));
}

// ============ User Coupon Functions ============

/**
 * 🔒 트랜잭션 + Row Lock으로 쿠폰 다운로드 (Race Condition 방지)
 * 100만 유저가 동시에 선착순 쿠폰을 클릭해도 정확히 제한 수량만 발급
 */
export async function downloadCoupon(userId: number, couponId: number, couponCode: string, pinCode: string, deviceId: string | null, qrCode: string, expiresAt: Date) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  // 🔒 트랜잭션 시작 (Atomic Operation)
  return await db.transaction(async (tx) => {
    // 1. 쿠폰 조회 + Row Lock (다른 트랜잭션 대기)
    const [coupon] = await tx
      .select()
      .from(coupons)
      .where(eq(coupons.id, couponId))
      .for('update') // ✅ SELECT FOR UPDATE (PostgreSQL Row-Level Lock)
      .limit(1);
    
    if (!coupon) {
      throw new Error("쿠폰을 찾을 수 없습니다");
    }
    
    // 2. 수량 확인
    if (coupon.remainingQuantity <= 0) {
      throw new Error("쿠폰이 모두 소진되었습니다");
    }
    
    // 3. 활성 쿠폰 확인
    if (!coupon.isActive) {
      throw new Error("비활성화된 쿠폰입니다");
    }
    
    // 4. 기간 확인
    const now = new Date();
    if (now < new Date(coupon.startDate) || now > new Date(coupon.endDate)) {
      throw new Error("쿠폰 사용 기간이 아닙니다");
    }
    
    // 5. 쿠폰 발급
    const [userCoupon] = await tx.insert(userCoupons).values({
      userId,
      couponId,
      couponCode,
      pinCode,
      deviceId,
      qrCode,
      expiresAt,
      status: "active"
    }).returning();
    
    // 6. 수량 차감 (Atomic Decrement)
    await tx
      .update(coupons)
      .set({ 
        remainingQuantity: sql`${coupons.remainingQuantity} - 1`,
        updatedAt: new Date()
      })
      .where(eq(coupons.id, couponId));
    
    console.log(`✅ [Transaction] Coupon ${couponId} downloaded by user ${userId}, remaining: ${coupon.remainingQuantity - 1}`);
    
    return userCoupon;
  }, {
    // 트랜잭션 격리 레벨 (PostgreSQL 기본값: READ COMMITTED)
    isolationLevel: 'read committed',
  });
}

export async function getUserCoupons(userId: number) {
  const db = await getDb();
  if (!db) return [];

  return await db
    .select()
    .from(userCoupons)
    .where(eq(userCoupons.userId, userId))
    .orderBy(desc(userCoupons.downloadedAt));
}

export async function getUserCouponsWithDetails(userId: number) {
  const db = await getDb();
  if (!db) return [];

  return await db
    .select({
      id: userCoupons.id,
      userId: userCoupons.userId,
      couponId: userCoupons.couponId,
      couponCode: userCoupons.couponCode,
      pinCode: userCoupons.pinCode,
      deviceId: userCoupons.deviceId,
      qrCode: userCoupons.qrCode,
      status: userCoupons.status,
      downloadedAt: userCoupons.downloadedAt,
      usedAt: userCoupons.usedAt,
      expiresAt: userCoupons.expiresAt,
      // 쿠폰 정보
      title: coupons.title,
      description: coupons.description,
      discountType: coupons.discountType,
      discountValue: coupons.discountValue,
      // 매장 정보
      storeName: stores.name,
      storeCategory: stores.category,
    })
    .from(userCoupons)
    .leftJoin(coupons, eq(userCoupons.couponId, coupons.id))
    .leftJoin(stores, eq(coupons.storeId, stores.id))
    .where(eq(userCoupons.userId, userId))
    .orderBy(desc(userCoupons.downloadedAt));
}

export async function getUserCouponByCode(couponCode: string) {
  const db = await getDb();
  if (!db) return null;

  const result = await db
    .select()
    .from(userCoupons)
    .where(eq(userCoupons.couponCode, couponCode))
    .limit(1);

  return result[0] || null;
}

export async function getUserCouponByPinCode(pinCode: string) {
  const db = await getDb();
  if (!db) return null;

  const result = await db
    .select()
    .from(userCoupons)
    .where(eq(userCoupons.pinCode, pinCode))
    .limit(1);

  return result[0] || null;
}

export async function getUserCouponById(id: number) {
  const db = await getDb();
  if (!db) return null;

  const result = await db
    .select()
    .from(userCoupons)
    .where(eq(userCoupons.id, id))
    .limit(1);

  return result[0] || null;
}

export async function markUserCouponAsUsed(id: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  return await db
    .update(userCoupons)
    .set({
      status: "used",
      usedAt: new Date(),
    })
    .where(eq(userCoupons.id, id));
}

/**
 * userId + couponId 기준 중복 다운로드 체크 (deviceId 무관)
 * - deviceId를 안 보낸 클라이언트도 같은 쿠폰 무한 다운 방지
 * - 활성(not-used, expiresAt > now) user_coupon 존재 시 차단
 */
export async function checkUserCoupon(userId: number, couponId: number) {
  const db = await getDb();
  if (!db) return null;

  const now = new Date();
  const result = await db
    .select({ id: userCoupons.id, status: userCoupons.status, expiresAt: userCoupons.expiresAt })
    .from(userCoupons)
    .where(
      and(
        eq(userCoupons.userId, userId),
        eq(userCoupons.couponId, couponId),
        ne(userCoupons.status, 'used'),
        gt(userCoupons.expiresAt, now)
      )
    )
    .limit(1);

  const found = result[0] || null;
  console.log(`[checkUserCoupon] userId=${userId} couponId=${couponId} → ${found ? `BLOCK (row=${found.id})` : 'PASS'}`);
  return found;
}

export async function checkDeviceCoupon(userId: number, couponId: number, deviceId: string) {
  const db = await getDb();
  if (!db) return null;

  const now = new Date();

  // 중복 차단 조건:
  //   1) 같은 userId + couponId + deviceId
  //   2) status != 'used'   (사용 완료된 건 재다운로드 허용)
  //   3) expiresAt > NOW()  (이미 만료된 user_coupon row는 재다운로드 허용)
  //      → 만료된 row를 기준으로 차단하면 쿠폰 연장/재오픈 시 오탐 발생
  const result = await db
    .select({
      id: userCoupons.id,
      status: userCoupons.status,
      expiresAt: userCoupons.expiresAt,
      downloadedAt: userCoupons.downloadedAt,
    })
    .from(userCoupons)
    .where(
      and(
        eq(userCoupons.userId, userId),
        eq(userCoupons.couponId, couponId),
        eq(userCoupons.deviceId, deviceId),
        ne(userCoupons.status, 'used'),   // 사용 완료 제외
        gt(userCoupons.expiresAt, now)    // 만료된 user_coupon 제외 (핵심 버그 수정)
      )
    )
    .limit(1);

  const found = result[0] || null;
  console.log(`[checkDeviceCoupon] userId=${userId} couponId=${couponId} deviceKey=${deviceId.substring(0,8)}*** → ${found ? `BLOCK (row=${found.id}, status=${found.status}, exp=${found.expiresAt?.toISOString()})` : 'PASS'}`);
  return found;
}

// 48시간 이내 동일 업장 쿠폰 사용 이력 확인
export async function checkRecentStoreUsage(userId: number, storeId: number) {
  const db = await getDb();
  if (!db) return null;

  const fortyEightHoursAgo = new Date(Date.now() - 48 * 60 * 60 * 1000);

  const result = await db
    .select({
      usedAt: userCoupons.usedAt,
    })
    .from(userCoupons)
    .leftJoin(coupons, eq(userCoupons.couponId, coupons.id))
    .where(
      and(
        eq(userCoupons.userId, userId),
        eq(coupons.storeId, storeId),
        eq(userCoupons.status, 'used'),
        sql`${userCoupons.usedAt} > ${fortyEightHoursAgo}`
      )
    )
    .orderBy(desc(userCoupons.usedAt))
    .limit(1);

  return result[0] || null;
}

export async function markCouponAsUsed(userCouponId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  return await db
    .update(userCoupons)
    .set({ 
      status: "used",
      usedAt: new Date()
    })
    .where(eq(userCoupons.id, userCouponId));
}

// ============ Coupon Usage Functions ============

export async function createCouponUsage(usage: InsertCouponUsage) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  return await db.insert(couponUsage).values(usage);
}

export async function getCouponUsageByStoreId(storeId: number) {
  const db = await getDb();
  if (!db) return [];

  return await db
    .select()
    .from(couponUsage)
    .where(eq(couponUsage.storeId, storeId))
    .orderBy(desc(couponUsage.usedAt));
}

export async function getTotalCouponUsageByStoreId(storeId: number) {
  const db = await getDb();
  if (!db) return 0;

  const result = await db
    .select({ count: sql<number>`count(*)` })
    .from(couponUsage)
    .where(eq(couponUsage.storeId, storeId));

  return result[0]?.count || 0;
}

// ============ User Stats Functions ============

export async function getUserStats(userId: number) {
  const db = await getDb();
  if (!db) return null;

  const result = await db
    .select()
    .from(userStats)
    .where(eq(userStats.userId, userId))
    .limit(1);

  return result[0] || null;
}

export async function createUserStats(userId: number, referralCode: string) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  return await db.insert(userStats).values({
    userId,
    referralCode,
    points: 0,
    level: 1,
    totalCouponsDownloaded: 0,
    totalCouponsUsed: 0,
    consecutiveCheckIns: 0,
    totalCheckIns: 0,
    totalReferrals: 0
  });
}

export async function updateUserStats(userId: number, updates: Partial<InsertUserStats>) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  return await db
    .update(userStats)
    .set(updates)
    .where(eq(userStats.userId, userId));
}

export async function incrementCouponDownload(userId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  return await db
    .update(userStats)
    .set({ 
      totalCouponsDownloaded: sql`${userStats.totalCouponsDownloaded} + 1`
    })
    .where(eq(userStats.userId, userId));
}

export async function incrementCouponUsage(userId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  return await db
    .update(userStats)
    .set({ 
      totalCouponsUsed: sql`${userStats.totalCouponsUsed} + 1`,
      points: sql`${userStats.points} + 10` // 쿠폰 사용 시 10 포인트
    })
    .where(eq(userStats.userId, userId));
}

// ============ Badge Functions ============

export async function getAllBadges() {
  const db = await getDb();
  if (!db) return [];

  return await db.select().from(badges);
}

export async function getUserBadges(userId: number) {
  const db = await getDb();
  if (!db) return [];

  return await db
    .select()
    .from(userBadges)
    .where(eq(userBadges.userId, userId))
    .orderBy(desc(userBadges.earnedAt));
}

export async function awardBadge(userId: number, badgeId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  return await db.insert(userBadges).values({
    userId,
    badgeId
  });
}

// ============ Check-in Functions ============

export async function createCheckIn(userId: number, points: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  return await db.insert(checkIns).values({
    userId,
    checkInDate: new Date(),
    points
  });
}

export async function getCheckInsByUserId(userId: number) {
  const db = await getDb();
  if (!db) return [];

  return await db
    .select()
    .from(checkIns)
    .where(eq(checkIns.userId, userId))
    .orderBy(desc(checkIns.checkInDate));
}

export async function getTodayCheckIn(userId: number) {
  const db = await getDb();
  if (!db) return null;

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const result = await db
    .select()
    .from(checkIns)
    .where(and(
      eq(checkIns.userId, userId),
      sql`DATE(${checkIns.checkInDate}) = DATE(${today})`
    ))
    .limit(1);

  return result[0] || null;
}

// ============ Favorite Functions ============

export async function addFavorite(userId: number, storeId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  return await db.insert(favorites).values({
    userId,
    storeId
  });
}

export async function removeFavorite(userId: number, storeId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  return await db
    .delete(favorites)
    .where(and(
      eq(favorites.userId, userId),
      eq(favorites.storeId, storeId)
    ));
}

export async function getUserFavorites(userId: number) {
  const db = await getDb();
  if (!db) return [];

  return await db
    .select()
    .from(favorites)
    .where(eq(favorites.userId, userId))
    .orderBy(desc(favorites.createdAt));
}

export async function isFavorite(userId: number, storeId: number) {
  const db = await getDb();
  if (!db) return false;

  const result = await db
    .select()
    .from(favorites)
    .where(and(
      eq(favorites.userId, userId),
      eq(favorites.storeId, storeId)
    ))
    .limit(1);

  return result.length > 0;
}

// ============================================
// Point Transactions
// ============================================

export async function createPointTransaction(transaction: InsertPointTransaction) {
  const db = await getDb();
  if (!db) return;
  return await db.insert(pointTransactions).values(transaction);
}

export async function getPointTransactions(userId: number, limit: number = 50) {
  const db = await getDb();
  if (!db) return [];
  return await db
    .select()
    .from(pointTransactions)
    .where(eq(pointTransactions.userId, userId))
    .orderBy(desc(pointTransactions.createdAt))
    .limit(limit);
}

// ============================================
// Missions
// ============================================

export async function getAllMissions() {
  const db = await getDb();
  if (!db) return [];
  return await db
    .select()
    .from(missions)
    .where(eq(missions.isActive, true));
}

export async function getUserMissions(userId: number) {
  const db = await getDb();
  if (!db) return [];
  return await db
    .select()
    .from(userMissions)
    .where(eq(userMissions.userId, userId))
    .orderBy(desc(userMissions.createdAt));
}

export async function createUserMission(mission: InsertUserMission) {
  const db = await getDb();
  if (!db) return;
  return await db.insert(userMissions).values(mission);
}

export async function updateUserMissionProgress(userId: number, missionId: number, progress: number) {
  const db = await getDb();
  if (!db) return;
  const mission = await db
    .select()
    .from(userMissions)
    .where(and(
      eq(userMissions.userId, userId),
      eq(userMissions.missionId, missionId)
    ))
    .limit(1);

  if (mission.length === 0) return;

  const missionData = mission[0];
  
  // missions 테이블에서 requirement 가져오기
  const missionInfo = await db
    .select()
    .from(missions)
    .where(eq(missions.id, missionId))
    .limit(1);
  
  if (missionInfo.length === 0) return;
  
  const requirement = JSON.parse(missionInfo[0].requirement || '{}');
  const isCompleted = progress >= (requirement.count || 1);

  await db
    .update(userMissions)
    .set({
      progress,
      isCompleted,
      completedAt: isCompleted ? new Date() : null,
    })
    .where(and(
      eq(userMissions.userId, userId),
      eq(userMissions.missionId, missionId)
    ));

  // 미션 완료 시 포인트 지급
  if (isCompleted && !missionData.isCompleted) {
    const rewardPoints = missionInfo[0].rewardPoints;
    
    // 포인트 지급
    await createPointTransaction({
      userId,
      amount: rewardPoints,
      type: 'mission',
      description: `미션 완료: ${missionInfo[0].title}`,
      relatedId: missionId,
    });

    // 사용자 통계 업데이트
    const stats = await getUserStats(userId);
    await updateUserStats(userId, {
      points: (stats?.points || 0) + rewardPoints,
    });

    // 알림 생성
    await createNotification({
      userId,
      title: '미션 완료!',
      message: `${missionInfo[0].title} 미션을 완료하고 ${rewardPoints}P를 받았어요!`,
      type: 'mission_complete',
      relatedId: missionId,
    });
  }
}

// ============================================
// Notifications
// ============================================

export async function createNotification(notification: InsertNotification) {
  const db = await getDb();
  if (!db) return;
  return await db.insert(notifications).values(notification);
}

export async function getNotifications(userId: number, limit: number = 50) {
  const db = await getDb();
  if (!db) return [];
  return await db
    .select()
    .from(notifications)
    .where(eq(notifications.userId, userId))
    .orderBy(desc(notifications.createdAt))
    .limit(limit);
}

export async function markNotificationAsRead(id: number) {
  const db = await getDb();
  if (!db) return;
  return await db
    .update(notifications)
    .set({ isRead: true })
    .where(eq(notifications.id, id));
}

export async function getUnreadNotificationCount(userId: number) {
  const db = await getDb();
  if (!db) return 0;
  const result = await db
    .select()
    .from(notifications)
    .where(and(
      eq(notifications.userId, userId),
      eq(notifications.isRead, false)
    ));
  return result.length;
}

// ============================================
// Leaderboard
// ============================================

export async function getLeaderboard(limit: number = 10) {
  const db = await getDb();
  if (!db) return [];
  const topUsers = await db
    .select({
      userId: userStats.userId,
      points: userStats.points,
      level: userStats.level,
      totalCouponsUsed: userStats.totalCouponsUsed,
    })
    .from(userStats)
    .orderBy(desc(userStats.points))
    .limit(limit);

  // 사용자 정보 가져오기
  const leaderboard = await Promise.all(
    topUsers.map(async (stat) => {
      const user = await db
        .select({
          id: users.id,
          name: users.name,
        })
        .from(users)
        .where(eq(users.id, stat.userId))
        .limit(1);

      return {
        ...stat,
        userName: user[0]?.name || '익명',
      };
    })
  );

  return leaderboard;
}

// ============================================
// Coupon Usage Recording
// ============================================

export async function recordCouponUsage(data: {
  userCouponId: number;
  storeId: number;
  userId: number;
  verifiedBy: number;
}) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  return await db.insert(couponUsage).values({
    userCouponId: data.userCouponId,
    storeId: data.storeId,
    userId: data.userId,
    verifiedBy: data.verifiedBy,
  });
}

// ============================================
// Session Logs
// ============================================

export async function logSession(data: {
  userId?: number;
  appVersion: string;
  browser: string;
  isPwa: boolean;
  isKakaoInapp: boolean;
  userAgent?: string;
}) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  return await db.insert(sessionLogs).values({
    userId: data.userId || null,
    appVersion: data.appVersion,
    browser: data.browser,
    isPwa: data.isPwa,
    isKakaoInapp: data.isKakaoInapp,
    userAgent: data.userAgent || null,
  });
}

// ==================== 배포/운영 안정성 관련 함수 ====================

import {
  appVersions,
  AppVersion,
  InsertAppVersion,
  installFunnelEvents,
  InstallFunnelEvent,
  InsertInstallFunnelEvent,
  emergencyBanners,
  EmergencyBanner,
  InsertEmergencyBanner,
  bannerInteractions,
  BannerInteraction,
  InsertBannerInteraction,
  clientErrors,
  ClientError,
  InsertClientError,
} from "../drizzle/schema";

/**
 * 활성 앱 버전 정보 조회
 */
export async function getActiveAppVersion(): Promise<AppVersion | null> {
  const db = await getDb();
  if (!db) return null;

  const results = await db
    .select()
    .from(appVersions)
    .where(eq(appVersions.isActive, true))
    .orderBy(desc(appVersions.createdAt))
    .limit(1);

  return results[0] || null;
}

/**
 * 앱 버전 정보 생성/업데이트
 */
export async function upsertAppVersion(data: {
  version: string;
  minVersion: string;
  recommendedVersion: string;
  updateMode: "none" | "soft" | "hard";
  updateMessage?: string;
  updateUrl?: string;
}): Promise<void> {
  const db = await getDb();
  if (!db) return;

  // 기존 버전 비활성화
  await db.update(appVersions).set({ isActive: false });

  // 새 버전 추가
  await db.insert(appVersions).values({
    version: data.version,
    minVersion: data.minVersion,
    recommendedVersion: data.recommendedVersion,
    updateMode: data.updateMode,
    updateMessage: data.updateMessage || null,
    updateUrl: data.updateUrl || null,
    isActive: true,
  });
}

/**
 * 설치 퍼널 이벤트 로깅
 */
export async function logInstallFunnelEvent(data: {
  sessionId: string;
  userId?: number;
  eventType: "landing_view" | "install_cta_view" | "install_cta_click" | "appinstalled" | "first_open_standalone" | "login_complete";
  deviceType?: string;
  browserType?: string;
  osVersion?: string;
  appVersion?: string;
  referrer?: string;
  metadata?: string | null;
}): Promise<void> {
  const db = await getDb();
  if (!db) return;

  await db.insert(installFunnelEvents).values({
    sessionId: data.sessionId,
    userId: data.userId || null,
    eventType: data.eventType,
    deviceType: data.deviceType || null,
    browserType: data.browserType || null,
    osVersion: data.osVersion || null,
    appVersion: data.appVersion || null,
    referrer: data.referrer || null,
    metadata: data.metadata || null,
  });
}

/**
 * 설치 퍼널 통계 조회
 */
export async function getInstallFunnelStats(startDate?: string, endDate?: string) {
  const db = await getDb();
  if (!db) return [];

  const conditions = [];
  if (startDate) {
    conditions.push(gte(installFunnelEvents.createdAt, new Date(startDate)));
  }
  if (endDate) {
    conditions.push(lte(installFunnelEvents.createdAt, new Date(endDate)));
  }

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  const stats = await db
    .select({
      eventType: installFunnelEvents.eventType,
      count: sql<number>`COUNT(*)`,
    })
    .from(installFunnelEvents)
    .where(whereClause)
    .groupBy(installFunnelEvents.eventType);

  return stats;
}

/**
 * 활성 배너 조회 (타겟팅 조건 적용)
 */
export async function getActiveBanners(filters: {
  appVersion?: string;
  browserType?: string;
  osType?: string;
}): Promise<EmergencyBanner[]> {
  const db = await getDb();
  if (!db) return [];

  const now = new Date();
  const conditions = [
    eq(emergencyBanners.isActive, true),
  ];

  const banners = await db
    .select()
    .from(emergencyBanners)
    .where(and(...conditions))
    .orderBy(desc(emergencyBanners.priority));

  // 타겟팅 필터링 (JSON 필드)
  return banners.filter((banner) => {
    // 시작일/종료일 체크
    if (banner.startDate && new Date(banner.startDate) > now) return false;
    if (banner.endDate && new Date(banner.endDate) < now) return false;

    // 버전 타겟팅
    if (banner.targetVersions && filters.appVersion) {
      const versions = JSON.parse(banner.targetVersions);
      if (versions.length > 0 && !versions.includes(filters.appVersion)) return false;
    }

    // 브라우저 타겟팅
    if (banner.targetBrowsers && filters.browserType) {
      const browsers = JSON.parse(banner.targetBrowsers);
      if (browsers.length > 0 && !browsers.includes(filters.browserType)) return false;
    }

    // OS 타겟팅
    if (banner.targetOS && filters.osType) {
      const osList = JSON.parse(banner.targetOS);
      if (osList.length > 0 && !osList.includes(filters.osType)) return false;
    }

    return true;
  });
}

/**
 * 배너 상호작용 로깅
 */
export async function logBannerInteraction(data: {
  bannerId: number;
  userId?: number;
  sessionId: string;
  interactionType: "view" | "click" | "dismiss";
}): Promise<void> {
  const db = await getDb();
  if (!db) return;

  await db.insert(bannerInteractions).values({
    bannerId: data.bannerId,
    userId: data.userId || null,
    sessionId: data.sessionId,
    interactionType: data.interactionType,
  });
}

/**
 * 긴급 배너 생성
 */
export async function createEmergencyBanner(data: {
  title: string;
  content: string;
  type: "info" | "warning" | "error" | "maintenance";
  priority?: number;
  linkUrl?: string | null;
  linkText?: string | null;
  targetVersions?: string | null;
  targetBrowsers?: string | null;
  targetOS?: string | null;
  startDate?: string;
  endDate?: string;
}): Promise<void> {
  const db = await getDb();
  if (!db) return;

  await db.insert(emergencyBanners).values({
    title: data.title,
    content: data.content,
    type: data.type,
    priority: data.priority || 0,
    linkUrl: data.linkUrl || null,
    linkText: data.linkText || null,
    targetVersions: data.targetVersions || null,
    targetBrowsers: data.targetBrowsers || null,
    targetOS: data.targetOS || null,
    startDate: data.startDate ? new Date(data.startDate) : null,
    endDate: data.endDate ? new Date(data.endDate) : null,
    isActive: true,
  });
}

/**
 * 모든 배너 조회
 */
export async function getAllBanners(): Promise<EmergencyBanner[]> {
  const db = await getDb();
  if (!db) return [];

  return await db
    .select()
    .from(emergencyBanners)
    .orderBy(desc(emergencyBanners.createdAt));
}

/**
 * 배너 업데이트
 */
export async function updateEmergencyBanner(
  id: number,
  data: Partial<{
    title: string;
    content: string;
    type: "info" | "warning" | "error" | "maintenance";
    priority: number;
    linkUrl: string;
    linkText: string;
    isActive: boolean;
    targetVersions: string;
    targetBrowsers: string;
    targetOS: string;
    startDate: string;
    endDate: string;
  }>
): Promise<void> {
  const db = await getDb();
  if (!db) return;

  const updateData: any = {};
  if (data.title !== undefined) updateData.title = data.title;
  if (data.content !== undefined) updateData.content = data.content;
  if (data.type !== undefined) updateData.type = data.type;
  if (data.priority !== undefined) updateData.priority = data.priority;
  if (data.linkUrl !== undefined) updateData.linkUrl = data.linkUrl;
  if (data.linkText !== undefined) updateData.linkText = data.linkText;
  if (data.isActive !== undefined) updateData.isActive = data.isActive;
  if (data.targetVersions !== undefined) updateData.targetVersions = data.targetVersions;
  if (data.targetBrowsers !== undefined) updateData.targetBrowsers = data.targetBrowsers;
  if (data.targetOS !== undefined) updateData.targetOS = data.targetOS;
  if (data.startDate !== undefined) updateData.startDate = new Date(data.startDate);
  if (data.endDate !== undefined) updateData.endDate = new Date(data.endDate);

  await db.update(emergencyBanners).set(updateData).where(eq(emergencyBanners.id, id));
}

/**
 * 배너 삭제
 */
export async function deleteEmergencyBanner(id: number): Promise<void> {
  const db = await getDb();
  if (!db) return;

  await db.delete(emergencyBanners).where(eq(emergencyBanners.id, id));
}

/**
 * 클라이언트 에러 로깅
 */
export async function logClientError(data: {
  userId?: number;
  sessionId: string;
  appVersion: string;
  errorType: "js_error" | "promise_rejection" | "api_failure" | "network_error";
  errorMessage: string;
  errorStack?: string | null;
  url?: string | null;
  userAgent?: string | null;
  deviceType?: string | null;
  browserType?: string | null;
  osVersion?: string | null;
  metadata?: string | null;
}): Promise<void> {
  const db = await getDb();
  if (!db) return;

  await db.insert(clientErrors).values({
    userId: data.userId || null,
    sessionId: data.sessionId,
    appVersion: data.appVersion,
    errorType: data.errorType,
    errorMessage: data.errorMessage,
    errorStack: data.errorStack || null,
    url: data.url || null,
    userAgent: data.userAgent || null,
    deviceType: data.deviceType || null,
    browserType: data.browserType || null,
    osVersion: data.osVersion || null,
    metadata: data.metadata || null,
  });
}

/**
 * 클라이언트 에러 통계 조회
 */
export async function getClientErrorStats(filters: {
  startDate?: string;
  endDate?: string;
  appVersion?: string;
  errorType?: string;
}) {
  const db = await getDb();
  if (!db) return [];

  const conditions = [];
  if (filters.startDate) {
    conditions.push(gte(clientErrors.createdAt, new Date(filters.startDate)));
  }
  if (filters.endDate) {
    conditions.push(lte(clientErrors.createdAt, new Date(filters.endDate)));
  }
  if (filters.appVersion) {
    conditions.push(eq(clientErrors.appVersion, filters.appVersion));
  }
  if (filters.errorType) {
    conditions.push(eq(clientErrors.errorType, filters.errorType as any));
  }

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  const stats = await db
    .select({
      errorType: clientErrors.errorType,
      appVersion: clientErrors.appVersion,
      count: sql<number>`COUNT(*)`,
    })
    .from(clientErrors)
    .where(whereClause)
    .groupBy(clientErrors.errorType, clientErrors.appVersion);

  return stats;
}

/**
 * 최근 클라이언트 에러 목록 조회
 */
export async function getRecentClientErrors(filters: {
  limit?: number;
  offset?: number;
  appVersion?: string;
  errorType?: string;
}): Promise<ClientError[]> {
  const db = await getDb();
  if (!db) return [];

  const conditions = [];
  if (filters.appVersion) {
    conditions.push(eq(clientErrors.appVersion, filters.appVersion));
  }
  if (filters.errorType) {
    conditions.push(eq(clientErrors.errorType, filters.errorType as any));
  }

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  return await db
    .select()
    .from(clientErrors)
    .where(whereClause)
    .orderBy(desc(clientErrors.createdAt))
    .limit(filters.limit || 50)
    .offset(filters.offset || 0);
}

/**
 * Feature Flag 생성
 */
export async function createFeatureFlag(data: any): Promise<void> {
  const db = await getDb();
  if (!db) return;

  await db.insert(featureFlags).values(data);
}

/**
 * 모든 Feature Flag 조회
 */
export async function getAllFeatureFlags(): Promise<any[]> {
  const db = await getDb();
  if (!db) return [];

  const flags = await db.select().from(featureFlags);
  return flags;
}

/**
 * Feature Flag 업데이트
 */
export async function updateFeatureFlag(id: number, data: any): Promise<void> {
  const db = await getDb();
  if (!db) return;

  await db.update(featureFlags).set(data).where(eq(featureFlags.id, id));
}

/**
 * Feature Flag 삭제
 */
export async function deleteFeatureFlag(id: number): Promise<void> {
  const db = await getDb();
  if (!db) return;

  await db.delete(featureFlags).where(eq(featureFlags.id, id));
}

/**
 * 사용자별 Feature Flag 조회
 */
export async function getUserFeatureFlags(userId?: number): Promise<any[]> {
  const db = await getDb();
  if (!db) return [];

  const flags = await db
    .select()
    .from(featureFlags)
    .where(eq(featureFlags.isEnabled, true));

  // 롤아웃 퍼센티지 기반 필터링
  const filteredFlags = flags.filter((flag) => {
    if (flag.rolloutPercentage >= 100) return true;
    if (flag.rolloutPercentage <= 0) return false;

    // 사용자 ID 기반 해시로 일관된 롤아웃
    if (userId) {
      const hash = userId % 100;
      return hash < flag.rolloutPercentage;
    }

    return false;
  });

  return filteredFlags;
}

/**
 * 특정 Feature Flag 활성화 여부 확인
 */
export async function isFeatureFlagEnabled(
  flagName: string,
  userId?: number
): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;

  const flag = await db
    .select()
    .from(featureFlags)
    .where(eq(featureFlags.name, flagName))
    .limit(1);

  if (flag.length === 0 || !flag[0].isEnabled) return false;

  const rolloutPercentage = flag[0].rolloutPercentage;

  if (rolloutPercentage >= 100) return true;
  if (rolloutPercentage <= 0) return false;

  // 사용자 ID 기반 해시로 일관된 롤아웃
  if (userId) {
    const hash = userId % 100;
    return hash < rolloutPercentage;
  }

  return false;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Effective Plan — 단일 계산 기준
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * 플랜 정책 상수
 * - FREE: 쿠폰 기간 7일, 동시 활성 쿠폰 최대 10개
 * - PAID: 쿠폰 기간 30일 (다만 plan.expiresAt로 cap)
 * 이 값은 서버 전용 — 프론트 표시는 API 응답값 사용
 */
export const PLAN_POLICY = {
  FREE_COUPON_DAYS: 7,         // 체험 FREE 쿠폰 유효기간 (시작일 포함)
  PAID_COUPON_DAYS: 30,        // PAID 쿠폰 유효기간 (시작일 포함)
  FREE_MAX_ACTIVE_COUPONS: 10, // 체험 FREE 동시 활성 쿠폰 최대수
  FREE_COUPON_QUOTA: 10,       // 체험 FREE 쿠폰 발행수량 기본값
  // 체험 종료 후 Non-trial FREE: 쿠폰 생성/수정 불가 (0/0)
  NON_TRIAL_COUPON_DAYS: 0,
  NON_TRIAL_COUPON_QUOTA: 0,
} as const;

/**
 * 체험 사용 여부 판정 (내부 헬퍼 — 직접 호출보다 resolveAccountState 권장)
 *
 * null trialEndsAt 해석:
 *   - NULL = 체험 기능 도입(2026-03-05) 이전 가입 계정 (grandfather)
 *   - 이들은 이미 시스템을 사용했으므로 "체험 사용 완료"로 간주 → non_trial_free
 *   - 새 계정은 completeUserSignup() 시 반드시 trial_ends_at = now+7d 가 set됨
 *   - 따라서 NULL = 구형 계정 = trialUsed=true 가 맞음
 *
 * ⚠️ 운영 데이터 영향:
 *   - trial_ends_at IS NULL 인 기존 merchant는 non_trial_free → 쿠폰 등록 불가
 *   - 이 계정들에게 계속 쿠폰 등록을 허용하려면 관리자가 유료 플랜을 부여해야 함
 *   - 또는 DB UPDATE users SET trial_ends_at = future_date 로 개별 체험 재부여 가능
 */
export function isTrialUsed(trialEndsAt: Date | null | undefined): boolean {
  if (!trialEndsAt) return true; // NULL = 구형 계정 = 체험 사용 완료로 간주
  return new Date(trialEndsAt) < new Date();
}

/**
 * ══════════════════════════════════════════════════════════
 * 계정 상태 3-way 단일 진입점 (전 시스템 공통 — 반드시 이 함수를 사용할 것)
 * ══════════════════════════════════════════════════════════
 *
 * 상태 정의:
 *   trial_free     — FREE + 체험 활성 (trial_ends_at > now)
 *                    7일 / 10개 쿠폰 허용
 *   paid           — 유효한 유료 플랜 (tier != FREE/null)
 *                    30일 / plan quota 허용
 *   non_trial_free — FREE or no plan + 체험 종료 (trial_ends_at <= now or null)
 *                    쿠폰 생성/수정 완전 불가 (0일 / 0개)
 *
 * 판정 규칙:
 *   1) planTier가 유료(FREE/null이 아님) → paid
 *   2) planTier가 FREE or null → isTrialUsed(trialEndsAt) 기준 분기
 *      - false → trial_free
 *      - true  → non_trial_free
 *
 * 사용처:
 *   coupons.create / coupons.update / getMyPlan /
 *   setUserPlan(FREE) / tier expiry scheduler / runReconciliation
 *
 * @param trialEndsAt users.trial_ends_at (ctx.user.trialEndsAt 직접 전달)
 * @param planTier    활성 플랜의 tier ('FREE'|'WELCOME'|'REGULAR'|'BUSY'|null)
 *                    null = 플랜 없음 or 만료됨
 */
export function resolveAccountState(
  trialEndsAt: Date | null | undefined,
  planTier: string | null | undefined,
): 'trial_free' | 'non_trial_free' | 'paid' {
  // 유료 플랜 활성 (FREE나 null이 아닌 tier)
  if (planTier && planTier !== 'FREE') return 'paid';
  // FREE or 플랜 없음: 체험 상태에 따라 분기
  return isTrialUsed(trialEndsAt) ? 'non_trial_free' : 'trial_free';
}

/**
 * 사용자의 현재 effective plan 조회 (DB 접근)
 * 기준: is_active=TRUE AND (expires_at IS NULL OR expires_at > NOW())
 * 없으면 null → resolveEffectivePlan(null)으로 FREE 처리
 *
 * ※ 모든 라우터/스케줄러에서 이 함수를 사용할 것 (인라인 SQL 중복 금지)
 */
export async function getEffectivePlan(userId: number): Promise<Record<string, unknown> | null> {
  const dbConn = await getDb();
  if (!dbConn) return null;

  const result = await dbConn.execute(sql`
    SELECT tier, expires_at, default_duration_days, default_coupon_quota
    FROM user_plans
    WHERE user_id = ${userId}
      AND is_active = TRUE
      AND (expires_at IS NULL OR expires_at > NOW())
    ORDER BY created_at DESC LIMIT 1
  `);

  const rows = (result as any)?.rows ?? (result as any)?.[0] ?? [];
  return (Array.isArray(rows) ? rows[0] : null) ?? null;
}

/**
 * planRow → 정규화된 plan 정보 (null = FREE)
 * 반환값은 서버 정책 기준 — FREE면 항상 FREE 기본값 반환
 */
export function resolveEffectivePlan(planRow: Record<string, unknown> | null) {
  if (!planRow) {
    return {
      tier: 'FREE' as string,
      defaultDurationDays: PLAN_POLICY.FREE_COUPON_DAYS,
      defaultCouponQuota: PLAN_POLICY.FREE_COUPON_QUOTA,
      expiresAt: null as Date | null,
    };
  }
  return {
    tier: String(planRow.tier ?? 'FREE'),
    defaultDurationDays: Number(planRow.default_duration_days ?? PLAN_POLICY.FREE_COUPON_DAYS),
    defaultCouponQuota: Number(planRow.default_coupon_quota ?? PLAN_POLICY.FREE_COUPON_QUOTA),
    expiresAt: planRow.expires_at ? new Date(planRow.expires_at as string) : null,
  };
}

/**
 * 쿠폰 endDate 서버 자동 계산 (정책 주입 핵심 함수)
 *
 * 정책:
 *   FREE  → startDate 포함 7일  = startDate + 6일 23:59:59
 *   PAID  → startDate 포함 30일 = startDate + 29일 23:59:59
 *   단, plan.expiresAt가 더 빠르면 그 날짜 23:59:59로 cap
 *
 * @param startDate 쿠폰 시작일 (Date 객체)
 * @param plan      resolveEffectivePlan 반환값
 * @returns         서버 강제 endDate
 */
export function computeCouponEndDate(startDate: Date, plan: ReturnType<typeof resolveEffectivePlan>): Date {
  const isPaid = plan.tier !== 'FREE';
  const totalDays = isPaid ? PLAN_POLICY.PAID_COUPON_DAYS : PLAN_POLICY.FREE_COUPON_DAYS;
  // 시작일 포함 N일: 종료일 = startDate + (N-1)일
  const endDate = new Date(startDate);
  endDate.setDate(startDate.getDate() + (totalDays - 1));
  endDate.setHours(23, 59, 59, 999);

  // PAID이고 plan.expiresAt가 더 빠른 경우 — plan 만료일로 cap
  if (isPaid && plan.expiresAt) {
    const planExpiry = new Date(plan.expiresAt);
    planExpiry.setHours(23, 59, 59, 999);
    if (planExpiry < endDate) return planExpiry;
  }
  return endDate;
}

/**
 * 플랜 만료 / 수동 FREE 전환 시 쿠폰 재정렬
 *
 * 정책:
 *   - FREE 기준 동시 활성 쿠폰 허용수(10개) 초과 시 자동 비활성화
 *   - 유지 우선순위: 최신 생성 쿠폰 우선 (오래된 것부터 비활성화)
 *   - is_active=false 처리 (하드 DELETE 아님 — 이력 보존)
 *
 * 이 함수는 스케줄러(tier 만료 배치) / setUserPlan(수동 FREE 전환) 양쪽에서 호출.
 * fire-and-forget 가능(await 선택), 에러는 로깅 후 무시.
 */
/**
 * @param effectiveQuota 허용 활성 쿠폰 수
 *   - 체험 FREE: PLAN_POLICY.FREE_MAX_ACTIVE_COUPONS (10)
 *   - 체험 종료 FREE: 0 (전부 비활성화)
 *   기본값 = 10 (기존 호출 backwards-compat)
 */
export async function reclaimCouponsToFreeTier(
  userId: number,
  effectiveQuota = PLAN_POLICY.FREE_MAX_ACTIVE_COUPONS
): Promise<{ deactivated: number }> {
  const dbConn = await getDb();
  if (!dbConn) return { deactivated: 0 };

  try {
    const ownedStores = await getStoresByOwnerId(userId);
    if (ownedStores.length === 0) return { deactivated: 0 };

    const storeIdList = ownedStores.map(s => s.id).join(',');
    const FREE_QUOTA = effectiveQuota; // 체험 FREE=10, 체험 종료=0

    // 현재 활성 쿠폰 목록 — 오래된 순 (초과분 = 오래된 것부터 제거)
    const activeResult = await dbConn.execute(
      `SELECT id FROM coupons
       WHERE store_id IN (${storeIdList})
         AND is_active = TRUE
       ORDER BY created_at ASC`
    );
    const activeIds: number[] = ((activeResult as any)?.rows ?? []).map((r: any) => Number(r.id));

    if (activeIds.length <= FREE_QUOTA) return { deactivated: 0 };

    // 최신 FREE_QUOTA개는 유지 (끝에서부터), 나머지는 비활성화
    const toDeactivate = activeIds.slice(0, activeIds.length - FREE_QUOTA);
    await dbConn.execute(
      `UPDATE coupons
       SET is_active = FALSE, updated_at = NOW()
       WHERE id IN (${toDeactivate.join(',')})`
    );

    console.log(JSON.stringify({
      action: 'coupon_reclaim_to_free',
      userId,
      deactivated: toDeactivate.length,
      kept: FREE_QUOTA,
      timestamp: new Date().toISOString(),
    }));

    return { deactivated: toDeactivate.length };
  } catch (e) {
    console.error('[reclaimCouponsToFreeTier] error (non-critical):', e);
    return { deactivated: 0 };
  }
}

/**
 * merchant 소유 쿠폰 전용 조회 (서버 권한 기반)
 * - soft-deleted 매장 제외 (getStoresByOwnerId와 동일 기준)
 * - 활성/비활성/만료 포함 (merchant 대시보드용 — 내 쿠폰 전체 관리)
 * - 클라이언트 필터 완전 불필요
 */
export async function getMerchantCoupons(ownerId: number) {
  const db = await getDb();
  if (!db) return [];

  // 소유 매장 IDs (soft-deleted 제외)
  const ownedStores = await getStoresByOwnerId(ownerId);
  if (ownedStores.length === 0) return [];

  const storeIds = ownedStores.map(s => s.id);
  const storeIdList = storeIds.join(',');

  return await db
    .select()
    .from(coupons)
    .where(sql`${coupons.storeId} IN (${sql.raw(storeIdList)})`)
    .orderBy(desc(coupons.createdAt));
}

/**
 * 관리자 행위 DB 감사 로그 삽입
 * - 실패해도 비즈니스 로직을 차단하지 않음 (fire-and-forget)
 * - console.log 임시 로그를 대체하는 영구 audit trail
 */
export async function insertAuditLog(params: {
  adminId: number;
  action: string;
  targetType?: string;
  targetId?: number;
  payload?: Record<string, unknown>;
}) {
  const db = await getDb();
  if (!db) return;

  try {
    await db.insert(adminAuditLogs).values({
      adminId: params.adminId,
      action: params.action,
      targetType: params.targetType ?? null,
      targetId: params.targetId ?? null,
      payload: params.payload ?? null,
    } as any);
  } catch (e) {
    // audit log 실패는 무시 (비즈니스 로직 차단 금지)
    console.error('[AuditLog] insert failed (non-critical):', e);
  }
}
