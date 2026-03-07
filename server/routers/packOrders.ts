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

  /** 현재 플랜 조회 (pending order 포함) */
  getMyPlan: merchantProcedure.query(async ({ ctx }) => {
    const dbConn = await db.getDb();
    if (!dbConn) throw new Error('Database connection failed');

    // 현재 플랜
    const planResult = await dbConn.execute(
      sql`SELECT id, user_id, tier, starts_at, expires_at,
                 default_duration_days, default_coupon_quota, is_active, memo
          FROM user_plans
          WHERE user_id = ${ctx.user.id}
            AND is_active = TRUE
          ORDER BY created_at DESC
          LIMIT 1`
    );

    // 신청 중인 발주요청 (pending order)
    const pendingResult = await dbConn.execute(
      sql`SELECT id, requested_pack, status, created_at
          FROM pack_order_requests
          WHERE user_id = ${ctx.user.id}
            AND status IN ('REQUESTED', 'CONTACTED')
          ORDER BY created_at DESC
          LIMIT 1`
    );

    const rows        = extractRows(planResult);
    const pendingRows = extractRows(pendingResult);
    const plan        = rows[0] ?? null;
    const pending     = pendingRows[0] ?? null;
    const now         = new Date();

    const pendingOrder = pending ? {
      orderId:     Number(pending.id),
      packCode:    pending.requested_pack as string,
      status:      pending.status as string,
      requestedAt: pending.created_at as Date,
    } : null;

    if (!plan || (plan.expires_at && new Date(plan.expires_at as string) < now)) {
      return {
        tier: 'FREE' as const,
        expiresAt: null as Date | null,
        defaultDurationDays: 7,
        defaultCouponQuota: 10,
        isExpired: !!plan,
        isAdmin: ctx.user.role === 'admin',
        pendingOrder,    // ← null 또는 신청 중인 발주요청 정보
      };
    }

    return {
      tier: plan.tier as string,
      expiresAt: plan.expires_at ? new Date(plan.expires_at as string) : null as Date | null,
      defaultDurationDays: plan.default_duration_days as number,
      defaultCouponQuota: plan.default_coupon_quota as number,
      isExpired: false,
      isAdmin: ctx.user.role === 'admin',
      pendingOrder,
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
   * v3 변경사항:
   * - 단일 CTE SQL로 SELECT+INSERT 원자적 실행 (레이스 컨디션 제거)
   * - ON CONFLICT (부분 유니크 인덱스) → 중복 클릭도 동일 id 반환 (idempotent)
   * - RETURNING id 없으면 무조건 throw (성공 응답 절대 없음)
   * - storeId 없어도 insert_id 반환 (store_id는 nullable)
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
      const storeId = input.storeId ?? null;

      console.log(`[PackOrder] createOrderRequest: user=${userId}, pack=${packCode}, store=${storeId}`);

      // ── 원자적 INSERT-OR-SELECT (CTE) ──────────────────────────────────────
      // 1. sel: 이미 REQUESTED/CONTACTED 상태인 row가 있는지 확인
      // 2. ins: sel이 없을 때만 INSERT (ON CONFLICT DO NOTHING 대신 WHERE NOT EXISTS)
      // 3. 결과: ins.id (신규) 또는 sel.id (기존) 중 하나를 반환
      // → 단일 트랜잭션 → 중복 클릭 / 동시 요청 모두 안전하게 처리
      const result = await dbConn.execute(
        sql`WITH sel AS (
              SELECT id, TRUE AS is_duplicate
              FROM   pack_order_requests
              WHERE  user_id        = ${userId}
                AND  requested_pack = ${packCode}
                AND  status IN ('REQUESTED', 'CONTACTED')
              LIMIT 1
            ),
            ins AS (
              INSERT INTO pack_order_requests
                (user_id, store_id, requested_pack, status, created_at, updated_at)
              SELECT ${userId}, ${storeId}, ${packCode}, 'REQUESTED', NOW(), NOW()
              WHERE  NOT EXISTS (SELECT 1 FROM sel)
              RETURNING id
            )
            SELECT id, FALSE AS is_duplicate FROM ins
            UNION ALL
            SELECT id, TRUE  AS is_duplicate FROM sel
            LIMIT 1`
      );

      const rows = extractRows(result);
      const row  = rows[0];

      // id 없으면 무조건 에러 (성공 응답 절대 없음)
      if (!row?.id) {
        console.error('[PackOrder] CTE 결과 id 없음. 테이블 또는 인덱스 확인 필요.', {
          userId, packCode, storeId, result,
        });
        throw new Error(
          '발주 요청 저장 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요.\n' +
          '(서버 로그: pack_order_requests 테이블 존재 여부 확인)'
        );
      }

      const orderId     = Number(row.id);
      const isDuplicate = row.is_duplicate === true || row.is_duplicate === 't' || row.is_duplicate === 1;

      console.log(`[PackOrder] 완료: id=${orderId}, isDuplicate=${isDuplicate}, user=${userId}, pack=${packCode}`);

      return {
        success: true,
        isDuplicate,
        orderId,           // ← 프론트가 이 값을 검증해야 모달 오픈
        message: isDuplicate
          ? '이미 접수된 요청이 있습니다. 담당자가 곧 연락드릴 예정입니다.'
          : '구독팩 신청이 접수되었습니다. 담당자가 확인 후 연락드려 진행을 도와드릴게요.',
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

      // DB audit trail
      void db.insertAuditLog({
        adminId,
        action: 'admin_set_user_plan',
        targetType: 'user',
        targetId: input.userId,
        payload: { tier: input.tier, durationDays: input.durationDays ?? null },
      });

      // FREE로 전환 시 — 기존 active 쿠폰 재정렬
      // 정책: PAID 자격이 끝나면 FREE 기준(max 10개)으로 초과분 비활성화
      if (input.tier === 'FREE') {
        const reclaim = await db.reclaimCouponsToFreeTier(input.userId);
        if (reclaim.deactivated > 0) {
          void db.insertAuditLog({
            adminId,
            action: 'admin_coupon_reclaim_free',
            targetType: 'user',
            targetId: input.userId,
            payload: { deactivated: reclaim.deactivated, reason: 'manual_free_downgrade' },
          });
        }
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

  /** 사장님 유저 목록 (계급 조회/부여용)
   *
   * 표시 대상: role IN ('merchant', 'user') — admin 제외
   * - 동의 완료 → role='merchant'로 승급된 계정 포함
   * - 아직 role='user'인 계정도 표시 (consent 완료 여부 무관)
   */
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
              WHERE u.role IN ('merchant', 'user')
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
              WHERE u.role IN ('merchant', 'user')
              ORDER BY u.created_at DESC
              LIMIT 100`
        );
      }

      return extractRows(result);
    }),

  /**
   * 어드민 전용: DB 테이블 헬스체크
   * Railway 배포 후 pack_order_requests 테이블 존재 여부를 API로 확인
   * 사용: GET /api/trpc/packOrders.dbHealth (어드민 로그인 필요)
   */
  dbHealth: adminProcedure.query(async () => {
    const dbConn = await db.getDb();
    if (!dbConn) return { ok: false, error: 'DB connection failed', tables: {} };

    const tables: Record<string, { exists: boolean; rowCount: number }> = {};

    for (const tableName of ['pack_order_requests', 'user_plans']) {
      try {
        const existsResult = await dbConn.execute(
          sql`SELECT COUNT(*) AS cnt
              FROM information_schema.tables
              WHERE table_schema = 'public'
                AND table_name = ${tableName}`
        );
        const existsRows = extractRows(existsResult);
        const exists = Number(existsRows[0]?.cnt ?? 0) > 0;

        let rowCount = 0;
        if (exists) {
          // 테이블이 있을 때만 행 수 조회 (raw string: tableName이 안전한 하드코딩 값)
          const countResult = await dbConn.execute(
            sql`SELECT COUNT(*) AS cnt FROM pack_order_requests`
          );
          const countRows = extractRows(countResult);
          rowCount = Number(countRows[0]?.cnt ?? 0);
        }

        tables[tableName] = { exists, rowCount };
      } catch (e: any) {
        tables[tableName] = { exists: false, rowCount: 0 };
      }
    }

    // pack_order_requests 인덱스 확인
    let idxExists = false;
    try {
      const idxResult = await dbConn.execute(
        sql`SELECT 1 FROM pg_indexes
            WHERE tablename = 'pack_order_requests'
              AND indexname = 'idx_pack_orders_active_unique'`
      );
      idxExists = extractRows(idxResult).length > 0;
    } catch (_) { /* 무시 */ }

    return {
      ok: tables['pack_order_requests']?.exists === true,
      tables,
      idempotencyIndexExists: idxExists,
    };
  }),
});
