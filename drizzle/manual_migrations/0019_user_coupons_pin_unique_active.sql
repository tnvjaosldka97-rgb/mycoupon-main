-- Manual Migration: user_coupons.pin_code 부분 unique 인덱스 (status='active' scope)
-- 적용 예정일: 사장님 명령 시점
-- 적용 방법: 운영 DB에 직접 실행 (idempotent)
-- 적용 상태: PENDING
--
-- 목적:
--   PIN 코드 6자리 random 발급 충돌 차단.
--   기존 schema (pin_code VARCHAR(6) NOT NULL) 에 unique 제약 X → 동시 active 다수일 때
--   동일 PIN 발급 가능 → getUserCouponByPinCode first match return → 잘못된 사용자 쿠폰 사용 처리 위험.
--
-- 정책 (paranoid 2중 가드):
--   - DB 측: status='active' 인 row 들끼리만 pin_code unique (used/expired 는 자유)
--   - 애플리케이션 측: server/routers.ts downloadCoupon PIN 발급 retry loop (동일 PR-102)
--   - DB 부분 unique 가 최종 방어선 — race condition 까지 차단
--
-- 기존 데이터 영향:
--   현재 사용자 5명 시점 = 충돌 0 (확률 1/100만, active row 소수)
--   적용 전 검증: SELECT pin_code, COUNT(*) FROM user_coupons WHERE status='active' GROUP BY pin_code HAVING COUNT(*)>1;
--   → 0 row 반환되어야 인덱스 생성 성공.
--
-- 적용 확인:
--   \d user_coupons → uq_user_coupons_pin_active 인덱스 존재
--   동일 active PIN 으로 INSERT 시 unique violation throw
--
-- 롤백 SQL (필요 시):
--   DROP INDEX IF EXISTS uq_user_coupons_pin_active;

CREATE UNIQUE INDEX IF NOT EXISTS uq_user_coupons_pin_active
  ON user_coupons (pin_code)
  WHERE status = 'active';
