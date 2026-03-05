/**
 * 구독팩 발주요청 & 유저 플랜 관리 라우터
 * - owner: 플랜 조회, 구독팩 목록, 발주요청 생성
 * - admin: 발주요청 리스트/상세/상태변경, 유저 플랜 부여/조절
 */
import { z } from 'zod';
import { router, protectedProcedure } from '../_core/trpc';
import * as db from '../db';

// ─── 사장님 인증 미들웨어 ─────────────────────────────────────────────────────
const merchantProcedure = protectedProcedure.use(({ ctx, next }) => {
  if (ctx.user.role !== 'merchant' && ctx.user.role !== 'admin') {
    throw new Error('Merchant access required');
  }
  return next({ ctx });
});

// ─── 어드민 인증 미들웨어 ─────────────────────────────────────────────────────
const adminProcedure = protectedProcedure.use(({ ctx, next }) => {
  if (ctx.user.role !== 'admin') {
    throw new Error('Admin access required');
  }
  return next({ ctx });
});

// ─── 계급별 기본값 ─────────────────────────────────────────────────────────────
const TIER_DEFAULTS: Record<string, { durationDays: number; couponQuota: number }> = {
  FREE:    { durationDays: 7,  couponQuota: 10 },
  WELCOME: { durationDays: 30, couponQuota: 20 },
  REGULAR: { durationDays: 30, couponQuota: 40 },
  BUSY:    { durationDays: 30, couponQuota: 80 },
};

