// ✅ ANALYTICS ROUTER: Type-Safe Implementation (Canonical Ver.)
import { router, publicProcedure } from "./trpc";
import { z } from "zod";
import { getDb } from "./db";
import { sql } from "drizzle-orm";
import { coupons, userCoupons, stores } from "../drizzle/schema";

// 1. [Type Definition] DB에서 넘어올 데이터 모양 정의
interface UsageTrendRow {
  date: string;
  count: string | number;
  discount_value: string | number;
  active_users: string | number;
}

interface TopStoreRow {
  store_id: number;
  store_name: string;
  used_count: string | number;
  total_discount: string | number;
}

interface HourlyPatternRow {
  hour: number;
  count: string | number;
}

interface CategoryDistRow {
  category: string;
  count: string | number;
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

        // 🛡️ [Type Safe] any 대신 명확한 타입으로 캐스팅
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
        `) as unknown as { rows: UsageTrendRow[] };

        if (!result || !result.rows) return [];

        return result.rows.map((row) => ({
          date: row.date,
          count: Number(row.count || 0),
          discountValue: Number(row.discount_value || 0),
          activeUsers: Number(row.active_users || 0),
          totalUsed: Number(row.count || 0)
        }));
      } catch (e) {
        console.error("UsageTrend Error:", e);
        return []; 
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
      `) as unknown as { rows: TopStoreRow[] }; // 🛡️ 타입 명시
      
      if (!result || !result.rows) return [];

      return result.rows.map((row) => ({
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
      `) as unknown as { rows: HourlyPatternRow[] }; // 🛡️ 타입 명시

      if (!result || !result.rows) return [];

      return result.rows.map((row) => ({
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
      `) as unknown as { rows: CategoryDistRow[] }; // 🛡️ 타입 명시

      if (!result || !result.rows) return [];

      return result.rows.map((row) => ({
        name: row.category || 'Uncategorized',
        value: Number(row.count || 0)
      }));
    } catch (e) { return [{ name: 'No Data', value: 0 }]; }
  }),
});