-- ============================================================
-- 구독팩 / 계급 시스템 마이그레이션
-- v1: user_plans, pack_order_requests 테이블 추가
-- ============================================================

-- 1. Enum 타입 생성 (이미 존재하면 무시)
DO $$ BEGIN
  CREATE TYPE user_tier AS ENUM ('FREE', 'WELCOME', 'REGULAR', 'BUSY');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE pack_code AS ENUM ('WELCOME_19800', 'REGULAR_29700', 'BUSY_49500');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE order_status AS ENUM ('REQUESTED', 'CONTACTED', 'APPROVED', 'REJECTED', 'CANCELLED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- 2. user_plans 테이블: 사장님 구독 계급/플랜 이력
CREATE TABLE IF NOT EXISTS user_plans (
  id               SERIAL PRIMARY KEY,
  user_id          INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  tier             user_tier NOT NULL DEFAULT 'FREE',
  starts_at        TIMESTAMP NOT NULL DEFAULT NOW(),
  expires_at       TIMESTAMP,                          -- NULL = 만료 없음
  default_duration_days INTEGER NOT NULL DEFAULT 7,    -- 쿠폰 등록 시 기본 기간(일)
  default_coupon_quota  INTEGER NOT NULL DEFAULT 10,   -- 쿠폰 등록 시 기본 수량
  is_active        BOOLEAN NOT NULL DEFAULT TRUE,
  created_by_admin_id INTEGER,                         -- 부여한 어드민 users.id
  memo             TEXT,
  created_at       TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_user_plans_user_id ON user_plans(user_id);
CREATE INDEX IF NOT EXISTS idx_user_plans_active   ON user_plans(user_id, is_active) WHERE is_active = TRUE;

-- 3. pack_order_requests 테이블: 구매하기(수기 발주) 요청
CREATE TABLE IF NOT EXISTS pack_order_requests (
  id              SERIAL PRIMARY KEY,
  user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  store_id        INTEGER,                             -- 어느 매장 기준 요청인지 (선택)
  requested_pack  pack_code NOT NULL,
  status          order_status NOT NULL DEFAULT 'REQUESTED',
  admin_memo      TEXT,
  created_at      TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pack_orders_user_id ON pack_order_requests(user_id);
CREATE INDEX IF NOT EXISTS idx_pack_orders_status  ON pack_order_requests(status);

COMMENT ON TABLE user_plans           IS '사장님 구독 계급/플랜 이력 (FREE/WELCOME/REGULAR/BUSY)';
COMMENT ON TABLE pack_order_requests  IS '구독팩 구매하기(수기 발주) 요청 내역';
COMMENT ON COLUMN user_plans.default_duration_days IS '계급에 따라 쿠폰 등록 시 기본 적용되는 유효기간(일)';
COMMENT ON COLUMN user_plans.default_coupon_quota  IS '계급에 따라 쿠폰 등록 시 기본 적용되는 총 발행 수량';
