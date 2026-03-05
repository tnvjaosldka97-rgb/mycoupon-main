# 구독팩 발주요청 버그 전수조사 리포트 (v2)

> 작성일: 2026-03-05  
> 현상: 사장님 "구매하기" 클릭 → 성공 모달 뜨지만 Network POST 없음 + 어드민 발주요청 목록 비어있음

---

## 수정 파일 리스트

| 파일 | 수정 이유 |
|------|-----------|
| `server/_core/index.ts` | 마이그레이션 후 테이블 존재 여부 검증 + 부분 유니크 인덱스 추가 |
| `server/routers/packOrders.ts` | CTE 원자적 INSERT-OR-SELECT, RETURNING id 강제, `dbHealth` 어드민 엔드포인트 추가 |
| `client/src/pages/MerchantDashboard.tsx` | `orderId` 없으면 모달 차단, 중복 클릭 방지 강화 |

---

## 전수조사 결과

### 버튼 핸들러 위치

```
client/src/pages/MerchantDashboard.tsx
  - createOrderRequest mutation: 라인 75~86
  - 버튼 onClick: 라인 537~543
  - 성공 모달: 라인 561~584
```

### 성공 모달이 뜨는 조건 (수정 전 vs 수정 후)

| 조건 | 수정 전 | 수정 후 |
|------|---------|---------|
| INSERT 성공 | 모달 ✅ | 모달 ✅ |
| INSERT 실패 (테이블 없음) | **모달 ✅ (버그!)** | 에러 toast ✅ |
| orderId 없는 응답 | 모달 ✅ (버그!) | 에러 toast ✅ |
| DB 연결 실패 | 에러 toast | 에러 toast |

### 기존 endpoint/table/status 현황

| 항목 | 파일 위치 | 상태 |
|------|-----------|------|
| `pack_order_requests` 테이블 | `drizzle/schema.ts:693` + `server/_core/index.ts` 자동 마이그레이션 | 기존 존재 (재사용) |
| `packOrders.createOrderRequest` | `server/routers/packOrders.ts` | 기존 존재 (수정) |
| `REQUESTED/CONTACTED/...` 상태값 | `drizzle/schema.ts:orderStatusEnum` | 기존 존재 (재사용) |
| 어드민 `listPackOrders` | `server/routers/packOrders.ts` | 기존 존재 (재사용) |
| 어드민 `dbHealth` (신규) | `server/routers/packOrders.ts` | **신규** (기존 구조로 불가능했던 이유: DB 검증 전용 엔드포인트가 없었음) |

---

## 근본 원인 (확정)

### 원인 1: `DO $$ ... $$;` PL/pgSQL 블록 실패 → 테이블 미생성

```typescript
// server/_core/index.ts (구버전)
try {
  await db.execute(`DO $$ BEGIN CREATE TYPE pack_code AS ENUM ...; END $$;`);
  // ↑ Drizzle execute(rawString)에서 PL/pgSQL 블록이 실패할 수 있음
  
  await db.execute(`CREATE TABLE IF NOT EXISTS pack_order_requests (
    requested_pack pack_code NOT NULL  ← pack_code 없으면 실패
  )`);
} catch (e) {
  console.error('non-critical');  // 에러 무시 → 테이블 미생성 감지 불가
}
```

### 원인 2: INSERT 성공 여부 미검증 → 가짜 성공 반환

```typescript
// packOrders.ts (구버전) - 이미 수정 완료
await dbConn.execute(`INSERT INTO pack_order_requests (...) VALUES (...)`);
// RETURNING id 없음! 실패해도 아래 코드 실행
return { success: true, message: '...' };  // ← 가짜 성공
```

### 원인 3: SELECT + INSERT 비원자적 실행 → 레이스 컨디션

```typescript
// 구버전: SELECT → INSERT 두 단계
const existing = await SELECT ...;       // 1단계
if (!existing) await INSERT ...;         // 2단계
// 동시 클릭 시 두 INSERT 모두 실행될 수 있음
```

---

## 수정 내용 상세

### 1. 마이그레이션 강화 (`server/_core/index.ts`)

```diff
- DO $$ BEGIN CREATE TYPE pack_code AS ENUM ...; END $$;  ← 제거
+ CREATE TABLE IF NOT EXISTS pack_order_requests (
+   requested_pack VARCHAR(50) NOT NULL,  ← VARCHAR로 교체
+   status         VARCHAR(20) NOT NULL DEFAULT 'REQUESTED',
+ )
+
+ CREATE UNIQUE INDEX IF NOT EXISTS idx_pack_orders_active_unique
+ ON pack_order_requests(user_id, requested_pack)
+ WHERE status IN ('REQUESTED', 'CONTACTED')  ← 부분 유니크 인덱스 추가
+
+ -- 생성 후 information_schema로 존재 확인 → 로그 출력
```

