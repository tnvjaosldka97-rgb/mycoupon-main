// PostgreSQL 엔진 강제 적용 (수정함)
import { router, publicProcedure } from "./trpc";
import { z } from "zod";
import { getDb } from "./db";
import { sql } from "drizzle-orm";
// 테이블 이름 매핑용 스키마
import { coupons, userCoupons, stores } from "../drizzle/schema";

export const analyticsRouter = router({
  // 1. 일별/주별/월별 추세 (PostgreSQL 문법)
  usageTrend: publicProcedure
    .input(z.object({ period: z.enum(['daily', 'weekly', 'monthly']) }))
    .query(async ({ input }) => {
      const db = await getDb();
      
      // ✅ PostgreSQL 날짜 포맷
      let dateFormat = "TO_CHAR(uc.used_at, 'YYYY-MM-DD')";
      if (input.period === 'weekly') dateFormat = "TO_CHAR(uc.used_at, 'IYYY-IW')"; 
      if (input.period === 'monthly') dateFormat = "TO_CHAR(uc.used_at, 'YYYY-MM')";

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

      // ✅ 매핑: 뱀(DB) -> 낙타(Front)
      return result.rows.map((row: any) => ({
        date: row.date,
        count: Number(row.count),
        discountValue: Number(row.discount_value || 0),
        activeUsers: Number(row.active_users || 0),
        totalUsed: Number(row.count)
      }));
    }),

  // 2. 인기 매장 TOP 5
  topStores: publicProcedure.query(async () => {
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

    return result.rows.map((row: any) => ({
      storeId: row.store_id,
      storeName: row.store_name,
      usedCount: Number(row.used_count),
      totalDiscount: Number(row.total_discount || 0)
    }));
  }),

  // 3. 시간대별 분석 (PostgreSQL 문법)
  hourlyPattern: publicProcedure.query(async () => {
    const db = await getDb();
    // ✅ PostgreSQL 시간 추출 (EXTRACT)
    const result = await db.execute(sql`
      SELECT 
        EXTRACT(HOUR FROM uc.used_at)::integer as hour,
        COUNT(*) as count
      FROM ${userCoupons} uc
      WHERE uc.used_at IS NOT NULL
      GROUP BY 1
      ORDER BY 1 ASC
    `);

    return result.rows.map((row: any) => ({
      hour: Number(row.hour),
      count: Number(row.count)
    }));
  }),

  // 4. 카테고리 분포
  categoryDistribution: publicProcedure.query(async () => {
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

    return result.rows.map((row: any) => ({
      name: row.category || 'Uncategorized',
      value: Number(row.count)
    }));
  }),
});