export const packOrdersRouter = router({

  // ─── 사장님 전용 ─────────────────────────────────────────────────────────────

  /** 현재 플랜 조회 */
  getMyPlan: merchantProcedure.query(async ({ ctx }) => {
    const dbConn = await db.getDb();
    if (!dbConn) throw new Error('Database connection failed');

    const result = await dbConn.execute(`
      SELECT id, user_id, tier, starts_at, expires_at,
             default_duration_days, default_coupon_quota, is_active, memo
      FROM user_plans
      WHERE user_id = ${ctx.user.id}
        AND is_active = TRUE
      ORDER BY created_at DESC
      LIMIT 1
    `);

    const plan = (result as any)[0]?.[0];
    const now = new Date();

    if (!plan || (plan.expires_at && new Date(plan.expires_at) < now)) {
      return {
        tier: 'FREE' as const,
        expiresAt: null as Date | null,
        defaultDurationDays: 7,
        defaultCouponQuota: 10,
        isExpired: !!plan,
        isAdmin: ctx.user.role === 'admin',
      };
    }

    return {
      tier: plan.tier as string,
      expiresAt: plan.expires_at ? new Date(plan.expires_at) : null as Date | null,
      defaultDurationDays: plan.default_duration_days as number,
      defaultCouponQuota: plan.default_coupon_quota as number,
      isExpired: false,
      isAdmin: ctx.user.role === 'admin',
    };
  }),

  /** 구독팩 카탈로그 목록 */
  listPacks: merchantProcedure.query(async () => {
    return [
      {
        packCode: 'WELCOME_19800' as const,
        title: '손님마중패키지',
        price: 19800,
        durationDays: 30,
        displayCouponCount: 30,
        unitPriceDisplay: 660,
        discountDisplay: '33.3%',
        tierToGrant: 'WELCOME',
        highlight: false,
      },
      {
        packCode: 'REGULAR_29700' as const,
        title: '단골손님패키지',
        price: 29700,
        durationDays: 30,
        displayCouponCount: 50,
        unitPriceDisplay: 594,
        discountDisplay: '40%',
        tierToGrant: 'REGULAR',
        highlight: true,
      },
      {
        packCode: 'BUSY_49500' as const,
        title: '북적북적패키지',
        price: 49500,
        durationDays: 30,
        displayCouponCount: 100,
        unitPriceDisplay: 495,
        discountDisplay: '50%',
        tierToGrant: 'BUSY',
        highlight: false,
      },
    ];
  }),

  /** 발주 요청 생성 (구매하기 클릭) */
  createOrderRequest: merchantProcedure
    .input(z.object({
      packCode: z.enum(['WELCOME_19800', 'REGULAR_29700', 'BUSY_49500']),
      storeId: z.number().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const dbConn = await db.getDb();
      if (!dbConn) throw new Error('Database connection failed');

      // 동일 유저 + 동일 팩 REQUESTED/CONTACTED 중복 방지
      const existing = await dbConn.execute(`
        SELECT id FROM pack_order_requests
        WHERE user_id = ${ctx.user.id}
          AND requested_pack = '${input.packCode}'
          AND status IN ('REQUESTED', 'CONTACTED')
        LIMIT 1
      `);

      if ((existing as any)[0]?.[0]) {
        return {
          success: true,
          isDuplicate: true,
          message: '이미 접수된 요청이 있습니다. 담당자가 곧 연락드릴 예정입니다.',
        };
      }

      const storeClause = input.storeId ? `, store_id` : '';
      const storeVal    = input.storeId ? `, ${input.storeId}` : '';

      await dbConn.execute(`
        INSERT INTO pack_order_requests
          (user_id${storeClause}, requested_pack, status, created_at, updated_at)
        VALUES
          (${ctx.user.id}${storeVal}, '${input.packCode}', 'REQUESTED', NOW(), NOW())
      `);

      return {
        success: true,
        isDuplicate: false,
        message: '구독팩 신청이 접수되었습니다. 담당자가 확인 후 연락드려 진행을 도와드릴게요.',
      };
    }),

  // ─── 슈퍼어드민 전용 ──────────────────────────────────────────────────────────

  /** 발주요청 목록 */
  listPackOrders: adminProcedure
    .input(z.object({
      status: z.string().optional(),
      q: z.string().optional(),
    }))
    .query(async ({ input }) => {
      const dbConn = await db.getDb();
      if (!dbConn) throw new Error('Database connection failed');

      const conditions: string[] = [];
      if (input.status) conditions.push(`por.status = '${input.status}'`);
      if (input.q) {
        const q = input.q.replace(/'/g, "''");
        conditions.push(`(u.name ILIKE '%${q}%' OR u.email ILIKE '%${q}%')`);
      }
      const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

      const result = await dbConn.execute(`
        SELECT
          por.id,
          por.requested_pack,
          por.status,
          por.admin_memo,
          por.created_at,
          por.updated_at,
          u.id   AS user_id,
          u.name AS user_name,
          u.email AS user_email,
          s.id   AS store_id,
          s.name AS store_name
        FROM pack_order_requests por
        JOIN users u ON u.id = por.user_id
        LEFT JOIN stores s ON s.id = por.store_id
        ${whereClause}
        ORDER BY por.created_at DESC
        LIMIT 200
      `);

      return (result as any)[0] ?? [];
    }),

  /** 발주요청 상세 */
  getPackOrder: adminProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ input }) => {
      const dbConn = await db.getDb();
      if (!dbConn) throw new Error('Database connection failed');

      const result = await dbConn.execute(`
        SELECT
          por.id,
          por.requested_pack,
          por.status,
          por.admin_memo,
          por.created_at,
          por.updated_at,
          u.id    AS user_id,
          u.name  AS user_name,
          u.email AS user_email,
          s.id    AS store_id,
          s.name  AS store_name,
          up.tier,
          up.expires_at AS plan_expires_at,
          up.default_coupon_quota
        FROM pack_order_requests por
        JOIN users u ON u.id = por.user_id
        LEFT JOIN stores s ON s.id = por.store_id
        LEFT JOIN user_plans up ON up.user_id = por.user_id AND up.is_active = TRUE
        WHERE por.id = ${input.id}
        LIMIT 1
      `);

      const row = (result as any)[0]?.[0];
      if (!row) throw new Error('Order request not found');
      return row;
    }),

  /** 발주요청 상태변경 + 메모 */
  updatePackOrder: adminProcedure
    .input(z.object({
      id: z.number(),
      status: z.enum(['REQUESTED', 'CONTACTED', 'APPROVED', 'REJECTED', 'CANCELLED']).optional(),
      adminMemo: z.string().optional(),
    }))
    .mutation(async ({ input }) => {
      const dbConn = await db.getDb();
      if (!dbConn) throw new Error('Database connection failed');

      const setClauses: string[] = ['updated_at = NOW()'];
      if (input.status) setClauses.push(`status = '${input.status}'`);
      if (input.adminMemo !== undefined) {
        setClauses.push(`admin_memo = '${input.adminMemo.replace(/'/g, "''")}'`);
      }

      await dbConn.execute(`
        UPDATE pack_order_requests SET ${setClauses.join(', ')} WHERE id = ${input.id}
      `);

      return { success: true };
    }),

  /** 유저 플랜(계급) 부여/업데이트 */
  setUserPlan: adminProcedure
    .input(z.object({
      userId: z.number(),
      tier: z.enum(['FREE', 'WELCOME', 'REGULAR', 'BUSY']),
      durationDays: z.number().optional(),
      expiresAt: z.string().optional(),
      defaultCouponQuota: z.number().optional(),
      defaultDurationDays: z.number().optional(),
      memo: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const dbConn = await db.getDb();
      if (!dbConn) throw new Error('Database connection failed');

      const defaults = TIER_DEFAULTS[input.tier];
      const quota    = input.defaultCouponQuota ?? defaults.couponQuota;
      const duration = input.defaultDurationDays ?? defaults.durationDays;
      const memoSql  = input.memo ? `'${input.memo.replace(/'/g, "''")}'` : 'NULL';

      let expiresAtSql = 'NULL';
      if (input.tier !== 'FREE') {
        if (input.expiresAt) {
          expiresAtSql = `'${input.expiresAt}'`;
        } else {
          const days = input.durationDays ?? 30;
          expiresAtSql = `NOW() + INTERVAL '${days} days'`;
        }
      }

      // 기존 active 플랜 비활성화
      await dbConn.execute(`
        UPDATE user_plans
        SET is_active = FALSE, updated_at = NOW()
        WHERE user_id = ${input.userId} AND is_active = TRUE
      `);

      // 새 플랜 생성
      await dbConn.execute(`
        INSERT INTO user_plans
          (user_id, tier, starts_at, expires_at, default_duration_days,
           default_coupon_quota, is_active, created_by_admin_id, memo, created_at, updated_at)
        VALUES
          (${input.userId}, '${input.tier}', NOW(),
           ${expiresAtSql}, ${duration}, ${quota},
           TRUE, ${ctx.user.id}, ${memoSql}, NOW(), NOW())
      `);

      return { success: true };
    }),

  /** 유저 현재 플랜 조회 (어드민용) */
  getUserPlan: adminProcedure
    .input(z.object({ userId: z.number() }))
    .query(async ({ input }) => {
      const dbConn = await db.getDb();
      if (!dbConn) throw new Error('Database connection failed');

      const result = await dbConn.execute(`
        SELECT
          up.id, up.tier, up.starts_at, up.expires_at,
          up.default_duration_days, up.default_coupon_quota, up.is_active, up.memo,
          u.name AS user_name, u.email AS user_email
        FROM user_plans up
        JOIN users u ON u.id = up.user_id
        WHERE up.user_id = ${input.userId} AND up.is_active = TRUE
        ORDER BY up.created_at DESC
        LIMIT 1
      `);

      const plan = (result as any)[0]?.[0];
      const now  = new Date();
      if (!plan || (plan.expires_at && new Date(plan.expires_at) < now)) {
        return { tier: 'FREE', expiresAt: null, defaultDurationDays: 7, defaultCouponQuota: 10, isExpired: !!plan };
      }
      return {
        tier: plan.tier as string,
        expiresAt: plan.expires_at as Date | null,
        defaultDurationDays: plan.default_duration_days as number,
        defaultCouponQuota: plan.default_coupon_quota as number,
        isExpired: false,
      };
    }),

  /** 사장님 유저 목록 (계급 조회/부여용) */
  listUsersForPlan: adminProcedure
    .input(z.object({ q: z.string().optional() }))
    .query(async ({ input }) => {
      const dbConn = await db.getDb();
      if (!dbConn) throw new Error('Database connection failed');

      const qSafe = input.q ? input.q.replace(/'/g, "''") : '';
      const whereClause = qSafe
        ? `WHERE (u.name ILIKE '%${qSafe}%' OR u.email ILIKE '%${qSafe}%') AND u.role = 'merchant'`
        : `WHERE u.role = 'merchant'`;

      const result = await dbConn.execute(`
        SELECT
          u.id, u.name, u.email, u.role, u.created_at,
          COALESCE(up.tier, 'FREE') AS tier,
          up.expires_at AS plan_expires_at,
          up.default_coupon_quota,
          up.default_duration_days,
          (SELECT COUNT(*) FROM stores s WHERE s.owner_id = u.id) AS store_count
        FROM users u
        LEFT JOIN user_plans up ON up.user_id = u.id AND up.is_active = TRUE
        ${whereClause}
        ORDER BY u.created_at DESC
        LIMIT 100
      `);

      return (result as any)[0] ?? [];
    }),
});
