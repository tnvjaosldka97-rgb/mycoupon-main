// ============================================
// Analytics Router - PostgreSQL Compatibl1
// Based on Manus/Gemini guidance, adapted for current project structure
// ============================================

import { router, publicProcedure, protectedProcedure } from "./_core/trpc";
import { z } from "zod";
import { getDb } from "./db";
import { sql } from "drizzle-orm";
import { coupons, userCoupons, stores, users, couponUsage } from "../drizzle/schema";

// Helper function to safely extract rows from query results
function getRows(result: any): any[] {
  if (!result) return [];
  if (Array.isArray(result)) return result;
  if (result.rows && Array.isArray(result.rows)) return result.rows;
  return [];
}

export const analyticsRouter = router({
  // ========================================
  // 1. Dashboard Overview
  // ========================================
  overview: protectedProcedure
    .use(({ ctx, next }) => {
      if (ctx.user.role !== 'admin') {
        throw new Error('Admin access required');
      }
      return next({ ctx });
    })
    .query(async () => {
      const db = await getDb();
      
      // Today's usage
      const todayUsage = await db.execute(sql`
        SELECT COALESCE(COUNT(*), 0) as count 
        FROM coupon_usage 
        WHERE DATE(used_at) = CURRENT_DATE
      `);
      
      // Total downloads
      const totalDownloads = await db.execute(sql`
        SELECT COALESCE(COUNT(*), 0) as count 
        FROM user_coupons
      `);
      
      // Total usage (including status='used' even if used_at is null)
      const totalUsage = await db.execute(sql`
        SELECT COALESCE(COUNT(*), 0) as count 
        FROM user_coupons 
        WHERE status = 'used'
      `);
      
      // Active stores — 정합성: activeStoresList SQL 과 동일 가드 적용
      // (deleted_at IS NULL 가드 누락 시 soft-deleted store 카운트 → list 와 mismatch)
      const activeStores = await db.execute(sql`
        SELECT COALESCE(COUNT(*), 0) as count
        FROM stores
        WHERE is_active = true
          AND deleted_at IS NULL
      `);
      
      // Total discount amount
      const totalDiscount = await db.execute(sql`
        SELECT COALESCE(SUM(c.discount_value), 0) as total
        FROM coupon_usage cu
        JOIN user_coupons uc ON uc.id = cu.user_coupon_id
        JOIN coupons c ON c.id = uc.coupon_id
      `);
      
      // Usage rate
      const usageRate = await db.execute(sql`
        SELECT 
          CASE 
            WHEN COUNT(*) > 0 
            THEN ROUND((SUM(CASE WHEN status = 'used' THEN 1 ELSE 0 END) * 100.0 / COUNT(*))::numeric, 1)
            ELSE 0 
          END as rate
        FROM user_coupons
      `);
      
      // Total users
      const totalUsers = await db.execute(sql`
        SELECT COALESCE(COUNT(*), 0) as count FROM users
      `);

      const result = {
        todayUsage: Number(getRows(todayUsage)[0]?.count ?? 0),
        totalDownloads: Number(getRows(totalDownloads)[0]?.count ?? 0),
        totalUsage: Number(getRows(totalUsage)[0]?.count ?? 0),
        activeStores: Number(getRows(activeStores)[0]?.count ?? 0),
        totalDiscountAmount: Number(getRows(totalDiscount)[0]?.total ?? 0),
        usageRate: Number(getRows(usageRate)[0]?.rate ?? 0),
        totalUsers: Number(getRows(totalUsers)[0]?.count ?? 0),
      };
      
      console.log('[Analytics Overview] Result:', result);
      return result;
    }),

  // ========================================
  // 1-A. Overview 카드 클릭 시 상세 리스트
  // ========================================

  /** 사용 상세 — today=true 면 오늘, 아니면 최근 N건 */
  usageDetail: protectedProcedure
    .use(({ ctx, next }) => {
      if (ctx.user.role !== 'admin') throw new Error('Admin access required');
      return next({ ctx });
    })
    .input(z.object({
      today: z.boolean().optional(),
      limit: z.number().int().min(1).max(500).optional(),
    }).optional())
    .query(async ({ input }) => {
      const db = await getDb();
      const lim = input?.limit ?? 100;
      const onlyToday = input?.today === true;

      const result = await db.execute(sql`
        SELECT
          cu.id          AS usage_id,
          cu.used_at,
          cu.user_id,
          u.name         AS user_name,
          u.email        AS user_email,
          c.id           AS coupon_id,
          c.title        AS coupon_title,
          c.discount_type,
          c.discount_value,
          s.id           AS store_id,
          s.name         AS store_name,
          s.category     AS store_category,
          s.naver_place_url
        FROM coupon_usage cu
        LEFT JOIN user_coupons uc ON uc.id = cu.user_coupon_id
        LEFT JOIN coupons c       ON c.id = uc.coupon_id
        LEFT JOIN stores s        ON s.id = cu.store_id
        LEFT JOIN users u         ON u.id = cu.user_id
        ${onlyToday ? sql`WHERE DATE(cu.used_at) = CURRENT_DATE` : sql``}
        ORDER BY cu.used_at DESC
        LIMIT ${lim}
      `);

      return getRows(result).map((r: any) => ({
        usageId: Number(r.usage_id),
        usedAt: r.used_at,
        userId: Number(r.user_id ?? 0),
        userName: r.user_name ?? null,
        userEmail: r.user_email ?? null,
        couponId: Number(r.coupon_id ?? 0),
        couponTitle: r.coupon_title ?? null,
        discountType: r.discount_type ?? null,
        discountValue: Number(r.discount_value ?? 0),
        storeId: Number(r.store_id ?? 0),
        storeName: r.store_name ?? null,
        storeCategory: r.store_category ?? null,
        naverPlaceUrl: r.naver_place_url ?? null,
      }));
    }),

  /** 다운로드 상세 — user_coupons (= 쿠폰 받은 이력) 최근 N건 */
  downloadDetail: protectedProcedure
    .use(({ ctx, next }) => {
      if (ctx.user.role !== 'admin') throw new Error('Admin access required');
      return next({ ctx });
    })
    .input(z.object({
      limit: z.number().int().min(1).max(500).optional(),
    }).optional())
    .query(async ({ input }) => {
      const db = await getDb();
      const lim = input?.limit ?? 100;

      const result = await db.execute(sql`
        SELECT
          uc.id              AS download_id,
          uc.downloaded_at,
          uc.status,
          uc.user_id,
          u.name             AS user_name,
          u.email            AS user_email,
          c.id               AS coupon_id,
          c.title            AS coupon_title,
          c.store_id,
          s.name             AS store_name,
          s.category         AS store_category,
          s.naver_place_url
        FROM user_coupons uc
        LEFT JOIN coupons c ON c.id = uc.coupon_id
        LEFT JOIN stores s  ON s.id = c.store_id
        LEFT JOIN users u   ON u.id = uc.user_id
        ORDER BY uc.downloaded_at DESC
        LIMIT ${lim}
      `);

      return getRows(result).map((r: any) => ({
        downloadId: Number(r.download_id),
        downloadedAt: r.downloaded_at,
        status: r.status,
        userId: Number(r.user_id ?? 0),
        userName: r.user_name ?? null,
        userEmail: r.user_email ?? null,
        couponId: Number(r.coupon_id ?? 0),
        couponTitle: r.coupon_title ?? null,
        storeId: Number(r.store_id ?? 0),
        storeName: r.store_name ?? null,
        storeCategory: r.store_category ?? null,
        naverPlaceUrl: r.naver_place_url ?? null,
      }));
    }),

  /** 활성 가게 상세 리스트 */
  activeStoresList: protectedProcedure
    .use(({ ctx, next }) => {
      if (ctx.user.role !== 'admin') throw new Error('Admin access required');
      return next({ ctx });
    })
    .query(async () => {
      const db = await getDb();
      const result = await db.execute(sql`
        SELECT
          s.id, s.name, s.category, s.address,
          s.is_active, s.created_at, s.naver_place_url,
          u.email AS owner_email, u.name AS owner_name,
          COALESCE(cnt.coupon_count, 0) AS coupon_count
        FROM stores s
        LEFT JOIN users u ON u.id = s.owner_id
        LEFT JOIN (
          SELECT store_id, COUNT(*) AS coupon_count
          FROM coupons
          WHERE is_active = TRUE AND approved_at IS NOT NULL
          GROUP BY store_id
        ) cnt ON cnt.store_id = s.id
        WHERE s.is_active = TRUE
          AND s.deleted_at IS NULL
        ORDER BY s.created_at DESC
      `);

      return getRows(result).map((r: any) => ({
        id: Number(r.id),
        name: r.name,
        category: r.category,
        address: r.address,
        ownerName: r.owner_name,
        ownerEmail: r.owner_email,
        couponCount: Number(r.coupon_count ?? 0),
        naverPlaceUrl: r.naver_place_url ?? null,
        createdAt: r.created_at,
      }));
    }),

  // ========================================
  // 2. Usage Trend (Daily/Weekly/Monthly)
  // ========================================
  usageTrend: protectedProcedure
    .use(({ ctx, next }) => {
      if (ctx.user.role !== 'admin') {
        throw new Error('Admin access required');
      }
      return next({ ctx });
    })
    .input(z.object({
      period: z.enum(['daily', 'weekly', 'monthly']).default('daily'),
    }))
    .query(async ({ input }) => {
      const db = await getDb();
      
      let dateFormat: string;
      let interval: string;
      
      switch (input.period) {
        case 'weekly':
          dateFormat = `DATE_TRUNC('week', used_at)`;
          interval = '12 weeks';
          break;
        case 'monthly':
          dateFormat = `DATE_TRUNC('month', used_at)`;
          interval = '12 months';
          break;
        default:
          dateFormat = `DATE(used_at)`;
          interval = '30 days';
      }
      
      const result = await db.execute(sql.raw(`
        SELECT 
          ${dateFormat} as date,
          COUNT(*) as usage_count,
          COUNT(DISTINCT user_id) as unique_users
        FROM coupon_usage
        WHERE used_at >= CURRENT_DATE - INTERVAL '${interval}'
        GROUP BY ${dateFormat}
        ORDER BY date ASC
      `));

      return getRows(result).map((row: any) => ({
        date: row.date,
        usageCount: Number(row.usage_count ?? 0),
        uniqueUsers: Number(row.unique_users ?? 0),
      }));
    }),

  // ========================================
  // 3. Top Stores
  // ========================================
  topStores: protectedProcedure
    .use(({ ctx, next }) => {
      if (ctx.user.role !== 'admin') {
        throw new Error('Admin access required');
      }
      return next({ ctx });
    })
    .input(z.object({
      limit: z.number().int().min(1).max(1000).optional(),
    }).optional())
    .query(async ({ input }) => {
      const db = await getDb();
      const lim = input?.limit ?? 10;

      const result = await db.execute(sql`
        SELECT
          s.id,
          s.name,
          s.category,
          COUNT(cu.id) as usage_count,
          COUNT(DISTINCT cu.user_id) as unique_users
        FROM stores s
        LEFT JOIN coupon_usage cu ON cu.store_id = s.id
        WHERE s.deleted_at IS NULL
        GROUP BY s.id, s.name, s.category
        ORDER BY usage_count DESC, s.id ASC
        LIMIT ${lim}
      `);

      return getRows(result).map((row: any) => ({
        id: Number(row.id),
        name: row.name,
        category: row.category,
        usageCount: Number(row.usage_count ?? 0),
        uniqueUsers: Number(row.unique_users ?? 0),
      }));
    }),

  // ========================================
  // 4. Hourly Pattern
  // ========================================
  hourlyPattern: protectedProcedure
    .use(({ ctx, next }) => {
      if (ctx.user.role !== 'admin') {
        throw new Error('Admin access required');
      }
      return next({ ctx });
    })
    .query(async () => {
      const db = await getDb();
      
      const result = await db.execute(sql`
        SELECT 
          EXTRACT(HOUR FROM used_at)::integer as hour,
          COUNT(*) as count
        FROM coupon_usage
        WHERE used_at >= CURRENT_DATE - INTERVAL '30 days'
        GROUP BY EXTRACT(HOUR FROM used_at)
        ORDER BY hour ASC
      `);

      // Create 24-hour array
      const hourlyData = Array.from({ length: 24 }, (_, i) => ({
        hour: i,
        count: 0,
      }));
      
      getRows(result).forEach((row: any) => {
        const hour = Number(row.hour);
        if (hour >= 0 && hour < 24) {
          hourlyData[hour].count = Number(row.count ?? 0);
        }
      });

      return hourlyData;
    }),

  // ========================================
  // 5. Category Distribution
  // ========================================
  categoryDistribution: protectedProcedure
    .use(({ ctx, next }) => {
      if (ctx.user.role !== 'admin') {
        throw new Error('Admin access required');
      }
      return next({ ctx });
    })
    .query(async () => {
      const db = await getDb();
      
      const result = await db.execute(sql`
        SELECT 
          CASE s.category
            WHEN 'cafe' THEN '☕ 카페'
            WHEN 'restaurant' THEN '🍽️ 맛집'
            WHEN 'beauty' THEN '💅 뷰티'
            WHEN 'hospital' THEN '🏥 병원'
            WHEN 'fitness' THEN '💪 헬스'
            ELSE '🎁 기타'
          END as category,
          COUNT(cu.id) as count
        FROM coupon_usage cu
        JOIN stores s ON s.id = cu.store_id
        GROUP BY s.category
        ORDER BY count DESC
      `);

      return getRows(result).map((row: any) => ({
        category: row.category,
        count: Number(row.count ?? 0),
      }));
    }),

  // ========================================
  // 6. Daily Signups
  // ========================================
  dailySignups: protectedProcedure
    .use(({ ctx, next }) => {
      if (ctx.user.role !== 'admin') {
        throw new Error('Admin access required');
      }
      return next({ ctx });
    })
    .input(z.object({
      days: z.number().default(30),
    }))
    .query(async ({ input }) => {
      const db = await getDb();
      
      const result = await db.execute(sql.raw(`
        SELECT 
          DATE(created_at) as date, 
          COUNT(*) as count
        FROM users
        WHERE created_at >= CURRENT_DATE - INTERVAL '${input.days} days'
        GROUP BY DATE(created_at)
        ORDER BY date ASC
      `));

      return getRows(result).map((row: any) => ({
        date: row.date,
        count: Number(row.count ?? 0),
      }));
    }),

  // ========================================
  // 7. Daily Active Users
  // ========================================
  dailyActiveUsers: protectedProcedure
    .use(({ ctx, next }) => {
      if (ctx.user.role !== 'admin') {
        throw new Error('Admin access required');
      }
      return next({ ctx });
    })
    .input(z.object({
      days: z.number().default(30),
    }))
    .query(async ({ input }) => {
      const db = await getDb();
      
      const result = await db.execute(sql.raw(`
        SELECT 
          DATE(last_signed_in) as date, 
          COUNT(DISTINCT id) as count
        FROM users
        WHERE last_signed_in >= CURRENT_DATE - INTERVAL '${input.days} days'
        GROUP BY DATE(last_signed_in)
        ORDER BY date ASC
      `));

      return getRows(result).map((row: any) => ({
        date: row.date,
        count: Number(row.count ?? 0),
      }));
    }),

  // ========================================
  // 8. Cumulative Users
  // ========================================
  cumulativeUsers: protectedProcedure
    .use(({ ctx, next }) => {
      if (ctx.user.role !== 'admin') {
        throw new Error('Admin access required');
      }
      return next({ ctx });
    })
    .input(z.object({
      days: z.number().default(30),
    }))
    .query(async ({ input }) => {
      const db = await getDb();
      
      const result = await db.execute(sql.raw(`
        SELECT 
          DATE(created_at) as date,
          COUNT(*) as daily_count,
          SUM(COUNT(*)) OVER (ORDER BY DATE(created_at)) as cumulative
        FROM users
        WHERE created_at >= CURRENT_DATE - INTERVAL '${input.days} days'
        GROUP BY DATE(created_at)
        ORDER BY date ASC
      `));

      return getRows(result).map((row: any) => ({
        date: row.date,
        dailyCount: Number(row.daily_count ?? 0),
        cumulative: Number(row.cumulative ?? 0),
      }));
    }),

  // ========================================
  // 9. Demographic Distribution
  // ========================================
  demographicDistribution: protectedProcedure
    .use(({ ctx, next }) => {
      if (ctx.user.role !== 'admin') {
        throw new Error('Admin access required');
      }
      return next({ ctx });
    })
    .query(async () => {
      try {
        const db = await getDb();
        
        const ageResult = await db.execute(sql`
          SELECT 
            COALESCE(age_group, '미설정') as age_group, 
            COUNT(*) as count
          FROM users
          GROUP BY age_group
          ORDER BY count DESC
        `);
        
        const genderResult = await db.execute(sql`
          SELECT 
            COALESCE(gender, '미설정') as gender, 
            COUNT(*) as count
          FROM users
          GROUP BY gender
          ORDER BY count DESC
        `);
        
        // Profile completion stats
        const profileCompletion = await db.execute(sql`
          SELECT 
            COUNT(*) as total,
            SUM(CASE WHEN profile_completed_at IS NOT NULL THEN 1 ELSE 0 END) as completed
          FROM users
        `);

        const result = {
          ageDistribution: getRows(ageResult).map((row: any) => ({
            ageGroup: row.age_group,
            count: Number(row.count ?? 0),
          })),
          genderDistribution: getRows(genderResult).map((row: any) => ({
            gender: row.gender,
            count: Number(row.count ?? 0),
          })),
          profileCompletion: {
            total: Number(getRows(profileCompletion)[0]?.total ?? 0),
            completed: Number(getRows(profileCompletion)[0]?.completed ?? 0),
          },
        };
        
        console.log('[Analytics] demographicDistribution:', result);
        return result;
      } catch (error) {
        console.error('[Analytics] demographicDistribution error:', error);
        return {
          ageDistribution: [],
          genderDistribution: [],
          profileCompletion: { total: 0, completed: 0 },
        };
      }
    }),

  // ========================================
  // 10. Store Stats
  // ========================================
  storeStats: protectedProcedure
    .use(({ ctx, next }) => {
      if (ctx.user.role !== 'admin') {
        throw new Error('Admin access required');
      }
      return next({ ctx });
    })
    .query(async () => {
  const db = await getDb();
      
      const result = await db.execute(sql`
        SELECT 
          s.id,
          s.name,
          s.category,
          s.rating,
          s.rating_count,
          COUNT(DISTINCT uc.id) as download_count,
          COUNT(DISTINCT cu.id) as usage_count
        FROM stores s
        LEFT JOIN coupons c ON c.store_id = s.id
        LEFT JOIN user_coupons uc ON uc.coupon_id = c.id
        LEFT JOIN coupon_usage cu ON cu.store_id = s.id
        GROUP BY s.id, s.name, s.category, s.rating, s.rating_count
        ORDER BY usage_count DESC
      `);

      return getRows(result).map((row: any) => ({
        id: Number(row.id),
        name: row.name,
        category: row.category,
        rating: Number(row.rating ?? 0),
        ratingCount: Number(row.rating_count ?? 0),
        downloadCount: Number(row.download_count ?? 0),
        usageCount: Number(row.usage_count ?? 0),
      }));
    }),

  // ========================================
  // 11. Competition
  // ========================================
  competition: protectedProcedure
    .use(({ ctx, next }) => {
      if (ctx.user.role !== 'admin') {
        throw new Error('Admin access required');
      }
      return next({ ctx });
    })
    .query(async () => {
      const db = await getDb();
      
      const result = await db.execute(sql`
        SELECT 
          s.id,
          s.name,
          s.category,
          s.rating,
          s.rating_count,
          COUNT(DISTINCT uc.id) as download_count,
          COUNT(DISTINCT cu.id) as usage_count,
          RANK() OVER (ORDER BY COUNT(DISTINCT cu.id) DESC) as rank
        FROM stores s
        LEFT JOIN coupons c ON c.store_id = s.id
        LEFT JOIN user_coupons uc ON uc.coupon_id = c.id
        LEFT JOIN coupon_usage cu ON cu.store_id = s.id
        GROUP BY s.id, s.name, s.category, s.rating, s.rating_count
        ORDER BY usage_count DESC
      `);

      // 카테고리별 상위 3개 업장
      const categoryLeadersResult = await db.execute(sql`
        SELECT * FROM (
          SELECT
            s.category, s.id, s.name, s.rating,
            COUNT(DISTINCT uc.id) as download_count,
            COUNT(DISTINCT cu.id) as usage_count,
            ROW_NUMBER() OVER (PARTITION BY s.category ORDER BY COUNT(DISTINCT cu.id) DESC) as category_rank
          FROM stores s
          LEFT JOIN coupons c ON c.store_id = s.id
          LEFT JOIN user_coupons uc ON uc.coupon_id = c.id
          LEFT JOIN coupon_usage cu ON cu.store_id = s.id
          WHERE s.is_active = true
          GROUP BY s.category, s.id, s.name, s.rating
        ) ranked WHERE category_rank <= 3
        ORDER BY category, category_rank
      `);

      // 전체 요약
      const summaryResult = await db.execute(sql`
        SELECT
          COUNT(DISTINCT s.id) as total_stores,
          COUNT(DISTINCT uc.id) as total_downloads,
          COUNT(DISTINCT cu.id) as total_usages,
          ROUND(AVG(s.rating::float)::numeric, 2) as avg_rating
        FROM stores s
        LEFT JOIN coupons c ON c.store_id = s.id
        LEFT JOIN user_coupons uc ON uc.coupon_id = c.id
        LEFT JOIN coupon_usage cu ON cu.store_id = s.id
        WHERE s.is_active = true
      `);

      const rows = getRows(result);
      return {
        rankings: rows.map((row: any) => ({
          rank: Number(row.rank ?? 0),
          storeId: Number(row.id),
          storeName: row.name,
          name: row.name,
          category: row.category,
          rating: Number(row.rating ?? 0),
          ratingCount: Number(row.rating_count ?? 0),
          downloadCount: Number(row.download_count ?? 0),
          download_count: Number(row.download_count ?? 0),
          usageCount: Number(row.usage_count ?? 0),
          usage_count: Number(row.usage_count ?? 0),
          download_rank: Number(row.rank ?? 0),
          usage_rank: Number(row.rank ?? 0),
          usage_rate: rows.length > 0 && Number(row.download_count ?? 0) > 0
            ? Math.round(Number(row.usage_count ?? 0) * 100 / Number(row.download_count ?? 0) * 10) / 10
            : 0,
        })),
        categoryLeaders: getRows(categoryLeadersResult).map((row: any) => ({
          ...row,
          download_count: Number(row.download_count ?? 0),
          usage_count: Number(row.usage_count ?? 0),
          category_rank: Number(row.category_rank ?? 0),
        })),
        summary: (() => {
          const s = getRows(summaryResult)[0] ?? {};
          return {
            total_stores: Number(s.total_stores ?? 0),
            total_downloads: Number(s.total_downloads ?? 0),
            total_usages: Number(s.total_usages ?? 0),
            avg_rating: Number(s.avg_rating ?? 0),
          };
        })(),
      };
    }),

  // ========================================
  // 12. Store Competition
  // ========================================
  storeCompetition: protectedProcedure
    .use(({ ctx, next }) => {
      if (ctx.user.role !== 'admin') {
        throw new Error('Admin access required');
      }
      return next({ ctx });
    })
    .input(z.object({ storeId: z.number() }))
    .query(async ({ input }) => {
      const db = await getDb();
      
      // Get store info
      const storeResult = await db.execute(sql`
        SELECT 
          s.id, s.name, s.category, s.latitude, s.longitude,
          COUNT(DISTINCT uc.id) as download_count,
          COUNT(DISTINCT cu.id) as usage_count
        FROM stores s
        LEFT JOIN coupons c ON c.store_id = s.id
        LEFT JOIN user_coupons uc ON uc.coupon_id = c.id
        LEFT JOIN coupon_usage cu ON cu.store_id = s.id
        WHERE s.id = ${input.storeId}
        GROUP BY s.id, s.name, s.category, s.latitude, s.longitude
      `);
      
      const store = getRows(storeResult)[0];
      if (!store) return null;
      
      // Get competitors in same category
      const competitorsResult = await db.execute(sql.raw(`
        SELECT 
          s.id, s.name, s.rating, s.rating_count,
          COUNT(DISTINCT uc.id) as download_count,
          COUNT(DISTINCT cu.id) as usage_count
        FROM stores s
        LEFT JOIN coupons c ON c.store_id = s.id
        LEFT JOIN user_coupons uc ON uc.coupon_id = c.id
        LEFT JOIN coupon_usage cu ON cu.store_id = s.id
        WHERE s.category = '${store.category}' AND s.id != ${input.storeId}
        GROUP BY s.id, s.name, s.rating, s.rating_count
        ORDER BY usage_count DESC
        LIMIT 5
      `));
    
    return {
        store: {
          id: Number(store.id),
          name: store.name,
          category: store.category,
          downloadCount: Number(store.download_count ?? 0),
          usageCount: Number(store.usage_count ?? 0),
        },
        competitors: getRows(competitorsResult).map((row: any) => ({
          id: Number(row.id),
          name: row.name,
          rating: Number(row.rating ?? 0),
          ratingCount: Number(row.rating_count ?? 0),
          downloadCount: Number(row.download_count ?? 0),
          usageCount: Number(row.usage_count ?? 0),
        })),
      };
    }),

  // ========================================
  // 13. Store Details
  // ========================================
  storeDetails: protectedProcedure
    .use(({ ctx, next }) => {
      if (ctx.user.role !== 'admin') {
        throw new Error('Admin access required');
      }
      return next({ ctx });
    })
    .input(z.object({ storeId: z.number() }))
    .query(async ({ input }) => {
      const db = await getDb();

      // 대상 store 좌표 조회 (nearbyStores 계산용)
      const targetStoreResult = await db.execute(sql`
        SELECT latitude, longitude
        FROM stores
        WHERE id = ${input.storeId} AND deleted_at IS NULL
        LIMIT 1
      `);
      const targetStore = getRows(targetStoreResult)[0];
      const targetLat = targetStore?.latitude ? Number(targetStore.latitude) : null;
      const targetLng = targetStore?.longitude ? Number(targetStore.longitude) : null;

      // Downloads — 많이 볼 수 있게 LIMIT 200으로 증량
      const downloads = await db.execute(sql`
        SELECT
          uc.id, uc.downloaded_at, uc.status, uc.used_at,
          uc.coupon_code, uc.pin_code,
          c.title as coupon_title,
          u.name as user_name, u.email as user_email
        FROM user_coupons uc
        JOIN coupons c ON c.id = uc.coupon_id
        JOIN users u ON u.id = uc.user_id
        WHERE c.store_id = ${input.storeId}
        ORDER BY uc.downloaded_at DESC
        LIMIT 200
      `);

      // Usages — LIMIT 200
      const usages = await db.execute(sql`
        SELECT
          cu.id, cu.used_at,
          uc.coupon_code, uc.pin_code, uc.downloaded_at,
          c.title as coupon_title,
          u.name as user_name, u.email as user_email
        FROM coupon_usage cu
        JOIN user_coupons uc ON uc.id = cu.user_coupon_id
        JOIN coupons c ON c.id = uc.coupon_id
        JOIN users u ON u.id = cu.user_id
        WHERE cu.store_id = ${input.storeId}
        ORDER BY cu.used_at DESC
        LIMIT 200
      `);

      // Nearby stores (100m 반경, 경쟁 구도) — 대상 좌표가 있을 때만
      let nearbyStores: Array<Record<string, unknown>> = [];
      if (targetLat !== null && targetLng !== null) {
        const nearby = await db.execute(sql.raw(`
          SELECT
            s.id, s.name, s.category, s.address,
            s.latitude, s.longitude,
            COUNT(DISTINCT c.id) AS total_coupons,
            COALESCE(SUM(c.total_quantity), 0) AS total_issued,
            (6371000 * acos(
              cos(radians(${targetLat})) * cos(radians(s.latitude::float)) *
              cos(radians(s.longitude::float) - radians(${targetLng})) +
              sin(radians(${targetLat})) * sin(radians(s.latitude::float))
            )) AS distance
          FROM stores s
          LEFT JOIN coupons c ON c.store_id = s.id AND c.is_active = TRUE
          WHERE s.id != ${input.storeId}
            AND s.deleted_at IS NULL
            AND s.latitude IS NOT NULL
            AND s.longitude IS NOT NULL
          GROUP BY s.id, s.name, s.category, s.address, s.latitude, s.longitude
          HAVING (6371000 * acos(
            cos(radians(${targetLat})) * cos(radians(s.latitude::float)) *
            cos(radians(s.longitude::float) - radians(${targetLng})) +
            sin(radians(${targetLat})) * sin(radians(s.latitude::float))
          )) <= 100
          ORDER BY total_issued DESC
          LIMIT 20
        `));
        nearbyStores = getRows(nearby).map((row: any) => ({
          id: Number(row.id),
          name: row.name,
          category: row.category,
          address: row.address,
          latitude: Number(row.latitude),
          longitude: Number(row.longitude),
          totalCoupons: Number(row.total_coupons ?? 0),
          totalIssued: Number(row.total_issued ?? 0),
          distance: Number(row.distance ?? 0),
        }));
      }

      return {
        downloads: getRows(downloads).map((row: any) => ({
          id: Number(row.id),
          downloadedAt: row.downloaded_at,
          usedAt: row.used_at,
          status: row.status,
          couponTitle: row.coupon_title,
          userName: row.user_name,
          userEmail: row.user_email,
          couponCode: row.coupon_code,
          pinCode: row.pin_code,
        })),
        usages: getRows(usages).map((row: any) => ({
          id: Number(row.id),
          usedAt: row.used_at,
          downloadedAt: row.downloaded_at,
          couponTitle: row.coupon_title,
          userName: row.user_name,
          userEmail: row.user_email,
          couponCode: row.coupon_code,
          pinCode: row.pin_code,
        })),
        nearbyStores,
      };
    }),

  // ========================================
  // 14. Nearby Store Ranking
  // ========================================
  nearbyStoreRanking: protectedProcedure
    .use(({ ctx, next }) => {
      if (ctx.user.role !== 'admin') {
        throw new Error('Admin access required');
      }
      return next({ ctx });
    })
    .input(z.object({
      lat: z.number(),
      lng: z.number(),
      radiusMeters: z.number().default(100),
    }))
    .query(async ({ input }) => {
  const db = await getDb();
      
      const result = await db.execute(sql.raw(`
        SELECT 
          s.id, s.name, s.category, s.latitude, s.longitude,
          s.rating, s.rating_count,
          COUNT(DISTINCT cu.id) as usage_count,
          (6371000 * acos(
            cos(radians(${input.lat})) * cos(radians(s.latitude::float)) *
            cos(radians(s.longitude::float) - radians(${input.lng})) +
            sin(radians(${input.lat})) * sin(radians(s.latitude::float))
          )) as distance
        FROM stores s
        LEFT JOIN coupon_usage cu ON cu.store_id = s.id
        WHERE s.latitude IS NOT NULL AND s.longitude IS NOT NULL
        GROUP BY s.id, s.name, s.category, s.latitude, s.longitude, s.rating, s.rating_count
        HAVING (6371000 * acos(
          cos(radians(${input.lat})) * cos(radians(s.latitude::float)) *
          cos(radians(s.longitude::float) - radians(${input.lng})) +
          sin(radians(${input.lat})) * sin(radians(s.latitude::float))
        )) <= ${input.radiusMeters}
        ORDER BY usage_count DESC
      `));

      return getRows(result).map((row: any) => ({
        id: Number(row.id),
        name: row.name,
        category: row.category,
        latitude: Number(row.latitude),
        longitude: Number(row.longitude),
        rating: Number(row.rating ?? 0),
        ratingCount: Number(row.rating_count ?? 0),
        usageCount: Number(row.usage_count ?? 0),
        distance: Math.round(Number(row.distance ?? 0)),
      }));
    }),

  // ========================================
  // 15. Regional Ranking
  // ========================================
  regionalRanking: protectedProcedure
    .use(({ ctx, next }) => {
      if (ctx.user.role !== 'admin') {
        throw new Error('Admin access required');
      }
      return next({ ctx });
    })
    .input(z.object({
      district: z.string().optional(),
    }))
    .query(async ({ input }) => {
      const db = await getDb();
      
      let whereClause = "WHERE s.is_active = true AND s.address IS NOT NULL";
      if (input.district) {
        whereClause += ` AND s.address LIKE '%${input.district}%'`;
      }
      
      const result = await db.execute(sql.raw(`
        WITH store_rankings AS (
          SELECT 
            s.id,
            s.name,
            s.category,
            s.address,
            s.rating,
            s.rating_count,
            CASE 
              WHEN s.address ~ '([가-힣]+구)' 
              THEN (regexp_match(s.address, '([가-힣]+구)'))[1]
              ELSE '기타'
            END as district,
            COUNT(DISTINCT uc.id) as download_count,
            COUNT(DISTINCT cu.id) as usage_count,
            ROUND(
              CASE 
                WHEN COUNT(DISTINCT uc.id) > 0 
                THEN (COUNT(DISTINCT cu.id) * 100.0 / COUNT(DISTINCT uc.id))
                ELSE 0 
              END::numeric, 1
            ) as usage_rate
          FROM stores s
          LEFT JOIN coupons c ON c.store_id = s.id
          LEFT JOIN user_coupons uc ON uc.coupon_id = c.id
          LEFT JOIN coupon_usage cu ON cu.store_id = s.id
          ${whereClause}
          GROUP BY s.id, s.name, s.category, s.address, s.rating, s.rating_count
        )
        SELECT 
          sr.*,
          RANK() OVER (PARTITION BY district ORDER BY download_count DESC) as district_rank,
          COUNT(*) OVER (PARTITION BY district) as stores_in_district
        FROM store_rankings sr
        ORDER BY district, district_rank
      `));
      
      const districtSummary = await db.execute(sql`
        SELECT 
          CASE 
            WHEN s.address ~ '([가-힣]+구)' 
            THEN (regexp_match(s.address, '([가-힣]+구)'))[1]
            ELSE '기타'
          END as district,
          COUNT(DISTINCT s.id) as store_count,
          COUNT(DISTINCT uc.id) as total_downloads,
          COUNT(DISTINCT cu.id) as total_usages,
          ROUND(AVG(s.rating::float)::numeric, 2) as avg_rating
        FROM stores s
        LEFT JOIN coupons c ON c.store_id = s.id
        LEFT JOIN user_coupons uc ON uc.coupon_id = c.id
        LEFT JOIN coupon_usage cu ON cu.store_id = s.id
        WHERE s.is_active = true AND s.address IS NOT NULL
        GROUP BY district
        ORDER BY total_downloads DESC
      `);

      return {
        rankings: getRows(result).map((row: any) => ({
          id: Number(row.id),
          name: row.name,
          category: row.category,
          address: row.address,
          district: row.district,
          rating: Number(row.rating ?? 0),
          ratingCount: Number(row.rating_count ?? 0),
          downloadCount: Number(row.download_count ?? 0),
          usageCount: Number(row.usage_count ?? 0),
          usageRate: Number(row.usage_rate ?? 0),
          districtRank: Number(row.district_rank ?? 0),
          storesInDistrict: Number(row.stores_in_district ?? 0),
        })),
        districtSummary: getRows(districtSummary).map((row: any) => ({
          district: row.district,
          storeCount: Number(row.store_count ?? 0),
          totalDownloads: Number(row.total_downloads ?? 0),
          totalUsages: Number(row.total_usages ?? 0),
          avgRating: Number(row.avg_rating ?? 0),
        })),
      };
    }),

  // ========================================
  // 16. Nearby Competition
  // ========================================
  nearbyCompetition: protectedProcedure
    .use(({ ctx, next }) => {
      if (ctx.user.role !== 'admin') {
        throw new Error('Admin access required');
      }
      return next({ ctx });
    })
    .input(z.object({
      storeId: z.number(),
      radius: z.number().default(100),
    }))
    .query(async ({ input }) => {
      const db = await getDb();
      
      // Get base store info
      const storeInfo = await db.execute(sql`
        SELECT id, name, category, latitude, longitude, rating, rating_count
        FROM stores WHERE id = ${input.storeId}
      `);
      const baseStore = getRows(storeInfo)[0];
      
      if (!baseStore || !baseStore.latitude || !baseStore.longitude) {
  return {
          baseStore: null,
          competitors: [],
          summary: null,
        };
      }
      
      const lat = parseFloat(baseStore.latitude);
      const lon = parseFloat(baseStore.longitude);
      
      // Get competitors within radius
      const competitors = await db.execute(sql.raw(`
        SELECT 
          s.id,
          s.name,
          s.category,
          s.address,
          s.rating,
          s.rating_count,
          s.latitude,
          s.longitude,
          (6371000 * acos(
            LEAST(1.0, GREATEST(-1.0,
              cos(radians(${lat})) * cos(radians(s.latitude::float)) *
              cos(radians(s.longitude::float) - radians(${lon})) +
              sin(radians(${lat})) * sin(radians(s.latitude::float))
            ))
          )) AS distance,
          COUNT(DISTINCT uc.id) as download_count,
          COUNT(DISTINCT cu.id) as usage_count,
          ROUND(
            CASE 
              WHEN COUNT(DISTINCT uc.id) > 0 
              THEN (COUNT(DISTINCT cu.id) * 100.0 / COUNT(DISTINCT uc.id))
              ELSE 0 
            END::numeric, 1
          ) as usage_rate,
          CASE WHEN s.category = '${baseStore.category}' THEN 1 ELSE 0 END as same_category
        FROM stores s
        LEFT JOIN coupons c ON c.store_id = s.id
        LEFT JOIN user_coupons uc ON uc.coupon_id = c.id
        LEFT JOIN coupon_usage cu ON cu.store_id = s.id
        WHERE s.id != ${input.storeId}
          AND s.latitude IS NOT NULL
          AND s.longitude IS NOT NULL
          AND s.is_active = true
        GROUP BY s.id, s.name, s.category, s.address, s.rating, s.rating_count, s.latitude, s.longitude
        HAVING (6371000 * acos(
          LEAST(1.0, GREATEST(-1.0,
            cos(radians(${lat})) * cos(radians(s.latitude::float)) *
            cos(radians(s.longitude::float) - radians(${lon})) +
            sin(radians(${lat})) * sin(radians(s.latitude::float))
          ))
        )) <= ${input.radius}
        ORDER BY same_category DESC, download_count DESC
      `));
      
      // Get base store stats
      const baseStoreStats = await db.execute(sql`
        SELECT 
          COUNT(DISTINCT uc.id) as download_count,
          COUNT(DISTINCT cu.id) as usage_count,
          ROUND(
            CASE 
              WHEN COUNT(DISTINCT uc.id) > 0 
              THEN (COUNT(DISTINCT cu.id) * 100.0 / COUNT(DISTINCT uc.id))
              ELSE 0 
            END::numeric, 1
          ) as usage_rate
        FROM stores s
        LEFT JOIN coupons c ON c.store_id = s.id
        LEFT JOIN user_coupons uc ON uc.coupon_id = c.id
        LEFT JOIN coupon_usage cu ON cu.store_id = s.id
        WHERE s.id = ${input.storeId}
      `);
      const baseStats = getRows(baseStoreStats)[0];
      
      const competitorsList = getRows(competitors);
      const sameCategoryCompetitors = competitorsList.filter((c: any) => c.same_category === 1);
      
      return {
        baseStore: {
          id: Number(baseStore.id),
          name: baseStore.name,
          category: baseStore.category,
          rating: Number(baseStore.rating ?? 0),
          ratingCount: Number(baseStore.rating_count ?? 0),
          latitude: Number(baseStore.latitude),
          longitude: Number(baseStore.longitude),
          downloadCount: Number(baseStats?.download_count ?? 0),
          usageCount: Number(baseStats?.usage_count ?? 0),
          usageRate: Number(baseStats?.usage_rate ?? 0),
        },
        competitors: competitorsList.map((row: any) => ({
          id: Number(row.id),
          name: row.name,
          category: row.category,
          address: row.address,
          rating: Number(row.rating ?? 0),
          ratingCount: Number(row.rating_count ?? 0),
          latitude: Number(row.latitude),
          longitude: Number(row.longitude),
          distance: Math.round(Number(row.distance ?? 0)),
          downloadCount: Number(row.download_count ?? 0),
          usageCount: Number(row.usage_count ?? 0),
          usageRate: Number(row.usage_rate ?? 0),
          sameCategory: row.same_category === 1,
        })),
        summary: {
          totalCompetitors: competitorsList.length,
          sameCategoryCompetitors: sameCategoryCompetitors.length,
          avgCompetitorDownloads: competitorsList.length > 0 
            ? Math.round(competitorsList.reduce((sum: number, c: any) => sum + Number(c.download_count ?? 0), 0) / competitorsList.length)
            : 0,
          avgCompetitorUsageRate: competitorsList.length > 0
            ? Math.round(competitorsList.reduce((sum: number, c: any) => sum + Number(c.usage_rate ?? 0), 0) / competitorsList.length * 10) / 10
            : 0,
        },
      };
    }),
});
