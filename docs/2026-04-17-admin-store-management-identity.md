# 2026-04-17 슈퍼어드민 가게관리 식별성 개선 (Surgical Fix)

## 작업 성격

- **범위**: admin read-path 보강 only
- **비목표**: DB 스키마 재설계, 라우팅 재구성, 권한 정책 변경
- **원칙**: 기존 endpoint/contract/응답 그대로 유지하고 **additive 필드만 추가**

기존 "대시보드 발주요청(신규 이벤트/요청) 리스트"에 적용됐던 LATERAL JOIN 식별정보 패턴을
**가게관리 탭 전반**으로 동일하게 확장한다.

---

## 변경 파일

| 파일 | 변경 내용 |
|---|---|
| `server/db.ts` | `getAllStoresForAdmin` read-path 보강 (LATERAL JOIN), `getAllCouponsForAdmin`에 store/owner 조인 필드 additive 추가 |
| `client/src/pages/AdminDashboard.tsx` | 식별 보조 헬퍼 3개(`resolveStoreThumbnail`, `StoreOwnerIdentity`, `StoreCouponStatus`, `StoreLatestPackOrder`) 추가 + 가게관리 탭 4개 섹션과 overview "최근 승인된 가게" 렌더 확장 |

**추가/삭제 파일 없음.** 라우팅 파일(`server/routers.ts`, `App.tsx`) 변경 없음.
DB 마이그레이션 없음.

---

## 서버 응답 필드 — 기존 vs 추가

### `admin.listStores` (→ `db.getAllStoresForAdmin`)

**기존 필드 (그대로 유지)**: stores 테이블 모든 컬럼
(`id`, `ownerId`, `name`, `category`, `address`, `phone`, `description`, `imageUrl`,
`naverPlaceUrl`, `latitude`, `longitude`, `district`, `rating`, `ratingCount`,
`adminComment`, `adminCommentAuthor`, `isActive`, `approvedBy`, `approvedAt`,
`status`, `rejectionReason`, `deletedAt`, `deletedBy`, `createdAt`, `updatedAt`)

**추가 필드 (additive, LATERAL/subquery로 계산)**:

| 필드 | 의미 | 출처 |
|---|---|---|
| `ownerEmail` | 계정 이메일 | `users.email` LEFT JOIN |
| `ownerName` | 계정 이름/점주명 | `users.name` |
| `ownerIsFranchise` | 프랜차이즈 여부 | `users.is_franchise` |
| `ownerTier` | 활성 플랜 tier — **만료(`expires_at < NOW()`)는 `FREE`로 정규화**. 기 확립 패턴(commit 3e28772 `listUsersForPlan`)과 동일 | `user_plans` LATERAL + `CASE WHEN` |
| `ownerPlanExpiresAt` | 플랜 만료일 (raw) | `user_plans.expires_at` |
| `ownerPlanIsActive` | **raw `user_plans.is_active` 그대로** (contract 의미 보존) | `user_plans.is_active` |
| `ownerPlanIsEffectivelyActive` *(neu)* | **derived — `is_active=TRUE AND (expires_at IS NULL OR expires_at > NOW())`**. UI 표시용 판정에만 사용 | `CASE WHEN` |
| `ownerStoreCount` | 동일 계정의 활성 매장 수 | `stores` subquery |
| `activeCouponCount` | 활성 승인 쿠폰 수 | `coupons` subquery |
| `pendingCouponCount` | 승인 대기 쿠폰 수 | `coupons` subquery |
| `expiredCouponCount` | 만료/소진 쿠폰 수 | `coupons` subquery |
| `latestPackOrderStatus` | 최근 발주요청 상태 | `pack_order_requests` LATERAL (최신 1건) |
| `latestPackOrderPack` | 최근 발주요청 팩 코드 | `pack_order_requests.requested_pack` |
| `latestPackOrderAt` | 최근 발주요청 시각 | `pack_order_requests.created_at` |

LATERAL 패턴은 이미 운영 중인 `server/routers/packOrders.ts`의 `listPackOrders`,
`listUsersForPlan`과 동일. `is_active = TRUE AND ORDER BY created_at DESC LIMIT 1`로
"유저당 1건" 보장하여 중복 행 없음 (Issue 3의 LATERAL stabilization 정책 재사용).

**raw vs derived 구분 원칙**:

