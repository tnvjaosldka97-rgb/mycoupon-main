/**
 * finder router — 쿠폰찾기 화면의 "조르기 확인하기 / 새로 오픈했어요" 탭 데이터 소스
 *
 * 설계 문서: docs/2026-04-17-user-notification-coupon-finder-design.md
 * Phase 2 (2026-04-17): API 추가 only. 클라이언트는 Phase 3에서 소비.
 *
 * 원칙:
 *   - 기존 엔드포인트/라우팅 보존 — 이 라우터는 additive
 *   - 쿠폰 공개 판정은 기존 buildPublicCouponFilter 와 동일 기준 (isActive + approvedBy + endDate + remainingQuantity)
 *   - 매장 공개 판정은 기존 getPublicMapStores 와 동일 기준 (isActive + approvedBy + deletedAt + lat/lng)
 *   - raw SQL + 파라미터 바인딩만 사용 (SQL injection 방어)
 *   - N+1 없이 단일 쿼리로 완결
 *   - 반경 필터는 CTE + 바깥 WHERE 방식 (HAVING 남용 금지 — PG 플래너 호환성)
 *   - 복합 쓰기 작업은 transaction 원자성 보장
 */
import { z } from 'zod';
import { sql } from 'drizzle-orm';
import { router, protectedProcedure } from '../_core/trpc';
import * as db from '../db';
import {
  USER_ALERT_RADIUS_OPTIONS_M,
  USER_ALERT_DEFAULT_RADIUS_M,
  NEW_OPEN_WINDOW_DAYS,
} from '@shared/const';

function extractRows(result: unknown): Record<string, unknown>[] {
  if (!result) return [];
  if (Array.isArray((result as any).rows)) return (result as any).rows;
  if (Array.isArray((result as any)[0])) return (result as any)[0];
  return [];
}

const radiusEnum = z.union([
  z.literal(USER_ALERT_RADIUS_OPTIONS_M[0]),
  z.literal(USER_ALERT_RADIUS_OPTIONS_M[1]),
  z.literal(USER_ALERT_RADIUS_OPTIONS_M[2]),
]);

