// ✅ ANALYTICS ROUTER: The "Universal Adapter" Fix (2026-01-28)
import { router, publicProcedure } from "./trpc";
import { z } from "zod";
import { getDb } from "./db";
import { sql } from "drizzle-orm";
import { coupons, userCoupons, stores } from "../drizzle/schema";

// 🛠️ [핵심] 박스가 있든 없든 데이터만 쏙 빼내는 함수
function getRows(result: any): any[] {
  if (!result) return [];
  // 1. 그냥 배열로 왔을 때 (postgres-js 방식)
  if (Array.isArray(result)) return result;
  // 2. .rows 안에 담겨 왔을 때 (node-postgres 방식)
  if (result.rows && Array.isArray(result.rows)) return result.rows;
  // 3. 모르면 빈 배열
  return [];
}

export const analyticsRouter = router({
  // 1. 일별/주별/월별 추세
  usageTrend: publicProcedure
    .input(z.object({ period: z.enum(['daily', 'weekly', 'monthly']) }))
    .query(async ({ input }) => {
      try {
        const db = await getDb();
        
        let dateFormat = "TO_CHAR(uc.used_at, 'YYYY-MM-DD')";
        if (input.period === 'weekly') dateFormat = "TO_CHAR(uc.used_at, 'IYYY-IW')"; 
        if (input.period === 'monthly') dateFormat = "TO_CHAR(uc.used_at, 'YYYY-MM')";

        const rawResult = await db.execute(sql`
          SELECT 
            ${sql.raw(dateFormat)} as date,
            COUNT(*) as count,
            SUM(c.discount_value) as discount_value,
            COUNT(DISTINCT uc.user_id) as active_users
          FROM ${userCoupons} uc
          JOIN ${coupons} c ON uc.coupon_id = c.id
          WHERE uc.used_at IS NOT NULL
          GROUP BY 1
          ORDER BY 1 DESC
          LIMIT 30
        `);

        // 🛡️ 만능 함수로 데이터 추출
        const rows = getRows(rawResult);

        return rows.map((row: any) => ({
          date: row.date,
          count: Number(row.count || 0),
          discountValue: Number(row.discount_value || 0),
          activeUsers: Number(row.active_users || 0),
          totalUsed: Number(row.count || 0)
        }));
      } catch (e) {
        console.error("Analytics Error (usageTrend):", e);
        return []; 
      }
    }),

  // 2. 인기 매장 TOP 5
  topStores: publicProcedure.query(async () => {
    try {
      const db = await getDb();
      const rawResult = await db.execute(sql`
        SELECT 
          s.id as store_id,
          s.name as store_name,
          COUNT(uc.id) as used_count,
          SUM(c.discount_value) as total_discount
        FROM ${userCoupons} uc
        JOIN ${coupons} c ON uc.coupon_id = c.id
        JOIN ${stores} s ON c.store_id = s.id
        WHERE uc.used_at IS NOT NULL
        GROUP BY s.id, s.name
        ORDER BY used_count DESC
        LIMIT 5
      `);

      const rows = getRows(rawResult);

      return rows.map((row: any) => ({
        storeId: row.store_id,
        storeName: row.store_name,
        usedCount: Number(row.used_count || 0),
        totalDiscount: Number(row.total_discount || 0)
      }));
    } catch (e) { return []; }
  }),

  // 3. 시간대별 분석
  hourlyPattern: publicProcedure.query(async () => {
    try {
      const db = await getDb();
      const rawResult = await db.execute(sql`
        SELECT 
          EXTRACT(HOUR FROM uc.used_at)::integer as hour,
          COUNT(*) as count
        FROM ${userCoupons} uc
        WHERE uc.used_at IS NOT NULL
        GROUP BY 1
        ORDER BY 1 ASC
      `);

      const rows = getRows(rawResult);

      return rows.map((row: any) => ({
        hour: Number(row.hour || 0),
        count: Number(row.count || 0)
      }));
    } catch (e) { return []; }
  }),

  // 4. 카테고리 분포
  categoryDistribution: publicProcedure.query(async () => {
    try {
      const db = await getDb();
      const rawResult = await db.execute(sql`
        SELECT 
          c.category,
          COUNT(*) as count
        FROM ${userCoupons} uc
        JOIN ${coupons} c ON uc.coupon_id = c.id
        WHERE uc.used_at IS NOT NULL
        GROUP BY c.category
      `);

      const rows = getRows(rawResult);

      return rows.map((row: any) => ({
        name: row.category || 'Uncategorized',
        value: Number(row.count || 0)
      }));
    } catch (e) { return [{ name: 'No Data', value: 0 }]; }
  }),
});