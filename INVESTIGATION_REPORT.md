# 구독팩 발주요청 버그 조사 보고서

> 작성일: 2026-03-05  
> 대상: `my-coupon-bridge.com/merchant/dashboard` 구독팩 구매하기 클릭 → 모달은 뜨는데 POST 없음

---

## 1. 버튼 핸들러 위치

**파일**: `client/src/pages/MerchantDashboard.tsx`

```tsx
// 라인 75~83: mutation 정의
const createOrderRequest = trpc.packOrders.createOrderRequest.useMutation({
  onSuccess: (data) => {
    setOrderModalMessage(data.message);
    setOrderModalOpen(true);          // ← 모달은 반드시 onSuccess에서만 열림
  },
  onError: (error) => {
    toast.error(error.message || '요청 처리 중 오류가 발생했습니다.');
  },
});

// 라인 537~542: 버튼 onClick
onClick={() =>
  createOrderRequest.mutate({
    packCode: pack.packCode,
    storeId: myStores?.[0]?.id,
  })}
```

**결론**: 버튼 클릭 → `trpc.packOrders.createOrderRequest.mutate()` 호출.  
성공 모달이 뜨려면 반드시 tRPC 뮤테이션이 `success` 응답을 받아야 함.  
직접 `setOrderModalOpen(true)` 호출하는 코드는 `onSuccess` 콜백 외에 없음.

---

## 2. 성공 모달이 뜨는 조건

| 조건 | 코드 |
|------|------|
| **정상 경로** | INSERT 성공 → `return { success: true, orderId: newId, message: '...' }` → `onSuccess` → 모달 |
| **중복 경로** | 기존 REQUESTED/CONTACTED 요청 존재 → `return { success: true, isDuplicate: true, message: '이미 접수됨...' }` → `onSuccess` → 모달 |
| **실패 경로** | DB 에러 or INSERT 실패 → `throw new Error(...)` → tRPC error → `onError` → toast.error |

**즉, 모달이 뜬다는 것은 서버가 `success: true`를 반환했다는 의미.**

---

## 3. 기존 관련 endpoint/table/enum 현황

### 3.1 기존 테이블 — `pack_order_requests`

**drizzle/schema.ts** (Drizzle 스키마 정의):
```typescript
export const packOrderRequests = pgTable("pack_order_requests", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  storeId: integer("store_id"),
  requestedPack: packCodeEnum("requested_pack").notNull(),  // pack_code ENUM
  status: orderStatusEnum("status").default("REQUESTED"),    // order_status ENUM
  adminMemo: text("admin_memo"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});
```

**server/_core/index.ts** (서버 시작 시 자동 마이그레이션):
```typescript
// 원래 버전 (문제 있음):
await db.execute(`
  DO $$ BEGIN
    CREATE TYPE pack_code AS ENUM ('WELCOME_19800', 'REGULAR_29700', 'BUSY_49500');
  EXCEPTION WHEN duplicate_object THEN NULL;
  END $$;
`);
// → PostgreSQL DO $$ 블록이 Drizzle raw string execute()와 호환 안 될 수 있음
// → enum 생성 실패 시 하위 CREATE TABLE도 실패 (pack_code 타입 없음)
// → 전체 try/catch에 감싸져 있어 에러가 로그만 남고 무시됨
```

### 3.2 기존 API endpoint — `packOrders.*`

**server/routers.ts**:
```typescript
import { packOrdersRouter } from "./routers/packOrders";  // 라인 13
// ...
packOrders: packOrdersRouter,   // 라인 2536 (appRouter 최상위에 등록)
```

**서버 등록 여부**: ✅ appRouter 최상위에 등록되어 있음.  
**접근 경로**: `POST /api/trpc/packOrders.createOrderRequest`

### 3.3 기존 status enum

`schema.ts`에 정의:
```typescript
export const orderStatusEnum = pgEnum("order_status",
  ["REQUESTED", "CONTACTED", "APPROVED", "REJECTED", "CANCELLED"]
);
```

기존 상태값을 그대로 사용 중. 추가 상태값 불필요.

---

## 4. 관리자 발주요청 화면 source

**client/src/pages/AdminDashboard.tsx** 라인 146~157:
```typescript
const { data: packOrders } = trpc.packOrders.listPackOrders.useQuery({
  status: packOrderFilter || undefined,
  q: packOrderSearch || undefined,
});
```

`packOrders.listPackOrders` → `server/routers/packOrders.ts`의 `listPackOrders` 쿼리  
→ `SELECT ... FROM pack_order_requests JOIN users ... LEFT JOIN stores ...`

**어드민에서 row가 안 보이는 이유**: 테이블이 없거나 INSERT가 실패했으면 행이 없음.

---

## 5. 원인 분석 (가능성 순)

### ⬛ 원인 1순위: PostgreSQL 커스텀 ENUM 생성 실패 → 테이블 미생성