| 구분 | 필드 | 의미 |
|---|---|---|
| raw (contract 보존) | `ownerPlanIsActive` | `user_plans.is_active` 그대로 — 기존 의미 변경 없음 |
| raw (contract 보존) | `ownerPlanExpiresAt` | `user_plans.expires_at` 그대로 |
| derived (additive) | `ownerTier` | 만료 시 `FREE`로 정규화. **주의**: 이건 이미 display용 의미 필드로 합의된 패턴 (commit 3e28772)이라 raw 교체가 아닌 "표시 tier"로 동작 |
| derived (additive) | `ownerPlanIsEffectivelyActive` | effective active 판정. UI 뱃지 분기에 사용 |

기존 필드 의미를 덮어쓰지 않고, 파생 판정은 별도 필드로 추가.

**`limit` 파라미터**: 기본값 `100` (기존 시그니처 그대로). 호출자(`server/routers.ts:3020`)가
`getAllStoresForAdmin(500)`로 override → 기존 동작과 동일.

### `admin.listCoupons` (→ `db.getAllCouponsForAdmin`)

**기존 필드 (그대로 유지)**: coupons 테이블 전체 컬럼 (`getTableColumns(coupons)` spread)

**추가 필드 (additive)**:

| 필드 | 의미 |
|---|---|
| `storeName` | 매장 이름 (`stores.name`) |
| `storeCategory` | 매장 카테고리 |
| `storeImageUrl` | 매장 대표 이미지 (JSON array or string) |
| `ownerEmail` | 매장주 이메일 |
| `ownerName` | 매장주 이름 |

**관련 버그 fix**: AdminDashboard의 쿠폰 검색 필터가 `(c as any).storeName`를 참조했으나
기존 쿼리가 이 필드를 반환하지 않아 **가게명 검색이 사실상 동작하지 않던 상태**.
이 보강으로 실제로 SQL/응답 레벨에서 `storeName`이 채워져 검색이 정상 동작.

**쿼리 방식**: Drizzle `select({ ...getTableColumns(coupons), ... }).leftJoin(stores).leftJoin(users)`.
raw SQL 전환 없음 — 기존 Drizzle 스타일 보존.

---

## 클라이언트 (AdminDashboard.tsx) 변경

### 추가된 읽기 전용 헬퍼 (함수 컴포넌트, 외부 파일 생성 없음)

| 이름 | 역할 |
|---|---|
| `resolveStoreThumbnail(raw)` | `imageUrl` 파싱 (JSON 배열 첫 번째 or 문자열 그대로). 기존 3곳에 중복돼있던 로직을 유틸화만 함. 동작 동일 |
| `<StoreOwnerIdentity store compact />` | 계정 이름/이메일 + tier 배지 + 프랜차이즈/다매장 배지 |
| `<StoreCouponStatus store compact />` | 활성/대기/만료 쿠폰 수 pill |
| `<StoreLatestPackOrder store />` | 최근 발주요청 상태 + 날짜 |
| 상수 `TIER_BADGE_STYLE`, `PACK_ORDER_STATUS_LABEL` | 표시용 스타일/라벨 (읽기 전용) |

### 식별 정보 적용된 섹션

| 섹션 | 기존 표시 | 추가 표시 |
|---|---|---|
| 대시보드 > **최근 승인된 가게** (overview) | 이름+카테고리 | 썸네일, 계정 이름/이메일, tier 배지 |
| 가게관리 > **승인 대기 중인 상점** | 이름+카테고리+주소+(이미지) | 계정 식별, tier, 쿠폰 현황, 최근 요청, 요청일 |
| 가게관리 > **거부된 가게** | 이름+주소+날짜 | 썸네일, 계정 식별, tier 배지, 거절 사유 요약 |
| 가게관리 > **승인된 가게 목록** | 이름+주소+승인 배지 | 썸네일, 계정 식별, tier, 쿠폰 현황, 최근 요청, 승인일 |
| 쿠폰관리 > 검색 필터 | (이전에는 storeName 미노출로 실질 동작 안 함) | 실제로 storeName 기준 필터링됨 |

### Fallback 규칙 (legacy 데이터 보호)

| 조건 | 표시 |
|---|---|
| `store.name` 없음 | `"가게정보 없음"` |
| `imageUrl` 없음/파싱 실패 | placeholder 아이콘 (`<Store />`) |
| `ownerName`도 `ownerEmail`도 없음 (계정-가게 매핑 깨진 legacy row) | `"미연결"` |
| 활성 plan 없음 (`ownerTier === null`) | `FREE` |
| `planIsActive=false` + tier가 `FREE` 아님 | `"<TIER> (만료)"` |
| `isFranchise=true` | 별도 `FRANCHISE` 배지 + tier는 `프랜차이즈`로 표시 |
| `ownerStoreCount > 1` | `매장 N` 배지 (다매장 주의 표시) |

