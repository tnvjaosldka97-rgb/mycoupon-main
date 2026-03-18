/**
 * 어뷰저 탐지 & 패널티 관리 라우터
 *
 * - getMyStatus: 본인 어뷰저 상태 조회 (protectedProcedure)
 * - markWarningSeen: 패널티 경고 모달 표시 완료 기록
 * - listAbusers: 어뷰저 목록 조회 (adminProcedure)
 * - setStatus: 수동 PENALIZED/WATCHLIST/CLEAN 지정 (adminProcedure)
 * - getLinkedAccounts: device_key 기반 연계 계정 조회 (adminProcedure)
 * - getSnapshots: 특정 유저 주간 스냅샷 이력 (adminProcedure)
 */
import { z } from 'zod';
import { sql } from 'drizzle-orm';
import { router, protectedProcedure } from '../_core/trpc';
import { TRPCError } from '@trpc/server';
import * as db from '../db';

// ─── 어드민 인증 미들웨어 ─────────────────────────────────────────────────────
const adminProcedure = protectedProcedure.use(({ ctx, next }) => {
  if (ctx.user.role !== 'admin') {
    throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Admin access required' });
  }
  return next({ ctx });
});

/** Drizzle execute 결과에서 rows 배열 추출 */
function extractRows(result: unknown): Record<string, unknown>[] {
  if (!result) return [];
  if (Array.isArray((result as any).rows)) return (result as any).rows;
  if (Array.isArray((result as any)[0])) return (result as any)[0];
  return [];
}

export const abuseRouter = router({

  // ── 유저 전용 ──────────────────────────────────────────────────────────────

  /** 본인 어뷰저 상태 조회. PENALIZED + warning_shown=false → 모달 노출 트리거. */
  getMyStatus: protectedProcedure.query(async ({ ctx }) => {
    const row = await db.getUserAbuseStatus(ctx.user.id);
    if (!row) {
      return { status: 'CLEAN', penaltyWarningShown: true };
    }
    return {
      status: row.status as string,
      penaltyWarningShown: row.penalty_warning_shown as boolean,
      penalizedAt: row.penalized_at as string | null,
      autoReleaseEligibleAt: row.auto_release_eligible_at as string | null,
    };
  }),

  /** 패널티 경고 모달 표시 완료 기록. */
  markWarningSeen: protectedProcedure.mutation(async ({ ctx }) => {
    await db.markAbuseWarningShown(ctx.user.id);
    return { success: true };
  }),

  // ── 어드민 전용 ────────────────────────────────────────────────────────────

  /**
   * WATCHLIST / PENALIZED 유저 목록.
   * status 필터 없으면 WATCHLIST + PENALIZED 모두 반환.
   */
  listAbusers: adminProcedure
    .input(z.object({
      status: z.enum(['WATCHLIST', 'PENALIZED', 'CLEAN']).optional(),
      q: z.string().optional(),
    }))
    .query(async ({ input }) => {
      const dbConn = await db.getDb();
      if (!dbConn) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR' });

      const statusFilter = input.status
        ? sql`AND uas.status = ${input.status}`
        : sql`AND uas.status IN ('WATCHLIST', 'PENALIZED')`;

      const searchFilter = input.q
        ? sql`AND (u.name ILIKE ${'%' + input.q + '%'} OR u.email ILIKE ${'%' + input.q + '%'})`
        : sql``;

      const result = await dbConn.execute(sql`
        SELECT
          uas.user_id,
          u.name,
          u.email,
          u.created_at AS user_created_at,
          uas.status,
          uas.penalized_at,
          uas.consecutive_penalized_weeks,
          uas.consecutive_clean_weeks,
          uas.last_snapshot_evaluation,
          uas.auto_release_eligible_at,
          uas.manually_set,
          uas.manually_set_at,
          uas.note,
          uas.updated_at,
          -- 최근 스냅샷 데이터
          snap.expired_total_count,
          snap.expired_unused_count,
          snap.expired_unused_rate,
          snap.week_start AS last_week_start
        FROM user_abuse_status uas
        JOIN users u ON u.id = uas.user_id
        LEFT JOIN LATERAL (
          SELECT expired_total_count, expired_unused_count, expired_unused_rate, week_start
          FROM user_abuse_snapshots
          WHERE user_id = uas.user_id
          ORDER BY week_start DESC
          LIMIT 1
        ) snap ON TRUE
        WHERE 1=1
        ${statusFilter}
        ${searchFilter}
        ORDER BY
          CASE uas.status WHEN 'PENALIZED' THEN 0 WHEN 'WATCHLIST' THEN 1 ELSE 2 END,
          uas.updated_at DESC
        LIMIT 100
      `);
      return extractRows(result);
    }),

  /** 관리자 수동 상태 지정. */
  setStatus: adminProcedure
    .input(z.object({
      userId: z.number(),
      status: z.enum(['CLEAN', 'WATCHLIST', 'PENALIZED']),
      note: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      await db.upsertAbuseStatus({
        userId: input.userId,
        status: input.status,
        consecutivePenalizedWeeks: input.status === 'PENALIZED' ? 1 : 0,
        consecutiveCleanWeeks: input.status === 'CLEAN' ? 1 : 0,
        lastSnapshotEvaluation: input.status,
        manuallySet: true,
        manuallySetBy: ctx.user.id,
        manuallySetAt: new Date(),
        note: input.note ?? null,
        penaltyWarningShown: false, // 수동 패널티도 경고 모달 재표시
      });
      return { success: true };
    }),

  /** device_key 기반 연계 계정 조회. */
  getLinkedAccounts: adminProcedure
    .input(z.object({ userId: z.number() }))
    .query(async ({ input }) => {
      const rows = await db.getLinkedAccountsByDeviceKey(input.userId);
      return rows;
    }),

  /** 특정 유저 주간 스냅샷 이력 (최근 8주). */
  getSnapshots: adminProcedure
    .input(z.object({ userId: z.number() }))
    .query(async ({ input }) => {
      const rows = await db.getUserAbuseSnapshots(input.userId);
      return rows;
    }),
});