export const finderRouter = router({
  /**
   * listNudgeActivated —
   *   유저 조르기 이후, 조르기한 매장에 새로 활성화된 쿠폰이 있는 매장 목록.
   *
   *   조건:
   *     - 유저가 과거 조르기한 매장 (store_id 매칭 + owner_id+store_name fallback)
   *     - 해당 매장이 공개 상태 (getPublicMapStores 조건)
   *     - 해당 매장에 공개 가능 쿠폰 존재 (buildPublicCouponFilter 조건)
   *     - 쿠폰의 last_activated_at > 조르기 created_at
   *     - 이미 소비된 조르기는 consumed_at 이후에 다시 활성화됐을 때만
   *
   *   dedup: 매장 단위 (DISTINCT ON store_id), 쿠폰은 가장 최근 활성화된 1건 대표
   */
  listNudgeActivated: protectedProcedure.query(async ({ ctx }) => {
    // role 분리 정책: 유저 전용 데이터 — 사업주/관리자는 빈 결과
    if (ctx.user.role !== 'user') return [];
    const dbConn = await db.getDb();
    if (!dbConn) return [];

    const result = await dbConn.execute(sql`
      SELECT DISTINCT ON (s.id)
        s.id AS "storeId",
        s.name AS "storeName",
        s.category,
        s.address,
        s.image_url AS "imageUrl",
        s.latitude, s.longitude,
        c.id AS "couponId",
        c.title AS "couponTitle",
        c.last_activated_at AS "activatedAt",
        cer.created_at AS "nudgedAt",
        cer.id AS "nudgeId"
      FROM coupon_extension_requests cer
      JOIN stores s ON (
        (cer.store_id IS NOT NULL AND s.id = cer.store_id)
        OR (cer.store_id IS NULL AND s.owner_id = cer.owner_id AND s.name = cer.store_name)
      )
      JOIN coupons c ON c.store_id = s.id
      WHERE cer.user_id = ${ctx.user.id}
        AND s.deleted_at IS NULL
        AND s.is_active = TRUE
        AND s.approved_by IS NOT NULL
        AND s.latitude IS NOT NULL
        AND s.longitude IS NOT NULL
        AND c.is_active = TRUE
        AND c.approved_by IS NOT NULL
        AND c.end_date > NOW()
        AND c.remaining_quantity > 0
        AND c.last_activated_at IS NOT NULL
        AND c.last_activated_at > cer.created_at
        AND (cer.consumed_at IS NULL OR c.last_activated_at > cer.consumed_at)
      ORDER BY s.id, c.last_activated_at DESC
      LIMIT 50
    `);
    return extractRows(result);
  }),

  /**
   * listNewlyOpened —
   *   유저 GPS 기준 반경 내, 최근 N일 이내 공개된 매장 목록.
   *
   *   조건:
   *     - 매장 공개 상태 (getPublicMapStores 조건 동일)
   *     - approved_at >= NOW() - NEW_OPEN_WINDOW_DAYS days
   *     - Haversine 반경 내 (파라미터 radiusM)
   *     - 기본 정책: 실제 공개 쿠폰이 있는 매장만 (includeWithoutCoupon=false, 혜택 플랫폼 원칙)
   *       → 추후 정책 전환 시 input.includeWithoutCoupon=true 로 bypass 가능하게 분리 설계
   *
   *   쿼리 구조: CTE `candidates` 에서 윈도/공개/쿠폰 존재 필터만 먼저 적용하여 distance_m 계산
   *              바깥 SELECT 에서 WHERE distance_m <= radius 로 반경 필터 (HAVING 미사용)
   *              → PostgreSQL 플래너 최적화 + 의미 명확성 확보
   */
  listNewlyOpened: protectedProcedure
    .input(z.object({
      lat: z.number(),
      lng: z.number(),
      /** null = 반경 해제(전체 보기). undefined = 기본값(USER_ALERT_DEFAULT_RADIUS_M). 100|200|500 = 해당 반경 */
      radiusM: radiusEnum.nullable().optional(),
      /** 추후 정책 전환용 — 기본 false: 쿠폰 있는 매장만. true: 공개 상태이면 쿠폰 없어도 포함 */
      includeWithoutCoupon: z.boolean().optional(),
    }))
    .query(async ({ ctx, input }) => {
      // role 분리 정책: 유저 전용 데이터 — 사업주/관리자는 빈 결과
      if (ctx.user.role !== 'user') return [];
      const dbConn = await db.getDb();
      if (!dbConn) return [];

      // radius === null → 반경 필터 해제 (COALESCE 로 WHERE 무력화).
      // radius === undefined → 기본값. radius === 100|200|500 → 해당 값.
      const radius: number | null = input.radiusM === null
        ? null
        : (input.radiusM ?? USER_ALERT_DEFAULT_RADIUS_M);
      const windowDays = NEW_OPEN_WINDOW_DAYS;
      const includeWithoutCoupon = input.includeWithoutCoupon ?? false;

      const result = await dbConn.execute(sql`
        WITH candidates AS (
          SELECT
            s.id AS store_id,
            s.name AS store_name,
            s.category,
            s.address,
            s.image_url,
            s.latitude::float AS lat,
            s.longitude::float AS lng,
            s.approved_at AS opened_at,
            (6371000 * acos(
              LEAST(1.0, GREATEST(-1.0,
                cos(radians(${input.lat}::float))
                  * cos(radians(s.latitude::float))
                  * cos(radians(s.longitude::float) - radians(${input.lng}::float))
                + sin(radians(${input.lat}::float))
                  * sin(radians(s.latitude::float))
              ))
            )) AS distance_m,
            (
              SELECT COUNT(*)::int FROM coupons c
              WHERE c.store_id = s.id
                AND c.is_active = TRUE
                AND c.approved_by IS NOT NULL
                AND c.end_date > NOW()
                AND c.remaining_quantity > 0
            ) AS active_coupon_count
          FROM stores s
          WHERE s.deleted_at IS NULL
            AND s.is_active = TRUE
            AND s.approved_by IS NOT NULL
            AND s.latitude IS NOT NULL
            AND s.longitude IS NOT NULL
            AND s.approved_at IS NOT NULL
            AND s.approved_at >= NOW() - make_interval(days => ${windowDays})
            AND (
              ${includeWithoutCoupon}::boolean
              OR EXISTS (
                SELECT 1 FROM coupons c
                WHERE c.store_id = s.id
                  AND c.is_active = TRUE
                  AND c.approved_by IS NOT NULL
                  AND c.end_date > NOW()
                  AND c.remaining_quantity > 0
              )
            )
        )
        SELECT
          store_id              AS "storeId",
          store_name            AS "storeName",
          category,
          address,
          image_url             AS "imageUrl",
          lat,
          lng,
          opened_at             AS "openedAt",
          distance_m            AS "distanceM",
          active_coupon_count   AS "activeCouponCount"
        FROM candidates
        WHERE distance_m <= COALESCE(${radius}::int, distance_m)
        ORDER BY opened_at DESC
        LIMIT 100
      `);
      return extractRows(result);
    }),

  /**
   * markTabSeen —
   *   유저가 "조르기 확인하기" 또는 "새로 오픈했어요" 탭을 실제로 클릭한 시점.
   *   해당 유형의 미확인 알림 읽음 처리 + (nudge 탭) 해당 조르기 row consumed_at 갱신.
   *
   *   원자성: 트랜잭션 내부에서 두 UPDATE를 묶음.
   *          - 알림 read 처리만 되고 consumed_at 미갱신 상태로 끝나면
   *            탭 재방문 시 조르기 row가 다시 나타나면서 배지만 줄어 있어 UX 불일치 발생 → 방지
   *          - 반대도 동일 (consumed_at만 갱신되고 알림 read 실패 시 배지 숫자 남음)
   *
   *   자동 읽음 금지: 탭 클릭 mutation 호출만이 유일한 트리거. 페이지 진입/자동 선택은 안 건드림.
   */
  markTabSeen: protectedProcedure
    .input(z.object({
      type: z.enum(['nudge_activated', 'newly_opened_nearby']),
    }))
    .mutation(async ({ ctx, input }) => {
      // role 분리 정책: 유저 전용 — 사업주/관리자는 no-op (클라이언트 오호출에 대비)
      if (ctx.user.role !== 'user') return { success: true, markedCount: 0 };
      const dbConn = await db.getDb();
      if (!dbConn) throw new Error('Database connection failed');

      let markedCount = 0;

      await dbConn.transaction(async (tx) => {
        // 1) 해당 유형의 미확인 알림만 read=true
        const updatedRes: any = await tx.execute(sql`
          UPDATE notifications
          SET is_read = TRUE
          WHERE user_id = ${ctx.user.id}
            AND is_read = FALSE
            AND type = ${input.type}::notification_type
        `);
        markedCount = Number(updatedRes?.rowCount ?? 0);

        // 2) nudge 탭일 때만 consumed_at 갱신 (listNudgeActivated 조건과 동일 기준)
        if (input.type === 'nudge_activated') {
          await tx.execute(sql`
            UPDATE coupon_extension_requests cer
            SET consumed_at = NOW()
            WHERE cer.user_id = ${ctx.user.id}
              AND EXISTS (
                SELECT 1
                FROM stores s
                JOIN coupons c ON c.store_id = s.id
                WHERE (
                    (cer.store_id IS NOT NULL AND s.id = cer.store_id)
                    OR (cer.store_id IS NULL AND s.owner_id = cer.owner_id AND s.name = cer.store_name)
                  )
                  AND s.deleted_at IS NULL
                  AND s.is_active = TRUE
                  AND s.approved_by IS NOT NULL
                  AND c.is_active = TRUE
                  AND c.approved_by IS NOT NULL
                  AND c.end_date > NOW()
                  AND c.remaining_quantity > 0
                  AND c.last_activated_at IS NOT NULL
                  AND c.last_activated_at > cer.created_at
                  AND (cer.consumed_at IS NULL OR c.last_activated_at > cer.consumed_at)
              )
          `);
        }
      });

      return { success: true, markedCount };
    }),

  /**
   * getUnreadCountByType —
   *   유저 알림 배지 세분화용 카운트 (신규 endpoint).
   *   기존 notifications.getUnreadCount (Number 반환) 는 건드리지 않음 — 하위호환 보존.
   */
  /**
   * listFavoriteCouponsNew — Phase C2b-1
   *   유저가 단골 등록한 매장 중, 최근 N일 이내 새로 활성화된 쿠폰이 있는 매장 목록.
   *
   *   조건:
   *     - favorites.user_id = ctx.user.id
   *     - favorites.notify_new_coupon = TRUE (알림 수신 동의 필터)
   *     - 매장 공개 상태 유지 (deleted_at IS NULL, is_active, approved_by 보유)
   *     - 쿠폰 공개 + 활성 (is_active, approved_by, end_date>NOW, remaining_quantity>0)
   *     - 쿠폰 last_activated_at > 단골 등록 시점 OR NEW_OPEN_WINDOW_DAYS 윈도 내
   *
   *   알림 발송(notifications INSERT) 은 별건 — 이 procedure 는 UI 조회 전용.
   */
  listFavoriteCouponsNew: protectedProcedure.query(async ({ ctx }) => {
    if (ctx.user.role !== 'user') return [];
    const dbConn = await db.getDb();
    if (!dbConn) return [];

    const result = await dbConn.execute(sql`
      SELECT DISTINCT ON (s.id)
        s.id                  AS "storeId",
        s.name                AS "storeName",
        s.category            AS category,
        s.address             AS address,
        s.image_url           AS "imageUrl",
        s.latitude, s.longitude,
        c.id                  AS "couponId",
        c.title               AS "couponTitle",
        c.last_activated_at   AS "activatedAt",
        f.created_at          AS "favoritedAt"
      FROM favorites f
      JOIN stores s ON s.id = f.store_id
      JOIN coupons c ON c.store_id = s.id
      WHERE f.user_id = ${ctx.user.id}
        AND f.notify_new_coupon = TRUE
        AND s.deleted_at IS NULL
        AND s.is_active = TRUE
        AND s.approved_by IS NOT NULL
        AND c.is_active = TRUE
        AND c.approved_by IS NOT NULL
        AND c.end_date > NOW()
        AND c.remaining_quantity > 0
        AND c.last_activated_at IS NOT NULL
        AND c.last_activated_at > f.created_at
      ORDER BY s.id, c.last_activated_at DESC
      LIMIT 50
    `);
    return extractRows(result);
  }),

  getUnreadCountByType: protectedProcedure.query(async ({ ctx }) => {
    // role 분리 정책: 유저 전용 배지 — 사업주/관리자는 0 (상단 종의 유저 알림 카운트 차단)
    if (ctx.user.role !== 'user') return { total: 0, nudgeActivated: 0, newlyOpenedNearby: 0 };
    const dbConn = await db.getDb();
    if (!dbConn) return { total: 0, nudgeActivated: 0, newlyOpenedNearby: 0 };

    const result = await dbConn.execute(sql`
      SELECT
        COUNT(*)::int AS total,
        COUNT(*) FILTER (WHERE type = 'nudge_activated'::notification_type)::int AS "nudgeActivated",
        COUNT(*) FILTER (WHERE type = 'newly_opened_nearby'::notification_type)::int AS "newlyOpenedNearby"
      FROM notifications
      WHERE user_id = ${ctx.user.id}
        AND is_read = FALSE
    `);
    const row = extractRows(result)[0] ?? {};
    return {
      total: Number((row as any).total ?? 0),
      nudgeActivated: Number((row as any).nudgeActivated ?? 0),
      newlyOpenedNearby: Number((row as any).newlyOpenedNearby ?? 0),
    };
  }),
});
