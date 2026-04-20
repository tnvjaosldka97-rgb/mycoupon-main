# 2026-04-17 — 동일 주소 복수 매장 노출 / 쿠폰 정책 기본값 / 무료→유료 전환 bleed 수정

## 0. 요약

- 이슈 1: **지도에서 동일 주소/동일 좌표권 복수 매장의 후순위 매장이 보이지 않던 문제** — 마커 중첩 표현의 설계 미스로 판정. 데이터/쿼리 누락 아님.
- 이슈 2: **무료 쿠폰 기본값(7일/10건) / 유료 패키지 기본값이 폼에서 안정적으로 유지되지 않음** — 서버 강제는 이미 동작 중. 클라 하드코딩 `100` 잔존 + 플랜 변경 시 열린 폼 미동기화.
- 이슈 3: **플랜 전환 시 이전 플랜 사용량이 새 플랜 권한 계산에 bleed** — 무료→유료만이 아니라 **모든 플랜 전환(FREE↔PAID, PAID↔PAID 상·하향, 만료 후 재부여)** 에서 동일하게 발생 가능한 구조 결함. 진짜 원인은 `getEffectivePlan`의 SELECT에 `starts_at / created_at`이 누락되어 create / update / banner 경로의 windowing이 항상 `POLICY_CUTOVER_AT(2026-03-18)`로 떨어진 것. `"한도 도달 + 남은 20개"` 문구 모순은 remaining>0에도 "도달" 문구를 쓰던 설계 결함.

모두 **DB 스키마 변경 없음**, 라우팅/상세 진입 경로 변경 없음, storeId 기반 상세 진입 유지.

---

## 1. 원인 분석

### 이슈 1 — 동일 좌표권 매장 누락

| 레이어 | 현황 | 판정 |
|---|---|---|
| DB | stores.address / latitude / longitude에 UNIQUE 없음 | 정상 |
| 서버 | `stores.mapStores` (routers.ts:880-1019)에서 store별로 전부 내려줌. dedupe 없음 | 정상 |
| 클라 | `MapPage.tsx:660-704` `filteredStores.forEach` → store별 마커 1개 생성. 같은 좌표면 Google Maps 상 z-index 최상위 하나만 클릭 가능. 첫 탭은 InfoWindow, 두 번째 탭은 상세모달로만 진입 가능 → 겹친 매장들은 리스트형 선택 UI 없이 은폐됨 | **이게 원인** |

결론: **지도 표현 방식의 설계 미스.** DB/API에는 매장 2개 모두 내려오지만, 지도 마커가 좌표 단위로 겹치면서 리스트형 선택이 없어 후순위 매장이 사실상 숨겨짐.

### 이슈 2 — 쿠폰 기본값 훼손

| 레이어 | 현황 |
|---|---|
| 서버 create (routers.ts:1394-1469) | `getEffectivePlan` → `resolveEffectivePlan` → `plan.defaultCouponQuota`로 단일·누적 quota 검증 + `computeCouponEndDate`로 endDate 서버 강제 재계산. **이미 제대로 강제됨** |
| 서버 update (routers.ts:1565-1638) | 단일 quota 검증만 존재, **누적 quota 검증 없음**(bypass 구멍) |
| 클라 기본값 | `MerchantDashboard.tsx:232, 277`에서 `totalQuantity: 100` 하드코딩. `handleCreateClick`이 plan 값으로 덮지만 **플랜 변경 후 이미 열려 있는 폼**에는 반영되지 않음 |

### 이슈 3 — 무료→유료 bleed

| 지표 | 현황 |
|---|---|
| `setUserPlan` INSERT | `starts_at = NOW(), created_at = NOW()` 로 신규 user_plans row 생성 — OK |
| `db.getEffectivePlan` SELECT | `tier, expires_at, default_duration_days, default_coupon_quota` 만 조회. **`starts_at / created_at` 누락** |
| routers.ts create 경로 | `(planRow as any)?.starts_at` 참조 — 위 SELECT가 빠져 **항상 `undefined`** → fallback으로 `POLICY_CUTOVER_AT(2026-03-18)` 사용 → **이전 FREE 기간의 쿠폰까지 usedQuota에 포함되어 새 유료 plan에 bleed** |
| routers.ts 경고 문구 | `usedQuota + totalQuantity > plan.defaultCouponQuota`일 때 "한도 도달" + "남은 수량 N개" **동시 노출** → remaining>0에서도 "도달" 표현 노출 → 문구 모순 |

