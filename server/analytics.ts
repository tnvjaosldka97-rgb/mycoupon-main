import { getDb } from "./db";
import { coupons, userCoupons, users, stores, couponUsage } from "../drizzle/schema";
import { eq, and, gte, lte, sql, desc } from "drizzle-orm";

export async function getCouponUsageStats(storeId: number) {
  const db = await getDb();
  if (!db) return [];
  
  const stats = await db
    .select({
      couponId: coupons.id,
      couponTitle: coupons.title,
      totalDownloads: sql<number>`COUNT(DISTINCT ${userCoupons.id})`,
      totalUsed: sql<number>`SUM(CASE WHEN ${userCoupons.status} = 'used' THEN 1 ELSE 0 END)`,
      usageRate: sql<number>`ROUND(SUM(CASE WHEN ${userCoupons.status} = 'used' THEN 1 ELSE 0 END) * 100.0 / NULLIF(COUNT(DISTINCT ${userCoupons.id}), 0), 2)`,
    })
    .from(coupons)
    .leftJoin(userCoupons, eq(coupons.id, userCoupons.couponId))
    .where(eq(coupons.storeId, storeId))
    .groupBy(coupons.id, coupons.title);

  return stats;
}

export async function getHourlyUsagePattern(storeId: number) {
  const db = await getDb();
  if (!db) return [];
  
  const pattern = await db
    .select({
      hour: sql<number>`EXTRACT(HOUR FROM ${userCoupons.usedAt})::integer`,
      count: sql<number>`COUNT(*)`,
    })
    .from(userCoupons)
    .innerJoin(coupons, eq(userCoupons.couponId, coupons.id))
    .where(and(eq(coupons.storeId, storeId), eq(userCoupons.status, 'used')))
    .groupBy(sql`EXTRACT(HOUR FROM ${userCoupons.usedAt})`)
    .orderBy(sql`EXTRACT(HOUR FROM ${userCoupons.usedAt})`);

  return pattern;
}

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
    .where(and(eq(coupons.storeId, storeId), eq(userCoupons.status, 'used')))
    .orderBy(desc(userCoupons.usedAt))
    .limit(limit);

  return recent;
}

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
    .where(and(eq(coupons.storeId, storeId), eq(userCoupons.status, 'used')))
    .orderBy(desc(userCoupons.usedAt));

  return history;
}

export async function getCouponRevenueStats(storeId: number) {
  const db = await getDb();
  if (!db) return [];
  
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

  return stats.map(stat => {
    const usedCount = Number(stat.totalUsed) || 0;
    let estimatedRevenue = 0;
    let estimatedDiscount = 0;
    const baseAmount = stat.minPurchase && stat.minPurchase > 0 ? stat.minPurchase : stat.discountValue * 3;
    
    if (stat.discountType === 'percentage') {
      estimatedRevenue = baseAmount * usedCount;
      estimatedDiscount = Math.round(baseAmount * (stat.discountValue / 100)) * usedCount;
    } else if (stat.discountType === 'fixed') {
      estimatedRevenue = baseAmount * usedCount;
      estimatedDiscount = stat.discountValue * usedCount;
    } else {
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
      totalAmount: estimatedRevenue,
      estimatedDiscount,
      estimatedRevenue: estimatedRevenue - estimatedDiscount,
    };
  });
}

export async function getStoreSummary(storeId: number) {
  const db = await getDb();
  if (!db) return { totalCoupons: 0, totalDownloads: 0, totalUsed: 0, activeUsers: 0, verifiedUsage: 0 };
  
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

  const usageCount = await db
    .select({ count: sql<number>`COUNT(*)` })
    .from(couponUsage)
    .where(eq(couponUsage.storeId, storeId));

  return {
    totalCoupons: Number(summary[0]?.totalCoupons) || 0,
    totalDownloads: Number(summary[0]?.totalDownloads) || 0,
    totalUsed: Number(summary[0]?.totalUsed) || 0,
    activeUsers: Number(summary[0]?.activeUsers) || 0,
    verifiedUsage: Number(usageCount[0]?.count) || 0,
  };
}
