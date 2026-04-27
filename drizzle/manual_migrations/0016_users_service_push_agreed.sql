-- Manual Migration: users.service_push_agreed (거래·서비스 통지 동의)
-- 적용 예정일: 2026-04-28
-- 적용 방법: 운영 DB에 직접 실행 (트랜잭션 단일 처리)
-- 적용 상태: PENDING
--
-- 목적:
--   users 테이블에 거래·서비스 통지 알림 수신 동의 필드 3개 추가
--   회원이 발급받은 쿠폰의 만료/사용 안내, 단골 매장 신규 쿠폰 알림 등
--   광고성 정보 수신 (marketing_agreed) 와 별개로 관리
--   정보통신망법 §50① "광고성 정보" 적용 X (거래·서비스 통지)
--
-- 추가 컬럼:
--   service_push_agreed BOOLEAN NOT NULL DEFAULT FALSE
--   service_push_agreed_at TIMESTAMP NULL
--   service_push_terms_version VARCHAR(10) NULL
--
-- 백필 정책 (사내 테스터 가정):
--   기존 가입 완료 유저 (signup_completed_at IS NOT NULL) 는
--   service_push_agreed = TRUE 로 백필하여 거래성 푸시 끊김 방지
--
-- 적용 확인:
--   \d users  → 3개 컬럼 확인
--   SELECT COUNT(*) FROM users WHERE service_push_agreed = TRUE;  → 사내 테스터 수 일치
--
-- 롤백 SQL (필요 시):
--   ALTER TABLE users
--     DROP COLUMN IF EXISTS service_push_agreed,
--     DROP COLUMN IF EXISTS service_push_agreed_at,
--     DROP COLUMN IF EXISTS service_push_terms_version;

BEGIN;

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS service_push_agreed BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS service_push_agreed_at TIMESTAMP,
  ADD COLUMN IF NOT EXISTS service_push_terms_version VARCHAR(10);

-- 사내 테스터 백필: 기존 가입 완료 유저 → TRUE
UPDATE users
SET service_push_agreed = TRUE,
    service_push_agreed_at = NOW(),
    service_push_terms_version = 'v1'
WHERE signup_completed_at IS NOT NULL
  AND service_push_agreed = FALSE;  -- 재실행 시 idempotent

COMMIT;
