-- Migration: 쿠폰 없는 사용자 trial 초기화 (Task 3 — Trial Start Timing)
-- 목적: trialEndsAt 기산 시점을 stores.create → coupons.create(첫 쿠폰)로 변경
--
-- 대상: trial_ends_at IS NOT NULL이지만 아직 쿠폰을 등록한 적 없는 사용자
--   → trial 카운트다운이 가게 등록 시점에 시작됐지만 쿠폰을 등록하지 않은 케이스
--   → 이들의 trial_ends_at을 NULL로 리셋하면, 첫 쿠폰 등록 시 7일 체험이 새로 시작됨
--
-- 보존 대상: 이미 쿠폰을 등록한 사용자는 trial이 실제로 사용 중이므로 그대로 유지
--
-- 적용 방법: Railway PostgreSQL 콘솔에서 직접 실행
-- 영향도 확인 쿼리:
--   SELECT COUNT(*) FROM users WHERE trial_ends_at IS NOT NULL
--     AND id IN (
--       SELECT DISTINCT s.owner_id FROM stores s WHERE s.deleted_at IS NULL
--         AND NOT EXISTS (SELECT 1 FROM coupons c WHERE c.store_id = s.id)
--     );

UPDATE users
SET trial_ends_at = NULL,
    updated_at    = NOW()
WHERE trial_ends_at IS NOT NULL
  AND id IN (
    SELECT DISTINCT s.owner_id
    FROM stores s
    WHERE s.deleted_at IS NULL
      AND NOT EXISTS (
        SELECT 1 FROM coupons c WHERE c.store_id = s.id
      )
  );
