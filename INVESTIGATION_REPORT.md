# 전수조사 리포트 (Safe Patch Mode)

> 작성일: 2026-03-05 | 작업모드: SAFE PATCH / 최소 변경 / 기존 구조 보존

---

## A. Store(가게) 모델/스키마

| 항목 | 위치 | 내용 |
|------|------|------|
| 테이블 정의 | `drizzle/schema.ts:57` | `pgTable("stores", { ... })` |
| 소유자 컬럼 | `drizzle/schema.ts:59` | `ownerId: integer("owner_id").notNull()` |
| 비활성 컬럼 | `drizzle/schema.ts:75` | `isActive: boolean("is_active").default(true).notNull()` |
| deletedAt | — | **존재하지 않음** |
| status | — | **존재하지 않음** |
| 현재 isActive 의미 | badge 로직 기준 | `isActive=false` = 거부됨 OR 비활성. 삭제 구분 불가 |

**결론**: soft delete용으로 `deletedAt TIMESTAMP NULL` + `deletedBy INT NULL` 컬럼 추가 필요 (additive-only).

---

## B. 인증/인가 구조

| 항목 | 위치 | 내용 |
|------|------|------|
| 구글 로그인 시작 | `server/_core/oauth.ts:16` | `GET /api/oauth/google/login` |
| 구글 콜백 | `server/_core/oauth.ts:31` | `GET /api/oauth/google/callback` |
| JWT 세팅 | `server/_core/oauth.ts:44-55` | JWT 생성 → 쿠키 세팅 → redirect |
| DB upsert | `server/_core/oauth.ts:58-64` | `setImmediate(() => db.upsertUser(...))` — **비동기 백그라운드** |
| ctx.user 세팅 | `server/_core/context.ts:54` | `db.getUserByOpenId(openId)` — DB에서 직접 조회 |
| merchant 가드 | `server/routers.ts:18` | `merchantProcedure`: `role !== 'merchant' && role !== 'admin'` → throw |

**중요 발견**: OAuth 콜백에서 DB upsert가 `setImmediate`(비동기)로 실행됨. consent 체크는 `merchantProcedure`에서 tRPC 레벨로 해야 함(redirect는 클라이언트 담당).

---

## C. 내 가게 목록 조회

| 항목 | 위치 | 내용 |
|------|------|------|
| 프론트 | `MerchantDashboard.tsx:85` | `trpc.stores.myStores.useQuery()` |
| 백엔드 엔드포인트 | `server/routers.ts:422` | `merchantProcedure.query(ctx => db.getStoresByOwnerId(ctx.user.id))` |
| DB 함수 | `server/db.ts:210` | `db.select().from(stores).where(eq(stores.ownerId, ownerId))` |
| deletedAt 제외 | — | **없음** — isActive 필터도 없음. 모든 store 반환 |
| 계정 격리 | ✅ | `ownerId = ctx.user.id` 필터 적용됨 |

**버그 발견**: `getStoresByOwnerId`가 `deleted_at IS NULL` 필터 없음 → soft delete 후에도 목록에 노출됨. 수정 필요.

---

## D. Store 종속 리소스

| 리소스 | 참조 방식 | 삭제 충돌 가능성 |
|--------|-----------|-----------------|
| `coupons` | `store_id FK REFERENCES stores(id) ON DELETE CASCADE` | 쿠폰 자동 삭제됨 |
| `userCoupons` | `coupon_id FK ... ON DELETE CASCADE` | 연쇄 삭제됨 |
| `couponUsage` | `store_id` (FK 아님) | 남아있을 수 있음 |
| `pack_order_requests` | `store_id` (nullable, FK 아님) | 남아있을 수 있음 |
| `reviews` | `store_id` (FK 아님) | 남아있을 수 있음 |

**결론**: hard delete 시 CASCADE로 쿠폰/유저쿠폰 삭제됨. soft delete(isActive=false)는 안전. 활성 쿠폰 있을 때 삭제 제한 권장.

---

## E. 등급/구독 상태

| 항목 | 위치 | 내용 |
|------|------|------|
| 저장 위치 | `user_plans` 테이블 (VARCHAR tier) | FREE/WELCOME/REGULAR/BUSY |
| 현재 플랜 조회 | `packOrders.getMyPlan` | `user_plans WHERE user_id = ctx.user.id AND is_active = TRUE` |
| `isAdmin` 필드 | `packOrders.ts:80` | `isAdmin: ctx.user.role === 'admin'` — **DB에서 오지 않음** |
| "어드민-제한없음" 노출 | `MerchantDashboard.tsx:466` | `{myPlan?.isAdmin && <span>(어드민 – 제한 없음)</span>}` |
| 원인 | 하드코딩 admin email 계정이 merchant 탭 진입 시 노출 | admin 역할 계정도 merchantProcedure 통과하므로 |
| pending order 정보 | — | **없음** — getMyPlan이 pack_order_requests 미참조 |