---

## 운영 규칙 영향 없음 확인

| 항목 | 변경 여부 |
|---|---|
| 공개 지도/쿠폰 필터(`buildPublicCouponFilter`) | 무변경 |
| 가게 approve/reject 조건 | 무변경 |
| `createOrderRequest` storeId 자동 연결 정책(Issue 1-policy) | 무변경 |
| 1계정 1업장 제한 | 무변경 |
| 프랜차이즈 isUnlimited/다매장 허용 | 무변경 |
| 권한 재부여 시 LATERAL 판정(Issue 3) | 무변경 (이미 반영된 기존 정책 재사용) |
| DB 스키마 / 마이그레이션 | 없음 |
| API endpoint 이름/권한 게이트 | 무변경 |

이번 변경은 **오직 admin GET read-path에 파생 필드를 추가**하고 그 값을 UI에
표시만 함. 어떤 write/approval/정책 분기도 수정하지 않음.

---

## 성능 / 안전 가드

| 항목 | 상태 |
|---|---|
| N+1 쿼리 | 없음. 단일 쿼리에 LATERAL + subquery로 완결 |
| 파라미터 바인딩 | `sql` 태그드 템플릿만 사용 (raw string interpolation 없음) |
| `limit` | 기본 100 유지, 호출자가 500 override (기존 동작 동일) |
| 쿠폰 집계 서브쿼리 | store 수 × 3 subquery. 500개 기준 1500 scalar, 인덱스(`coupons.store_id`) 존재 → 문제 없음 |
| LATERAL 정렬 | `is_active=TRUE ORDER BY created_at DESC LIMIT 1` — 기존 패턴 그대로 |

---

## 검증 결과

### TypeScript

`server/db.ts` 및 `client/src/pages/AdminDashboard.tsx` 변경 후 `tsc --noEmit` 실행 →
이번 수정으로 **새로 발생한 에러 없음**. 기존에 존재하던 pre-existing 에러
(chart.js, sonner, implicit any 등)는 동일하게 남아있음 (다른 PR 범위).

### 섹션별 수동 검증 포인트

| 시나리오 | 기대 | 확인 방법 |
|---|---|---|
| 승인된 매장 + 유료 유저 | 썸네일 + 점주 이름/이메일 + tier 배지(WELCOME/REGULAR/BUSY) + 활성 쿠폰 개수 | 가게관리 탭 스크롤 |
| 프랜차이즈 계정의 매장 | `프랜차이즈` 배지 + `FRANCHISE` pill + `매장 N` 배지 | 같은 계정의 여러 매장이 모두 동일 표시 |
| 승인 대기 매장 | orange 섹션에서 점주 + 요청일 + 쿠폰 대기 수 | pending 섹션 |
| 거부된 매장 | 썸네일 + 점주 + 거절 사유(툴팁 포함) | 거부됨 섹션 펼쳐서 확인 |
| legacy: `image_url=NULL` | placeholder 아이콘 표시, 깨짐 없음 | DB에서 imageUrl NULL 매장 확인 |
| legacy: `owner_id`가 없는/삭제된 user | `"미연결"` + tier `FREE` + 정상 렌더 | `users.id = stores.owner_id` 매칭 실패 케이스 |
| 쿠폰관리 > 가게명으로 검색 | 실제 매칭됨 (기존 버그 해소) | 쿠폰 탭 상단 검색창에 가게명 입력 |

### 실제 DB 조회 결과 (Railway `ballast.proxy.rlwy.net`)

본 세션에서 운영 DB에 **직접 SQL을 실행**하여 쿼리 반환 shape과 법적 edge case를 확인.

**섹션별 카운트:**
```
pending_cnt      : 0
rejected_cnt     : 1
approved_cnt     : 9
total_active_rows: 10
```

**legacy 데이터 분포 (deleted_at IS NULL 기준):**
```
null_name_cnt    : 0    (모든 매장에 이름 존재)
null_image_cnt   : 8    (이미지 없는 매장 → placeholder 렌더)
orphan_owner_cnt : 1    (owner_id가 users 테이블에 없는 legacy row)
```

