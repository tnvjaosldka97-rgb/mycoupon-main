-- Migration: 동의 필드 추가 (Task 2 — Consent Flow + DB Save)
-- 목적: privacy_agreed_at, lbs_agreed_at, terms_version, privacy_version 컬럼 추가
-- 적용 방법: Railway PostgreSQL 콘솔에서 직접 실행

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS privacy_agreed_at  TIMESTAMP,
  ADD COLUMN IF NOT EXISTS lbs_agreed_at      TIMESTAMP,
  ADD COLUMN IF NOT EXISTS terms_version      VARCHAR(20),
  ADD COLUMN IF NOT EXISTS privacy_version    VARCHAR(20);

-- 기존 사용자: terms_agreed_at이 있으면 privacy_agreed_at도 동시에 동의한 것으로 간주
-- (기존 동의 흐름에서 privacyAgreed도 필수였으므로)
UPDATE users
SET privacy_agreed_at = terms_agreed_at
WHERE terms_agreed_at IS NOT NULL
  AND privacy_agreed_at IS NULL;
