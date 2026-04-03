-- Migration: 쿠폰 없는 사용자 trial 초기화 (Trial Start Timing Fix)
-- 목적: trialEndsAt 기산 시점을 stores.create → coupons.create(첫 쿠폰)로 변경
--
-- ⚠️ 이 파일은 참고용입니다. 실제 적용은 서버 startup auto-migration(_core/index.ts)에서 자동 실행됩니다.
--
-- ── 정확한 대상 조건 ──────────────────────────────────────────────────────────
-- 대상: 해당 사용자의 모든 가게를 통틀어 쿠폰이 단 1건도 없는 사용자
--   (가게 A에 쿠폰 있고 가게 B에 없는 사용자 → 제외: 이미 trial 사용 중)
--
-- ── 이전 버그 패턴 (사용 금지) ────────────────────────────────────────────────
--   IN (SELECT DISTINCT s.owner_id FROM stores s
--        WHERE s.deleted_at IS NULL
--          AND NOT EXISTS (SELECT 1 FROM coupons c WHERE c.store_id = s.id))
--   문제: "쿠폰 없는 가게가 하나라도 있는 owner"를 선택 → 다른 가게에 쿠폰이 있어도 포함됨
--
-- ── 보정 전 영향 row 확인 쿼리 ─────────────────────────────────────────────────
--   SELECT COUNT(*) FROM users
--   WHERE trial_ends_at IS NOT NULL
--     AND role != 'admin'
--     AND is_franchise = FALSE
--     AND NOT EXISTS (
--       SELECT 1 FROM coupons c JOIN stores s ON c.store_id = s.id
--       WHERE s.owner_id = users.id AND s.deleted_at IS NULL
--     )
--     AND EXISTS (
--       SELECT 1 FROM stores s WHERE s.owner_id = users.id AND s.deleted_at IS NULL
--     );

UPDATE users
SET trial_ends_at = NULL,
    updated_at    = NOW()
WHERE trial_ends_at IS NOT NULL
  AND role != 'admin'
  AND is_franchise = FALSE
  AND NOT EXISTS (
    -- 이 사용자 소유 모든 가게를 통틀어 쿠폰이 단 1건도 없음
    SELECT 1
    FROM coupons c
    JOIN stores s ON c.store_id = s.id
    WHERE s.owner_id = users.id
      AND s.deleted_at IS NULL
  )
  AND EXISTS (
    -- 가게가 하나라도 있는 사용자만 (stores.create flow를 거친 사용자)
    SELECT 1
    FROM stores s
    WHERE s.owner_id = users.id
      AND s.deleted_at IS NULL
  );
