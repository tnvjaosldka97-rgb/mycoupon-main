// ✅ FORCE DEPLOY: Safe Mode Analytics 2 (진짜 마지막)
import { router, publicProcedure } from "./trpc";
import { z } from "zod";
import { getDb } from "./db";
import { sql } from "drizzle-orm";
// 🚨 핵심: 테이블 이름을 자동 매핑해주는 스키마 가져오기
import { coupons, userCoupons, stores } from "../drizzle/schema";

export const analyticsRouter = router({
  // 1. 일별/주별/월별 추세 (안전장치 포함)
  usageTrend: publicProcedure
    .input(z.object({ period: z.enum(['daily', 'weekly', 'monthly']) }))
    .query(async ({ input }) => {
      try {
        const db = await getDb();
        
        // PostgreSQL 날짜 포맷
        let dateFormat = "TO_CHAR(uc.used_at, 'YYYY-MM-DD')";
        if (input.period === 'weekly') dateFormat = "TO_CHAR(uc.used_at, 'IYYY-IW')"; 
        if (input.period === 'monthly') dateFormat = "TO_CHAR(uc.used_at, 'YYYY-MM')";

        // ${userCoupons}를 써서 실제 테이블 이름과 자동 연결
        const result = await db.execute(sql`
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

        if (!result || !result.rows) return [];

        return result.rows.map((row: any) => ({
          date: row.date,
          count: Number(row.count || 0),
          discountValue: Number(row.discount_value || 0),
          activeUsers: Number(row.active_users || 0),
          totalUsed: Number(row.count || 0)
        }));
      } catch (e) {
        console.error("UsageTrend Error:", e);
        return []; // 에러 나면 빈 배열 반환 (앱 멈춤 방지)
      }
    }),

  // 2. 인기 매장 TOP 5
  topStores: publicProcedure.query(async () => {
    try {
      const db = await getDb();
      const result = await db.execute(sql`
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
      
      if (!result || !result.rows) return [];

      return result.rows.map((row: any) => ({
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
      const result = await db.execute(sql`
        SELECT 
          EXTRACT(HOUR FROM uc.used_at)::integer as hour,
          COUNT(*) as count
        FROM ${userCoupons} uc
        WHERE uc.used_at IS NOT NULL
        GROUP BY 1
        ORDER BY 1 ASC
      `);

      if (!result || !result.rows) return [];

      return result.rows.map((row: any) => ({
        hour: Number(row.hour || 0),
        count: Number(row.count || 0)
      }));
    } catch (e) { return []; }
  }),

  // 4. 카테고리 분포
  categoryDistribution: publicProcedure.query(async () => {
    try {
      const db = await getDb();
      const result = await db.execute(sql`
        SELECT 
          c.category,
          COUNT(*) as count
        FROM ${userCoupons} uc
        JOIN ${coupons} c ON uc.coupon_id = c.id
        WHERE uc.used_at IS NOT NULL
        GROUP BY c.category
      `);

      if (!result || !result.rows) return [];

      return result.rows.map((row: any) => ({
        name: row.category || 'Uncategorized',
        value: Number(row.count || 0)
      }));
    } catch (e) { return [{ name: 'No Data', value: 0 }]; }
  }),
});