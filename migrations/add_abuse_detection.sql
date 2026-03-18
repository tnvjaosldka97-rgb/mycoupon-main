-- ============================================================
-- 어뷰저 탐지 시스템 마이그레이션
-- user_abuse_snapshots: 주간 평가 스냅샷 (히스토리/연속주 판단용)
-- user_abuse_status:    유저별 현재 상태 (source of truth)
-- ============================================================

-- 1. user_abuse_snapshots — 주간 평가 스냅샷
CREATE TABLE IF NOT EXISTS user_abuse_snapshots (
  id                   SERIAL PRIMARY KEY,
  user_id              INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  week_start           VARCHAR(10) NOT NULL,           -- KST 기준 월요일 YYYY-MM-DD
  expired_total_count  INTEGER NOT NULL,
  expired_unused_count INTEGER NOT NULL,
  expired_unused_rate  NUMERIC(5, 4) NOT NULL,         -- 0.0000 ~ 1.0000
  evaluation           VARCHAR(20) NOT NULL,           -- CLEAN | WATCHLIST | PENALIZED
  evaluated_at         TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_user_abuse_snapshots_user_week
  ON user_abuse_snapshots(user_id, week_start);

CREATE INDEX IF NOT EXISTS idx_user_abuse_snapshots_user_id
  ON user_abuse_snapshots(user_id);

-- 2. user_abuse_status — 유저별 현재 어뷰저 상태 (daily 업데이트)
CREATE TABLE IF NOT EXISTS user_abuse_status (
  id                          SERIAL PRIMARY KEY,
  user_id                     INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  status                      VARCHAR(20) NOT NULL DEFAULT 'CLEAN', -- CLEAN | WATCHLIST | PENALIZED
  penalized_at                TIMESTAMP,
  consecutive_penalized_weeks INTEGER NOT NULL DEFAULT 0,
  consecutive_clean_weeks     INTEGER NOT NULL DEFAULT 0,
  last_snapshot_evaluation    VARCHAR(20),
  auto_release_eligible_at    TIMESTAMP,               -- penalized_at + 14일
  manually_set                BOOLEAN NOT NULL DEFAULT FALSE,
  manually_set_by             INTEGER,
  manually_set_at             TIMESTAMP,
  note                        TEXT,
  penalty_warning_shown       BOOLEAN NOT NULL DEFAULT FALSE,
  created_at                  TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at                  TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_user_abuse_status_status
  ON user_abuse_status(status)
  WHERE status IN ('WATCHLIST', 'PENALIZED');

COMMENT ON TABLE user_abuse_snapshots IS '어뷰저 주간 평가 스냅샷 — 연속주 판단 히스토리';
COMMENT ON TABLE user_abuse_status    IS '유저별 현재 어뷰저 상태 — daily job이 갱신하는 source of truth';
COMMENT ON COLUMN user_abuse_snapshots.week_start IS 'KST 기준 해당 주 월요일 날짜 (YYYY-MM-DD)';
COMMENT ON COLUMN user_abuse_status.auto_release_eligible_at IS 'PENALIZED 확정 시각 + 14일 — 이 시각 이후부터 자동 해제 가능';
COMMENT ON COLUMN user_abuse_status.penalty_warning_shown IS '로그인 경고 모달 표시 여부 (PENALIZED 확정 후 1회 보장)';
