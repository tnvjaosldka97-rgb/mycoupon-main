-- 어드민이 admin.createStore로 등록했으나 approvedBy가 NULL인 가게를 일괄 승인 처리
-- 조건: is_active=true, approved_by IS NULL, latitude IS NOT NULL, longitude IS NOT NULL
--        (좌표가 있다 = admin.createStore로 geocoding을 통해 등록된 것)
-- 실행 전 영향 row 확인:
--   SELECT COUNT(*) FROM stores WHERE is_active=true AND approved_by IS NULL AND latitude IS NOT NULL AND longitude IS NOT NULL;

UPDATE stores
SET
  approved_by  = owner_id,    -- 실제 승인자 admin id를 알 수 없으므로 owner_id로 대체
  approved_at  = created_at,  -- 등록 시점을 승인 시점으로 설정
  status       = 'approved',
  updated_at   = NOW()
WHERE
  is_active    = true
  AND approved_by IS NULL
  AND latitude  IS NOT NULL
  AND longitude IS NOT NULL
  AND deleted_at IS NULL;