**결론**: `isAdmin` 조건부 텍스트를 merchant UI에서 제거하거나 관리자 계정에만 표시해야 함. `getMyPlan`에 pending order 체크 추가 필요.

---

## F. 발주신청 생성 플로우

| 항목 | 위치 | 내용 |
|------|------|------|
| endpoint | `packOrders.createOrderRequest` | CTE INSERT-OR-SELECT |
| RETURNING id | `server/routers/packOrders.ts:159` | `RETURNING id` 있음 |
| id 검증 | `server/routers/packOrders.ts:195` | `if (!row?.id) throw ...` |
| 프론트 모달 트리거 | `MerchantDashboard.tsx:76` | `onSuccess: (data) => { if (!data.orderId) return; setOrderModalOpen(true); }` |
| tier 반영 | — | **없음** — pack_order 생성 후 getMyPlan에 신청중 상태 미반영 |

---

## 구현 플랜 + 변경 파일 리스트

### 파트 1: 내 가게 Soft Delete

| 파일 | 변경 내용 |
|------|-----------|
| `drizzle/schema.ts` | stores에 `deletedAt`, `deletedBy` 컬럼 추가 |
| `server/_core/index.ts` | ALTER TABLE stores ADD COLUMN IF NOT EXISTS |
| `server/db.ts` | `getStoresByOwnerId`: `deleted_at IS NULL` 필터 추가 / `softDeleteStore(id, userId)` 추가 |
| `server/routers.ts` | `stores.softDeleteMyStore` merchantProcedure 추가 |
| `client/src/pages/MerchantDashboard.tsx` | 가게 카드에 삭제 버튼 + AlertDialog |

### 파트 2: 동의(Consent) 온보딩

| 파일 | 변경 내용 |
|------|-----------|
| `drizzle/schema.ts` | users에 `signupCompletedAt`, `termsAgreedAt`, `marketingAgreed`, `trialEndsAt` 추가 |
| `server/_core/index.ts` | ALTER TABLE users + 기존 사용자 backfill (grandfathering) |
| `server/db.ts` | `completeUserSignup(userId, marketing)` 추가 |
| `server/routers.ts` | `auth.completeSignup` 추가, `merchantProcedure`에 signup 체크 추가 |
| `client/src/pages/ConsentPage.tsx` | **신규** 동의 페이지 |
| `client/src/App.tsx` | `/signup/consent` 라우트 추가 |
| `client/src/main.tsx` 또는 `App.tsx` | SIGNUP_REQUIRED 에러 핸들링 |

### 파트 3: 발주신청 후 등급 반영

| 파일 | 변경 내용 |
|------|-----------|
| `server/routers/packOrders.ts` | `getMyPlan`에 `pack_order_requests` JOIN, `pendingOrder` 필드 추가 |
| `client/src/pages/MerchantDashboard.tsx` | "구독팩 신청중" 배지 표시 |

### 파트 4: UI 텍스트 수정

| 파일 | 변경 내용 |
|------|-----------|
| `client/src/pages/MerchantDashboard.tsx` | "(어드민 – 제한 없음)" 제거 → "(7일 체험)" 추가, 체험 잔여일 표시 |

---

## 기존 재사용 전략

| 기능 | 재사용 항목 | 신규 추가 이유 |
|------|-------------|---------------|
| Soft delete | `isActive` 기존 있음 → **불가**: 거부/삭제 구분 불가 → `deletedAt` 신규 추가 | `isActive=false`는 이미 "거부됨" 의미로 사용됨 |
| 동의 저장 | users 테이블 재사용, 4개 컬럼 추가 | 기존에 consent 관련 컬럼 전혀 없음 |
| 등급 티어 | `user_plans.tier` VARCHAR 재사용, PENDING 추가 안 함 | getMyPlan에 pending 체크만 추가 (테이블 변경 없음) |

---

## 기술부채 / 리팩토링 포인트 (이번 범위 외)

1. **SQL 인젝션 취약점**: `server/routers.ts:659` — `coupons.create` 플랜 체크가 raw string SQL + 템플릿 리터럴 사용. `sql``로 전환 필요.
2. **race condition**: OAuth 콜백의 `setImmediate(db.upsertUser)` — JWT 발급과 DB 저장이 비동기. 첫 API 호출 시 user null 가능성.
3. **getStoresByOwnerId isActive 필터 없음**: 현재 rejected store도 목록에 노출됨.
4. **admin.deleteStore**: Hard delete 사용 → 프로덕션에서 cascade로 쿠폰/다운로드 데이터 삭제됨. 이 함수도 soft delete로 전환 필요.
5. **merchantProcedure signupCompleted 체크**: 현재 role만 체크. 추가 필드 필요.