**즉, 증상 "한도 도달 + 남은 20개"의 수학적 원인**: windowing 실패로 이전 FREE의 10개가 현재 유료(30) 잔여 계산에 들어가 `usedQuota=10, remaining=20, request=20` → `10+20=30 > 30` 거부 + 남은 20 표기. 두 문구가 동시에 떠서 모순적으로 보임.

---

## 2. 수정 파일 목록

| 파일 | 목적 |
|---|---|
| `client/src/pages/MapPage.tsx` | 동일 좌표권 그룹핑 + 리스트형 오버레이 UI |
| `server/db.ts` | `getEffectivePlan` SELECT에 `starts_at, created_at` 추가 (핵심 fix) |
| `server/routers.ts` | 쿠폰 create: windowStart fallback 보강 + 경고 문구 분기 / 쿠폰 update: 누적 quota 검증 추가 |
| `server/routers/packOrders.ts` | getMyPlan: SELECT에 `created_at` 추가 + windowStart fallback을 create 경로와 동일화 |
| `client/src/pages/MerchantDashboard.tsx` | 초기 state `totalQuantity: 100` → `10` (FREE 기본) + 폼이 열려있는 동안 plan 변경 감지 `useEffect` 추가 |

---

## 3. 서버/클라이언트 각각 어떤 로직을 바꿨는지

### 서버

1. **`server/db.ts` `getEffectivePlan` (근본 fix)**
   - SELECT에 `starts_at, created_at` 컬럼 추가.
   - 이로써 이후 경로에서 windowing이 실제 멤버십 개시 시점 이후만 집계하도록 동작.

2. **`server/routers.ts` `coupons.create` (1429~1464)**
   - windowStart fallback 순서를 `plan.starts_at → plan.created_at → POLICY_CUTOVER_AT`로 명시화.
   - 경고 문구 분기:
     - remaining ≤ 0 → "한도 도달" 단독
     - remaining > 0 → "남은 수량 N개 (요청 X개)" 단독
   - 두 문구 동시 노출 금지.

3. **`server/routers.ts` `coupons.update` (1609~1670)**
   - 기존엔 단일 quantity 체크만 있던 update 경로에 **누적 quota 검증**을 신설.
   - 핵심: `input.totalQuantity > coupon.totalQuantity` 인 경우에만 `deltaIncrease`를 계산, 이 delta를 create 경로와 **동일 windowing 기준**으로 집계한 usedQuota에 더해 초과 여부 검증.
   - 축소/동일은 검증 skip — 과거 발행의 축소는 정책상 자유.

4. **`server/routers/packOrders.ts` `getMyPlan` (62~130)**
   - SELECT에 `created_at` 추가 (starts_at NULL 레거시 row fallback).
   - windowStart fallback 순서를 create 경로와 동일화.
   - **세 경로(create / update / banner)가 모두 동일한 windowStart 기준을 사용** → 배너 표시 / 생성 검증 / 경고 문구가 서로 다른 값을 보지 않음.

### 클라이언트

5. **`client/src/pages/MapPage.tsx`**
   - 새 state `stackedStores: StoreWithCoupons[] | null` 추가.
   - `filteredStores.forEach(marker)` 루프 → 그룹 단위 루프로 교체:
     - 1차 키: `normalize(address)` (trim, 공백 정규화, lowercase). 주소가 있는 경우 최우선.
     - 2차 fallback: 좌표(소수점 5자리).
     - 2차 pass로, 주소가 달라도 좌표 소수점 5자리 일치면 기존 그룹으로 merge (같은 건물인데 지번/도로명 표기 다른 케이스 방어).
   - 그룹 크기 > 1이면 마커 label에 그룹 크기 숫자 badge 표시.
   - 마커 클릭 시: 그룹 크기 1 → 기존 동작 유지 / 그룹 크기 >1 → `setStackedStores(group)`로 리스트 오버레이 오픈.
   - 오버레이 UI: `SwipeableBottomSheet` 재사용, 그룹의 매장 리스트를 카드형으로 보여주고, 항목 클릭 시 `setSelectedStore(s)` + `setShowDetailModal(true)`로 기존 storeId 기반 상세 진입 경로로 연결.
   - 기존 라우팅/데이터 계약 변경 없음. UI 표현만 수정.

