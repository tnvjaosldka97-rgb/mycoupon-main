-- ============================================================
-- coupon_extension_requests 테이블 추가
-- 목적: 사용자의 휴면 매장 조르기(쿠폰 등록 요청) 이력 관리
--   - 24시간 중복 조르기 방지
--   - 30일 기준 distinct 대기 인원 집계
--   - unresolved 운영 상태 기반 데이터 (audit_logs 대체)
-- ============================================================

CREATE TABLE IF NOT EXISTS coupon_extension_requests (
  id          SERIAL PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  owner_id    INTEGER NOT NULL,              -- 요청 대상 사장님 users.id
  store_name  VARCHAR(255) NOT NULL DEFAULT '',
  created_at  TIMESTAMP NOT NULL DEFAULT NOW()
);

-- 사장님 기준 최신순 조회 (대기 집계용)
CREATE INDEX IF NOT EXISTS idx_cer_owner_created
  ON coupon_extension_requests(owner_id, created_at DESC);

-- 유저 × 사장님 중복 조회 (24h dedup용)
CREATE INDEX IF NOT EXISTS idx_cer_user_owner
  ON coupon_extension_requests(user_id, owner_id);

COMMENT ON TABLE coupon_extension_requests
  IS '휴면 사장에 대한 사용자 조르기(쿠폰 등록 요청) 이력. 24h 중복 제한 + 30일 distinct 집계 기준.';
