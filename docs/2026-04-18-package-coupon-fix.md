# 2026-04-18 — 패키지 고정 쿠폰 정책 정비

## 1. 문제 정의

### 증상
- 구독팩(손님마중/단골손님/북적북적)을 신청한 merchant가 쿠폰 등록 시 **발행 수량·시작일·종료일을 임의로 수정**할 수 있었다.
- UI에서는 기본값이 채워지지만 개발자도구/프록시/직접 API 호출로 임의 값을 보내면 서버가 그대로 저장했다.
- quota 차감이 **create 시점**에서 이루어졌고, `coupons` 테이블의 상태 필터(`is_active`, `approved_at`, `approved_by`)가 없어 다음 왜곡이 발생:
  - pending 쿠폰도 quota를 차지
  - rejected / soft-deleted 쿠폰도 quota에서 빠지지 않음
  - 멤버십 경계(갱신) 시점 "공짜 승인 창구" 발생 가능(이전 기간 pending → 신규 기간 approve)
- 프론트 에러/안내 문구가 "이번 멤버십 남은 수량 N개", "다음 멤버십 기간부터 가능", "추가 수량 증설" 등 **복수 문구가 혼재**해 일관성 없음.

### 핵심 원인
1. `coupons.create` 경로가 `input.totalQuantity` / `input.startDate` / `input.endDate`를 **검증만 하고 override 없이 저장**.
2. `coupons.update` 경로도 동일하게 비관리자 요청 필드를 그대로 반영.
3. quota 집계 SQL이 **`created_at ≥ windowStart`** 한 줄만 걸려 있고 승인 상태 무시.
4. UI 경고 문구가 분산 하드코딩되어 정책 변경과 동시에 정리되지 않음.

---

## 2. 최종 정책 (2026-04-18부)

### 2.1 패키지별 고정값 (비관리자 기준)

| 패키지 | 기간 | 수량 |
|---|---|---|
| 손님마중 (WELCOME) | 30일 | 30개 |
| 단골손님 (REGULAR) | 30일 | 50개 |
| 북적북적 (BUSY)    | 30일 | 90개 |
| 체험 (FREE)        | 7일  | 10개 |

### 2.2 업주(비관리자) 편집 가능/불가 필드

| 필드 | 쿠폰 등록 | 쿠폰 수정 |
|---|---|---|
| 제목 / 설명 / 할인 유형·값 / 최소구매 / 최대할인 / 일 소비수량 | ✅ 편집 | ✅ 편집 |
| **발행 수량** | ❌ 서버 강제 (plan quota) | ❌ 서버가 무시 |
| **시작일**    | ❌ 서버 강제 (오늘)        | ❌ 서버가 무시 |
| **종료일**    | ❌ 서버 재계산 (startDate+기간) | ❌ 서버가 무시 |

어드민은 기존대로 자유 편집.

### 2.3 quota 소비 시점 — **승인(approve)만 소비**

- `coupons.create` / `coupons.update`: quota 검증 없음. pending 저장만.
- `coupons.approveCoupon`(admin): **유일한 quota 소비 지점**.
  - 집계 축: `approved_at ≥ windowStart`
  - 상태 필터: `is_active = TRUE AND approved_at IS NOT NULL AND approved_by IS NOT NULL`
  - 초과 시 승인 거절, 아래 **단일 문구**만 사용:
    ```
    현재 등급({tierName}) 누적 쿠폰 한도({quota}개)에 도달했습니다.
    ```

### 2.4 승인 차단 가드
- (G1) 이미 `approved_at` 존재 → idempotent no-op
- (G2) `is_active = false` (reject / soft-delete) → 승인 불가
- (G3) **활성 패키지가 없거나 `defaultCouponQuota ≤ 0`** → 승인 불가
  ```
  현재 활성 패키지가 없어 쿠폰을 승인할 수 없습니다.
  ```

### 2.5 동시성 보호
- `dbConn.transaction` 블록으로 집계·update 묶음
- `pg_advisory_xact_lock(owner_id)` — 같은 merchant의 승인 직렬화
- 대상 쿠폰 `SELECT … FOR UPDATE` — stale read / 더블클릭 방어

