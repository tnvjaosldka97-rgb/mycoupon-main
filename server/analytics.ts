import { getDb } from "./db";
import { coupons, userCoupons, users, stores } from "../drizzle/schema";
import { eq, and, gte, lte, sql, desc } from "drizzle-orm";

// 쿠폰별 사용 현황
export async function getCouponUsageStats(storeId: number) {
  const db = await getDb();
  if (!db) return [];
  
  const stats = await db
    .select({
      couponId: coupons.id,
      couponTitle: coupons.title,
      totalDownloads: sql<number>`COUNT(DISTINCT ${userCoupons.id})`,
      totalUsed: sql<number>`SUM(CASE WHEN ${userCoupons.status} = 'used' THEN 1 ELSE 0 END)`,
      usageRate: sql<number>`ROUND(SUM(CASE WHEN ${userCoupons.status} = 'used' THEN 1 ELSE 0 END) * 100.0 / COUNT(DISTINCT ${userCoupons.id}), 2)`,
    })
    .from(coupons)
    .leftJoin(userCoupons, eq(coupons.id, userCoupons.couponId))
    .where(eq(coupons.storeId, storeId))
    .groupBy(coupons.id, coupons.title);

  return stats;
}

// 시간대별 사용 패턴
export async function getHourlyUsagePattern(storeId: number) {
  const db = await getDb();
  if (!db) return [];
  
  const pattern = await db
    .select({
      hour: sql<number>`HOUR(${userCoupons.usedAt})`,
      count: sql<number>`COUNT(*)`,
    })
    .from(userCoupons)
    .innerJoin(coupons, eq(userCoupons.couponId, coupons.id))
    .where(
      and(
        eq(coupons.storeId, storeId),
        eq(userCoupons.status, 'used')
      )
    )
    .groupBy(sql`HOUR(${userCoupons.usedAt})`)
    .orderBy(sql`HOUR(${userCoupons.usedAt})`);

  return pattern;
}

// 최근 사용 내역
export async function getRecentUsage(storeId: number, limit: number = 10) {
  const db = await getDb();
  if (!db) return [];
  
  const recent = await db
    .select({
      id: userCoupons.id,
      couponTitle: coupons.title,
      userName: users.name,
      usedAt: userCoupons.usedAt,
      pinCode: userCoupons.pinCode,
    })
    .from(userCoupons)
    .innerJoin(coupons, eq(userCoupons.couponId, coupons.id))
    .innerJoin(users, eq(userCoupons.userId, users.id))
    .where(
      and(
        eq(coupons.storeId, storeId),
        eq(userCoupons.status, 'used')
      )
    )
    .orderBy(desc(userCoupons.usedAt))
    .limit(limit);

  return recent;
}

// 인기 쿠폰 순위
export async function getPopularCoupons(storeId: number, limit: number = 5) {
  const db = await getDb();
  if (!db) return [];
  
  const popular = await db
    .select({
      couponId: coupons.id,
      couponTitle: coupons.title,
      downloadCount: sql<number>`COUNT(DISTINCT ${userCoupons.id})`,
      usedCount: sql<number>`SUM(CASE WHEN ${userCoupons.status} = 'used' THEN 1 ELSE 0 END)`,
    })
    .from(coupons)
    .leftJoin(userCoupons, eq(coupons.id, userCoupons.couponId))
    .where(eq(coupons.storeId, storeId))
    .groupBy(coupons.id, coupons.title)
    .orderBy(desc(sql`COUNT(DISTINCT ${userCoupons.id})`))
    .limit(limit);

  return popular;
}

// 쿠폰 다운로드 내역 전체 조회 (엑셀 다운로드용)
export async function getDownloadHistory(storeId: number) {
  const db = await getDb();
  if (!db) return [];
  
  const history = await db
    .select({
      id: userCoupons.id,
      couponTitle: coupons.title,
      discountType: coupons.discountType,
      discountValue: coupons.discountValue,
      userName: users.name,
      userEmail: users.email,
      pinCode: userCoupons.pinCode,
      status: userCoupons.status,
      downloadedAt: userCoupons.downloadedAt,
      usedAt: userCoupons.usedAt,
      expiresAt: userCoupons.expiresAt,
    })
    .from(userCoupons)
    .innerJoin(coupons, eq(userCoupons.couponId, coupons.id))
    .innerJoin(users, eq(userCoupons.userId, users.id))
    .where(eq(coupons.storeId, storeId))
    .orderBy(desc(userCoupons.downloadedAt));

  return history;
}

