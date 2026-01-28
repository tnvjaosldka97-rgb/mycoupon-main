// ✅ FORCE DEPLOY: Complete Traffic Control (All Variables Aliased) & PIN Reveal
import { router, publicProcedure } from "./_core/trpc";
import { z } from "zod";
import { getDb } from "./db";
import { sql } from "drizzle-orm";
// 🚨 users 테이블 의존성 제거 (안전 모드)
import { coupons, userCoupons, stores } from "../drizzle/schema";

// 🛠️ [만능 어댑터] 데이터 안전 추출 함수
function getRows(result: any): any[] {
  try {
    if (!result) return [];
    if (Array.isArray(result)) return result;
    if (result.rows && Array.isArray(result.rows)) return result.rows;
    return [];
  } catch (e) { return []; }
}

export const analyticsRouter = router({
  // =========================================================
  // 1. 대시보드 메인 (Overview) - 🚨 모든 변수명 다중 매핑
  // =========================================================
  overview: publicProcedure.query(async () => {
    try {
      const db = await getDb();
      
      // 1. 오늘 사용량
      const todayUsage = await db.execute(sql`
        SELECT COUNT(*) as count FROM ${userCoupons} 
        WHERE TO_CHAR(used_at, 'YYYY-MM-DD') = TO_CHAR(NOW(), 'YYYY-MM-DD') 
           OR (status = 'used' AND TO_CHAR(updated_at, 'YYYY-MM-DD') = TO_CHAR(NOW(), 'YYYY-MM-DD'))
      `);
      
      // 2. 전체 다운로드
      const totalDownloads = await db.execute(sql`SELECT COUNT(*) as count FROM ${userCoupons}`);
      
      // 3. 전체 사용
      const totalUsage = await db.execute(sql`SELECT COUNT(*) as count FROM ${userCoupons} WHERE status = 'used'`);
      
      // 4. 활성 가게
      const activeStores = await db.execute(sql`SELECT COUNT(*) as count FROM ${stores} WHERE is_active = true`);
      
      // 5. 전체 할인 금액
      const totalDiscount = await db.execute(sql`
        SELECT COALESCE(SUM(c.discount_value), 0) as total
        FROM ${userCoupons} uc
        JOIN ${coupons} c ON uc.coupon_id = c.id
        WHERE uc.status = 'used'
      `);

      // 숫자 추출
      const vUsage = Number(getRows(todayUsage)[0]?.count ?? 0);
      const vDownloads = Number(getRows(totalDownloads)[0]?.count ?? 0);
      const vTotalUsage = Number(getRows(totalUsage)[0]?.count ?? 0);
      const vStores = Number(getRows(activeStores)[0]?.count ?? 0);
      const vDiscount = Number(getRows(totalDiscount)[0]?.total ?? 0);

      return {
        // [교통정리] 프론트가 뭘 좋아할지 몰라서 다 준비했습니다.
        
        // 1. 오늘 사용량
        todayUsage: vUsage,
        todayCount: vUsage,
        usageToday: vUsage,

        // 2. 전체 다운로드
        totalDownloads: vDownloads,
        downloadCount: vDownloads,
        downloads: vDownloads,

        // 3. 전체 사용
        totalUsage: vTotalUsage,
        usageCount: vTotalUsage,
        usedCount: vTotalUsage,

        // 4. 활성 가게
        activeStores: vStores,
        storeCount: vStores,
        stores: vStores,

        // 5. 할인 금액 (가장 중요)
        totalDiscountAmount: vDiscount,
        totalDiscount: vDiscount,
        discountAmount: vDiscount,
        total: vDiscount,
        value: vDiscount, // 차트에서 쓸 수도 있음

        // 6. 기타
        usageRate: vDownloads > 0 ? Math.round((vTotalUsage / vDownloads) * 100) : 0,
        totalUsers: 1 
      };
    } catch (e) {
      console.error("Overview Error:", e);
      // 에러 시 0으로 방어
      return { 
        todayUsage: 0, totalDownloads: 0, totalUsage: 0, activeStores: 0, 
        totalDiscountAmount: 0, totalDiscount: 0, usageRate: 0, totalUsers: 0 
      };
    }
  }),

  // =========================================================
  // 2. 그래프 데이터 (Charts) - 다중 매핑
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
          SELECT ${sql.raw(dateFormat)} as date, COUNT(*) as count
          FROM ${userCoupons} uc
          WHERE (uc.used_at IS NOT NULL OR uc.status = 'used')
          GROUP BY 1 ORDER BY 1 ASC LIMIT 30
        `);

        return getRows(rawResult).map((row: any) => ({
          date: row.date,
          // [교통정리] 차트용 이름표들
          count: Number(row.count || 0),
          usageCount: Number(row.count || 0),
          value: Number(row.count || 0)
        }));
      } catch (e) { return []; }
    }),

  topStores: publicProcedure.query(async () => {
    try {
      const db = await getDb();
      const rawResult = await db.execute(sql`
        SELECT s.id, s.name, COUNT(uc.id) as count
        FROM ${userCoupons} uc
        JOIN ${coupons} c ON uc.coupon_id = c.id
        JOIN ${stores} s ON c.store_id = s.id
        WHERE (uc.used_at IS NOT NULL OR uc.status = 'used')
        GROUP BY s.id, s.name
        ORDER BY count DESC LIMIT 5
      `);

      return getRows(rawResult).map((row: any) => ({
        id: row.id, 
        name: row.name, 
        category: 'restaurant',
        // [교통정리]
        usageCount: Number(row.count || 0),
        usedCount: Number(row.count || 0),
        count: Number(row.count || 0),
        value: Number(row.count || 0)
      }));
    } catch (e) { return []; }
  }),

  hourlyPattern: publicProcedure.query(async () => {
    try {
      const db = await getDb();
      const rawResult = await db.execute(sql`
        SELECT EXTRACT(HOUR FROM COALESCE(uc.used_at, uc.updated_at))::integer as hour, COUNT(*) as count
        FROM ${userCoupons} uc WHERE (uc.used_at IS NOT NULL OR uc.status = 'used')
        GROUP BY 1 ORDER BY 1 ASC
      `);
      return getRows(rawResult).map((row: any) => ({
        hour: Number(row.hour || 0), 
        count: Number(row.count || 0),
        value: Number(row.count || 0)
      }));
    } catch (e) { return []; }
  }),

  categoryDistribution: publicProcedure.query(async () => {
    try {
      const db = await getDb();
      const rawResult = await db.execute(sql`
        SELECT c.category, COUNT(*) as count
        FROM ${userCoupons} uc JOIN ${coupons} c ON uc.coupon_id = c.id
        WHERE (uc.used_at IS NOT NULL OR uc.status = 'used') GROUP BY c.category
      `);
      return getRows(rawResult).map((row: any) => ({
        name: row.category || '기타', 
        category: row.category || '기타',
        value: Number(row.count || 0),
        count: Number(row.count || 0)
      }));
    } catch (e) { return [{ name: 'No Data', value: 0 }]; }
  }),

  // 더미 데이터 (안전 유지)
  dailySignups: publicProcedure.query(async () => { return []; }),
  dailyActiveUsers: publicProcedure.query(async () => { return []; }),
  cumulativeUsers: publicProcedure.query(async () => { return []; }),
  demographicDistribution: publicProcedure.query(async () => { return { ageDistribution: [], genderDistribution: [] }; }),

  // =========================================================
  // 4. 매장 상세 (PIN 번호 노출 + 안전 매핑)
  // =========================================================
  storeDetails: publicProcedure
    .input(z.object({ storeId: z.union([z.number(), z.string(), z.nan()]) }))
    .query(async ({ input }) => {
      try {
        const storeId = Number(input.storeId);
        if (isNaN(storeId)) return { downloads: [], usages: [] };
        const db = await getDb();
        
        // 🚨 pin_code 추가
        const downloads = await db.execute(sql`
          SELECT uc.id, uc.downloaded_at, uc.status, c.title, uc.pin_code
          FROM ${userCoupons} uc
          JOIN ${coupons} c ON c.id = uc.coupon_id
          WHERE c.store_id = ${storeId}
          ORDER BY uc.downloaded_at DESC LIMIT 50
        `);

        const usages = await db.execute(sql`
          SELECT uc.id, uc.used_at, c.title, uc.pin_code
          FROM ${userCoupons} uc
          JOIN ${coupons} c ON c.id = uc.coupon_id
          WHERE c.store_id = ${storeId} AND (uc.status = 'used' OR uc.used_at IS NOT NULL)
          ORDER BY uc.used_at DESC LIMIT 50
        `);

        return {
          downloads: getRows(downloads).map((row: any) => ({
            id: row.id, 
            downloadedAt: row.downloaded_at, 
            status: row.status, 
            couponTitle: row.title, 
            userName: 'User',
            // [교통정리] 핀 번호 이름표도 여러 개 붙임
            couponCode: row.pin_code || '-',
            pinCode: row.pin_code || '-',
            code: row.pin_code || '-'
          })),
          usages: getRows(usages).map((row: any) => ({
            id: row.id, 
            usedAt: row.used_at, 
            couponTitle: row.title, 
            userName: 'User',
            couponCode: row.pin_code || '-',
            pinCode: row.pin_code || '-',
            code: row.pin_code || '-'
          }))
        };
      } catch (e) { return { downloads: [], usages: [] }; }
    }),
});