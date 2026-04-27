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
import { PLAN_POLICY } from '../db';
import { sendAdminNotificationEmail } from '../email';

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
// couponQuota: 팩당 쿠폰 발행 한도 / dailyLimit: 일 최소 소비수량 (= 사장님이 선택 불가능한 floor)
// 2026-04-24 정책: 사장님이 쿠폰 등록 시 이 값을 최소 보장, 그 이상 자율 설정 가능.
//   서버에서 Math.max(input, TIER_DEFAULTS[tier].dailyLimit) 로 강제.
export const TIER_DEFAULTS: Record<string, { durationDays: number; couponQuota: number; dailyLimit: number }> = {
  FREE:    { durationDays: 7,  couponQuota: 10, dailyLimit: 1 },
  WELCOME: { durationDays: 30, couponQuota: 30, dailyLimit: 3 },
  REGULAR: { durationDays: 30, couponQuota: 50, dailyLimit: 5 },
  BUSY:    { durationDays: 30, couponQuota: 90, dailyLimit: 9 },
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

    // 현재 플랜 — created_at 포함 필수 (starts_at NULL 레거시 row fallback)
    const planResult = await dbConn.execute(
      sql`SELECT id, user_id, tier, starts_at, expires_at,
                 default_duration_days, default_coupon_quota, is_active, memo,
                 created_at
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

    // 운영 중인 가게 수 (공통 배너용)
    const storeCountResult = await dbConn.execute(
      sql`SELECT COUNT(*) AS cnt FROM stores WHERE owner_id = ${ctx.user.id} AND deleted_at IS NULL`
    );

    const rows        = extractRows(planResult);
    const pendingRows = extractRows(pendingResult);
    const plan        = rows[0] ?? null;
    const pending     = pendingRows[0] ?? null;
    const storeCount  = Number(extractRows(storeCountResult)[0]?.cnt ?? 0);
    const now         = new Date();

    const pendingOrder = pending ? {
      orderId:     Number(pending.id),
      packCode:    pending.requested_pack as string,
      status:      pending.status as string,
      requestedAt: pending.created_at as Date,
    } : null;

    // isFranchise를 먼저 선언 — resolveAccountState 1순위 분기에 전달
    const isFranchise = !!(ctx.user as any).isFranchise;

    // ── resolveAccountState 단일 진입점으로 trialState 계산 ────────────────
    // isFranchise 전달 → franchise는 trial 만료와 무관하게 항상 'paid' 반환
    const trialEndsAt   = ctx.user.trialEndsAt;
    const isPlanExpired = !!plan && !!plan.expires_at && new Date(plan.expires_at as string) < now;
    const isPlanAbsent  = !plan;

    const effectivePlanTier = (isPlanAbsent || isPlanExpired)
      ? null
      : (plan.tier as string ?? null);

    const trialState = db.resolveAccountState(trialEndsAt, effectivePlanTier, isFranchise);

    // ── 누적 quota 계산 (공통 배너 남은 수량 표시용) ────────────────────────
    // windowStart = MAX(plan.created_at, plan.starts_at, POLICY_CUTOVER_AT)
    // - plan.created_at: DB INSERT 시점(변경 불가 anchor). setUserPlan이 새 row를 INSERT할 때 자동 NOW().
    // - plan.starts_at: 명시적 시작 시점. 레거시/수동 UPDATE로 과거값일 수 있어 단독 신뢰 금지.
    // - 두 값 중 최댓값을 anchor로 쓰면 "슈퍼어드민 신규 패키지 부여 = 새 집계 창" 불변식이 보장됨
    //   → 이전 기간 approved 쿠폰이 새 창에 바인딩되지 않아 신규처럼 등록 가능
    const POLICY_CUTOVER_AT = '2026-03-18T00:00:00Z';
    const rawStartsAt = plan && (plan as any).starts_at;
    const rawCreatedAt = plan && (plan as any).created_at;
    const startsAtIso = rawStartsAt ? new Date(rawStartsAt as string).toISOString() : null;
    const createdAtIso = rawCreatedAt ? new Date(rawCreatedAt as string).toISOString() : null;
    const candidates = [POLICY_CUTOVER_AT];
    if (startsAtIso) candidates.push(startsAtIso);
    if (createdAtIso) candidates.push(createdAtIso);
    const windowStart = candidates.reduce((a, b) => (a > b ? a : b));

    // 2026-04-18: approved 기준 집계로 통일.
    // - 축: approved_at (create/update는 quota 소비 아님 — approve만 소비)
    // - is_active=TRUE, approved_at/approved_by NOT NULL 로 pending/rejected/soft-deleted 전부 제외
    // → 배너의 "남은 수량"은 approveCoupon 한도 체크와 동일 기준으로 일관됨
    const usedQuotaResult = await dbConn.execute(
      sql`SELECT COALESCE(SUM(total_quantity), 0) AS used_quota
          FROM coupons
          WHERE store_id IN (
            SELECT id FROM stores WHERE owner_id = ${ctx.user.id} AND deleted_at IS NULL
          )
          AND is_active = TRUE
          AND approved_at IS NOT NULL
          AND approved_by IS NOT NULL
          AND approved_at >= ${windowStart}`
    );
    const usedQuota = Number(extractRows(usedQuotaResult)[0]?.used_quota ?? 0);

    // 1) 플랜 없음 or 만료 (franchise는 trialState='paid'로 여기 진입 가능)
    if (isPlanAbsent || isPlanExpired) {
      // franchise/trial_free는 기본 FREE quota(10) 적용, non_trial_free는 0
      const quotaTotal = (isFranchise || trialState === 'trial_free') ? 10 : 0;
      const defaultDailyLimit = (isFranchise || trialState === 'trial_free')
        ? TIER_DEFAULTS.FREE.dailyLimit : 0;
      return {
        tier: 'FREE' as const,
        expiresAt: null as Date | null,
        defaultDurationDays: (isFranchise || trialState === 'trial_free') ? 7 : 0,
        defaultCouponQuota: quotaTotal,
        defaultDailyLimit,
        isExpired: isPlanExpired,
        planState: isPlanExpired ? 'expired_downgrade' : 'free',
        trialState,
        isAdmin: ctx.user.role === 'admin',
        isFranchise,
        pendingOrder,
        quotaTotal,
        quotaRemaining: Math.max(0, quotaTotal - usedQuota),
        storeCount,
        isUnlimited: isFranchise,
      };
    }

    // 2) tier = FREE 행 active (관리자 수동 FREE 포함)
    if (plan.tier === 'FREE') {
      const quotaTotal = (isFranchise || trialState === 'trial_free')
        ? (plan.default_coupon_quota as number ?? 10) : 0;
      const defaultDailyLimit = (isFranchise || trialState === 'trial_free')
        ? TIER_DEFAULTS.FREE.dailyLimit : 0;
      return {
        tier: 'FREE' as const,
        expiresAt: null as Date | null,
        defaultDurationDays: (isFranchise || trialState === 'trial_free')
          ? (plan.default_duration_days as number ?? 7) : 0,
        defaultCouponQuota: quotaTotal,
        defaultDailyLimit,
        isExpired: false,
        planState: 'free' as const,
        trialState,
        isAdmin: ctx.user.role === 'admin',
        isFranchise,
        pendingOrder,
        quotaTotal,
        quotaRemaining: Math.max(0, quotaTotal - usedQuota),
        storeCount,
        isUnlimited: isFranchise,
      };
    }

    // 3) 유효한 유료 플랜 (trialState === 'paid')
    const quotaTotal  = plan.default_coupon_quota as number;
    const expiresAt   = plan.expires_at ? new Date(plan.expires_at as string) : null as Date | null;
    const defaultDailyLimit = TIER_DEFAULTS[plan.tier as string]?.dailyLimit ?? TIER_DEFAULTS.FREE.dailyLimit;
    return {
      tier: plan.tier as string,
      expiresAt,
      defaultDurationDays: plan.default_duration_days as number,
      defaultCouponQuota: quotaTotal,
      defaultDailyLimit,
      isExpired: false,
      planState: 'active_paid' as const,
      trialState,
      isAdmin: ctx.user.role === 'admin',
      isFranchise,
      pendingOrder,
      quotaTotal,
      quotaRemaining: Math.max(0, quotaTotal - usedQuota),
      storeCount,
      isUnlimited: isFranchise || expiresAt === null,
    };
  }),

  /** 구독팩 카탈로그 목록 */
  // ※ displayCouponCount = TIER_DEFAULTS.couponQuota와 반드시 일치
  listPacks: merchantProcedure.query(async () => {
    return [
      {
        packCode: 'WELCOME_19800' as const,
        title: '손님마중패키지',
        price: 19800,
        durationDays: 30,
        displayCouponCount: TIER_DEFAULTS.WELCOME.couponQuota,   // 30
        dailyLimit: TIER_DEFAULTS.WELCOME.dailyLimit,            // 1
        unitPriceDisplay: Math.round(19800 / TIER_DEFAULTS.WELCOME.couponQuota),
        discountDisplay: '34%',
        tierToGrant: 'WELCOME',
        highlight: false,
      },
      {
        packCode: 'REGULAR_29700' as const,
        title: '단골손님패키지',
        price: 29700,
        durationDays: 30,
        displayCouponCount: TIER_DEFAULTS.REGULAR.couponQuota,   // 50
        dailyLimit: TIER_DEFAULTS.REGULAR.dailyLimit,            // 2
        unitPriceDisplay: Math.round(29700 / TIER_DEFAULTS.REGULAR.couponQuota),
        discountDisplay: '40%',
        tierToGrant: 'REGULAR',
        highlight: true,
      },
      {
        packCode: 'BUSY_49500' as const,
        title: '북적북적패키지',
        price: 49500,
        durationDays: 30,
        displayCouponCount: TIER_DEFAULTS.BUSY.couponQuota,      // 90
        dailyLimit: TIER_DEFAULTS.BUSY.dailyLimit,               // 3
        unitPriceDisplay: Math.round(49500 / TIER_DEFAULTS.BUSY.couponQuota),
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

      // 관리자 계정은 구독팩 발주 불가 (실수/자동화 클릭 방지)
      if (ctx.user.role === 'admin') {
        throw new Error('관리자 계정은 구독팩을 신청할 수 없습니다.');
      }

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

      // 신규 접수일 때만 관리자 알림 메일 전송 (중복 요청 제외)
      if (!isDuplicate) {
        void sendAdminNotificationEmail({
          type: 'pack_order_new',
          merchantName: ctx.user.name ?? ctx.user.email ?? `ID:${userId}`,
          merchantEmail: ctx.user.email ?? '',
          targetName: packCode,
          extraInfo: storeId ? `가게 ID: ${storeId}` : undefined,
        });
      }

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

      // store_id가 NULL인 발주요청 → 요청자 소유 매장으로 fallback (LATERAL)
      const packOrderSelect = sql`
        SELECT por.id, por.requested_pack, por.status, por.admin_memo,
               por.created_at, por.updated_at,
               u.id AS user_id, u.name AS user_name, u.email AS user_email,
               s.id AS store_id, s.name AS store_name,
               s.image_url AS store_image_url, s.category AS store_category
        FROM pack_order_requests por
        JOIN users u ON u.id = por.user_id
        LEFT JOIN LATERAL (
          SELECT id, name, image_url, category
          FROM stores
          WHERE deleted_at IS NULL
            AND (
              (por.store_id IS NOT NULL AND id = por.store_id)
              OR (por.store_id IS NULL AND owner_id = por.user_id)
            )
          ORDER BY CASE WHEN id = por.store_id THEN 0 ELSE 1 END, created_at DESC
          LIMIT 1
        ) s ON TRUE`;

      let result: unknown;
      if (input.status && input.q) {
        const qLike = `%${input.q}%`;
        result = await dbConn.execute(
          sql`${packOrderSelect}
              WHERE por.status = ${input.status}
                AND (u.name ILIKE ${qLike} OR u.email ILIKE ${qLike})
              ORDER BY por.created_at DESC
              LIMIT 200`
        );
      } else if (input.status) {
        result = await dbConn.execute(
          sql`${packOrderSelect}
              WHERE por.status = ${input.status}
              ORDER BY por.created_at DESC
              LIMIT 200`
        );
      } else if (input.q) {
        const qLike = `%${input.q}%`;
        result = await dbConn.execute(
          sql`${packOrderSelect}
              WHERE (u.name ILIKE ${qLike} OR u.email ILIKE ${qLike})
              ORDER BY por.created_at DESC
              LIMIT 200`
        );
      } else {
        result = await dbConn.execute(
          sql`${packOrderSelect}
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
                   s.image_url AS store_image_url, s.category AS store_category,
                   CASE
                     WHEN up.tier IS NULL THEN 'FREE'
                     WHEN up.expires_at IS NOT NULL AND up.expires_at < NOW() THEN 'FREE'
                     ELSE up.tier
                   END AS tier,
                   up.expires_at AS plan_expires_at,
                   CASE
                     WHEN up.expires_at IS NOT NULL AND up.expires_at < NOW() THEN 0
                     ELSE up.default_coupon_quota
                   END AS default_coupon_quota
            FROM pack_order_requests por
            JOIN users u ON u.id = por.user_id
            LEFT JOIN LATERAL (
              SELECT id, name, image_url, category
              FROM stores
              WHERE deleted_at IS NULL
                AND (
                  (por.store_id IS NOT NULL AND id = por.store_id)
                  OR (por.store_id IS NULL AND owner_id = por.user_id)
                )
              ORDER BY CASE WHEN id = por.store_id THEN 0 ELSE 1 END, created_at DESC
              LIMIT 1
            ) s ON TRUE
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

  /** 발주요청 삭제 (어드민 전용) */
  deletePackOrder: adminProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      const dbConn = await db.getDb();
      if (!dbConn) throw new Error('Database connection failed');
      await dbConn.execute(
        sql`DELETE FROM pack_order_requests WHERE id = ${input.id}`
      );
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

      // 기존 active 플랜 조회 (audit용) + 비활성화
      const prevResult = await dbConn.execute(
        sql`SELECT id, tier, expires_at, default_coupon_quota, is_active
            FROM user_plans
            WHERE user_id = ${input.userId} AND is_active = TRUE
            ORDER BY created_at DESC LIMIT 1`
      );
      const prevPlan = extractRows(prevResult)[0] ?? null;

      await dbConn.execute(
        sql`UPDATE user_plans
            SET is_active = FALSE, updated_at = NOW()
            WHERE user_id = ${input.userId} AND is_active = TRUE`
      );

      // FREE로 전환 시 — 신청 중인 발주요청 전부 취소
      if (input.tier === 'FREE') {
        await dbConn.execute(
          sql`UPDATE pack_order_requests
              SET status = 'CANCELLED', updated_at = NOW()
              WHERE user_id = ${input.userId}
                AND status IN ('REQUESTED', 'CONTACTED')`
        );
      }

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
      const prevExpired = prevPlan?.expires_at
        ? new Date(prevPlan.expires_at as string) < new Date() : false;
      void db.insertAuditLog({
        adminId,
        action: 'admin_set_user_plan',
        targetType: 'user',
        targetId: input.userId,
        payload: {
          newTier: input.tier,
          newDurationDays: input.durationDays ?? duration,
          newCouponQuota: quota,
          prevPlanId: prevPlan?.id ?? null,
          prevTier: prevPlan?.tier ?? null,
          prevExpiresAt: prevPlan?.expires_at ?? null,
          prevCouponQuota: prevPlan?.default_coupon_quota ?? null,
          prevWasExpired: prevExpired,
          isRenewal: !!prevPlan,
          memo: memo,
        },
      });

      // FREE로 전환 시 — 기존 active 쿠폰 재정렬
      // 체험 종료(non_trial_free) → effectiveQuota=0 (전체 비활성)
      // 체험 활성(trial_free)     → effectiveQuota=10
      if (input.tier === 'FREE') {
        // 대상 유저 trial 상태 조회 → resolveAccountState(FREE 컨텍스트)
        const targetUserResult = await dbConn.execute(
          sql`SELECT trial_ends_at FROM users WHERE id = ${input.userId}`
        );
        const targetUserRow = extractRows(targetUserResult)[0];
        const targetTrialEndsAt = targetUserRow?.trial_ends_at
          ? new Date(targetUserRow.trial_ends_at as string) : null;
        // reclaim quota 정책:
        //   non_trial_free 여부와 관계없이 항상 FREE_MAX_ACTIVE_COUPONS(10) 사용
        //   → 기존 활성 쿠폰은 10개 초과분만 비활성화 (전체 삭제 금지)
        //   → "0/0 제한(생성·수정 차단)"은 coupons.create/update 서버 403에서만 적용
        // (targetAccountState는 로깅/감사 목적으로만 사용)
        const targetAccountState = db.resolveAccountState(targetTrialEndsAt, 'FREE');
        const effectiveQuota = PLAN_POLICY.FREE_MAX_ACTIVE_COUPONS; // 항상 10

        try {
          const reclaim = await db.reclaimCouponsToFreeTier(input.userId, effectiveQuota);
          void db.insertAuditLog({
            adminId,
            action: 'admin_coupon_reclaim_free',
            targetType: 'user',
            targetId: input.userId,
            payload: {
              deactivated: reclaim.deactivated,
              reason: 'manual_free_downgrade',
              success: true,
            },
          });
        } catch (reclaimErr) {
          // reclaim 실패: plan 변경은 성공했으나 쿠폰 초과 상태 잔존 가능
          // → audit 기록 후 admin.runReconciliation로 수동 복구 가능
          console.error('[setUserPlan] FREE reclaim failed — needs manual reconciliation:', reclaimErr);
          void db.insertAuditLog({
            adminId,
            action: 'admin_coupon_reclaim_failed',
            targetType: 'user',
            targetId: input.userId,
            payload: {
              reason: 'manual_free_downgrade',
              error: String(reclaimErr),
              note: 'run admin.runReconciliation to fix',
            },
          });
        }
      }

      return { success: true };
    }),

  /**
   * adjustPlanQuota — 관리자 전용: 현재 활성 유료 플랜의 quota/기간 조정
   *
   * setUserPlan 과의 차이 (핵심):
   *   - setUserPlan: 기존 active 비활성화 → 새 row INSERT → windowStart 밀림 → 누적 쿠폰 카운트 리셋 (= 기존 버그)
   *   - adjustPlanQuota: 같은 row UPDATE → starts_at/created_at 유지 → windowStart 불변 → **누적 유지**
   *
   * 사용 시나리오: 유료 진행 중 사장님 CS 대응 (기간 연장 / 쿠폰 추가 부여).
   * 목적: 30 → 40 조정 시 이미 쓴 20장 카운트 유지 → 추가 20장만 가능 (사장님 원칙).
   *
   * 가드:
   *   - 활성 유료(tier !== 'FREE') 플랜 없으면 에러
   *   - expires_at 연장: GREATEST(NOW, 기존 expires_at) + addDurationDays 로 과거 만료값 보호
   *   - tier 변경 기능 없음 (tier 변경은 setUserPlan 사용)
   *
   * 반환: { success, planId, quotaBefore, quotaAfter, expiresAtBefore, expiresAtAfter }
   */
  adjustPlanQuota: adminProcedure
    .input(z.object({
      userId: z.number(),
      newCouponQuota: z.number().int().min(0),
      addDurationDays: z.number().int().min(0).optional(),
      memo: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const dbConn = await db.getDb();
      if (!dbConn) throw new Error('Database connection failed');

      const adminId = ctx.user.id;

      // 기존 active 유료 플랜 조회 (FREE 는 조정 대상 아님 — tier 변경은 setUserPlan)
      const prevResult = await dbConn.execute(
        sql`SELECT id, tier, starts_at, expires_at, default_coupon_quota, default_duration_days, memo
            FROM user_plans
            WHERE user_id = ${input.userId}
              AND is_active = TRUE
              AND tier != 'FREE'
            ORDER BY created_at DESC LIMIT 1`
      );
      const prevPlan = extractRows(prevResult)[0] ?? null;

      if (!prevPlan) {
        throw new Error(
          '활성 유료 플랜이 없습니다. 계급 부여는 "저장" 버튼 (setUserPlan) 을 사용하세요.'
        );
      }

      // expires_at 연장 계산 — 과거 만료값 보호
      const quotaBefore = Number(prevPlan.default_coupon_quota);
      const expiresAtBefore = prevPlan.expires_at ? new Date(prevPlan.expires_at as string) : null;
      const addDays = input.addDurationDays ?? 0;

      // quota/기간 조정 UPDATE — starts_at, created_at, tier, default_duration_days 불변
      await dbConn.execute(
        sql`UPDATE user_plans
            SET default_coupon_quota = ${input.newCouponQuota},
                expires_at = CASE
                  WHEN ${addDays}::int > 0
                    THEN GREATEST(expires_at, NOW()) + (${addDays} || ' days')::interval
                  ELSE expires_at
                END,
                memo = COALESCE(${input.memo ?? null}, memo),
                updated_at = NOW()
            WHERE id = ${prevPlan.id} AND is_active = TRUE`
      );

      // 조정 후 값 조회 (audit 용)
      const afterResult = await dbConn.execute(
        sql`SELECT default_coupon_quota, expires_at
            FROM user_plans WHERE id = ${prevPlan.id}`
      );
      const afterRow = extractRows(afterResult)[0];
      const quotaAfter = Number(afterRow?.default_coupon_quota ?? input.newCouponQuota);
      const expiresAtAfter = afterRow?.expires_at ? new Date(afterRow.expires_at as string) : null;

      void db.insertAuditLog({
        adminId,
        action: 'admin_adjust_plan_quota',
        targetType: 'user',
        targetId: input.userId,
        payload: {
          planId: prevPlan.id,
          tier: prevPlan.tier,
          quotaBefore,
          quotaAfter,
          expiresAtBefore: expiresAtBefore?.toISOString() ?? null,
          expiresAtAfter: expiresAtAfter?.toISOString() ?? null,
          addDurationDays: addDays,
          memo: input.memo ?? null,
        },
      });

      return {
        success: true,
        planId: Number(prevPlan.id),
        quotaBefore,
        quotaAfter,
        expiresAtBefore,
        expiresAtAfter,
      };
    }),

  /**
   * terminatePlan — 관리자 전용: 구독 즉시 강제 종료 (진짜 휴면 전이)
   *
   * setUserPlan(tier='FREE')와의 차이:
   *   - setUserPlan: TIER_DEFAULTS.FREE {7일, 10개} 기본값 → 무료 체험 사실상 재부여 (버그)
   *   - terminatePlan: quota=0, duration=0, trialEndsAt=과거 → 즉시 dormant 상태 확정
   *
   * 멱등성 보장:
   *   - 이미 종료된 계정에 재실행해도 동일 결과 (is_active=FALSE인 플랜 비활성화 시도 → no-op)
   *   - trial_ends_at이 이미 과거여도 덮어쓰기 → 항상 dormant 확정
   */
  terminatePlan: adminProcedure
    .input(z.object({
      userId: z.number(),
      reason: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const dbConn = await db.getDb();
      if (!dbConn) throw new Error('Database connection failed');

      const adminId = ctx.user.id;

      // 1. 모든 활성 플랜 비활성화
      await dbConn.execute(
        sql`UPDATE user_plans
            SET is_active = FALSE, updated_at = NOW()
            WHERE user_id = ${input.userId} AND is_active = TRUE`
      );

      // 2. 신청 중인 발주요청 전부 취소
      await dbConn.execute(
        sql`UPDATE pack_order_requests
            SET status = 'CANCELLED', updated_at = NOW()
            WHERE user_id = ${input.userId}
              AND status IN ('REQUESTED', 'CONTACTED')`
      );

      // 3. quota=0, duration=0 으로 FREE 플랜 신규 생성 (무료 체험 재부여 없음)
      //    expires_at=NULL → "영구 FREE" 이지만 quota=0이라 쿠폰 발행 불가
      await dbConn.execute(
        sql`INSERT INTO user_plans
              (user_id, tier, starts_at, expires_at, default_duration_days,
               default_coupon_quota, is_active, created_by_admin_id, memo, created_at, updated_at)
            VALUES
              (${input.userId}, 'FREE', NOW(), NULL, 0,
               0, TRUE, ${adminId}, ${input.reason ?? '관리자 강제 종료'}, NOW(), NOW())`
      );

      // 4. trial_ends_at을 과거로 설정 → isDormantMerchant() 확정 true
      //    (trialEndsAt < now AND 플랜 없거나 만료 → dormant)
      await dbConn.execute(
        sql`UPDATE users
            SET trial_ends_at = NOW() - INTERVAL '1 second', updated_at = NOW()
            WHERE id = ${input.userId}`
      );

      // 5. 모든 활성 쿠폰 비활성화 (quota=0 정책 적용)
      let deactivated = 0;
      try {
        const reclaim = await db.reclaimCouponsToFreeTier(input.userId, 0);
        deactivated = reclaim.deactivated;
      } catch (reclaimErr) {
        console.error('[terminatePlan] reclaim failed — schedule reconciliation:', reclaimErr);
      }

      // 6. 감사 로그
      void db.insertAuditLog({
        adminId,
        action: 'admin_terminate_plan',
        targetType: 'user',
        targetId: input.userId,
        payload: {
          reason: input.reason ?? 'manual_termination',
          deactivatedCoupons: deactivated,
          note: 'quota=0, trial_ends_at=past — immediate dormant',
        },
      });

      return { success: true, deactivated };
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
      // 휴면 판정: 활성 유료 플랜 없음 AND (trialEndsAt <= now OR trialEndsAt IS NULL)
      // hasBeenNudged: MERCHANT_NUDGE audit log 존재 여부
      const baseSelect = sql`
        SELECT u.id, u.name, u.email, u.role, u.created_at, u.trial_ends_at,
               u.is_franchise AS "isFranchise",
               CASE
                 WHEN up.tier IS NULL THEN 'FREE'
                 WHEN up.expires_at IS NOT NULL AND up.expires_at < NOW() THEN 'FREE'
                 ELSE up.tier
               END AS tier,
               up.starts_at AS plan_starts_at,
               up.expires_at AS plan_expires_at,
               up.is_active AS plan_is_active,
               up.memo AS plan_memo,
               CASE
                 WHEN up.expires_at IS NOT NULL AND up.expires_at < NOW() THEN 0
                 ELSE up.default_coupon_quota
               END AS default_coupon_quota,
               up.default_duration_days,
               (SELECT COUNT(*) FROM stores s WHERE s.owner_id = u.id AND s.deleted_at IS NULL) AS store_count,
               (SELECT STRING_AGG(s2.name, ', ' ORDER BY s2.created_at ASC)
                FROM stores s2 WHERE s2.owner_id = u.id AND s2.deleted_at IS NULL) AS store_names,
               CASE
                 WHEN up.is_active = TRUE AND (up.expires_at IS NULL OR up.expires_at > NOW()) THEN FALSE
                 WHEN u.trial_ends_at IS NOT NULL AND u.trial_ends_at > NOW() THEN FALSE
                 ELSE TRUE
               END AS is_dormant,
               EXISTS(
                 SELECT 1 FROM admin_audit_logs al
                 WHERE al.action = 'MERCHANT_NUDGE' AND al.target_id = u.id
               ) AS has_been_nudged
        FROM users u
        LEFT JOIN LATERAL (
          SELECT tier, starts_at, expires_at, is_active, default_coupon_quota, default_duration_days, memo
          FROM user_plans
          WHERE user_id = u.id AND is_active = TRUE
          ORDER BY created_at DESC LIMIT 1
        ) up ON TRUE
        WHERE u.role IN ('merchant', 'user')
      `;
      if (input.q) {
        const qLike = `%${input.q}%`;
        result = await dbConn.execute(
          sql`${baseSelect}
              AND (u.name ILIKE ${qLike} OR u.email ILIKE ${qLike})
              ORDER BY u.created_at DESC LIMIT 100`
        );
      } else {
        result = await dbConn.execute(
          sql`${baseSelect}
              ORDER BY u.created_at DESC LIMIT 100`
        );
      }

      return extractRows(result);
    }),

  /**
   * getPlanHistory — 계급 변경 히스토리 (어드민 모달 표시용)
   *
   * admin_audit_logs 에서 해당 사용자에 대한 plan 관련 액션을 시간 역순으로 조회.
   * 읽기 전용 — DB 쓰기 없음. additive read.
   *
   * 액션 타입:
   *   - admin_set_user_plan: 계급 부여/변경 (payload: newTier, newDurationDays, newCouponQuota, prevTier, isRenewal)
   *   - admin_adjust_plan_quota: 같은 tier 내 quota/기간 조정 (payload: tier, quotaBefore, quotaAfter, addDurationDays, expiresAtAfter)
   *   - admin_terminate_plan: 즉시 강제 종료 (payload: reason, deactivatedCoupons)
   */
  getPlanHistory: adminProcedure
    .input(z.object({ userId: z.number() }))
    .query(async ({ input }) => {
      const dbConn = await db.getDb();
      if (!dbConn) throw new Error('Database connection failed');

      const result = await dbConn.execute(
        sql`SELECT al.id, al.action, al.payload, al.created_at, al.admin_id,
                   admin.name AS admin_name
            FROM admin_audit_logs al
            LEFT JOIN users admin ON admin.id = al.admin_id
            WHERE al.target_type = 'user'
              AND al.target_id = ${input.userId}
              AND al.action IN (
                'admin_set_user_plan',
                'admin_adjust_plan_quota',
                'admin_terminate_plan',
                'auto_plan_expired'
              )
            ORDER BY al.created_at DESC
            LIMIT 20`
      );

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

  /**
   * 1회성 과거 데이터 정합성 정리 (어드민 전용)
   *
   * 대상: 유료 플랜이 만료되었으나 FREE 기준 초과 active 쿠폰이 남아있는 유저
   * 처리: reclaimCouponsToFreeTier 일괄 실행
   *
   * 호출 시점: 배포 후 1회, 또는 Railway 로그에서 "만료 유저" 경고 확인 시
   * 멱등: 이미 정리된 유저는 skip (deactivated=0)
   */
  runReconciliation: adminProcedure.mutation(async ({ ctx }) => {
    const dbConn = await db.getDb();
    if (!dbConn) throw new Error('Database connection failed');

    // 정리 대상 유저: 유료 플랜이 모두 만료 + 현재 활성 플랜 없음 + active 쿠폰 있음
    const targetResult = await dbConn.execute(`
      SELECT DISTINCT u.id AS user_id
      FROM users u
      INNER JOIN stores s ON s.owner_id = u.id AND s.deleted_at IS NULL
      INNER JOIN coupons c ON c.store_id = s.id AND c.is_active = TRUE
      WHERE NOT EXISTS (
        SELECT 1 FROM user_plans up
        WHERE up.user_id = u.id
          AND up.is_active = TRUE
          AND (up.expires_at IS NULL OR up.expires_at > NOW())
      )
    `);
    const targetRows = (targetResult as any)?.rows ?? [];
    const userIds: number[] = targetRows.map((r: any) => Number(r.user_id));

    if (userIds.length === 0) {
      return { processed: 0, totalDeactivated: 0, message: '정리 대상 없음 — 이미 정합성 일치' };
    }

    // trial_ends_at 배치 조회 (N+1 방지)
    const trialResult = await dbConn.execute(`
      SELECT id, trial_ends_at FROM users WHERE id = ANY(ARRAY[${userIds.join(',')}]::int[])
    `);
    const trialMap: Record<number, Date | null> = {};
    for (const row of ((trialResult as any)?.rows ?? [])) {
      trialMap[Number(row.id)] = row.trial_ends_at ? new Date(row.trial_ends_at) : null;
    }

    let totalDeactivated = 0;
    const results: { userId: number; deactivated: number; accountState: string }[] = [];

    for (const userId of userIds) {
      const accountState = db.resolveAccountState(trialMap[userId], 'FREE');
      // reclaim은 항상 FREE_MAX_ACTIVE_COUPONS(10) 기준 — 전체 삭제 금지
      // non_trial_free 제한(0개)은 create/update 차단에만 적용
      const r = await db.reclaimCouponsToFreeTier(userId, PLAN_POLICY.FREE_MAX_ACTIVE_COUPONS);
      results.push({ userId, deactivated: r.deactivated, accountState });
      totalDeactivated += r.deactivated;
    }

    void db.insertAuditLog({
      adminId: ctx.user.id,
      action: 'admin_reconciliation_run',
      targetType: 'user',
      payload: { processed: userIds.length, totalDeactivated, results },
    });

    console.log(JSON.stringify({
      action: 'admin_reconciliation_complete',
      adminId: ctx.user.id,
      processed: userIds.length,
      totalDeactivated,
      timestamp: new Date().toISOString(),
    }));

    return { processed: userIds.length, totalDeactivated, results };
  }),
});