// 쿠폰 사용 내역 전체 조회 (엑셀 다운로드용)
export async function getUsageHistory(storeId: number) {
  const db = await getDb();
  if (!db) return [];
  
  const history = await db
    .select({
      id: userCoupons.id,
      couponTitle: coupons.title,
      discountType: coupons.discountType,
      discountValue: coupons.discountValue,
      userName: users.name,
      userEmail: users.email,
      pinCode: userCoupons.pinCode,
      usedAt: userCoupons.usedAt,
    })
    .from(userCoupons)
    .innerJoin(coupons, eq(userCoupons.couponId, coupons.id))
    .innerJoin(users, eq(userCoupons.userId, users.id))
    .where(
      and(
        eq(coupons.storeId, storeId),
        eq(userCoupons.status, 'used')
      )
    )
    .orderBy(desc(userCoupons.usedAt));

  return history;
}

// 쿠폰별 예상 매출 계산
export async function getCouponRevenueStats(storeId: number) {
  const db = await getDb();
  if (!db) return [];
  
  // 쿠폰별 사용 횟수와 할인 정보를 기반으로 예상 매출 계산
  // 예상 매출 = 사용 횟수 * 최소구매금액 (최소구매금액이 없으면 할인값 * 3 기준)
  const stats = await db
    .select({
      couponId: coupons.id,
      couponTitle: coupons.title,
      discountType: coupons.discountType,
      discountValue: coupons.discountValue,
      minPurchase: coupons.minPurchase,
      totalUsed: sql<number>`SUM(CASE WHEN ${userCoupons.status} = 'used' THEN 1 ELSE 0 END)`,
      totalDownloads: sql<number>`COUNT(DISTINCT ${userCoupons.id})`,
    })
    .from(coupons)
    .leftJoin(userCoupons, eq(coupons.id, userCoupons.couponId))
    .where(eq(coupons.storeId, storeId))
    .groupBy(coupons.id, coupons.title, coupons.discountType, coupons.discountValue, coupons.minPurchase);

  // 예상 매출 계산
  return stats.map(stat => {
    const usedCount = Number(stat.totalUsed) || 0;
    let estimatedRevenue = 0;
    let estimatedDiscount = 0;
    
    // 최소 구매 금액이 있으면 그것을 기준으로, 없으면 할인값의 3배를 기준으로 계산
    const baseAmount = stat.minPurchase && stat.minPurchase > 0 
      ? stat.minPurchase 
      : stat.discountValue * 3;
    
    if (stat.discountType === 'percentage') {
      // 퍼센트 할인: 예상 매출 = 기준금액 * 사용횟수
      estimatedRevenue = baseAmount * usedCount;
      estimatedDiscount = Math.round(baseAmount * (stat.discountValue / 100)) * usedCount;
    } else if (stat.discountType === 'fixed') {
      // 정액 할인: 예상 매출 = 기준금액 * 사용횟수
      estimatedRevenue = baseAmount * usedCount;
      estimatedDiscount = stat.discountValue * usedCount;
    } else {
      // 증정: 예상 매출 = 기준금액 * 사용횟수
      estimatedRevenue = baseAmount * usedCount;
      estimatedDiscount = stat.discountValue * usedCount;
    }
    
    return {
      couponId: stat.couponId,
      couponTitle: stat.couponTitle,
      discountType: stat.discountType,
      discountValue: stat.discountValue,
      minPurchase: stat.minPurchase,
      totalUsed: usedCount,
      totalDownloads: Number(stat.totalDownloads) || 0,
      totalAmount: estimatedRevenue, // 총액 (할인 전)
      estimatedDiscount, // 할인액
      estimatedRevenue: estimatedRevenue - estimatedDiscount, // 예상 총매출 (총액에서 할인된 금액)
    };
  });
}

// 전체 통계 요약
export async function getStoreSummary(storeId: number) {
  const db = await getDb();
  if (!db) return { totalCoupons: 0, totalDownloads: 0, totalUsed: 0, activeUsers: 0 };
  
  const summary = await db
    .select({
      totalCoupons: sql<number>`COUNT(DISTINCT ${coupons.id})`,
      totalDownloads: sql<number>`COUNT(DISTINCT ${userCoupons.id})`,
      totalUsed: sql<number>`SUM(CASE WHEN ${userCoupons.status} = 'used' THEN 1 ELSE 0 END)`,
      activeUsers: sql<number>`COUNT(DISTINCT ${userCoupons.userId})`,
    })
    .from(coupons)
    .leftJoin(userCoupons, eq(coupons.id, userCoupons.couponId))
    .where(eq(coupons.storeId, storeId));

  return summary[0] || {
    totalCoupons: 0,
    totalDownloads: 0,
    totalUsed: 0,
    activeUsers: 0,
  };
}