### 2. 원자적 CTE (`server/routers/packOrders.ts`)

```sql
WITH sel AS (
  SELECT id, TRUE AS is_duplicate
  FROM   pack_order_requests
  WHERE  user_id = $1 AND requested_pack = $2
    AND  status IN ('REQUESTED', 'CONTACTED')
  LIMIT 1
),
ins AS (
  INSERT INTO pack_order_requests (user_id, store_id, requested_pack, status, ...)
  SELECT $1, $3, $2, 'REQUESTED', NOW(), NOW()
  WHERE  NOT EXISTS (SELECT 1 FROM sel)  -- 원자적 중복 방지
  RETURNING id
)
SELECT id, FALSE AS is_duplicate FROM ins
UNION ALL
SELECT id, TRUE  AS is_duplicate FROM sel
LIMIT 1
```
→ 신규: INSERT → `id` 반환  
→ 중복: 기존 `id` 반환  
→ 실패: `id` 없음 → `throw new Error(...)` → `onError` toast  

### 3. 프론트엔드 검증 (`client/src/pages/MerchantDashboard.tsx`)

```typescript
onSuccess: (data) => {
  // orderId 없으면 모달 절대 열지 않음
  if (!data.orderId || typeof data.orderId !== 'number') {
    toast.error('요청 저장 중 오류가 발생했습니다. 다시 시도해 주세요.');
    return;
  }
  setOrderModalMessage(data.message);
  setOrderModalOpen(true);  // orderId 확인 후에만 오픈
},
```

---

## 검증 방법

### A. Railway 서버 로그 확인 (배포 후 즉시)

```
✅ [Migration] pack_order_requests table ready (exists=true)
✅ [Migration] user_plans table ready (exists=true)
```

이 로그가 없거나 `exists=false`면 테이블 생성 실패 → DB 연결/권한 문제.

### B. 어드민 API로 테이블 확인

브라우저에서 어드민 로그인 후:
```
GET https://my-coupon-bridge.com/api/trpc/packOrders.dbHealth?batch=1&input=%7B%220%22%3A%7B%22json%22%3Anull%7D%7D
```

**성공 응답:**
```json
{
  "result": {
    "data": {
      "ok": true,
      "tables": {
        "pack_order_requests": { "exists": true, "rowCount": 0 },
        "user_plans":          { "exists": true, "rowCount": 0 }
      },
      "idempotencyIndexExists": true
    }
  }
}
```

### C. 구매하기 클릭 후 Network 탭 확인

1. Chrome DevTools → Network → Fetch/XHR 필터
2. "구매하기" 클릭
3. **확인해야 할 요청**: `POST /api/trpc/packOrders.createOrderRequest?batch=1`
4. **Response 확인**:
   ```json
   { "result": { "data": { "success": true, "orderId": 123, "isDuplicate": false, "message": "..." } } }
   ```
5. `orderId`가 숫자면 성공, 없으면 서버 에러

### D. DB 직접 확인 (Railway 콘솔)

Railway 대시보드 → PostgreSQL 서비스 → Query 탭:
```sql
-- 테이블 존재 여부
SELECT tablename FROM pg_tables WHERE tablename IN ('pack_order_requests', 'user_plans');

-- 최근 발주요청
SELECT id, user_id, requested_pack, status, created_at FROM pack_order_requests ORDER BY created_at DESC LIMIT 5;

-- 부분 유니크 인덱스 존재 여부
SELECT indexname, indexdef FROM pg_indexes WHERE tablename = 'pack_order_requests';
```

### E. 어드민 UI 확인

어드민 로그인 → 발주요청 탭 → 목록에 row 표시 여부 확인  
(배포 후 사장님 계정으로 1회 구매하기 클릭 → 어드민에서 확인)

---

## 적용 후 배포

```bash
git add server/_core/index.ts server/routers/packOrders.ts client/src/pages/MerchantDashboard.tsx
git commit -m "fix(pack-orders): 발주요청 진짜 성공 보장

- CTE 원자적 INSERT-OR-SELECT (레이스 컨디션 제거)
- 부분 유니크 인덱스 추가 (idempotency)
- RETURNING id 없으면 무조건 throw (가짜 성공 차단)
- 프론트 orderId 검증 후에만 모달 오픈
- dbHealth endpoint로 테이블 존재 검증 가능"
git push
```

**배포 후 즉시 Railway 로그에서:**
```
✅ [Migration] pack_order_requests table ready (exists=true)
```
**확인 필수.**
