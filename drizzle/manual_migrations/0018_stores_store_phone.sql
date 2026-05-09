-- Manual Migration: stores.store_phone (가게 전화번호 — 사용자 노출용)
-- 적용 예정일: 사장님 명령 시점
-- 적용 방법: 운영 DB에 직접 실행 (idempotent)
-- 적용 상태: PENDING
--
-- 목적:
--   가게 등록/수정 폼에 "가게 전화번호" 신규 필수 필드 추가.
--   사용자 측 노출 (지도 매장 카드, 매장 상세 페이지) 은 store_phone 사용.
--   기존 phone 컬럼 (사장님 연락처, 영업용) 은 admin/통계 측에서만 노출.
--
-- 추가 컬럼:
--   store_phone VARCHAR(30) NULL
--   - 길이 30: 자유 형식 (예: "02-1234-5678", "02.333.111", "031 123 4567")
--   - 010 강제 X (가게 대표 번호는 02/031 등 지역번호 가능)
--
-- 백필 정책 (사장님 결정 — 동일하게 쳐):
--   기존 매장의 phone 값을 store_phone 으로 1회 복사.
--   복사 조건: store_phone IS NULL AND phone IS NOT NULL (idempotent — 재실행 안전).
--   사장님이 추후 EditStoreModal 에서 가게 전용 번호로 갱신 가능.
--
-- 적용 확인:
--   \d stores → store_phone 컬럼 존재 확인
--   SELECT COUNT(*) FROM stores WHERE store_phone IS NULL AND phone IS NOT NULL;
--   → 0 (백필 후 모든 phone 보유 매장이 store_phone 도 보유)
--
-- 롤백 SQL (필요 시):
--   ALTER TABLE stores DROP COLUMN IF EXISTS store_phone;

BEGIN;

ALTER TABLE stores
  ADD COLUMN IF NOT EXISTS store_phone VARCHAR(30);

UPDATE stores
   SET store_phone = phone
 WHERE store_phone IS NULL
   AND phone IS NOT NULL;

COMMIT;