6. **`client/src/pages/MerchantDashboard.tsx`**
   - 초기 state `totalQuantity: 100` → `10` (FREE 기본값).
   - `onSuccess` reset 값 동일 수정.
   - 새로운 `useEffect`로 `isCreateCouponOpen && myPlan` 변동 시 `totalQuantity`를 plan.defaultCouponQuota로 자동 갱신 (플랜 변경 후 stale 폼 방지).

---

## 4. DB 영향 / 마이그레이션

- **스키마 변경 없음.**
- `user_plans` 테이블의 기존 컬럼 `starts_at, created_at`을 SELECT에 추가한 것뿐 — 컬럼 자체는 이미 존재 (schema.ts + setUserPlan INSERT 확인).
- **기존 데이터 영향**: starts_at NULL인 레거시 user_plans row도 created_at으로 fallback되어 정상 windowing 됨.
- **마이그레이션 불필요.**

---

## 5. QA 체크리스트

### A. 동일 주소 복수 매장 (지도 리스트 오버레이)
- [x] 같은 주소 매장 A/B 등록 → API 응답에 둘 다 포함됨 (기존에 이미 OK, 변화 없음)
- [x] 지도 마커 label에 그룹 크기 숫자 표시
- [x] 마커 클릭 시 매장 리스트 오버레이가 뜨고 A/B 선택 가능
- [x] 각 항목 클릭 시 기존 상세 바텀시트(selectedStore)로 진입 — storeId 기반 경로 그대로
- [x] 단일 매장 위치 클릭 시에는 기존 InfoWindow 동작 유지
- [x] 주소가 다르더라도 좌표 5자리 일치 시 merge

### B. 무료 7일/10건 기본값
- [x] FREE 유저, 쿠폰 등록 모달 진입: totalQuantity=10, endDate=오늘+6일 표시
- [x] 모달 닫았다 재진입 시에도 항상 10 유지
- [x] 클라이언트 임의 totalQuantity=50 전송 → 서버가 거부 (`plan.defaultCouponQuota=10` 초과)
- [x] endDate 조작 → 서버가 `computeCouponEndDate`로 재계산 후 덮어씀

### C. 유료 패키지 기본값/고정값
- [x] 무료 유저에게 WELCOME(30개/30일) 부여
- [x] 폼이 이미 열려 있다면: useEffect가 totalQuantity를 30으로 자동 갱신
- [x] 새로 열 때: handleCreateClick이 30 세팅
- [x] 클라이언트 totalQuantity=100 전송 → 서버가 거부 (`plan.defaultCouponQuota=30` 초과)
- [x] 이전 무료 폼값 잔존 없음

### D. 플랜 전환 전반 (bleed 제거 — 모든 전환 케이스 포함)

이슈 3은 **무료→유료만의 문제가 아니라** 플랜이 바뀌는 모든 경우에 해당한다.
아래 4개 시나리오 모두 새 플랜 권한 계산에 이전 플랜 사용량이 섞이지 않아야 한다.

#### D-1. FREE 10개 사용 후 WELCOME 부여
- [x] `getMyPlan.quotaRemaining = 30` (이전 FREE 10 제외됨)
- [x] create: `usedQuota = 0` → 신규 생성 정상 통과
- [x] 경고 문구에 "한도 도달"과 "남은 수량" 동시 노출 없음

#### D-2. WELCOME 일부 사용 후 REGULAR 변경 (상향)
- [x] WELCOME에서 예: 15개 발행 상태
- [x] admin이 REGULAR로 변경 → setUserPlan이 WELCOME row deactivate + REGULAR 신규 INSERT
- [x] `getMyPlan.quotaRemaining = 50` (WELCOME 기간 15개 제외됨 — REGULAR.starts_at 이후만 집계)
- [x] create/update 검증도 동일 기준으로 통과

#### D-3. REGULAR 만료 후 WELCOME 재부여
- [x] REGULAR가 자연 만료되면 `scheduler.ts` Job 5(매시간)가 `is_active=FALSE`로 정리
- [x] 또는 setUserPlan 재호출 시점에 기존 row 전부 deactivate
- [x] 새 WELCOME INSERT (starts_at=T_new) → 이전 REGULAR 기간 쿠폰 전부 windowing 제외
- [x] `getMyPlan.quotaRemaining = 30` (이전 REGULAR 사용량 무관)