### 2.6 예외
- 활성 패키지 없는 상태에서 쿠폰 등록 시도 → 차단. 메시지:
  ```
  현재 부여된 패키지가 없어 쿠폰을 등록할 수 없습니다. 관리자에게 문의하세요.
  ```
- 무료 체험 종료 계정은 기존 문구 유지(`무료 체험이 종료되었습니다. 유료 구독팩을 신청해 주세요.`).

---

## 3. 수정한 파일 목록

| 파일 | 변경 요약 |
|---|---|
| `server/routers.ts` | `coupons.create` 서버 강제 override + 선차감 제거 / `coupons.update` 비관리자 수량·기간 drop / `admin.approveCoupon` 트랜잭션·advisory lock·approved 기준 집계·가드 |
| `server/routers/packOrders.ts` | `getMyPlan` usedQuota SQL 필터를 approved 기준으로 통일 |
| `client/src/pages/MerchantDashboard.tsx` | 쿠폰 등록 모달 paid 분기 배너 단일 문구화 / create 모달 `startDate` readonly / edit 모달 `totalQuantity`·`startDate`·`endDate` readonly + 안내문 |

`client/src/hooks/useAuth.ts`, `client/src/pages/AuthFinalize.tsx`, `.claude/settings.local.json` 는 건드리지 않음.

---

## 4. 서버 변경 세부 — 무엇이 바뀌었나

### 4.1 `coupons.create` (server/routers.ts)

**Before**
- `input.totalQuantity > plan.defaultCouponQuota` 검증 → 초과 시 거절
- 누적 quota SQL 실행(`SELECT SUM(total_quantity) … created_at >= windowStart`) 후 `usedQuota + input.totalQuantity > quota`면 거절
- 거절 문구: "이번 멤버십 기간 남은 수량 N개 …", "추가 등록은 다음 멤버십 기간부터 가능합니다" 등 복수
- `couponData`에 `input.totalQuantity` / `input.startDate` 그대로 저장, endDate만 서버 계산

**After**
- 누적 quota 선차감/검증/문구 **전부 제거**
- 비관리자 가드 유지: `accountState === 'non_trial_free'` 차단 / `plan.defaultCouponQuota <= 0` → "현재 부여된 패키지가 없어 쿠폰을 등록할 수 없습니다."
- 비관리자는 `enforcedTotalQuantity = plan.defaultCouponQuota`, `enforcedStartDate = new Date()` 로 **강제 override**
- `serverEndDate = computeCouponEndDate(enforcedStartDate, plan)` (기존 로직 유지, admin만 `input.endDate` 우회 가능)
- `couponData.{totalQuantity, startDate, endDate, remainingQuantity}`를 강제값으로 저장
- audit log / 승인 대기 이메일의 `totalQuantity` 필드도 enforced 값으로 교체

### 4.2 `coupons.update` (server/routers.ts)

**Before**
- 비관리자가 보낸 `totalQuantity`를 plan quota와 비교 검증
- 증가분(delta)에 대해 누적 quota SQL 재실행, 초과 시 거절 + "남은 수량 …" / "다음 멤버십 …" 문구
- `endDate`도 admin만 직접 허용, 비관리자는 startDate 기반 재계산
- `updateData = { ...data }`에 totalQuantity/startDate/endDate 포함 가능

**After**
- **어드민 bypass**: 첫 분기에서 `data` 그대로 `updateCoupon` → return. 과거 로직과 동일.
- **비관리자 경로**: 계정 상태 가드(non_trial_free 차단)만 수행 후
  ```ts
  const updateData: any = { ...data };
  delete updateData.totalQuantity;
  delete updateData.startDate;
  delete updateData.endDate;
  ```
  → 수량·기간 필드는 **서버에서 무조건 drop**. 입력 스키마는 유지(하위 호환)하되 반영되지 않음.
- 누적 quota 검증·문구 전부 제거.
- 편집 가능 필드: `title/description/discountType/discountValue/minPurchase/maxDiscount/dailyLimit`
  - 스키마에 `dailyLimit: z.number().optional()` 추가(기존 누락되어 있던 것을 이번에 포함).

### 4.3 `admin.approveCoupon` (server/routers.ts)

**Before**
- `db.updateCoupon(id, { approvedBy, approvedAt })` 단순 UPDATE
- 한도 검증 없음, 동시성 보호 없음, 가드 없음

