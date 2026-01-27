import { getDb } from "./db";
import { sql } from "drizzle-orm";

export async function getUsageTrend(storeId: number, period: 'daily' | 'weekly' | 'monthly' = 'daily') {
  const db = await getDb();
  if (!db) return [];

  let dateFormat = "TO_CHAR(uc.used_at, 'YYYY-MM-DD')";
  if (period === 'weekly') dateFormat = "TO_CHAR(uc.used_at, 'IYYY-IW')";
  if (period === 'monthly') dateFormat = "TO_CHAR(uc.used_at, 'YYYY-MM')";

  const result = await db.execute(sql`
    SELECT 
      ${sql.raw(dateFormat)} as date,
      COUNT(*) as count,
      SUM(c.discount_value) as discount_value,
      COUNT(DISTINCT uc.user_id) as active_users
    FROM user_coupons uc
    JOIN coupons c ON uc.coupon_id = c.id
    WHERE uc.used_at IS NOT NULL
      AND c.store_id = ${storeId}
    GROUP BY 1
    ORDER BY 1 DESC
    LIMIT 30
  `);

  return result.rows.map((row: any) => ({
    date: row.date,
    count: Number(row.count),
    discountValue: Number(row.discount_value || 0),
    activeUsers: Number(row.active_users || 0),
    totalUsed: Number(row.count)
  }));
}

export async function getCouponUsageStats(storeId: number) {
  const db = await getDb();
  if (!db) return [];

  const result = await db.execute(sql`
    SELECT 
      c.id as coupon_id,
      c.title as coupon_title,
      COUNT(DISTINCT uc.id) as total_downloads,
      SUM(CASE WHEN uc.status = 'used' THEN 1 ELSE 0 END) as total_used
    FROM coupons c
    LEFT JOIN user_coupons uc ON c.id = uc.coupon_id
    WHERE c.store_id = ${storeId}
    GROUP BY c.id, c.title
  `);

  return result.rows.map((row: any) => {
    const totalDownloads = Number(row.total_downloads || 0);
    const totalUsed = Number(row.total_used || 0);
    return {
      couponId: row.coupon_id,
      couponTitle: row.coupon_title,
      totalDownloads,
      totalUsed,
      usageRate: totalDownloads > 0 ? ((totalUsed / totalDownloads) * 100).toFixed(2) : '0'
    };
  });
}

export async function getHourlyUsagePattern(storeId: number) {
  const db = await getDb();
  if (!db) return [];

  const result = await db.execute(sql`
    SELECT 
      EXTRACT(HOUR FROM uc.used_at)::integer as hour,
      COUNT(*) as count
    FROM user_coupons uc
    JOIN coupons c ON uc.coupon_id = c.id
    WHERE uc.used_at IS NOT NULL
      AND c.store_id = ${storeId}
    GROUP BY 1
    ORDER BY 1 ASC
  `);

  return result.rows.map((row: any) => ({
    hour: Number(row.hour),
    count: Number(row.count)
  }));
}

export async function getPopularCoupons(storeId: number, limit: number = 5) {
  const db = await getDb();
  if (!db) return [];

  const result = await db.execute(sql`
    SELECT 
      c.id as coupon_id,
      c.title as coupon_title,
      COUNT(DISTINCT uc.id) as download_count,
      SUM(CASE WHEN uc.status = 'used' THEN 1 ELSE 0 END) as used_count
    FROM coupons c
    LEFT JOIN user_coupons uc ON c.id = uc.coupon_id
    WHERE c.store_id = ${storeId}
    GROUP BY c.id, c.title
    ORDER BY download_count DESC
    LIMIT ${limit}
  `);

  return result.rows.map((row: any) => ({
    couponId: row.coupon_id,
    couponTitle: row.coupon_title,
    downloadCount: Number(row.download_count || 0),
    usedCount: Number(row.used_count || 0)
  }));
}

export async function getRecentUsage(storeId: number, limit: number = 10) {
  const db = await getDb();
  if (!db) return [];

  const result = await db.execute(sql`
    SELECT 
      uc.id,
      c.title as coupon_title,
      u.name as user_name,
      uc.used_at,
      uc.pin_code
    FROM user_coupons uc
    JOIN coupons c ON uc.coupon_id = c.id
    JOIN users u ON uc.user_id = u.id
    WHERE uc.used_at IS NOT NULL
      AND c.store_id = ${storeId}
    ORDER BY uc.used_at DESC
    LIMIT ${limit}
  `);

  return result.rows.map((row: any) => ({
    id: row.id,
    couponTitle: row.coupon_title,
    userName: row.user_name,
    usedAt: row.used_at,
    pinCode: row.pin_code
  }));
}

export async function getStoreSummary(storeId: number) {
  const db = await getDb();
  if (!db) return { totalCoupons: 0, totalDownloads: 0, totalUsed: 0, activeUsers: 0, verifiedUsage: 0 };

  const result = await db.execute(sql`
    SELECT 
      COUNT(DISTINCT c.id) as total_coupons,
      COUNT(DISTINCT uc.id) as total_downloads,
      SUM(CASE WHEN uc.status = 'used' THEN 1 ELSE 0 END) as total_used,
      COUNT(DISTINCT uc.user_id) as active_users
    FROM coupons c
    LEFT JOIN user_coupons uc ON c.id = uc.coupon_id
    WHERE c.store_id = ${storeId}
  `);

  const row = result.rows[0] as any;
  return {
    totalCoupons: Number(row?.total_coupons || 0),
    totalDownloads: Number(row?.total_downloads || 0),
    totalUsed: Number(row?.total_used || 0),
    activeUsers: Number(row?.active_users || 0),
    verifiedUsage: Number(row?.total_used || 0)
  };
}

export async function getCategoryDistribution(storeId: number) {
  const db = await getDb();
  if (!db) return [];
  return [{ name: 'General', value: 100 }];
}

export async function getDownloadHistory(storeId: number) { return []; }
export async function getUsageHistory(storeId: number) { return []; }
export async function getCouponRevenueStats(storeId: number) { return []; }
