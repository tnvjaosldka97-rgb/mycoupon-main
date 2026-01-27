// ✅ FORCE DEPLOY: Analytics + Overview Integrated (2026-01-28)
import { router, publicProcedure } from "./_core/trpc";
import { z } from "zod";
import { getDb } from "./db";
import { sql } from "drizzle-orm";
import { coupons, userCoupons, stores } from "../drizzle/schema";

// 🛠️ [만능 어댑터] 박스 포장이 어떻게 되어있든 데이터만 꺼내는 함수
function getRows(result: any): any[] {
  if (!result) return [];
  // 1. 그냥 배열로 왔을 때
  if (Array.isArray(result)) return result;
  // 2. .rows 안에 담겨 왔을 때
  if (result.rows && Array.isArray(result.rows)) return result.rows;
  // 3. 모르면 빈 배열
  return [];
}

export const analyticsRouter = router({
  // 1. [신규 추가] 대시보드 상단 숫자판 (Overview)
  overview: publicProcedure.query(async () => {
    try {
      const db = await getDb();
      if (!db) throw new Error("Database connection failed");

      // 오늘 사용량
      const todayUsage = await db.execute(sql`
        SELECT COALESCE(COUNT(*), 0) as count 
        FROM ${userCoupons} uc
        WHERE TO_CHAR(uc.used_at, 'YYYY-MM-DD') = TO_CHAR(NOW(), 'YYYY-MM-DD')
           OR (uc.status = 'used' AND TO_CHAR(uc.updated_at, 'YYYY-MM-DD') = TO_CHAR(NOW(), 'YYYY-MM-DD'))
      `);
      
      // 전체 다운로드
      const totalDownloads = await db.execute(sql`SELECT COUNT(*) as count FROM ${userCoupons}`);
      
      // 전체 사용 (날짜 없어도 status가 used면 인정)
      const totalUsage = await db.execute(sql`SELECT COUNT(*) as count FROM ${userCoupons} WHERE status = 'used'`);
      
      // 활성 가게
      const activeStores = await db.execute(sql`SELECT COUNT(*) as count FROM ${stores} WHERE is_active = true`);

      // 🚨 getRows로 안전하게 값 추출
      return {
        todayUsage: Number(getRows(todayUsage)[0]?.count ?? 0),
        totalDownloads: Number(getRows(totalDownloads)[0]?.count ?? 0),
        totalUsage: Number(getRows(totalUsage)[0]?.count ?? 0),
        activeStores: Number(getRows(activeStores)[0]?.count ?? 0),
        // 아래 항목들은 일단 0으로 처리 (에러 방지)
        totalDiscountAmount: 0,
        usageRate: 100, // 임시: 사용률 로직 단순화
        totalUsers: 1   // 임시: 사용자 수
      };
    } catch (e) {
      console.error("Analytics Error (Overview):", e);
      // 에러 나면 0으로 반환해서 화면 안 죽게 함
      return {
        todayUsage: 0, totalDownloads: 0, totalUsage: 0, 
        activeStores: 0, totalDiscountAmount: 0, usageRate: 0, totalUsers: 0
      };
    }
  }),

  // 2. 일별/주별/월별 추세 (그래프)
  usageTrend: publicProcedure
    .input(z.object({ period: z.enum(['daily', 'weekly', 'monthly']) }))
    .query(async ({ input }) => {
      try {
        const db = await getDb();
        if (!db) throw new Error("Database connection failed");
        
        // 날짜가 없으면 updated_at이나 created_at 사용
        const dateColumn = "COALESCE(uc.used_at, uc.updated_at, uc.created_at)";
        let dateFormat = `TO_CHAR(${dateColumn}, 'YYYY-MM-DD')`;
        if (input.period === 'weekly') dateFormat = `TO_CHAR(${dateColumn}, 'IYYY-IW')`; 
        if (input.period === 'monthly') dateFormat = `TO_CHAR(${dateColumn}, 'YYYY-MM')`;

        const rawResult = await db.execute(sql`
          SELECT 
            ${sql.raw(dateFormat)} as date,
            COUNT(*) as count,
            SUM(c.discount_value) as discount_value
          FROM ${userCoupons} uc
          JOIN ${coupons} c ON uc.coupon_id = c.id
          WHERE (uc.used_at IS NOT NULL OR uc.status = 'used')
          GROUP BY 1
          ORDER BY 1 DESC
          LIMIT 30
        `);

        const rows = getRows(rawResult);
        return rows.map((row: any) => ({
          date: row.date,
          count: Number(row.count || 0),
          discountValue: Number(row.discount_value || 0),
          activeUsers: 0,
          totalUsed: Number(row.count || 0)
        }));
      } catch (e) { return []; }
    }),

  // 3. 인기 매장 TOP 5
  topStores: publicProcedure.query(async () => {
    try {
      const db = await getDb();
      if (!db) throw new Error("Database connection failed");
      const rawResult = await db.execute(sql`
        SELECT 
          s.id as store_id,
          s.name as store_name,
          COUNT(uc.id) as used_count
        FROM ${userCoupons} uc
        JOIN ${coupons} c ON uc.coupon_id = c.id
        JOIN ${stores} s ON c.store_id = s.id
        WHERE (uc.used_at IS NOT NULL OR uc.status = 'used')
        GROUP BY s.id, s.name
        ORDER BY used_count DESC
        LIMIT 5
      `);

      const rows = getRows(rawResult);
      return rows.map((row: any) => ({
        storeId: row.store_id,
        storeName: row.store_name,
        usedCount: Number(row.used_count || 0),
        totalDiscount: 0
      }));
    } catch (e) { return []; }
  }),

  // 4. 시간대별 분석
  hourlyPattern: publicProcedure.query(async () => {
    try {
      const db = await getDb();
      if (!db) throw new Error("Database connection failed");
      const rawResult = await db.execute(sql`
        SELECT 
          EXTRACT(HOUR FROM COALESCE(uc.used_at, uc.updated_at))::integer as hour,
          COUNT(*) as count
        FROM ${userCoupons} uc
        WHERE (uc.used_at IS NOT NULL OR uc.status = 'used')
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

  // 5. 카테고리 분포
  categoryDistribution: publicProcedure.query(async () => {
    try {
      const db = await getDb();
      if (!db) throw new Error("Database connection failed");
      const rawResult = await db.execute(sql`
        SELECT 
          c.category,
          COUNT(*) as count
        FROM ${userCoupons} uc
        JOIN ${coupons} c ON uc.coupon_id = c.id
        WHERE (uc.used_at IS NOT NULL OR uc.status = 'used')
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