**After**
- `dbConn.transaction` 블록 내 실행
- 1) 대상 쿠폰 + `owner_id` JOIN 조회
- 2) `pg_advisory_xact_lock(ownerId)` — 같은 owner 승인 직렬화
- 3) `SELECT id, total_quantity, is_active, approved_at FROM coupons WHERE id = ? FOR UPDATE`
- 가드:
  - **(G1)** `row.approved_at` 존재 → idempotent no-op, 조용히 성공 반환
  - **(G2)** `!row.is_active` → `BAD_REQUEST: 비활성 쿠폰은 승인할 수 없습니다.`
  - **(G3)** `!planRow || plan.defaultCouponQuota <= 0` → `FORBIDDEN: 현재 활성 패키지가 없어 쿠폰을 승인할 수 없습니다.`
- 한도 체크:
  ```sql
  SELECT COALESCE(SUM(total_quantity), 0)
  FROM coupons
  WHERE store_id IN (SELECT id FROM stores WHERE owner_id = ? AND deleted_at IS NULL)
    AND is_active = TRUE
    AND approved_at IS NOT NULL
    AND approved_by IS NOT NULL
    AND approved_at >= ${windowStart}
  ```
  `usedQuota + row.total_quantity > plan.defaultCouponQuota` 이면 거절 + 단일 문구:
  ```
  현재 등급({tierName}) 누적 쿠폰 한도({quota}개)에 도달했습니다.
  ```
- UPDATE: 같은 tx 내 `SET approved_by, approved_at=NOW(), updated_at=NOW()`
- audit log는 tx 외부 (실패가 승인 성공에 영향 없음)
- 반환값: `{ success: true }` (기존 호환)

### 4.4 `packOrders.getMyPlan` (server/routers/packOrders.ts)

**Before**
```sql
SELECT COALESCE(SUM(total_quantity), 0) AS used_quota
FROM coupons
WHERE store_id IN (SELECT id FROM stores WHERE owner_id = ? AND deleted_at IS NULL)
  AND created_at >= ${windowStart}
```

**After**
```sql
SELECT COALESCE(SUM(total_quantity), 0) AS used_quota
FROM coupons
WHERE store_id IN (SELECT id FROM stores WHERE owner_id = ? AND deleted_at IS NULL)
  AND is_active = TRUE
  AND approved_at IS NOT NULL
  AND approved_by IS NOT NULL
  AND approved_at >= ${windowStart}
```

→ 배너의 `quotaRemaining`이 **`approveCoupon` 한도 체크와 완전 동일 기준**. UI와 서버 거절 조건이 정렬됨.

---

## 5. 프론트 변경 세부 — 무엇을 잠갔나 (A/B/C)

모두 `client/src/pages/MerchantDashboard.tsx` 단일 파일.
**변경 범위: readonly / 안내문 / 시각적 고정. 비즈니스 규칙·form payload·서버 호출 조건 불변.**

### 5.1 Patch A — 상단 배너 단일 문구화 (line 926–954)
- 쿠폰 등록 모달 paid 분기 배너를 IIFE 내부 조건 분기로 교체.
- `quotaRemaining <= 0`:
  - 붉은 배너(`bg-red-50`) + 유일 허용 문구:
    `현재 등급({tierName}) 누적 쿠폰 한도({quotaTotal}개)에 도달했습니다.`
- `quotaRemaining > 0`: 기존 녹색 배너 유지.
- `quotaRemaining`은 ② getMyPlan이 approved 기준으로 내려주는 값. UI↔서버 동일 기준.

### 5.2 Patch B — create 모달 `startDate` readonly (line 1052–1078)
- 비관리자: `readOnly={true}` + 회색 배경.
- onChange 상단 방어 가드 `if (!myPlan?.isAdmin) return;` — 어드민 경로만 기존 로직(`setFormData` + `computeDisplayEndDate`) 수행.
- 비관리자 안내문: `시작일은 등록일(오늘)로 고정됩니다.`
- `totalQuantity`·`endDate`의 readonly는 사전 상태로 이미 적용되어 있었음.

### 5.3 Patch C — edit 모달 readonly + 안내문 (line 1204–1272)
- 비관리자에게만 노출되는 **오렌지 안내 배너**(신규):
  `발행 수량 · 시작일 · 종료일은 패키지 기본값으로 고정되어 수정할 수 없습니다. 나머지(제목/설명/할인/일 소비수량)만 수정 가능합니다.`