**근거**:
```typescript
// server/_core/index.ts 원본 코드
try {
  await db.execute(`DO $$ BEGIN CREATE TYPE pack_code AS ENUM ... END $$;`);
  // 위 실패 시 (DO $$ 블록 미지원) → catch에서 잡힘
  await db.execute(`CREATE TABLE IF NOT EXISTS pack_order_requests (... requested_pack pack_code NOT NULL ...)`);
  // pack_code 타입이 없으면 이 쪽도 실패 → catch에서 잡힘
} catch (e) {
  console.error('⚠️ [Migration] subscription plan error (non-critical):', e);
  // 에러 무시
}
```

`DO $$ BEGIN ... END $$;` PL/pgSQL 익명 블록은 일부 Drizzle 버전이나 환경에서 `execute(rawString)`으로 실행할 때 예외 없이 무시될 수 있음. 테이블이 없으면 INSERT가 tRPC 에러를 throw하고 `onError` 경로로 가야 하는데...

### ⬛ 원인 2순위: SQL 응답 포맷 불일치 → 가짜 성공 반환

**근거 (원본 packOrders.ts)**:
```typescript
// 원본 코드의 INSERT 결과 접근 방식:
const storeClause = input.storeId ? `, store_id` : '';
await dbConn.execute(`
  INSERT INTO pack_order_requests (user_id${storeClause}, ...)
  VALUES (${ctx.user.id}${storeVal}, '${input.packCode}', 'REQUESTED', NOW(), NOW())
`);
// RETURNING id 없음! INSERT 성공 여부 미검증

return {
  success: true,
  isDuplicate: false,
  message: '구독팩 신청이 접수되었습니다...',
};
```

**문제**: 원본 코드는 INSERT 성공 여부를 확인하지 않고 무조건 `success: true` 반환.  
테이블이 없어서 INSERT가 실패해도, **Drizzle의 `execute(rawString)`이 에러를 throw하지 않고 silent fail하면** `success: true`를 반환 → `onSuccess` → 성공 모달!  
→ 이것이 "POST 없이 모달이 뜨는" 현상의 가장 유력한 설명.

### ⬛ 원인 3순위: Railway 배포 미완료 (구버전 코드 실행 중)

**근거**:
- 스크린샷의 Railway 대시보드: ACTIVE 배포가 "last month" 커밋
- 구독팩 기능은 `6d8afb6 feat: 구독팩/계급 시스템 추가` 커밋에서 추가됨
- 만약 구 버전이 배포 중이라면 구독팩 탭 자체가 없어야 하나, 스크린샷에 모달이 보임 → 새 버전 배포 완료된 것으로 추정
- 단, Railway에서 캐시/빌드 문제로 구버전 JS 번들이 제공될 가능성 배제 불가

---

## 6. 기존 구조 충돌 여부

| 항목 | 기존 구조 | 새로 만들 필요 |
|------|-----------|---------------|
| `pack_order_requests` 테이블 | ✅ `schema.ts`에 정의, 마이그레이션 존재 | 없음 |
| `packOrders.createOrderRequest` endpoint | ✅ `packOrders.ts` + `appRouter` 등록 | 없음 |
| status enum (REQUESTED, CONTACTED, APPROVED...) | ✅ `schema.ts`에 정의 | 없음 |
| 어드민 발주요청 조회 | ✅ `AdminDashboard.tsx` → `listPackOrders` | 없음 |

**결론**: 기존 구조로 완전히 해결 가능. 새 테이블/endpoint/enum 불필요.

---

## 7. 최소 수정안

### 수정 1: `server/_core/index.ts` — 마이그레이션 안정화

**변경**: `DO $$ BEGIN ... END $$;` PL/pgSQL 블록 제거 → `VARCHAR` 기반 테이블 생성으로 교체  
**이유**: PostgreSQL custom ENUM 타입 생성 없이도 동작. Drizzle `execute(rawString)` 호환성 보장.  
**규모**: 5줄 수정 (ENUM 생성 블록 3개 제거 + VARCHAR로 테이블 재정의)

### 수정 2: `server/routers/packOrders.ts` — SQL 안전화

**변경**: `db.execute(rawString)` → `db.execute(sql\`...\`)` Drizzle 태그드 템플릿  
**이유**:  
1. `sql\`\`` 태그드 템플릿은 parameterized query → SQL injection 방지  
2. 결과 포맷이 명확히 `{ rows: [...] }` 구조  
3. `INSERT ... RETURNING id` 추가 → 실제 저장 여부 검증, 실패 시 `throw` → `onError` toast 표시  
**규모**: `createOrderRequest` 함수 내부 재작성, 나머지 절차도 동일 패턴 적용

### 수정 3: 프론트엔드 — 변경 없음

현재 코드는 올바름:  
- 버튼 → `createOrderRequest.mutate()` 호출  
- 모달은 `onSuccess`에서만 열림  
- 에러는 `onError`에서 toast 표시  

---

## 8. 새로 만든 것의 근거 없음 확인

기존 구조로 해결 가능함을 재확인:
- `pack_order_requests` 테이블: 기존 schema.ts에 있음 → 재사용
- `packOrders.*` 라우터: 기존에 있음 → 재사용
- 상태값: REQUESTED/CONTACTED/APPROVED/REJECTED/CANCELLED → 기존 enum 재사용
- 어드민 UI: 기존 `AdminDashboard.tsx` 발주요청 탭 → 재사용
