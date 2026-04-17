# 2026-04-17 계급/잔여쿠폰 정합성 수정 + QA 시뮬레이션

## 1. Root Cause

관리자 조회 쿼리(`listUsersForPlan`, `getPackOrder`)가 **만료된 유료 plan을 유료 tier로 표시**하는 버그.

| 쿼리 | 버그 | 위치 |
|------|------|------|
| `listUsersForPlan` | LATERAL JOIN이 `is_active=TRUE`만 확인, `expires_at < NOW()` 미체크 → 만료 plan도 유료 tier로 표시 | `packOrders.ts:776` |
| `getPackOrder` | 동일 — `up.tier`를 raw 반환, 만료 체크 없음 | `packOrders.ts:419` |

`getMyPlan`(사장님 대시보드)은 자체적으로 `isPlanExpired` 판정 후 `tier: 'FREE'`를 반환하므로 정상.
**관리자 화면만 불일치** — 사장님은 FREE 표시, 관리자는 REGULAR 표시.

## 2. 무료 전환 시 어떤 상태가 남아서 버그가 발생했는지

스케줄러가 매시간 정각에만 실행되므로, **만료 시각~다음 정각** 사이에:
- `user_plans` row: `is_active = TRUE`, `expires_at < NOW()`
- `getMyPlan`: 자체 `isPlanExpired` 체크 → FREE 반환 (✅ 정상)
- `listUsersForPlan`: `up.tier` 그대로 반환 → 유료 tier 표시 (❌ 버그)
- `getPackOrder`: 동일 (❌ 버그)

마스터 무료 처리(`setUserPlan(FREE)`)의 경우:
- 기존 plan `is_active = FALSE` → 새 FREE plan INSERT
- 새 plan의 `tier = 'FREE'`, `default_coupon_quota = 10`
- LATERAL JOIN이 새 plan을 읽음 → `tier = 'FREE'` (✅ 정상)
- 이 경로는 정상. **버그는 자연 만료 경로에서만 발생.**

## 3. 재부여 시 이전 상태가 어떻게 섞이는지

`setUserPlan`은:
1. 기존 active plan 전부 `is_active = FALSE` (line 519-523)
2. 새 plan INSERT with `starts_at = NOW()` (line 536-565)
3. `getMyPlan`은 새 plan의 `starts_at` 기준으로 `usedQuota` 계산 → **이전 잔여 carry-over 없음 ✅**

재부여 자체에는 정합성 문제 없음. 새 plan 기준으로 clean start.

## 4. 수정 파일 목록

| 파일 | 변경 |
|------|------|
| `server/routers/packOrders.ts` | `listUsersForPlan` CASE WHEN으로 만료 tier→FREE, quota→0. `getPackOrder` 동일 적용 |

**변경 규모**: SQL CASE WHEN 추가만. 서버 로직/DB/라우팅/클라이언트 미변경.

## 5. 무료 전환 처리 방식

변경 없음. 기존 처리가 정상:
- **기간 만료**: 스케줄러가 `is_active = FALSE` 처리 + `reclaimCouponsToFreeTier`
- **마스터 무료 처리**: `setUserPlan(FREE)` → 기존 비활성 + 새 FREE plan INSERT + reclaim
- **즉시 휴면**: `terminatePlan` → 전부 비활성 + FREE(0/0) INSERT + `trial_ends_at` 과거 설정

## 6. 재부여 처리 방식

변경 없음. 기존 처리가 정상:
- `setUserPlan(REGULAR)` → 기존 active 전부 비활성 → 새 REGULAR plan INSERT (`starts_at = NOW()`)
- `getMyPlan`의 `usedQuota` 윈도우가 새 `starts_at` 기준 → 이전 잔여 carry-over 없음

## 7. 잔여 쿠폰 계산 기준

`getMyPlan` (line 116-130):
```
windowStart = max(plan.starts_at, POLICY_CUTOVER_AT)
usedQuota = SUM(coupons.total_quantity) WHERE created_at >= windowStart
quotaRemaining = max(0, quotaTotal - usedQuota)
```

| 상태 | quotaTotal | usedQuota 기준 | quotaRemaining |
|------|-----------|---------------|---------------|
| 유효 유료 plan | plan.default_coupon_quota | plan.starts_at 이후 | quota - used |
| 만료 + non_trial_free | 0 | (무관) | 0 |
| 만료 + trial_free | 10 | CUTOVER 이후 | 10 - used |
| FREE plan active | 0 (non_trial_free) 또는 10 (trial_free) | plan.starts_at 이후 | quota - used |

## 8. UI 반영 방식

### 관리자 화면 (`listUsersForPlan`)
수정 전: `COALESCE(up.tier, 'FREE')` → 만료 plan도 유료 tier 표시
수정 후:
```sql
CASE
  WHEN up.tier IS NULL THEN 'FREE'
  WHEN up.expires_at IS NOT NULL AND up.expires_at < NOW() THEN 'FREE'
  ELSE up.tier
END AS tier
```

`default_coupon_quota`도 동일 CASE:
```sql
CASE
  WHEN up.expires_at IS NOT NULL AND up.expires_at < NOW() THEN 0
  ELSE up.default_coupon_quota
END AS default_coupon_quota
```