- `edit-totalQuantity` / `edit-startDate` / `edit-endDate`:
  - `readOnly={!myPlan?.isAdmin}`
  - 회색 배경 class
  - onChange 상단 `if (!myPlan?.isAdmin) return;` 가드
- `edit-dailyLimit`은 정책상 편집 허용 → 변경 없음.
- 어드민은 기존 자유 편집 유지.

---

## 6. Patch D (내 쿠폰 카드 표시 정합성) — 왜 보류했나

### D의 원래 의도
쿠폰 카드 남은 수량 Badge `{remainingQuantity}/{totalQuantity}`를 **패키지 총량 - 실제 사용량** 기준으로 보정. 레거시 쿠폰(과거 업주 입력값)이 저장된 경우에도 현재 패키지 기준으로 일관 표시.

### 보류 근거
1. **현재 플랜으로 과거 쿠폰을 재해석하면 왜곡 위험**: merchant가 패키지를 변경(손님마중→단골손님 등)한 뒤에도 과거에 발급된 쿠폰 카드가 `myPlan.defaultCouponQuota` 기준으로 표시되어, 발급 시점 실제 수량과 달라 보일 수 있다.
2. **`coupon.totalQuantity` / `coupon.remainingQuantity`가 서버에 저장된 단일 진실**: 신규 쿠폰은 ① 반영본으로 plan 기준 저장이 강제되므로 "카드 표시 == 저장값"이 자연히 일관됨. 레거시 보정은 추가 가치 대비 혼란 위험이 더 큼.
3. **실질 필요성 미입증**: 현재 사용자가 "왜곡된 표시"를 실제로 보고 있다는 케이스/스크린샷이 확보되지 않았다. 근거 없이 표시 로직을 바꾸면 source-of-truth를 UI가 덮어쓰는 역전 구조가 생김.

### 재착수 조건
- 실제 왜곡 사례(legacy coupon의 저장값과 정책 기대값 괴리) 재현 케이스가 확보될 때.
- 그때는 "발급 시점 plan snapshot" 같은 per-coupon 레퍼런스를 신설할지, 단순 표시 보정만 할지 설계부터 재논의.

---

## 7. QA 체크리스트 (실행 순서)

**환경 가정**: local dev 또는 staging. 테스트 계정 3종 준비 필요.

### 계정 준비
- `ADMIN`: role=admin
- `PAID_MERCHANT_A`: role=merchant, 현재 active plan = WELCOME(30일/30개), isFranchise=false
- `PAID_MERCHANT_B`: role=merchant, 현재 active plan = BUSY(30일/90개)
- `TRIAL_MERCHANT`: role=merchant, trial_ends_at = now+7d (trial_free)
- `NO_PLAN_MERCHANT`: role=merchant, trial_ends_at = null + plan row 없음 (non_trial_free)

### 단계별 체크리스트

#### Step 1 — create UI 잠금 확인 (PAID_MERCHANT_A 로그인)
- [ ] 쿠폰 등록 모달 open
- [ ] 상단 배너 표시: `현재 등급: 손님마중 — 기간 30일 / 수량 30개 (만료: …)`
- [ ] 발행 수량 인풋 readonly (회색 배경, 편집 불가), 값 = 30
- [ ] 시작일 인풋 readonly, 값 = 오늘
- [ ] 종료일 인풋 readonly, 값 = 오늘+29일
- [ ] 시작일 아래 안내문 노출: `시작일은 등록일(오늘)로 고정됩니다.`
- [ ] 종료일 아래 기존 안내문 노출

#### Step 2 — create 서버 강제 override 확인 (DevTools 우회)
- [ ] PAID_MERCHANT_A 로 쿠폰 등록 모달 open
- [ ] DevTools Console에서 tRPC mutation payload를 수동 조작해 `totalQuantity: 999`, `startDate: 1년 뒤`, `endDate: 1년 뒤+60일` 강제 전송
- [ ] 서버 응답 성공. DB에서 새 쿠폰 확인 시 `total_quantity=30`, `start_date=오늘`, `end_date=오늘+29일`로 저장됨
- [ ] audit log에도 `totalQuantity: 30`으로 기록됨

