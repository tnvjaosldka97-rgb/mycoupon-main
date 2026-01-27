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
      discount_value: coupons.discountValue,
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
      discount_value: coupons.discountValue,
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
      discount_value: coupons.discountValue,
      min_purchase: coupons.minPurchase,
      totalUsed: sql<number>`SUM(CASE WHEN ${userCoupons.status} = 'used' THEN 1 ELSE 0 END)`,
      totalDownloads: sql<number>`COUNT(DISTINCT ${userCoupons.id})`,
    })
    .from(coupons)
    .leftJoin(userCoupons, eq(coupons.id, userCoupons.couponId))
    .where(eq(coupons.storeId, storeId))
    .groupBy(coupons.id, coupons.title, coupons.discountType, coupons.discountValue, coupons.minPurchase);

  return stats.map(stat => {
    const used_count = Number(stat.totalUsed) || 0;
    let estimated_revenue = 0;
    let estimated_discount = 0;
    const base_amount = stat.min_purchase && stat.min_purchase > 0 ? stat.min_purchase : stat.discount_value * 3;
    
    if (stat.discountType === 'percentage') {
      estimated_revenue = base_amount * used_count;
      estimated_discount = Math.round(base_amount * (stat.discount_value / 100)) * used_count;
    } else if (stat.discountType === 'fixed') {
      estimated_revenue = base_amount * used_count;
      estimated_discount = stat.discount_value * used_count;
    } else {
      estimated_revenue = base_amount * used_count;
      estimated_discount = stat.discount_value * used_count;
    }
    
    return {
      couponId: stat.couponId,
      couponTitle: stat.couponTitle,
      discountType: stat.discountType,
      discount_value: stat.discount_value,
      min_purchase: stat.min_purchase,
      totalUsed: used_count,
      totalDownloads: Number(stat.totalDownloads) || 0,
      totalAmount: estimated_revenue,
      estimatedDiscount: estimated_discount,
      estimatedRevenue: estimated_revenue - estimated_discount,
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

  const usage_count = await db
    .select({ count: sql<number>`COUNT(*)` })
    .from(couponUsage)
    .where(eq(couponUsage.storeId, storeId));

  return {
    totalCoupons: Number(summary[0]?.totalCoupons) || 0,
    totalDownloads: Number(summary[0]?.totalDownloads) || 0,
    totalUsed: Number(summary[0]?.totalUsed) || 0,
    activeUsers: Number(summary[0]?.activeUsers) || 0,
    verifiedUsage: Number(usage_count[0]?.count) || 0,
  };
}
