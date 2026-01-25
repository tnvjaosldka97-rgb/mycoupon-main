import { eq, desc, and, sql, like, ne, gte, lte } from "drizzle-orm";
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
  InsertFeatureFlag
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
    } else if (user.openId === ENV.ownerOpenId) {
      values.role = 'admin';
      updateSet.role = 'admin';
    }

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

  return await db.select().from(stores).where(eq(stores.ownerId, ownerId));
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
    .where(eq(stores.isActive, true))
    .limit(limit);
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

export async function getCouponsByStoreId(storeId: number) {
  const db = await getDb();
  if (!db) return [];

  return await db
    .select()
    .from(coupons)
    .where(and(
      eq(coupons.storeId, storeId),
      eq(coupons.isActive, true)
    ))
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

  const now = new Date();
  
  return await db
    .select()
    .from(coupons)
    .where(and(
      eq(coupons.isActive, true),
      sql`${coupons.endDate} > ${now}`,
      sql`${coupons.remainingQuantity} > 0`
    ))
    .orderBy(desc(coupons.createdAt));
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

export async function checkDeviceCoupon(userId: number, couponId: number, deviceId: string) {
  const db = await getDb();
  if (!db) return null;

  // 사용 완료된 쿠폰(status='used')은 제외하고 검색
  // 사용자가 쿠폰을 사용 완료하면 같은 쿠폰을 다시 다운로드 가능
  const result = await db
    .select()
    .from(userCoupons)
    .where(
      and(
        eq(userCoupons.userId, userId),
        eq(userCoupons.couponId, couponId),
        eq(userCoupons.deviceId, deviceId),
        ne(userCoupons.status, 'used') // 사용 완료된 쿠폰 제외
      )
    )
    .limit(1);
  
  return result[0] || null;
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