**샘플 3건 (실제 반환):**
- `id=67, name="프랜차이즈 2"` → `ownerIsFranchise=true, ownerStoreCount=2, ownerTier="FREE"`, 프랜차이즈 배지 + 매장 2 배지 정상 노출
- `id=66, name="삭제 후 재가입 테스트"` → `ownerTier=null, ownerPlanIsActive=null` → 클라 fallback으로 `FREE` 표시
- `id=65, name="휴면 > 가게등록 마지막테스트"` → `ownerEmail=null, ownerName=null` (**orphan row**) → UI에서 "미연결" 표시됨 (fallback 규칙 적용 확인)

### 쿠폰관리 가게명 검색 동작 검증

실제 SQL에서 `s.name ILIKE '%휴면%'`으로 검색 →
```
row count: 1
{id: 94, title: "휴면 > 가게등록 > 쿠폰테스트",
 storeName: "휴면 > 가게등록 마지막테스트",
 ownerEmail: null}
```

- 쿠폰 title과 storeName이 **서로 다른 문자열로 정확히 구분**되어 반환됨
- `ownerEmail`이 null인 orphan 매장도 검색 결과에 포함 (검색 자체는 정상 동작)
- **검색 버그 해소 확인**: 기존에는 `storeName` 필드가 응답에 없어 클라이언트 필터가 항상 false → 이제 정상적으로 가게명 일치 조회 가능

### UI 렌더 검증 수준 (본 세션 한계 명시)

| 검증 항목 | 방법 | 결과 |
|---|---|---|
| SQL 쿼리 실행 가능 여부 | Railway DB에 직접 쿼리 | ✅ 정상 |
| 반환 필드 shape | sample 3건 JSON 확인 | ✅ 모든 추가 필드 존재 |
| Legacy/orphan 케이스 존재 | COUNT 집계 | ✅ 실제로 존재함 (null_image=8, orphan=1) |
| 쿠폰 storeName join | ILIKE 검색 실행 | ✅ 매칭됨 |
| TypeScript 컴파일 (`tsc --noEmit`) | `server/db.ts` + `AdminDashboard.tsx` | ✅ 이번 수정으로 **새로 추가된 에러 없음** (기존 pre-existing 에러는 동일) |
| 클라이언트 번들 빌드 (`vite build`) | 전체 프로덕션 번들 | ✅ 정상 완료 (SW 버전 `v2026041706332`) |
| 실제 브라우저에서 어드민 로그인 후 4개 섹션 시각 확인 | 수동 | ❌ **본 세션 환경(권한/실기기 없음)에서 수행 불가** — 운영자 단계 검증 필요 |

실제 픽셀 단위 렌더 확인은 LAUNCH READY 원칙에 따라 **슈퍼어드민 계정
(`mycoupon.official@gmail.com`)으로 실기기 또는 브라우저에서 `/admin`
접속 후 가게관리 탭 4개 섹션과 쿠폰 탭 검색창**을 직접 확인해야 최종
판정 가능.

---

### 대량 데이터 한도

대량 매장(500건 이상) 환경의 쿼리 plan은 미계측. 인덱스(`stores.owner_id`, `coupons.store_id`, `user_plans.user_id`, `pack_order_requests.user_id`) 전제로 설계됨. 현재 운영 DB 기준 매장 총 10건이라 문제 없음.

---

## 기존 대비 동작 차이 명시

| 화면/동작 | 변경 전 | 변경 후 |
|---|---|---|
| 승인된 가게 카드 | 이름·주소만 | 이름·주소·**썸네일·점주·tier·쿠폰 현황·최근 요청** |
| 거부된 가게 row | 이름·주소·날짜 | 이름·주소·날짜·**썸네일·점주·tier·거절 사유** |
| 승인 대기 매장 | 이름·카테고리·(이미지)·주소·설명 | 동일 + **점주·tier·쿠폰 현황·최근 요청·요청일** |
| Overview "최근 승인된 가게" | 이름·카테고리 | 이름·카테고리·**썸네일·점주·tier** |
| 쿠폰 검색 필터 (가게명) | 응답에 storeName 없어 실질 동작 안 함 | **정상 매칭** (storeName이 서버에서 채워짐) |
| 기타 운영 규칙 | — | **무변경** |

---

## 후속 (이 턴 범위 아님)

- `AdminDashboard.tsx`의 pre-existing implicit-any/chart.js 타입 에러는 별도 PR 범위.
- 식별 정보를 search 필터에 더 활용(예: `ownerName`, tier 필터)하는 UX 개선은 후속 작업으로 분리 권장.
- 공통 `StoreOwnerIdentity`/`StoreCouponStatus`를 `components/` 하위 정식 컴포넌트로 승격할지 여부는
  실제 재사용 위치가 늘어나는 시점에 판단.