#### Step 3 — create 후 approveCoupon 전까지 quota 미소비 확인
- [ ] Step 2에서 만든 pending 쿠폰 상태로 유지
- [ ] 같은 merchant의 "쿠폰 등록" 모달 재오픈 시 상단 배너 **녹색 유지** (`quotaRemaining = 30`, approved 없음)
- [ ] 같은 merchant로 두 번째 쿠폰 등록 시도 → **성공** (create는 quota를 안 봄)

#### Step 4 — admin approveCoupon 정상 경로
- [ ] ADMIN 로그인 → 관리자 페이지에서 Step 2의 pending 쿠폰 승인
- [ ] 응답 `{ success: true }`
- [ ] DB: `approved_by = admin.id`, `approved_at = NOW()` 기록
- [ ] PAID_MERCHANT_A의 `/getMyPlan` 재호출 → `quotaRemaining = 0` 으로 감소
- [ ] 쿠폰 등록 모달 배너가 붉은색으로 전환 + 문구:
  `현재 등급(손님마중) 누적 쿠폰 한도(30개)에 도달했습니다.`

#### Step 5 — approveCoupon 한도 초과 차단
- [ ] Step 3에서 만든 두 번째 pending 쿠폰을 ADMIN이 승인 시도
- [ ] 에러 응답, 메시지:
  `현재 등급(손님마중) 누적 쿠폰 한도(30개)에 도달했습니다.`
- [ ] DB: 해당 쿠폰 `approved_at` 여전히 NULL (rollback 확인)

#### Step 6 — 더블클릭 idempotent
- [ ] Step 4로 승인된 쿠폰을 ADMIN이 다시 "승인" 클릭
- [ ] 응답 성공(no-op), DB 상태 무변화 (`approved_at` 기존 값 유지)
- [ ] audit log `payload.alreadyApproved = true`

#### Step 7 — 동시 승인(advisory lock)
- [ ] PAID_MERCHANT_B(BUSY 90개) 에 90개짜리 pending 2건 준비
- [ ] ADMIN이 두 쿠폰을 동시 승인(두 탭에서 동시 클릭) — 요청 2개 동시 전송
- [ ] 정확히 **1건만 성공**, 나머지 1건은 `누적 쿠폰 한도(90개)` 에러

#### Step 8 — rejected 쿠폰 승인 차단 (G2)
- [ ] ADMIN이 쿠폰 reject → `is_active=false`
- [ ] 같은 쿠폰 다시 승인 시도 → `비활성 쿠폰은 승인할 수 없습니다.`

#### Step 9 — 활성 패키지 부재 시 승인 차단 (G3)
- [ ] NO_PLAN_MERCHANT로 쿠폰 등록 시도 → `현재 부여된 패키지가 없어 쿠폰을 등록할 수 없습니다. …` 로 차단 (create 단계)
- [ ] 어떤 경로로든 NO_PLAN_MERCHANT 소유의 pending 쿠폰이 DB에 존재하도록 수동 주입 후 ADMIN 승인 시도
- [ ] `현재 활성 패키지가 없어 쿠폰을 승인할 수 없습니다.` 응답 + DB `approved_at` NULL 유지

#### Step 10 — update UI 잠금 (PAID_MERCHANT_A)
- [ ] 기존 쿠폰 편집 모달 open
- [ ] 오렌지 안내 배너 노출
- [ ] 발행 수량 / 시작일 / 종료일 readonly (회색 배경, 편집 불가)
- [ ] 일 소비수량은 편집 가능
- [ ] 제목·설명·할인 유형·할인 값·최소/최대 금액 편집 가능

#### Step 11 — update 서버 drop 확인
- [ ] 비관리자로 편집 모달에서 DevTools로 payload 조작 — `totalQuantity: 999`, `startDate`/`endDate` 임의 변경
- [ ] 응답 성공이지만 DB 상 수량·기간 필드 **변화 없음**. 다른 필드(제목 등)는 반영됨

#### Step 12 — 어드민은 자유 편집
- [ ] ADMIN이 admin 경로로 쿠폰 편집 → 수량/기간 자유 변경 성공
- [ ] create 모달도 admin 계정일 때 readonly/가드 해제 확인