### 사장님 대시보드 (`getMyPlan`)
변경 없음. 이미 `isPlanExpired` 판정 후 `tier: 'FREE'`, `defaultCouponQuota: 0` 반환 정상.

### 발주요청 상세 (`getPackOrder`)
수정 전: `up.tier` raw 반환
수정 후: 동일 CASE WHEN 적용

## 9. 검증 결과

### 시나리오별 기대 동작 vs 실제

| # | 시나리오 | 기대 | getMyPlan | listUsersForPlan (수정 후) |
|---|---------|------|-----------|---------------------------|
| 1 | 무료→유료 직후 | 유료 표시 | ✅ active_paid, quota=50 | ✅ REGULAR |
| 2 | 유료→일부사용→만료 | 무료, 잔여 0 | ✅ FREE, quota=0 | ✅ FREE (CASE WHEN) |
| 3 | 마스터 무료처리 | 즉시 무료 | ✅ FREE plan active | ✅ FREE |
| 4 | 무료처리 후 동일 재부여 | 새 기준 시작 | ✅ starts_at=NOW(), usedQuota=0 | ✅ 해당 tier |
| 5 | 다른 플랜 재부여 | 새 기준 시작 | ✅ 동일 | ✅ 해당 tier |
| 6 | 유료 + 잔여 0 | 유료 유지, 등록만 차단 | ✅ active_paid, quotaRemaining=0 | ✅ 해당 tier |
| 7 | 수량 남은 상태에서 무료처리 | 무료, 잔여 0 | ✅ FREE, quota=0 | ✅ FREE |

## 10. 왜 이번 수정이 갈아엎기가 아닌지

| 비교 | 이번 수정 |
|------|----------|
| DB 스키마 변경 | 없음 |
| API 계약 변경 | 없음 — 반환 필드명 동일, 값만 만료 시 FREE/0으로 보정 |
| 서버 로직 변경 | SQL CASE WHEN 추가만 (2곳) |
| 클라이언트 변경 | 없음 |
| 라우팅 변경 | 없음 |
| 정책 변경 | 없음 — 기존 `getMyPlan`의 만료 판정과 동일 기준을 `listUsersForPlan`/`getPackOrder`에 통일 |

---

## 계급 정합성 QA 시뮬레이션

| # | 시나리오 | 기대 결과 | 실패 조건 | 우선순위 | 확인 화면 |
|---|---------|----------|----------|---------|----------|
| 1 | 무료→유료 부여 직후 | 사장님: 유료 tier+quota 표시. 관리자: 동일 | 한쪽만 유료 | 치명 | 사장님 대시보드 + 관리자 계급관리 |
| 2 | 유료→일부사용→기간만료 | 사장님: FREE, 잔여 0. 관리자: FREE, 휴면 | 유료 tier/잔여 쿠폰 보임 | 치명 | 사장님 대시보드 + 관리자 계급관리 |
| 3 | 유료→일부사용→마스터 무료처리 | 즉시 FREE, 잔여 0, 유료 문구 없음 | 유료 잔여 보임 | 치명 | 사장님 대시보드 + 관리자 계급관리 |
| 4 | 무료처리 후 동일 플랜 재부여 | 새 quota 기준, 이전 잔여 carry-over 없음 | quotaRemaining에 이전 값 섞임 | 치명 | 사장님 쿠폰 등록 모달 |
| 5 | 무료처리 후 다른 플랜 재부여 | 새 tier/quota 기준, 이전 무관 | 이전 tier 표시 | 높음 | 사장님 대시보드 + 관리자 |
| 6 | 유료 활성 + 잔여 0 | 유료 유지, "한도 초과" 등록 차단, 등급 유지 | 무료로 강등 표시 | 높음 | 사장님 쿠폰 등록 모달 |
| 7 | 수량 남은 상태에서 무료처리 | 무료, 잔여 0, 이전 수량 미표시 | 이전 유료 quota 보임 | 치명 | 사장님 대시보드 |
| 8 | 만료 직전/직후 경계 (스케줄러 미실행) | getMyPlan: FREE. listUsersForPlan: FREE | listUsersForPlan이 유료 표시 | 치명 | 관리자 계급관리 |
| 9 | 관리자 수정 직후 캐시 정합성 | 관리자: 즉시 반영. 사장님: 최대 60초 내 반영 | 새로고침해도 이전 상태 | 높음 | 양쪽 대시보드 |
| 10 | 관리자 2명 동시 수정 (race) | 한 쪽만 성공, 결과적으로 active plan 1개 | 2개 active plan → 중복 표시 | 중간 | 관리자 계급관리 (LATERAL LIMIT 1로 방어) |
| 11 | 사장님/쿠폰등록/관리자 간 상태 일치 | 전부 동일한 tier/quota/만료일 표시 | 화면간 tier 불일치 | 치명 | 사장님 대시보드 vs 관리자 화면 |
| 12 | 과거 유료 이력이 현재처럼 노출 | 현재 상태만 표시, 과거 이력 미표시 | 만료된 plan이 유료 badge로 표시 | 치명 | 관리자 계급관리 tier badge |
