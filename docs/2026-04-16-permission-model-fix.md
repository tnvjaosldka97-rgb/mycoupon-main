# 2026-04-16 권한 모델 수정 + 정책 분석 종합 문서

## 반영 상태 구분

### ✅ 버그 수정 완료 (이번 커밋 포함)
| Issue | 요약 | 수정 파일 |
|-------|------|----------|
| Issue 1 (읽기 경로) | LATERAL JOIN으로 store_id=NULL 발주요청에서 매장 정보 fallback 표시 | `packOrders.ts`, `AdminDashboard.tsx` |
| Issue 2 | 구독팩 버튼 3개 동시 깜빡임 → per-pack pendingPackCode 분리 | `MerchantDashboard.tsx` |
| Issue 3 | 재부여 시 만료 잔존 → LATERAL + cache invalidation + audit 보강 | `packOrders.ts`, `AdminDashboard.tsx` |

### ⚠️ 정책 확인 후 반영 (이번 커밋에서 제외 또는 승인 대기)
| Issue | 요약 | 현재 상태 |
|-------|------|----------|
| Issue 1 (쓰기 경로) | `createOrderRequest`에서 storeId 미전달 시 자동 매장 연결 정책 | **코드 작성됨, 정책 승인 대기** — [상세 분석](#issue-1-policy) |
| Issue 4 | `extra_coupon_quota` 컬럼 추가 (추가 쿠폰 지급 기능) | 설계 완료, 미구현 |
| Issue 5 | 유료기간 내 쿠폰 소진 시 UI 표시 | 분석 완료, 프론트 미구현 |
| Issue 6 | 마스터어드민 추가 쿠폰 지급 endpoint | 설계 완료, 미구현 |
| Issue 7 | 프랜차이즈 → 유료 전환 시나리오 | 분석 완료, 변경 없음 |
| Issue 8 | 1계정 1업장 정책 확인 | 분석 완료, 현재 동작 = 의도 정책 |
| Issue 9 | B2B Organization 구조 | 설계 제안, 미구현 |

---

## 목차
1. [Issue 1: 슈퍼어드민 대시보드 매장 식별 정보 누락](#issue-1)
   - [Issue 1 정책 변경 분석: createOrderRequest 자동 매장 연결](#issue-1-policy)
2. [Issue 2: 구독팩 버튼 3개 동시 깜빡임](#issue-2)
3. [Issue 3: 권한 재부여 시 만료 상태 잔존](#issue-3)
4. [Issue 4: 유료 진행 중 추가 쿠폰 부여](#issue-4)
5. [Issue 5: 유료기간 내 쿠폰 소진 시 권한 변화](#issue-5)
6. [Issue 6: 마스터어드민 추가 쿠폰 지급 가능 여부](#issue-6)
7. [Issue 7: 프랜차이즈 계급 계정 시나리오](#issue-7)
8. [Issue 8: 유료 쿠폰 권한 1계정 1업장 정책](#issue-8)
9. [Issue 9: B2B 장기권한 구조 제안](#issue-9)
10. [정책 정리표](#policy-table)
11. [변경 파일 목록](#changed-files)
12. [커밋 전 수동 검증 시나리오](#pre-commit-verification)
13. [검증 시나리오](#verification)
14. [남은 리스크](#risks)

---

<a id="issue-1"></a>
## Issue 1: 슈퍼어드민 대시보드 매장 식별 정보 누락

### 원인
| 단계 | 위치 | 문제 |
|---|---|---|
| **데이터 저장** | `MerchantDashboard.tsx:825` | `storeId: myStores?.[0]?.id` — 매장 미등록/로딩 미완 시 `undefined` |
| **서버 수용** | `packOrders.ts:253` | `storeId: z.number().optional()` — `undefined` 허용 |
| **DB 저장** | `packOrders.ts:266` | `input.storeId ?? null` → `pack_order_requests.store_id = NULL` |
| **조회 JOIN** | `packOrders.ts:360` | `LEFT JOIN stores s ON s.id = por.store_id` — NULL이면 매칭 실패 |
| **프론트 렌더** | `AdminDashboard.tsx:1585` | `{order.store_name && ...}` — NULL이면 렌더 안 됨 |

**root cause**: `store_id`가 NULL인 발주요청이 다수 존재하고, JOIN이 오직 `store_id`로만 연결하므로, 사장님이 매장을 보유하더라도 매장 정보가 표시되지 않음.

### 수정 내용
1. **`packOrders.ts` — `listPackOrders` 쿼리**: `LEFT JOIN stores` → `LEFT JOIN LATERAL` subquery로 교체. `store_id` 우선, NULL이면 `owner_id`로 fallback. 추가 컬럼: `store_image_url`, `store_category`
2. **`packOrders.ts` — `getPackOrder` 쿼리**: 동일 LATERAL 적용
3. **`packOrders.ts` — `createOrderRequest`**: `storeId` NULL일 때 유저 소유 활성 매장 수 확인. 0개→에러, 2개 이상→에러, 정확히 1개→자동 연결
4. **`AdminDashboard.tsx` — 발주요청 카드**: 매장 썸네일 이미지 + 카테고리 추가. `store_name` 없으면 "가게정보 없음" fallback
5. **`AdminDashboard.tsx` — 가게등록 승인 카드**: `store.imageUrl` 파싱 후 썸네일 표시

### 기존 NULL row 백필
LATERAL JOIN이 조회 시 자동 fallback하므로 기존 데이터 마이그레이션 불필요. 원한다면 활성 매장 1개인 유저의 NULL row만 백필하는 쿼리:
```sql
UPDATE pack_order_requests por
SET store_id = s.id
FROM (
  SELECT DISTINCT ON (owner_id) id, owner_id
  FROM stores WHERE deleted_at IS NULL
  ORDER BY owner_id, created_at ASC
) s
WHERE por.store_id IS NULL
  AND s.owner_id = por.user_id
  AND NOT EXISTS (
    SELECT 1 FROM stores s2
    WHERE s2.owner_id = por.user_id AND s2.deleted_at IS NULL AND s2.id != s.id
  );
```

---

<a id="issue-1-policy"></a>
### Issue 1 정책 변경 분석: `createOrderRequest` 자동 매장 연결

> **분류: 정책 민감 항목 — 승인 대기**

#### 변경 내용 (`packOrders.ts:266-282`)

`storeId`가 프론트에서 전달되지 않았을 때, 서버가 해당 유저의 활성 매장을 조회하여:
- **정확히 1개** → 자동으로 `store_id`에 연결
- **0개** → `throw new Error('매장 등록 후 신청 가능합니다.')`
- **2개 이상** → `throw new Error('매장을 먼저 선택하세요.')`

#### 기존 운영 규칙과의 비교

| 시나리오 | 기존 동작 (변경 전) | 변경 후 | 규칙 변경 여부 |
|----------|---------------------|---------|---------------|
| 매장 1개 + storeId 미전달 | `store_id=NULL`로 DB 저장, 어드민이 수동 매칭 | 자동으로 해당 매장 연결 | **YES** (수동→자동) |
| 매장 0개 + storeId 미전달 | `store_id=NULL`로 저장, 발주 자체는 성공 | **에러 throw, 발주 차단** | **YES** (허용→차단) |
| 매장 2개+ + storeId 미전달 | `store_id=NULL`로 저장 | **에러 throw, 매장 선택 강제** | **YES** (허용→차단) |
| storeId 명시 전달 (정상 흐름) | 정상 저장 | 동일 | NO |

#### 영향 범위

1. **프론트엔드 호출 경로**: `MerchantDashboard.tsx:824-827`에서 `storeId: myStores?.[0]?.id`를 전달.
   - 매장 1개인 정상 유저: `myStores[0].id`가 유효 → **기존 코드도 storeId를 보냄** → 이 변경에 영향 없음
   - 매장 0개 유저: `myStores?.[0]?.id` = `undefined` → 서버에 도달 → 기존: NULL 저장 / 변경 후: 에러
   - 매장 로딩 미완료: `myStores`가 아직 `undefined` → 동일한 케이스

2. **운영 데이터 영향**: 기존 `store_id=NULL` row는 이미 LATERAL JOIN으로 읽기 경로에서 해결됨. 이 변경은 **신규 발주만** 영향.

3. **실제 운영 빈도**:
   - 매장 1개 유저 (대다수): 프론트가 storeId를 이미 보내므로 영향 없음
   - 매장 0개 유저: 발주 자체가 무의미 (매장 없이 쿠폰 사용 불가). 기존에 NULL 저장은 의미 없는 데이터
   - 매장 2개+ 유저: 프랜차이즈만 해당. 프랜차이즈는 `storeId: myStores?.[0]?.id`로 첫 번째 매장이 전달됨

#### 결론

이 변경은 **기존에 허용되던 "매장 없는 발주"를 차단**합니다. 실질적으로 문제가 되는 케이스는 낮지만, **기존 운영 규칙을 변경하는 것은 사실**이므로 승인 후 반영이 적절합니다.

**승인 시**: 이 코드 그대로 커밋
**미승인 시**: `createOrderRequest`의 storeId 검증 블록(line 268-282)을 제거하고, 기존대로 `input.storeId ?? null` 유지

---

<a id="issue-2"></a>
## Issue 2: 구독팩 버튼 3개 동시 깜빡임

### 원인
| 위치 | 코드 | 문제 |
|---|---|---|
| `MerchantDashboard.tsx:828` | `disabled={createOrderRequest.isPending}` | 전역 mutation의 `isPending`을 3개 버튼이 공유 |
| `MerchantDashboard.tsx:831` | `{createOrderRequest.isPending ? '신청 중...' : '구매하기'}` | 어느 팩이든 pending이면 전부 텍스트 변경 |

**root cause**: tRPC useMutation의 `isPending`은 mutation 인스턴스 단위로 하나. `.map()` 안에서 같은 mutation 참조하므로 1건 클릭 → 3개 버튼 전부 반응.

### 수정 내용
1. `pendingPackCode` state 추가 (`string | null`)
2. 버튼 클릭 시 `setPendingPackCode(pack.packCode)` → 해당 버튼만 `disabled`/`aria-busy`
3. `onSuccess`/`onError`에서 `setPendingPackCode(null)` → 복구
4. `if (pendingPackCode) return;` — 다른 팩 진행 중이면 추가 클릭 차단 (중복 submit 방지)

### 서버 중복신청 방어
이미 존재: `createOrderRequest`의 CTE (`packOrders.ts:276-294`)가 `REQUESTED`/`CONTACTED` 상태 동일 팩 존재 시 INSERT 하지 않고 기존 row ID 반환. 서버 레벨 idempotency 확보됨.

---

<a id="issue-3"></a>
## Issue 3: 권한 재부여 시 만료 상태 잔존

### 원인 (복합)
| 계층 | 위치 | 문제 |
|---|---|---|
| **프론트 캐시** | `AdminDashboard.tsx:332-342` | `setUserPlan` onSuccess에서 `packOrders.getMyPlan` 미invalidate → 대상 유저의 캐시가 갱신 안 됨 |
| **조회 JOIN** | `packOrders.ts:788` | `LEFT JOIN user_plans up ON up.user_id = u.id AND up.is_active = TRUE` — active row 2건이면 유저 중복 행 발생, 비결정적 plan 선택 |
| **감사 추적** | `packOrders.ts:590` | audit payload에 이전 플랜 정보 없음 → 재부여인지 신규인지 역추적 불가 |

### 수정 내용
1. **AdminDashboard.tsx**: `setUserPlan` onSuccess에 `utils.packOrders.getMyPlan.invalidate()` + `utils.packOrders.listPackOrders.invalidate()` 추가
2. **packOrders.ts — `listUsersForPlan`**: `LEFT JOIN` → `LEFT JOIN LATERAL (...ORDER BY created_at DESC LIMIT 1)` 변경. 유저당 최신 active plan 1건만 반환
3. **packOrders.ts — `setUserPlan`**: 비활성화 전 이전 plan 캡처 → audit log에 `prevTier`, `prevExpiresAt`, `prevCouponQuota`, `prevWasExpired`, `isRenewal` 포함

### active row 중복 발생 가능성
- **정상 경로**: 항상 1건 (setUserPlan이 전부 비활성 → 1건 INSERT)
- **race condition**: 관리자 2명 동시 호출 시 2건 가능
- **권장**: `CREATE UNIQUE INDEX idx_user_plans_one_active_per_user ON user_plans (user_id) WHERE is_active = TRUE;` — 별도 마이그레이션으로 추가
- **LATERAL**: race 상황에서도 최신 1건만 반환하는 방어적 읽기 (정책 변경 아닌 read-path stabilization)

---

<a id="issue-4"></a>
## Issue 4: 유료 진행 중 추가 쿠폰 부여 가능 여부

### 현재 구조 분석
| 항목 | 현재 상태 |
|---|---|
| `user_plans.default_coupon_quota` | 유일한 쿠폰 한도 필드. 플랜 생성 시 고정 |
| `extra_coupon_quota` 필드 | **존재하지 않음** |
| 소진량 계산 | `SUM(coupons.total_quantity)` WHERE `created_at >= plan.starts_at` |
| 한도 비교 | `usedQuota + newQuantity > defaultCouponQuota` |

### 추가 쿠폰 구현을 위한 구조 보강안

**Option A: `user_plans`에 `extra_coupon_quota` 컬럼 추가** (권장)
```sql
ALTER TABLE user_plans ADD COLUMN extra_coupon_quota integer NOT NULL DEFAULT 0;
```

- 한도 비교식 변경: `usedQuota + newQuantity > (defaultCouponQuota + extraCouponQuota)`
- 추가 지급 시: `UPDATE user_plans SET extra_coupon_quota = extra_coupon_quota + N WHERE user_id = X AND is_active = TRUE`
- 기간 종료 시: plan 자체가 비활성 → extra도 자동 소멸 (별도 처리 불필요)
- **장점**: 스키마 변경 최소, 기존 로직과 자연스러운 통합
- **단점**: plan 재부여 시 extra가 리셋됨 (의도된 동작)

**Option B: 별도 `coupon_grants` 테이블**
```sql
CREATE TABLE coupon_grants (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  plan_id INTEGER REFERENCES user_plans(id),
  amount INTEGER NOT NULL,
  granted_by_admin_id INTEGER NOT NULL,
  reason TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);
```
- 한도 비교식: `usedQuota + newQuantity > (defaultCouponQuota + SUM(grants.amount))`
- **장점**: 지급 이력 완전 보존, 개별 추적 가능
- **단점**: JOIN 추가, 쿼리 복잡도 증가

**권장: Option A**. 이유:
1. 현재 audit_log에 이미 변경 이력이 쌓임
2. 추가 쿠폰은 해당 플랜 기간에 종속 → plan row와 lifecycle 일치
3. 구현/유지 비용 최소

### 검증 시나리오 (구현 후)
- 유료 30일 + 기본 50장 → `default_coupon_quota=50, extra_coupon_quota=0`
- 운영 중간 추가 20장 → `extra_coupon_quota=20` → 총 한도 70장
- 남은 기간 동안 `usedQuota + new <= 70` 까지 등록 가능
- 기간 종료 → plan `is_active=FALSE` → base/extra 모두 비활성

---

<a id="issue-5"></a>
## Issue 5: 유료기간 내 쿠폰 소진 시 권한 변화 시뮬레이션

### 현재 코드 기준 실제 동작

| 단계 | 시스템 반응 | 근거 |
|---|---|---|
| 유료 기간 유효 + 잔여 0 | `resolveAccountState()` → `'paid'` | plan tier ≠ FREE → 무조건 paid (`db.ts:2220`) |
| 쿠폰 등록 시도 | `coupons.create` 403 reject | `usedQuota + newQty > defaultCouponQuota` (`routers.ts:1457`) |
| `getMyPlan` 응답 | `quotaRemaining: 0` | `Math.max(0, quotaTotal - usedQuota)` (`packOrders.ts:192`) |
| 프론트 표시 | 구매하기 버튼은 활성, 쿠폰 등록만 차단 | `planState: 'paid'`, 등록 시도 시 서버 에러 |

### 결론
**현재 동작이 의도된 정책과 일치합니다:**
- 등급: `active paid` 유지
- 쿠폰 등록: 차단 (quota 초과)
- 다른 기능(매장 관리 등): 영향 없음

### 개선 제안
프론트에서 `quotaRemaining === 0 && planState !== 'expired'` 상태를 명시적으로 표시해야 함:
- "쿠폰 소진 (잔여 0개)" 배지
- 쿠폰 등록 버튼 비활성 + 안내 문구: "이번 기간 쿠폰이 모두 소진되었습니다"
- 추가 쿠폰 지급 요청 안내 (Issue 4 구현 후)

---

<a id="issue-6"></a>
## Issue 6: 마스터어드민 추가 쿠폰 지급 가능 여부

### 현재 상태
**불가능**. `user_plans`에 `extra_coupon_quota` 필드가 없고, `setUserPlan`은 플랜 전체를 교체하는 구조이므로, 추가 쿠폰만 올리는 방법이 없음.

### 구현 시 조건 정리 (Issue 4의 Option A 적용 시)

| 조건 | 지급 가능 | 이유 |
|---|---|---|
| 유효 유료 플랜 보유 | ✅ | 기간 내 extra quota 증가 |
| FREE (체험 중) | ❌ | 무료 체험에 추가 지급은 정책 모호 |
| FREE (체험 만료) | ❌ | non_trial_free → 쿠폰 등록 자체 불가 |
| 휴면 (plan 없거나 만료) | ❌ | active plan 없으므로 UPDATE 대상 없음 |
| 프랜차이즈 | ❌ (불필요) | 이미 isUnlimited=true |

### 필요한 신규 endpoint
```typescript
addExtraCouponQuota: adminProcedure
  .input(z.object({
    userId: z.number(),
    amount: z.number().min(1).max(500),
    reason: z.string().optional(),
  }))
  .mutation(...)
```
- active plan 존재 확인 (없으면 에러)
- plan tier가 FREE면 에러
- `UPDATE user_plans SET extra_coupon_quota = extra_coupon_quota + amount WHERE user_id = X AND is_active = TRUE`
- audit log 기록

---

<a id="issue-7"></a>
## Issue 7: 프랜차이즈 계급 계정 시나리오

### 현재 코드 기준 동작

| 항목 | 프랜차이즈 동작 | 근거 |
|---|---|---|
| 쿠폰 등록 | 무제한 (`isUnlimited: true`) | `resolveAccountState(isFranchise=true)` → `'paid'`, quota 체크 자체가 bypass되지는 않지만 `isUnlimited` 플래그로 프론트에서 제한 없이 표시 |
| 매장 수 | **다수 등록 가능** | `stores.create`에서 `isFranchise` 체크 시 1매장 제한 bypass (`routers.ts:734`) |
| 기간 제한 | 없음 | `resolveAccountState`에서 `isFranchise=true` → 무조건 `'paid'` 반환, plan expiry 무관 |
| 쿠폰 한도 | 코드상 한도 체크는 존재하나 실질적 무제한 | plan이 없으면 FREE(10개) 기본값이지만, franchise는 `resolveAccountState='paid'`로 통과 |
| 부여 조건 | FREE 계정에만 부여 가능 | `setFranchise`에서 유료 플랜 이력 있으면 거부 (`routers.ts:2896-2907`) |

### 프랜차이즈 → 유료 전환 시나리오

**현재 코드 기준**: 직접적인 전환 로직은 없음. 하지만:
1. admin이 `setFranchise(isFranchise=false)` 호출 → `is_franchise=false`
2. admin이 `setUserPlan(tier='WELCOME')` 호출 → 유료 플랜 부여
3. 이 시점에서 `stores.create`의 1매장 제한이 적용됨

**문제**: 기존에 프랜차이즈로 3개 매장 운영 중이었다면?
- **현재 동작**: 3개 매장 그대로 유지됨. 신규 매장 추가만 차단.
- **쿠폰 등록**: `routers.ts:1365-1375`에서 non-franchise + 다매장 시 canonical store(최초 등록)에만 쿠폰 생성 가능

### 운영상 안전한 정책 제안

| 시나리오 | 권장 정책 |
|---|---|
| 프랜차이즈 해제 + 유료 전환 시 기존 매장 | **신규 추가만 차단**, 기존 매장은 유지. 관리자에게 "이 유저는 N개 매장 보유 중" 경고 표시 |
| 유료 전환 후 쿠폰 등록 | 대표 매장(canonical store)에만 가능. 나머지 매장은 조회만 가능 |
| 초과 매장 정리 | 자동 비활성화는 위험 → 관리자가 수동으로 정리하도록 알림 + 관리 UI |

---

<a id="issue-8"></a>
## Issue 8: 유료 쿠폰 권한 1계정 1업장 정책 확인

### 코드/DB 기준 판정

| 질문 | 답 | 근거 |
|---|---|---|
| 유료 시 1계정 1업장인가? | **예** | `stores.create` (`routers.ts:734-738`): `!isFranchise && existing.length > 0` → 에러 |
| 1계정 2~3업장 가능한가? | **아니오** (신규 등록 시) | 위 체크에 의해 차단 |
| legacy 데이터로 2업장 보유 가능? | **예** | 체크는 생성 시점에만 존재, 기존 데이터 소급 적용 없음 |
| 2업장 보유 시 쿠폰 등록 | canonical store에만 가능 | `routers.ts:1365-1375` — earliest registered store |

### 현재 동작 / 의도 정책 / 수정 제안

| 구분 | 내용 |
|---|---|
| **현재 동작** | 생성 시점 1개 제한, 기존 다매장은 유지, canonical store에만 쿠폰 |
| **의도 정책** | 1계정 1업장 (유료) / 다업장 (프랜차이즈) |
| **수정 제안** | 없음 — 현재 구조가 의도와 일치. 단, 관리자 UI에서 "이 유저는 N개 매장 보유" 표시 추가 권장 |

---

<a id="issue-9"></a>
## Issue 9: B2B 장기권한 구조 제안

### 현재 구조의 한계
- 계정 = 개인. 조직/팀 개념 없음
- 프랜차이즈 = `users.is_franchise` boolean. 상위 권한 구조가 아닌 예외 플래그
- 감사 로그는 admin_id 기준. 조직 내 역할 분리 불가

### 권장안: 조직(Organization) + 멤버(Seat) 구조

```
organizations
├── id, name, contract_type ('B2B_ANNUAL'), plan_tier
├── max_stores, max_seats, coupon_quota_total
├── contract_starts_at, contract_expires_at
└── created_by_admin_id

organization_members
├── id, org_id, user_id
├── role ('owner' | 'manager' | 'staff')
├── invited_at, accepted_at
└── is_active

organization_stores
├── id, org_id, store_id
└── assigned_at
```

**장점:**
- 본사 owner가 하위 매장 관리자를 초대/제거 가능
- 매장별 쿠폰 할당이 아닌 조직 전체 quota pool
- 감사 로그에 `org_id` 추가 → 조직 단위 추적
- 개별 계정 비밀번호 공유 불필요 → 보안 강화
- 직원 퇴사 시 해당 seat만 비활성 → 다른 매장 영향 없음

**단점:**
- 스키마 변경 규모 큼 (3개 테이블 + 관계)
- 기존 프랜차이즈 마이그레이션 필요
- 관리 UI 신규 개발 (조직 관리, 멤버 초대, 매장 할당)

### 차선안: 본사-지점 매핑 (parent-child user)

```sql
ALTER TABLE users ADD COLUMN parent_user_id INTEGER REFERENCES users(id);
ALTER TABLE users ADD COLUMN org_role VARCHAR(20); -- 'headquarter' | 'branch_manager'
```

**장점:** 스키마 변경 최소, 기존 `is_franchise`와 호환 가능
**단점:** 깊은 계층 불가(2단계만), 조직 단위 quota 공유 어려움, 확장성 낮음

### 비교표

| 기준 | 권장안 (Organization) | 차선안 (Parent-Child) |
|---|---|---|
| 구현 비용 | 높음 (2-3주) | 낮음 (3-5일) |
| 확장성 | 높음 (N단계 계층, 역할 분리) | 낮음 (2단계 고정) |
| 감사 추적 | 조직+멤버+매장 단위 | 유저 단위만 |
| 보안 | 계정 분리, 최소 권한 원칙 | 공유 계정 위험 잔존 |
| 운영 편의 | 높음 (조직 대시보드) | 중간 |
| 기존 호환 | migration 필요 | is_franchise 재활용 가능 |

### 권장 로드맵
1. **즉시**: 현재 `is_franchise` + 1매장 정책으로 운영 (변경 없음)
2. **단기 (1-2주)**: Issue 4의 `extra_coupon_quota` 추가로 유연성 확보
3. **중기 (1-2월)**: B2B 고객 확정 시 Organization 구조 설계 + 구현
4. **마이그레이션**: 기존 franchise 유저 → organization + member로 전환

---

<a id="policy-table"></a>
## 정책 정리표

| 상태 | 업장 등록 가능 수 | 쿠폰 한도 | 추가쿠폰 가능 | 기간 만료 처리 | 관리자 지급 가능 | 비고 |
|---|---|---|---|---|---|---|
| **무료 (체험 중)** | 1개 | 10개/7일 | ❌ | 7일 후 non_trial_free | ❌ | 첫 쿠폰 등록 시 체험 시작 |
| **휴면 (체험 만료)** | 1개 (등록만, 쿠폰 불가) | 0개 | ❌ | 이미 만료 상태 | ❌ | `accountState = 'non_trial_free'` |
| **유료 (WELCOME/REGULAR/BUSY)** | 1개 | 30/50/90개 | ✅ (구현 후) | plan `is_active=FALSE` | ✅ | 기간 내 quota pool |
| **유료 + 추가쿠폰** | 1개 | base + extra | — | base+extra 동시 만료 | ✅ | `extra_coupon_quota` 컬럼 추가 후 |
| **유료 (기간유효 / 잔여0)** | 1개 | 0개 남음 | ✅ (구현 후) | 등급 유지, 등록만 차단 | ✅ | `quotaRemaining=0` 별도 표시 권장 |
| **프랜차이즈** | **무제한** | 무제한 | ❌ (불필요) | 기간 없음 | ❌ (불필요) | `isUnlimited=true`, FREE만 부여 가능 |
| **프랜차이즈→유료 전환** | 기존 유지, 신규 추가 차단 | 해당 tier 기준 | ✅ (구현 후) | 유료 기준 적용 | ✅ | canonical store에만 쿠폰 |
| **B2B 상위플랜 (향후)** | 조직 단위 N개 | 조직 전체 pool | ✅ | 계약 종료 시 전체 만료 | ✅ | Organization 구조 필요 |

---

<a id="changed-files"></a>
## 변경 파일 목록

### 버그 수정 (커밋 대상)
| 파일 | 변경 내용 | Issue |
|---|---|---|
| `server/routers/packOrders.ts` | listPackOrders/getPackOrder LATERAL JOIN, listUsersForPlan LATERAL JOIN, setUserPlan audit 보강 | 1(읽기), 3 |
| `server/db.ts` | `reclaimCouponsToFreeTier` effectiveQuota 타입 명시 (`number`) | TS 에러 수정 |
| `client/src/pages/AdminDashboard.tsx` | 매장 썸네일+fallback, cache invalidation | 1(읽기), 3 |
| `client/src/pages/MerchantDashboard.tsx` | pendingPackCode state, 버튼 per-pack loading | 2 |

### 정책 변경 (승인 대기)
| 파일 | 변경 내용 | Issue |
|---|---|---|
| `server/routers/packOrders.ts:268-282` | createOrderRequest storeId 자동 연결/에러 로직 | 1(쓰기) |

### 문서
| 파일 | 내용 |
|---|---|
| `docs/2026-04-16-permission-model-fix.md` | 이 문서 (Issues 1-9 종합 분석) |

---

<a id="pre-commit-verification"></a>
## 커밋 전 수동 검증 시나리오 (createOrderRequest 정책 변경)

> Issue 1의 `createOrderRequest` storeId 자동 연결 로직 검증용.
> 이 3개 시나리오를 통과해야 정책 변경 코드를 커밋에 포함할 수 있음.

### 시나리오 A: 매장 1개 유저

**전제 조건:**
- merchant 계정, 활성 매장 1개 보유
- 프론트에서 `storeId`를 전달하지 않는 상황 시뮬레이션 (또는 `storeId: undefined`)

**검증 방법:**
```bash
# DB에서 매장 1개인 merchant 확인
SELECT u.id, u.name, COUNT(s.id) as store_count
FROM users u
LEFT JOIN stores s ON s.owner_id = u.id AND s.deleted_at IS NULL
WHERE u.role = 'merchant'
GROUP BY u.id HAVING COUNT(s.id) = 1
LIMIT 5;
```

**API 호출 (storeId 없이):**
```
POST /trpc/packOrders.createOrderRequest
Body: { packCode: "WELCOME_19800" }
```

**기대 결과:**
- ✅ 발주 성공 (`status: 'REQUESTED'`)
- ✅ `pack_order_requests.store_id`에 해당 유저의 매장 id가 자동 연결됨
- ✅ 어드민 대시보드에서 매장명 표시됨

**실패 시 의미:** 자동 연결 로직 오류. storeId 조회 쿼리 확인 필요.

---

### 시나리오 B: 매장 0개 유저

**전제 조건:**
- merchant 계정, 매장 미등록 (또는 모든 매장 deleted_at 설정됨)

**검증 방법:**
```bash
# DB에서 매장 0개인 merchant 확인
SELECT u.id, u.name
FROM users u
LEFT JOIN stores s ON s.owner_id = u.id AND s.deleted_at IS NULL
WHERE u.role = 'merchant'
GROUP BY u.id HAVING COUNT(s.id) = 0
LIMIT 5;
```

**API 호출:**
```
POST /trpc/packOrders.createOrderRequest
Body: { packCode: "WELCOME_19800" }
```

**기대 결과:**
- ✅ 에러 반환: `"매장 등록 후 신청 가능합니다."`
- ✅ `pack_order_requests`에 새 row 생성되지 않음
- ✅ 프론트에서 에러 메시지 사용자에게 표시

**실패 시 의미:**
- 에러가 나지 않으면: 기존처럼 `store_id=NULL` row 생성. 의도한 차단이 작동하지 않음.
- 다른 에러가 나면: 에러 메시지 확인 필요.

**⚠️ 정책 판단 포인트:**
기존에는 매장 0개여도 발주가 가능했음 (`store_id=NULL`). 이 변경은 **매장 없는 발주를 차단**. 운영상 "매장 등록 전 발주 예약" 같은 워크플로가 있었다면 이 변경이 깨뜨림.

---

### 시나리오 C: 매장 2개 이상 유저

**전제 조건:**
- merchant 또는 franchise 계정, 활성 매장 2개 이상 보유
- 프론트에서 `storeId`를 전달하지 않는 상황

**검증 방법:**
```bash
# DB에서 매장 2개 이상인 유저 확인
SELECT u.id, u.name, u.is_franchise, COUNT(s.id) as store_count
FROM users u
LEFT JOIN stores s ON s.owner_id = u.id AND s.deleted_at IS NULL
WHERE u.role IN ('merchant', 'user')
GROUP BY u.id, u.is_franchise HAVING COUNT(s.id) >= 2
LIMIT 5;
```

**API 호출 (storeId 없이):**
```
POST /trpc/packOrders.createOrderRequest
Body: { packCode: "REGULAR_29700" }
```

**기대 결과:**
- ✅ 에러 반환: `"매장을 먼저 선택하세요."`
- ✅ `pack_order_requests`에 새 row 생성되지 않음

**API 호출 (storeId 명시):**
```
POST /trpc/packOrders.createOrderRequest
Body: { packCode: "REGULAR_29700", storeId: 42 }
```

**기대 결과:**
- ✅ 발주 성공 (storeId 명시 시 기존 로직과 동일)

**실패 시 의미:**
- storeId 없이 성공하면: 2개 이상 판별 로직 오류 (`LIMIT 2` 확인)
- storeId 명시해도 실패하면: storeId 유효성 검증 추가 필요할 수 있음

**⚠️ 정책 판단 포인트:**
기존에는 다매장 유저도 `store_id=NULL`로 발주 가능했음. 이 변경은 **매장 선택을 강제**. 프랜차이즈 유저의 경우 프론트가 `myStores?.[0]?.id`를 보내므로 정상 경로에서는 영향 없지만, 프론트 로딩 타이밍 이슈로 `undefined`가 올 수 있음.

---

<a id="verification"></a>
## 검증 시나리오

### Issue 1 검증
| 시나리오 | 기대 결과 | 상태 |
|---|---|---|
| store_id NULL인 발주요청 → 유저가 매장 1개 보유 | 매장명+썸네일 표시 | ✅ LATERAL fallback |
| store_id NULL + 유저 매장 0개 | "가게정보 없음" + placeholder 아이콘 | ✅ fallback |
| store_id 있는 기존 발주요청 | 해당 매장 정보 그대로 표시 | ✅ LATERAL 우선순위 |
| 가게등록 승인 카드 | 매장 이미지 썸네일 표시 | ✅ imageUrl 파싱 |
| imageUrl이 JSON 배열인 경우 | 첫 번째 이미지 표시 | ✅ JSON.parse fallback |

### Issue 2 검증
| 시나리오 | 기대 결과 | 상태 |
|---|---|---|
| 3개 버튼 중 가운데 클릭 | 가운데만 "신청 중..." + disabled | ✅ pendingPackCode |
| 좌/우 버튼 | 변화 없음 | ✅ `pendingPackCode !== pack.packCode` |
| 더블클릭/연타 | `if (pendingPackCode) return` + 서버 CTE 중복방지 | ✅ 이중 방어 |
| 요청 완료 후 | 버튼 정상 복구 | ✅ onSuccess/onError 초기화 |

### Issue 3 검증
| 시나리오 | 기대 결과 | 상태 |
|---|---|---|
| 만료 유저 재권한부여 | setUserPlan → 이전 plan 비활성 → 신규 INSERT → active | ✅ |
| 어드민 부여 후 유저 화면 | getMyPlan invalidate → 최신 plan 반환 | ✅ cache fix |
| listUsersForPlan에서 중복 active row | LATERAL이 최신 1건만 반환 | ✅ read stabilization |
| audit log | prevTier/prevExpiresAt/prevWasExpired/isRenewal 기록 | ✅ |

---

<a id="risks"></a>
## 남은 리스크

| 리스크 | 심각도 | 대응 |
|---|---|---|
| `user_plans`에 partial unique index 없음 → race condition 시 2건 active 가능 | 중 | LATERAL로 read 방어됨. 별도 migration으로 unique index 추가 권장 |
| `extra_coupon_quota` 미구현 → 추가 쿠폰 지급 불가 | 중 | Issue 4 설계 완료, migration + endpoint 구현 필요 |
| 프론트에서 `quotaRemaining=0` 상태 표시 미구분 | 낮 | 유료 active인데 잔여 0인 경우 별도 UI 표시 필요 |
| `createOrderRequest`에서 다매장 유저 미처리 | 낮 | 에러 반환은 구현됨. 프론트에서 매장 선택 UI는 미구현 (후속 과제) |
| `coupons.create` quota 쿼리가 raw string interpolation 사용 | 중 | `routers.ts:1448-1453` — parameterized query로 교체 권장 (SQL injection 방어) |
| `setFranchise`에서도 raw string interpolation | 중 | `routers.ts:2911-2912` — 동일 |
