// ✅ 2026-01-28 FINAL FIX: Field Name Correction
import { router, publicProcedure } from "./_core/trpc";
import { z } from "zod";
import { getDb } from "./db";
import { sql } from "drizzle-orm";
import { coupons, userCoupons, stores, users } from "../drizzle/schema";

// 🛠️ [만능 어댑터] 데이터 꺼내는 함수
function getRows(result: any): any[] {
  if (!result) return [];
  if (Array.isArray(result)) return result;
  if (result.rows && Array.isArray(result.rows)) return result.rows;
  return [];
}

export const analyticsRouter = router({
  // =========================================================
  // 1. 대시보드 메인 (Overview) - 변수명 유지
  // =========================================================
  overview: publicProcedure.query(async () => {
    try {
      const db = await getDb();
      
      const todayUsage = await db.execute(sql`
        SELECT COALESCE(COUNT(*), 0) as count 
        FROM ${userCoupons} uc
        WHERE TO_CHAR(uc.used_at, 'YYYY-MM-DD') = TO_CHAR(NOW(), 'YYYY-MM-DD')
           OR (uc.status = 'used' AND TO_CHAR(uc.updated_at, 'YYYY-MM-DD') = TO_CHAR(NOW(), 'YYYY-MM-DD'))
      `);
      
      const totalDownloads = await db.execute(sql`SELECT COUNT(*) as count FROM ${userCoupons}`);
      const totalUsage = await db.execute(sql`SELECT COUNT(*) as count FROM ${userCoupons} WHERE status = 'used'`);
      const activeStores = await db.execute(sql`SELECT COUNT(*) as count FROM ${stores} WHERE is_active = true`);
      const totalUsers = await db.execute(sql`SELECT COUNT(*) as count FROM ${users}`);

      return {
        todayUsage: Number(getRows(todayUsage)[0]?.count ?? 0),
        totalDownloads: Number(getRows(totalDownloads)[0]?.count ?? 0),
        totalUsage: Number(getRows(totalUsage)[0]?.count ?? 0),
        activeStores: Number(getRows(activeStores)[0]?.count ?? 0),
        totalDiscountAmount: 0, 
        usageRate: 100, 
        totalUsers: Number(getRows(totalUsers)[0]?.count ?? 0)
      };
    } catch (e) {
      console.error("Analytics Error (Overview):", e);
      return { todayUsage: 0, totalDownloads: 0, totalUsage: 0, activeStores: 0, totalDiscountAmount: 0, usageRate: 0, totalUsers: 0 };
    }
  }),

  // =========================================================
  // 2. 그래프 데이터 (Charts) - 🚨 변수명 수정됨 (usageCount 등)
  // =========================================================
  usageTrend: publicProcedure
    .input(z.object({ period: z.enum(['daily', 'weekly', 'monthly']) }))
    .query(async ({ input }) => {
      try {
        const db = await getDb();
        const dateColumn = "COALESCE(uc.used_at, uc.updated_at, uc.created_at)";
        let dateFormat = `TO_CHAR(${dateColumn}, 'YYYY-MM-DD')`;
        if (input.period === 'weekly') dateFormat = `TO_CHAR(${dateColumn}, 'IYYY-IW')`; 
        if (input.period === 'monthly') dateFormat = `TO_CHAR(${dateColumn}, 'YYYY-MM')`;

        const rawResult = await db.execute(sql`
          SELECT 
            ${sql.raw(dateFormat)} as date,
            COUNT(*) as count
          FROM ${userCoupons} uc
          JOIN ${coupons} c ON uc.coupon_id = c.id
          WHERE (uc.used_at IS NOT NULL OR uc.status = 'used')
          GROUP BY 1
          ORDER BY 1 ASC
          LIMIT 30
        `);

        // 🚨 수정: count -> usageCount, activeUsers -> uniqueUsers (프론트엔드 규격 준수)
        return getRows(rawResult).map((row: any) => ({
          date: row.date,
          usageCount: Number(row.count || 0), // 여기가 핵심!
          uniqueUsers: 0 // 임시값
        }));
      } catch (e) { return []; }
    }),

  topStores: publicProcedure.query(async () => {
    try {
      const db = await getDb();
      const rawResult = await db.execute(sql`
        SELECT s.id as store_id, s.name as store_name, COUNT(uc.id) as used_count
        FROM ${userCoupons} uc
        JOIN ${coupons} c ON uc.coupon_id = c.id
        JOIN ${stores} s ON c.store_id = s.id
        WHERE (uc.used_at IS NOT NULL OR uc.status = 'used')
        GROUP BY s.id, s.name
        ORDER BY used_count DESC
        LIMIT 5
      `);

      // 🚨 수정: storeId -> id, storeName -> name, usedCount -> usageCount
      return getRows(rawResult).map((row: any) => ({
        id: row.store_id, 
        name: row.store_name,
        category: 'restaurant', // 기본값
        usageCount: Number(row.used_count || 0),
        uniqueUsers: 0
      }));
    } catch (e) { return []; }
  }),

  hourlyPattern: publicProcedure.query(async () => {
    try {
      const db = await getDb();
      const rawResult = await db.execute(sql`
        SELECT EXTRACT(HOUR FROM COALESCE(uc.used_at, uc.updated_at))::integer as hour, COUNT(*) as count
        FROM ${userCoupons} uc
        WHERE (uc.used_at IS NOT NULL OR uc.status = 'used')
        GROUP BY 1
        ORDER BY 1 ASC
      `);
      return getRows(rawResult).map((row: any) => ({
        hour: Number(row.hour || 0),
        count: Number(row.count || 0)
      }));
    } catch (e) { return []; }
  }),

  categoryDistribution: publicProcedure.query(async () => {
    try {
      const db = await getDb();
      const rawResult = await db.execute(sql`
        SELECT c.category, COUNT(*) as count
        FROM ${userCoupons} uc
        JOIN ${coupons} c ON uc.coupon_id = c.id
        WHERE (uc.used_at IS NOT NULL OR uc.status = 'used')
        GROUP BY c.category
      `);
      // 🚨 수정: name -> category, value -> count
      return getRows(rawResult).map((row: any) => ({
        category: row.category || '기타',
        count: Number(row.count || 0)
      }));
    } catch (e) { return [{ category: 'No Data', count: 0 }]; }
  }),

  // =========================================================
  // 3. 사용자 분석
  // =========================================================
  dailySignups: publicProcedure.query(async () => {
    try {
      const db = await getDb();
      const result = await db.execute(sql`
        SELECT TO_CHAR(created_at, 'YYYY-MM-DD') as date, COUNT(*) as count
        FROM ${users}
        WHERE created_at >= NOW() - INTERVAL '30 days'
        GROUP BY 1 ORDER BY 1 ASC
      `);
      return getRows(result).map((row: any) => ({ date: row.date, count: Number(row.count) }));
    } catch (e) { return []; }
  }),

  dailyActiveUsers: publicProcedure.query(async () => {
    try {
      const db = await getDb();
      const result = await db.execute(sql`
        SELECT TO_CHAR(last_signed_in, 'YYYY-MM-DD') as date, COUNT(DISTINCT id) as count
        FROM ${users}
        WHERE last_signed_in >= NOW() - INTERVAL '30 days'
        GROUP BY 1 ORDER BY 1 ASC
      `);
      return getRows(result).map((row: any) => ({ date: row.date, count: Number(row.count) }));
    } catch (e) { return []; }
  }),

  cumulativeUsers: publicProcedure.query(async () => {
    try {
      const db = await getDb();
      const result = await db.execute(sql`
        SELECT TO_CHAR(created_at, 'YYYY-MM-DD') as date, COUNT(*) as daily_count,
               SUM(COUNT(*)) OVER (ORDER BY TO_CHAR(created_at, 'YYYY-MM-DD')) as cumulative
        FROM ${users}
        WHERE created_at >= NOW() - INTERVAL '90 days'
        GROUP BY 1 ORDER BY 1 ASC
      `);
      return getRows(result).map((row: any) => ({
        date: row.date,
        dailyCount: Number(row.daily_count),
        cumulative: Number(row.cumulative)
      }));
    } catch (e) { return []; }
  }),

  demographicDistribution: publicProcedure.query(async () => {
    try {
      const db = await getDb();
      const ageResult = await db.execute(sql`SELECT COALESCE(age_group, 'Unknown') as age_group, COUNT(*) as count FROM ${users} GROUP BY 1`);
      const genderResult = await db.execute(sql`SELECT COALESCE(gender, 'Unknown') as gender, COUNT(*) as count FROM ${users} GROUP BY 1`);
      
      return {
        ageDistribution: getRows(ageResult).map((row: any) => ({ ageGroup: row.age_group, count: Number(row.count) })),
        genderDistribution: getRows(genderResult).map((row: any) => ({ gender: row.gender, count: Number(row.count) }))
      };
    } catch (e) { return { ageDistribution: [], genderDistribution: [] }; }
  }),

  // =========================================================
  // 4. 매장 상세 분석
  // =========================================================
  storeDetails: publicProcedure
    .input(z.object({ storeId: z.union([z.number(), z.string(), z.nan()]) }))
    .query(async ({ input }) => {
      try {
        const storeId = Number(input.storeId);
        if (isNaN(storeId)) return { downloads: [], usages: [] };

        const db = await getDb();
        const downloads = await db.execute(sql`
          SELECT uc.id, uc.downloaded_at, uc.status, c.title, u.name as user_name
          FROM ${userCoupons} uc
          JOIN ${coupons} c ON c.id = uc.coupon_id
          LEFT JOIN ${users} u ON u.id = uc.user_id
          WHERE c.store_id = ${storeId}
          ORDER BY uc.downloaded_at DESC LIMIT 50
        `);

        const usages = await db.execute(sql`
          SELECT uc.id, uc.used_at, c.title, u.name as user_name
          FROM ${userCoupons} uc
          JOIN ${coupons} c ON c.id = uc.coupon_id
          LEFT JOIN ${users} u ON u.id = uc.user_id
          WHERE c.store_id = ${storeId} AND (uc.status = 'used' OR uc.used_at IS NOT NULL)
          ORDER BY uc.used_at DESC LIMIT 50
        `);

        return {
          downloads: getRows(downloads).map((row: any) => ({
            id: row.id, downloadedAt: row.downloaded_at, status: row.status, couponTitle: row.title, userName: row.user_name || 'Unknown'
          })),
          usages: getRows(usages).map((row: any) => ({
            id: row.id, usedAt: row.used_at, couponTitle: row.title, userName: row.user_name || 'Unknown'
          }))
        };
      } catch (e) { return { downloads: [], usages: [] }; }
    }),
});