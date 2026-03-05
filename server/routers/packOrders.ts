/**
 * 구독팩 발주요청 & 유저 플랜 관리 라우터
 *
 * 변경 이력:
 * - v2: 모든 raw string SQL → sql`` 태그드 템플릿으로 교체 (parameterized query)
 *       RETURNING id로 INSERT 성공 여부 검증
 *       테이블은 VARCHAR 기반 (PostgreSQL custom enum 대신)
 */
import { z } from 'zod';
import { sql } from 'drizzle-orm';
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

/** Drizzle execute 결과에서 rows 배열 추출 (pg 드라이버 결과 포맷 정규화) */
function extractRows(result: unknown): Record<string, unknown>[] {
  if (!result) return [];
  // Drizzle node-postgres: result.rows
  if (Array.isArray((result as any).rows)) return (result as any).rows;
  // Legacy/raw 패턴: result[0] (일부 기존 코드 호환)
  if (Array.isArray((result as any)[0])) return (result as any)[0];
  return [];
}

export const packOrdersRouter = router({

  // ─── 사장님 전용 ─────────────────────────────────────────────────────────────

  /** 현재 플랜 조회 */
  getMyPlan: merchantProcedure.query(async ({ ctx }) => {
    const dbConn = await db.getDb();
    if (!dbConn) throw new Error('Database connection failed');

    const result = await dbConn.execute(
      sql`SELECT id, user_id, tier, starts_at, expires_at,
                 default_duration_days, default_coupon_quota, is_active, memo
          FROM user_plans
          WHERE user_id = ${ctx.user.id}
            AND is_active = TRUE
          ORDER BY created_at DESC
          LIMIT 1`
    );

    const rows = extractRows(result);
    const plan = rows[0] ?? null;
    const now = new Date();

    if (!plan || (plan.expires_at && new Date(plan.expires_at as string) < now)) {
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
      expiresAt: plan.expires_at ? new Date(plan.expires_at as string) : null as Date | null,
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

  /**
   * 발주 요청 생성 (구매하기 클릭)
   *
   * 수정 이력:
   * - v2: sql`` 태그드 템플릿 사용, RETURNING id로 실제 저장 여부 검증
   *       저장 실패 시 에러 throw → onError toast (성공처럼 보이지 않음)
   */
  createOrderRequest: merchantProcedure
    .input(z.object({
      packCode: z.enum(['WELCOME_19800', 'REGULAR_29700', 'BUSY_49500']),
      storeId: z.number().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const dbConn = await db.getDb();
      if (!dbConn) throw new Error('Database connection failed');

      const userId = ctx.user.id;
      const packCode = input.packCode;

      console.log(`[PackOrder] createOrderRequest 시작: user=${userId}, pack=${packCode}, store=${input.storeId}`);

      // 동일 유저 + 동일 팩 REQUESTED/CONTACTED 중복 방지
      const existingResult = await dbConn.execute(
        sql`SELECT id FROM pack_order_requests
            WHERE user_id = ${userId}
              AND requested_pack = ${packCode}
              AND status IN ('REQUESTED', 'CONTACTED')
            LIMIT 1`
      );

      const existingRows = extractRows(existingResult);
      if (existingRows.length > 0) {
        console.log(`[PackOrder] 중복 요청 감지: existingId=${existingRows[0]?.id}`);
        return {
          success: true,
          isDuplicate: true,
          orderId: existingRows[0]?.id ?? null,
          message: '이미 접수된 요청이 있습니다. 담당자가 곧 연락드릴 예정입니다.',
        };
      }

      // INSERT with RETURNING id → DB 저장 성공 여부 반드시 확인
      let insertResult: unknown;
      if (input.storeId) {
        insertResult = await dbConn.execute(
          sql`INSERT INTO pack_order_requests
                (user_id, store_id, requested_pack, status, created_at, updated_at)
              VALUES
                (${userId}, ${input.storeId}, ${packCode}, 'REQUESTED', NOW(), NOW())
              RETURNING id`
        );
      } else {
        insertResult = await dbConn.execute(
          sql`INSERT INTO pack_order_requests
                (user_id, requested_pack, status, created_at, updated_at)
              VALUES
                (${userId}, ${packCode}, 'REQUESTED', NOW(), NOW())
              RETURNING id`
        );
      }

      const insertedRows = extractRows(insertResult);
      const newId = (insertedRows[0]?.id as number) ?? null;

      // 실제 저장 실패 시 에러 throw → 클라이언트 onError 호출 (성공 모달 뜨지 않음)
      if (!newId) {
        console.error('[PackOrder] INSERT 실패: RETURNING id 없음', insertResult);
        throw new Error('발주 요청 저장 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요.');
      }

      console.log(`[PackOrder] 발주요청 생성 완료: id=${newId}, user=${userId}, pack=${packCode}`);

      return {
        success: true,
        isDuplicate: false,
        orderId: newId,
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

      // 필터 조건에 따른 동적 쿼리
      let result: unknown;
      if (input.status && input.q) {
        const qLike = `%${input.q}%`;
        result = await dbConn.execute(
          sql`SELECT por.id, por.requested_pack, por.status, por.admin_memo,
                     por.created_at, por.updated_at,
                     u.id AS user_id, u.name AS user_name, u.email AS user_email,
                     s.id AS store_id, s.name AS store_name
              FROM pack_order_requests por
              JOIN users u ON u.id = por.user_id
              LEFT JOIN stores s ON s.id = por.store_id
              WHERE por.status = ${input.status}
                AND (u.name ILIKE ${qLike} OR u.email ILIKE ${qLike})
              ORDER BY por.created_at DESC
              LIMIT 200`
        );
      } else if (input.status) {
        result = await dbConn.execute(
          sql`SELECT por.id, por.requested_pack, por.status, por.admin_memo,
                     por.created_at, por.updated_at,
                     u.id AS user_id, u.name AS user_name, u.email AS user_email,
                     s.id AS store_id, s.name AS store_name
              FROM pack_order_requests por
              JOIN users u ON u.id = por.user_id
              LEFT JOIN stores s ON s.id = por.store_id
              WHERE por.status = ${input.status}
              ORDER BY por.created_at DESC
              LIMIT 200`
        );
      } else if (input.q) {
        const qLike = `%${input.q}%`;
        result = await dbConn.execute(
          sql`SELECT por.id, por.requested_pack, por.status, por.admin_memo,
                     por.created_at, por.updated_at,
                     u.id AS user_id, u.name AS user_name, u.email AS user_email,
                     s.id AS store_id, s.name AS store_name
              FROM pack_order_requests por
              JOIN users u ON u.id = por.user_id
              LEFT JOIN stores s ON s.id = por.store_id
              WHERE (u.name ILIKE ${qLike} OR u.email ILIKE ${qLike})
              ORDER BY por.created_at DESC
              LIMIT 200`
        );
      } else {
        result = await dbConn.execute(
          sql`SELECT por.id, por.requested_pack, por.status, por.admin_memo,
                     por.created_at, por.updated_at,
                     u.id AS user_id, u.name AS user_name, u.email AS user_email,
                     s.id AS store_id, s.name AS store_name
              FROM pack_order_requests por
              JOIN users u ON u.id = por.user_id
              LEFT JOIN stores s ON s.id = por.store_id
              ORDER BY por.created_at DESC
              LIMIT 200`
        );
      }

      return extractRows(result);
    }),

  /** 발주요청 상세 */
  getPackOrder: adminProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ input }) => {
      const dbConn = await db.getDb();
      if (!dbConn) throw new Error('Database connection failed');

      const result = await dbConn.execute(
        sql`SELECT por.id, por.requested_pack, por.status, por.admin_memo,
                   por.created_at, por.updated_at,
                   u.id AS user_id, u.name AS user_name, u.email AS user_email,
                   s.id AS store_id, s.name AS store_name,
                   up.tier, up.expires_at AS plan_expires_at, up.default_coupon_quota
            FROM pack_order_requests por
            JOIN users u ON u.id = por.user_id
            LEFT JOIN stores s ON s.id = por.store_id
            LEFT JOIN user_plans up ON up.user_id = por.user_id AND up.is_active = TRUE
            WHERE por.id = ${input.id}
            LIMIT 1`
      );

      const rows = extractRows(result);
      if (rows.length === 0) throw new Error('Order request not found');
      return rows[0];
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

      if (input.status !== undefined && input.adminMemo !== undefined) {
        await dbConn.execute(
          sql`UPDATE pack_order_requests
              SET status = ${input.status}, admin_memo = ${input.adminMemo}, updated_at = NOW()
              WHERE id = ${input.id}`
        );
      } else if (input.status !== undefined) {
        await dbConn.execute(
          sql`UPDATE pack_order_requests
              SET status = ${input.status}, updated_at = NOW()
              WHERE id = ${input.id}`
        );
      } else if (input.adminMemo !== undefined) {
        await dbConn.execute(
          sql`UPDATE pack_order_requests
              SET admin_memo = ${input.adminMemo}, updated_at = NOW()
              WHERE id = ${input.id}`
        );
      }

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
      const memo     = input.memo ?? null;
      const adminId  = ctx.user.id;

      // 기존 active 플랜 비활성화
      await dbConn.execute(
        sql`UPDATE user_plans
            SET is_active = FALSE, updated_at = NOW()
            WHERE user_id = ${input.userId} AND is_active = TRUE`
      );

      // 새 플랜 생성
      if (input.tier === 'FREE') {
        await dbConn.execute(
          sql`INSERT INTO user_plans
                (user_id, tier, starts_at, expires_at, default_duration_days,
                 default_coupon_quota, is_active, created_by_admin_id, memo, created_at, updated_at)
              VALUES
                (${input.userId}, ${input.tier}, NOW(), NULL, ${duration},
                 ${quota}, TRUE, ${adminId}, ${memo}, NOW(), NOW())`
        );
      } else if (input.expiresAt) {
        const expiresAt = new Date(input.expiresAt);
        await dbConn.execute(
          sql`INSERT INTO user_plans
                (user_id, tier, starts_at, expires_at, default_duration_days,
                 default_coupon_quota, is_active, created_by_admin_id, memo, created_at, updated_at)
              VALUES
                (${input.userId}, ${input.tier}, NOW(), ${expiresAt}, ${duration},
                 ${quota}, TRUE, ${adminId}, ${memo}, NOW(), NOW())`
        );
      } else {
        const days = input.durationDays ?? 30;
        await dbConn.execute(
          sql`INSERT INTO user_plans
                (user_id, tier, starts_at, expires_at, default_duration_days,
                 default_coupon_quota, is_active, created_by_admin_id, memo, created_at, updated_at)
              VALUES
                (${input.userId}, ${input.tier}, NOW(),
                 NOW() + (${days} || ' days')::interval,
                 ${duration}, ${quota}, TRUE, ${adminId}, ${memo}, NOW(), NOW())`
        );
      }

      return { success: true };
    }),

  /** 유저 현재 플랜 조회 (어드민용) */
  getUserPlan: adminProcedure
    .input(z.object({ userId: z.number() }))
    .query(async ({ input }) => {
      const dbConn = await db.getDb();
      if (!dbConn) throw new Error('Database connection failed');

      const result = await dbConn.execute(
        sql`SELECT up.id, up.tier, up.starts_at, up.expires_at,
                   up.default_duration_days, up.default_coupon_quota, up.is_active, up.memo,
                   u.name AS user_name, u.email AS user_email
            FROM user_plans up
            JOIN users u ON u.id = up.user_id
            WHERE up.user_id = ${input.userId} AND up.is_active = TRUE
            ORDER BY up.created_at DESC
            LIMIT 1`
      );

      const rows = extractRows(result);
      const plan  = rows[0] ?? null;
      const now   = new Date();

      if (!plan || (plan.expires_at && new Date(plan.expires_at as string) < now)) {
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

      let result: unknown;
      if (input.q) {
        const qLike = `%${input.q}%`;
        result = await dbConn.execute(
          sql`SELECT u.id, u.name, u.email, u.role, u.created_at,
                     COALESCE(up.tier, 'FREE') AS tier,
                     up.expires_at AS plan_expires_at,
                     up.default_coupon_quota, up.default_duration_days,
                     (SELECT COUNT(*) FROM stores s WHERE s.owner_id = u.id) AS store_count
              FROM users u
              LEFT JOIN user_plans up ON up.user_id = u.id AND up.is_active = TRUE
              WHERE u.role = 'merchant'
                AND (u.name ILIKE ${qLike} OR u.email ILIKE ${qLike})
              ORDER BY u.created_at DESC
              LIMIT 100`
        );
      } else {
        result = await dbConn.execute(
          sql`SELECT u.id, u.name, u.email, u.role, u.created_at,
                     COALESCE(up.tier, 'FREE') AS tier,
                     up.expires_at AS plan_expires_at,
                     up.default_coupon_quota, up.default_duration_days,
                     (SELECT COUNT(*) FROM stores s WHERE s.owner_id = u.id) AS store_count
              FROM users u
              LEFT JOIN user_plans up ON up.user_id = u.id AND up.is_active = TRUE
              WHERE u.role = 'merchant'
              ORDER BY u.created_at DESC
              LIMIT 100`
        );
      }

      return extractRows(result);
    }),
});