#### Step 13 — getMyPlan 배너 숫자 정합성
- [ ] PAID_MERCHANT_A 상태: approved 쿠폰 1건 × 30개 (WELCOME)
- [ ] 배너 `quotaRemaining = 0`, 붉은 문구 노출
- [ ] 같은 쿠폰을 reject → `is_active=false` → 배너 `quotaRemaining = 30`으로 복구
- [ ] reject된 쿠폰이 다시 pending으로 들어와도 배너 숫자 변화 없음(approved만 집계)

#### Step 14 — 문구 잔존 검색
- [ ] 프론트/서버 코드 grep:
  - `남은 수량`, `다음 멤버십`, `추가 등록은`, `추가 수량 증설`, `쿠폰 발급 한도` — **사용자용 에러/경고 경로에서 0 매치**
  - `쿠폰 카드 재고 표시(정상 UI)`의 "남은 수량 N개"는 제외 가능
- [ ] 유일 허용 문구 노출 여부: `현재 등급({tierName}) 누적 쿠폰 한도({quota}개)에 도달했습니다.` 단일성

---

## 8. 남은 리스크

### 8.1 레거시 pending 쿠폰
- 이번 변경 이전에 `totalQuantity`가 패키지 기본값보다 크게 저장된 pending이 DB에 남아 있을 수 있음.
- 승인 시도 시 현재 코드는 `row.total_quantity` 그대로 집계 → 경우에 따라 `누적 한도 도달` 거절이 발생할 수 있음.
- **운영 대응**: 해당 pending을 reject 또는 admin이 `updateCoupon`으로 수량을 plan 기본값으로 수동 보정 후 재승인.

### 8.2 멤버십 갱신 경계
- 플랜 갱신으로 `starts_at` 갱신된 경우, 집계 windowStart가 밀리며 이전 기간 approved는 집계에서 제외됨(의도대로).
- 단, `starts_at`이 NULL인 레거시 plan row는 `created_at` fallback을 사용하므로 운영팀이 marginal 케이스에서 값 확인 필요.

### 8.3 advisory lock의 범위
- `pg_advisory_xact_lock(ownerId)`는 tx 종료까지 owner 단위 직렬화. 극단적으로 많은 merchant를 동시 승인하는 admin 운영을 상정하지는 않음.
- 장시간 lock 점유가 관찰되면 `pg_stat_activity`의 `wait_event = 'advisory'` 모니터링 필요.

### 8.4 admin 자신이 create 하는 쿠폰
- `coupons.create` admin 경로는 즉시 승인되며 plan 검증을 bypass.
- 해당 쿠폰은 `approveCoupon`을 타지 않으므로 G3(활성 패키지 부재 차단)이 적용되지 않음.
- admin이 수동으로 쿠폰을 만든 경우의 quota 집계는 `getMyPlan`에서 approved 상태로 합산되어 정상 반영.

### 8.5 Patch D(카드 표시 정합성) 미적용
- 레거시 `coupons.total_quantity`가 패키지 기본값과 다른 쿠폰의 카드 남은 수량 Badge는 **저장값 그대로** 노출됨.
- 현재로서는 이것이 오히려 안전한 선택(재해석 없음). 재착수 시 per-coupon plan snapshot 설계 필요.

### 8.6 기타
- 이번 변경은 DB 스키마 변경/마이그레이션 없음. 배포/롤백 모두 코드만.
- TypeScript 전역 타입 에러 169건은 **사전부터 존재하던 무관 에러**이며 이번 변경으로 증가하지 않음(영향 파일 필터 0건 확인).

---

## 9. 변경 이력

- 2026-04-18 정책 반영:
  1. `server/routers.ts` — `coupons.create` override + `coupons.update` drop
  2. `server/routers.ts` — `admin.approveCoupon` tx + advisory lock + G1/G2/G3
  3. `server/routers/packOrders.ts` — `getMyPlan` approved 기준 집계
  4. `client/src/pages/MerchantDashboard.tsx` Patch A — 배너 단일 문구
  5. `client/src/pages/MerchantDashboard.tsx` Patch B — create startDate lock
  6. `client/src/pages/MerchantDashboard.tsx` Patch C — edit 수량/기간 lock + 안내
- 보류: Patch D (카드 표시 정합성) — 근거 확보 시 재착수
