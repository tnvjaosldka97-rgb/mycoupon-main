-- Manual Migration: users.push_notifications_enabled (앱 푸시 마스터 스위치)
-- 적용 예정일: 2026-04-28
-- 적용 방법: 운영 DB에 직접 실행 (idempotent)
-- 적용 상태: PENDING
--
-- 목적:
--   sendRealPush 진입에서 사용자 토글 체크 게이트 추가.
--   사용자가 NotificationSettings 에서 "앱 푸시 받기" OFF 시 모든 FCM 발송 차단.
--   (단골 새 쿠폰/조르기 응답/만료 등 알림 종류 무관 마스터 스위치)
--
-- 추가 컬럼:
--   push_notifications_enabled BOOLEAN NOT NULL DEFAULT TRUE
--
-- 백필 정책:
--   DEFAULT TRUE 로 모든 기존 유저는 자동 ON (현재 동작 그대로 유지)
--   사장님 사내 테스터 영향 0
--
-- 적용 확인:
--   \d users → push_notifications_enabled 컬럼 존재
--   SELECT COUNT(*) FROM users WHERE push_notifications_enabled = TRUE;
--   → 전체 유저 수와 일치
--
-- 롤백 SQL (필요 시):
--   ALTER TABLE users DROP COLUMN IF EXISTS push_notifications_enabled;

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS push_notifications_enabled BOOLEAN NOT NULL DEFAULT TRUE;
