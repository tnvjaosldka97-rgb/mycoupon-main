-- Add daily limit columns to coupons table
ALTER TABLE coupons 
ADD COLUMN IF NOT EXISTS daily_limit INTEGER,
ADD COLUMN IF NOT EXISTS daily_used_count INTEGER DEFAULT 0 NOT NULL,
ADD COLUMN IF NOT EXISTS last_reset_date TIMESTAMP DEFAULT NOW();

-- Create index for faster daily reset queries
CREATE INDEX IF NOT EXISTS idx_coupons_daily_reset ON coupons(is_active, last_reset_date) WHERE is_active = true;

COMMENT ON COLUMN coupons.daily_limit IS '일 소비수량 제한 (null이면 무제한)';
COMMENT ON COLUMN coupons.daily_used_count IS '오늘 다운로드된 수량';
COMMENT ON COLUMN coupons.last_reset_date IS '마지막 리셋 날짜';
