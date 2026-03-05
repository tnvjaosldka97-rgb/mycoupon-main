# MyCoupon 모바일 QA 버그 리포트

> 작성일: 2026-03-05  
> 환경: Production (https://my-coupon-bridge.com)  
> 스택: React 19 + Vite / Express + tRPC / PostgreSQL + Drizzle / Railway

---

## 버그 목록 (Severity 순)

---

### BUG-08 · P0 · **구독팩 발주요청 미생성 — 성공 모달이 DB 저장 없이 노출**

| 항목 | 내용 |
|------|------|
| **파일** | `server/_core/index.ts`, `server/routers/packOrders.ts` |
| **재현 절차** | 1. 사장님 로그인 2. 대시보드 → 마이쿠폰 구독팩 탭 3. 아무 패키지 "구매하기" 클릭 4. 성공 모달 확인 5. Network 탭에서 POST 없음 확인 |
| **기대 결과** | POST `/api/trpc/packOrders.createOrderRequest` 발생 → DB 저장 → 성공 모달 |
| **실제 결과** | POST 없이 성공 모달 표시 / 어드민 발주요청 목록 비어있음 |
| **상태** | ✅ 수정 완료 |

#### 근본 원인 (조사 결과)

**원인 1 (확정): `DO $$ BEGIN ... END $$;` PL/pgSQL 블록이 자동 마이그레이션에서 실패**

```typescript
// server/_core/index.ts (구버전 — 문제 코드)
try {
  await db.execute(`
    DO $$ BEGIN
      CREATE TYPE pack_code AS ENUM ('WELCOME_19800', ...);
    EXCEPTION WHEN duplicate_object THEN NULL;
    END $$;
  `);
  // → DO $$ 블록이 Drizzle execute(rawString)과 호환 안 됨
  // → 실패해도 try/catch가 에러를 삼킴
  
  await db.execute(`
    CREATE TABLE IF NOT EXISTS pack_order_requests (
      ...
      requested_pack  pack_code NOT NULL,  // ← pack_code 타입 없으면 실패
      status          order_status NOT NULL DEFAULT 'REQUESTED',
    )
  `);
  // → 위 실패 → 테이블 미생성
} catch (e) {
  console.error('non-critical');  // 에러 무시
}
```

**원인 2 (확정): `RETURNING id` 없이 INSERT 성공 여부 미검증**

```typescript
// server/routers/packOrders.ts (구버전)
await dbConn.execute(`
  INSERT INTO pack_order_requests (...) VALUES (...)
  // RETURNING id 없음!
`);
return {
  success: true,   // ← INSERT 실패 여부와 무관하게 항상 success 반환
  message: '구독팩 신청이 접수되었습니다...',
};
// → onSuccess → 모달 표시
// → 실제 DB 저장 없이 사용자에게 성공처럼 보임
```

#### 수정 내용

**수정 1: `server/_core/index.ts`**
- `DO $$ BEGIN ... END $$;` PL/pgSQL 블록 제거
- PostgreSQL ENUM 대신 `VARCHAR(20/50)` 사용 → Drizzle `execute(rawString)` 호환 보장
- 테이블별 독립 try/catch → 각 마이그레이션 실패가 다른 마이그레이션에 영향 없음

**수정 2: `server/routers/packOrders.ts`**
- 모든 `db.execute(rawString)` → `db.execute(sql\`...\`)` Drizzle 태그드 템플릿
- `INSERT ... RETURNING id` 추가 → 실제 저장된 row ID 확인
- INSERT 후 `newId` 없으면 `throw new Error(...)` → `onError` toast 표시 (성공처럼 보이지 않음)
- `extractRows()` 헬퍼 추가 → `{ rows: [...] }` / `[rowsArray]` 두 가지 Drizzle 응답 포맷 모두 처리
- 어드민 쿼리 (listPackOrders, updatePackOrder, setUserPlan 등)도 동일 패턴으로 통일

**수정 3: 기존 구조 재사용 확인**
- 새 테이블 생성 없음 (기존 `pack_order_requests` 재사용)
- 새 endpoint 생성 없음 (기존 `packOrders.*` 재사용)  
- 새 status enum 생성 없음 (기존 REQUESTED/CONTACTED/APPROVED/REJECTED/CANCELLED 재사용)
- 어드민 UI 변경 없음 (기존 발주요청 탭 그대로)

#### 수정 파일

| 파일 | 수정 이유 |
|------|-----------|
| `server/_core/index.ts` | ENUM 기반 마이그레이션 → VARCHAR 기반으로 교체 |
| `server/routers/packOrders.ts` | sql 태그드 템플릿 + RETURNING id 검증 |
| `tests/e2e/mobile/07-order-request-regression.spec.ts` | 회귀 테스트 추가 (신규) |

#### 기존 구조를 존중한 방법

- `pack_order_requests` 테이블 구조 유지 (컬럼 이름/타입 변경 없음, VARCHAR → ENUM 컬럼은 PostgreSQL이 자동 캐스트)
- `packOrders.*` tRPC 네임스페이스 유지
- `REQUESTED/CONTACTED/APPROVED/REJECTED/CANCELLED` 상태값 유지
- 어드민 `listPackOrders` 쿼리 조건 변경 없음

#### 회귀 테스트

`tests/e2e/mobile/07-order-request-regression.spec.ts`:
- `TC-ORDER-04`: 구매하기 클릭 시 POST 발생 확인
- `TC-ORDER-05`: 성공 모달 ↔ POST 응답 동시 확인
- `TC-ORDER-06`: 발주요청 후 admin 목록 반영 확인
- `TC-ORDER-07/08`: 서버 기동 + endpoint 존재 확인

---

---

### BUG-01 · P1 · **CSS safe-area 이중 적용 → iOS 상단/하단 여백 2배**

| 항목 | 내용 |
|------|------|
| **파일** | `client/src/index.css` |
| **원인 라인** | `html` (130~133) + `body` (152~155) 모두 `padding: env(safe-area-inset-*)` 적용 |
| **재현 절차** | 1. iPhone 노치/Dynamic Island 기기에서 PWA 설치 후 실행 2. 상단/하단 여백 확인 |
| **기대 결과** | 상단 Safe Area 여백 1회만 적용 (e.g. 44px) |
| **실제 결과** | html + body 이중 적용으로 여백 2배 (88px) → 헤더가 노치 아래로 밀려남 |
| **수정 내용** | `html`의 safe-area padding 4줄 제거, `body`에만 유지 |
| **수정 파일** | `client/src/index.css` |
| **상태** | ✅ 수정 완료 |

---

### BUG-02 · P1 · **100vh 사용 → 모바일 Chrome 주소바 포함 오버플로우**

| 항목 | 내용 |
|------|------|
| **파일** | `client/src/index.css:174` |
| **원인** | `#root { min-height: 100vh }` — 모바일 Chrome은 주소바 높이를 포함한 값이 100vh여서, 주소바가 나타나면 콘텐츠 하단 잘림 |
| **재현 절차** | Android Chrome에서 페이지 접속 후 스크롤 → 주소바 숨김 → 하단 콘텐츠 잘림 |
| **기대 결과** | 뷰포트 내 콘텐츠 온전히 표시 |
| **실제 결과** | 하단 버튼/내비게이션이 잘려 보임 |
| **수정 내용** | `min-height: 100svh` (Small Viewport Height) + `100vh` fallback 추가 |
| **수정 파일** | `client/src/index.css` |
| **상태** | ✅ 수정 완료 |

---

### BUG-03 · P2 · **maximum-scale=1 → 접근성 텍스트 확대 불가 (WCAG 위반)**

| 항목 | 내용 |
|------|------|
| **파일** | `client/index.html:8` |
| **원인** | `<meta name="viewport" content="..., maximum-scale=1, ...">` |
| **재현 절차** | iOS Safari에서 두 손가락 핀치줌 시도 → 확대 안 됨 |
| **기대 결과** | 사용자 텍스트 확대 가능 (WCAG 1.4.4) |
| **실제 결과** | 핀치줌 차단 |
| **수정 내용** | `maximum-scale=1` → `maximum-scale=5` |
| **수정 파일** | `client/index.html` |
| **상태** | ✅ 수정 완료 |

---

### BUG-04 · P2 · **PWA 아이콘 파일이 git에 없음 → 배포 시 아이콘 404**

| 항목 | 내용 |
|------|------|
| **파일** | `client/public/` |
| **원인** | `icon-192.png`, `icon-512.png`, `apple-touch-icon-v2.png`, `logo-bear-nobg.png` 파일이 레포에 없음 (`.gitignore`에서도 제외 규칙 없음) |
| **재현 절차** | 1. git clone 후 빌드 2. `/icon-192.png` 요청 → 404 |
| **기대 결과** | 아이콘 파일 200 응답 |
| **실제 결과** | 404 (단, Railway 배포본에는 파일이 있을 수 있음 — 수동 확인 필요) |
| **수정 내용** | 프로덕션 서버에서 파일 추출 후 `client/public/`에 커밋 필요 |
| **수정 파일** | `client/public/*.png` (추가 작업 필요) |
| **상태** | ⚠️ 미수정 (수동 작업 필요) |

---

### BUG-05 · P2 · **Select.Item value="" 에러 (어드민 발주요청 필터)**

| 항목 | 내용 |
|------|------|
| **파일** | `client/src/pages/AdminDashboard.tsx` |
| **원인** | `<SelectItem value="">전체</SelectItem>` — Radix UI Select는 빈 문자열 value 금지 |
| **재현 절차** | 어드민 로그인 → 발주요청 탭 → 앱 전체 크래시 |
| **기대 결과** | 필터 셀렉트 정상 렌더링 |
| **실제 결과** | `A <Select.Item /> must have a value prop that is not an empty string` 에러로 앱 크래시 |
| **수정 내용** | value="" → value="ALL", onValueChange에서 "ALL" → "" 변환 처리 |
| **수정 파일** | `client/src/pages/AdminDashboard.tsx` |
| **상태** | ✅ 수정 완료 |

---

### BUG-06 · P3 · **도장판(District Stamps) 메뉴 노출 — 사용하지 않는 기능**

| 항목 | 내용 |
|------|------|
| **파일** | `client/src/pages/Home.tsx:408` |
| **원인** | 네비게이션 바에 `/district-stamps` 링크 존재 |
| **재현 절차** | 홈화면 접속 → 헤더 "도장판" 링크 클릭 |
| **기대 결과** | 메뉴 미노출 |
| **실제 결과** | 도장판 링크 노출 → 빈 페이지 또는 미완성 기능으로 이동 |
| **수정 내용** | 도장판 링크 및 구분선 제거 |
| **수정 파일** | `client/src/pages/Home.tsx` |
| **상태** | ✅ 수정 완료 |

---

### BUG-07 · P3 · **`-webkit-touch-callout: none` 전체 적용 → 링크 길게 누르기 불가**

| 항목 | 내용 |
|------|------|
| **파일** | `client/src/index.css:122` |
| **원인** | `* { -webkit-touch-callout: none; }` — 모든 요소에 적용 |
| **재현 절차** | iOS Safari에서 링크 길게 누르기 → 컨텍스트 메뉴 안 뜸 |
| **기대 결과** | 링크/이미지 길게 누르기 시 "링크 복사", "이미지 저장" 옵션 표시 |
| **실제 결과** | 컨텍스트 메뉴 억제 |
| **수정 내용** | 수정하지 않음 (의도된 앱 경험일 수 있음) — 운영팀 판단 필요 |
| **상태** | ℹ️ 검토 필요 |

---

## 수정 완료 파일 요약

| 파일 | 수정 내용 |
|------|-----------|
| `client/src/index.css` | safe-area 이중 적용 제거, 100vh → 100svh |
| `client/index.html` | maximum-scale=1 → maximum-scale=5 |
| `client/src/pages/AdminDashboard.tsx` | Select.Item 빈 value 에러 수정 |
| `client/src/pages/Home.tsx` | 도장판 메뉴 제거 |
| `server/_core/index.ts` | 구독팩 DB 테이블 자동 마이그레이션 추가 |

---

## 남은 리스크

| 리스크 | 수준 | 대응 방안 |
|--------|------|-----------|
| PWA 아이콘 파일 git 미추적 | P2 | 실서버에서 파일 추출 후 git add |
| iOS 실기기 safe-area 시각 검증 미완 | P2 | iOS Simulator 또는 실기기 수동 확인 |
| 로그인 필요 플로우 E2E 미테스트 | P1 | 테스트 계정(merchant/admin) 제공 시 추가 |
| 쿠폰 발급/사용 레이스 컨디션 | P1 | DB transaction lock 확인 완료 (코드), 부하 테스트 미시행 |
| 구독팩 자동 마이그레이션 실서버 적용 확인 | P1 | Railway 배포 후 로그에서 "subscription plan tables ready" 확인 |