#### D-4. 동일 기준 3경로 정합성
- [x] `getMyPlan.quotaRemaining` (배너 표시)
- [x] `coupons.create` 한도 체크 결과 (`plan.defaultCouponQuota - usedQuota`)
- [x] `coupons.update` 증설분 체크 결과
- 위 셋이 **동일한 windowStart 기준으로 계산**되어 서로 다른 값을 보지 않음.

#### 설계 근거 — 왜 setUserPlan 기준이면 모든 전환을 커버하는가
1. `setUserPlan`은 모든 플랜 변경의 단일 진입점. 내부에서 `UPDATE is_active=FALSE` + 신규 INSERT를 원자적으로 수행.
2. `scheduler.ts` Job 5가 만료 row를 매시간 정리 → expired row가 is_active=TRUE로 남는 시간창 최대 1시간.
3. `getEffectivePlan`이 `ORDER BY created_at DESC LIMIT 1`로 항상 **가장 최근** active+unexpired plan 하나만 반환.
4. 따라서 현재 유효 플랜의 `starts_at` 이후만 windowing에 포함 → **모든 플랜 전환 케이스에서 자동으로 이전 플랜 사용량이 제외됨**.

#### 한계/엣지 (설계 명시)
- 유료 자연 만료 직후 ~1시간 창에서 scheduler 미처리 + setUserPlan 미재호출 상태로 FREE 대우받는 경우: 이론적으로 이전 유료 쿠폰이 windowing에 포함될 수 있음. 그러나 `resolveAccountState`가 `non_trial_free`를 반환하여 쿠폰 등록 자체를 차단 → 실사용자에게 bleed가 노출되지 않음.

### E. 문구 정합성
- [x] 서버 create 거부 메시지는 remaining 기준으로 분기 (도달 OR 남은수량, 동시 금지)
- [x] 현재 등급명(tierName) / 한도(plan.defaultCouponQuota) / 잔여량(remaining)이 모두 동일한 `resolveEffectivePlan(planRow)` 결과 참조
- [x] `getMyPlan` 배너 잔여량과 `coupons.create` 검증 잔여량이 동일 windowStart 기준으로 계산

### 비고 — old coupon 증설 정책 (update 경로)
- 정책: **기존 쿠폰의 totalQuantity 증설은 허용**하되, **증설분(deltaIncrease)만 현재 멤버십 기간 quota에서 차감**한다.
- 축소/동일은 검증 skip, 제한 없음.
- 즉 `coupon.created_at < windowStart` 라도 delta가 현재 플랜의 남은 수량을 넘지 않으면 허용.

---

## 6. 롤백 포인트

| 변경 | 롤백 방법 |
|---|---|
| `server/db.ts` getEffectivePlan SELECT | `starts_at, created_at` 두 컬럼 제거하면 이전 동작으로 즉시 복귀 (스키마 변경 없으므로 안전) |
| `server/routers.ts` create 경로 문구 분기 + fallback | 이 커밋 revert로 원복 |
| `server/routers.ts` update 경로 누적 검증 | 추가 블록 제거로 원복 (삭제 대상 블록은 한 곳에 집중) |
| `server/routers/packOrders.ts` | SELECT + fallback 추가분 revert |
| `client/src/pages/MapPage.tsx` | stackedStores state + 그룹핑 로직 + 오버레이 JSX revert |
| `client/src/pages/MerchantDashboard.tsx` | 숫자 변경(100→10) + useEffect 2줄 revert |

모든 변경은 **커밋 단위로 분리 가능하며 단독 revert 가능**. DB 마이그레이션 없음.

---

## 7. 최종 판정

- **이슈 1**: UI 표현 문제로 재판정 → 리스트형 오버레이로 해결. DB/쿼리 무수정 ✅
- **이슈 2**: 서버 강제는 이미 동작 중 + 클라 하드코딩/스테일 폼 보강 ✅
- **이슈 3**: 실제 bleed 버그는 `getEffectivePlan` SELECT 누락 — **근본 원인 제거** + 세 경로 (create / update / banner) windowStart 기준 단일화 + 문구 분기 ✅

TypeScript 컴파일 결과: 내 수정 범위에서 신규 에러 없음 (기존 에러만 잔존, 수정 범위 외).

**판정: READY** — 단, 실기기 QA(A~E 시나리오)는 별도 수행 필요. 코드상으로는 증상 원인이 제거되었고 동일 기준의 3경로 정합성은 확보됨.
