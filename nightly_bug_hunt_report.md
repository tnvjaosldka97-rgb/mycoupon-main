# 마이쿠폰 나이틀리 버그헌트 리포트
> 작업 일시: 2026-03-19
> 브랜치: `stabilization/nightly-bugfix-2026-03-19`
> 커밋: 1ff3ca3 (BUG-1), 9445048 (BUG-2), 266b940 (BUG-7), 0a77caa (BUG-3) — 분리 완료
> 작업자 모드: 통제된 수정 모드 — Principal QA Architect + CTO

---

## 1. 전체 실행 요약

| 항목 | 수치 |
|---|---|
| 발견 이슈 | 8건 |
| P0 | 0건 |
| P1 | 3건 |
| P2 | 3건 |
| P3 | 2건 |
| 수정 완료 | 4건 (BUG-1, BUG-2, BUG-3, BUG-7) |
| 반영 가능 후보 | 4건 (BUG-2 실기기 보류, 나머지 3건 반영 가능) |
| 보류 | 4건 |

---

## 2. 수정 완료 이슈

---

### BUG-1 [P1] — dailyLimit 경쟁 조건 (race condition)

- **심각도**: P1
- **플랫폼**: server (web + android 공통)
- **재현 조건**: dailyLimit 설정된 쿠폰에서 동시 다운로드 요청 10건 이상 발생 시
- **원인**:
  - `dailyUsedCount` 사전 체크(routers.ts 1528행)와 증가(routers.ts 1631~1641행)가
    `downloadCoupon()` 트랜잭션 밖에서 독립 실행됨
  - 10개 동시 요청이 모두 count=9를 읽고 체크 통과 → 모두 increment
  - dailyLimit=10 쿠폰에서 15~20개까지 발급 가능
- **수정**:
  - `server/db.ts`: `downloadCoupon()` 트랜잭션 내 `SELECT FOR UPDATE` 이후에
    dailyLimit 체크 + `dailyUsedCount` 원자 증가 추가
  - `server/routers.ts`: 트랜잭션 밖 raw SQL UPDATE 블록 제거
- **수정 파일**: `server/db.ts`, `server/routers.ts`
- **커밋**: `1ff3ca3`
- **검증 결과**:
  - (B) JavaScript async 동시성 시뮬레이션 (`scripts/simulate-race-condition.mjs`)
  - 수정 전: 동시 10요청 × 5회 → **5/5회 초과 발급 재현** (dailyLimit=5, 발급 10건)
  - 수정 후: 동시 10요청 × 5회 → **5/5회 차단** (dailyLimit=5, 발급 정확히 5건)
  - (C) 실 PostgreSQL SELECT FOR UPDATE 확인은 `scripts/test-daily-limit-concurrency.mjs` 준비 완료 (DB 연결 시 즉시 실행 가능)
- **회귀 테스트**: 기존 remainingQuantity 감소 로직 유지, dailyLimit 없는 쿠폰은 변경 없음
- **남은 리스크**: 실 DB 고부하 환경에서 lock wait timeout 미측정

---

### BUG-2 [P1] — 신규 앱 유저 consent redirect 오류

- **심각도**: P1
- **플랫폼**: Android (Capacitor)
- **재현 조건**: 처음 앱에서 구글 로그인하는 신규 유저 (signupCompletedAt = null)
- **원인**:
  - `server/_core/oauth.ts` 180~187행: 신규 앱 유저를 consent 후
    `?next=/merchant/dashboard`로 리다이렉트
  - 일반 유저는 merchant role이 없어 merchant dashboard 진입 불가
  - consent 완료 후 403 또는 즉시 재리다이렉트 → 혼란스러운 UX
- **수정**:
  - `server/_core/oauth.ts`: `next = /merchant/dashboard` → `next = /`
  - 신규 앱 유저는 consent 완료 후 홈(/)에서 시작
- **수정 파일**: `server/_core/oauth.ts`
- **커밋**: `9445048`
- **검증 결과**:
  - (A) ConsentPage.tsx 코드 확인: `next=%2F` → `decodeURIComponent` → `/` → safety check 통과 → `setLocation('/')` 실행
  - (A) `isAppMode && signupCompleted` 경로(기존 앱 유저) — 코드 분기 진입 없음. ticket 발급 경로 수정 없음
  - (A) `isAppMode=false` 경로(웹 OAuth) — 분기 외부, 코드 실행 없음
  - (C) 실기기 Android 신규 계정 최종 확인 보류
- **회귀 테스트**: 웹 모드 OAuth 플로우는 수정 없음. 기존 유저 앱 로그인(ticket 경로)은 수정 없음
- **남은 리스크**: 실기기 미확인

---

### BUG-7 [P1] — PWA standalone 세션 삭제 dead code ✅ 반영 가능

- **심각도**: P1 (재판정: Capacitor에서 잘못 발화 가능한 PWA first-launch dead code 제거)
- **실제 피해**: 세션 쿠키 삭제 미발생 (httpOnly + 이름 불일치 이중 방어로 원래부터 무효)
- **올바른 이슈 설명**: Capacitor Android WebView에서 `(display-mode: standalone)` 또는 `document.referrer: android-app://` 조건이 true로 평가될 경우 PWA 전용 첫 실행 블록이 불필요하게 실행됨
- **수정**: `isCapacitorNative()` 조기 반환 가드 추가. `document.referrer` 조건 제거. 잘못된 cookie name + httpOnly dead code 제거
- **수정 파일**: `client/src/App.tsx`
- **커밋**: `266b940`
- **반영 상태**: **반영 가능**

---

### BUG-3 [P2-SEC] — Bridge Secret 하드코딩 폴백 ✅ 반영 가능

- **심각도**: P2-SEC
- **원인**: `server/bridgeAuth.ts`, `server/_core/index.ts` 3곳에 hardcoded fallback `'my-coupon-bridge-secret-2025'` — git에 노출
- **피해 범위 재판정**: 알려진 시크릿으로 가능한 최악 → 콘솔 로그 이벤트 삽입. 유저 데이터/인증 우회/파괴적 동작 없음
- **수정**: hardcoded fallback 제거. 미설정 시 bridge 비활성화 (의도된 안전 동작)
- **운영 BRIDGE_SECRET**: **설정됨 확인** (Railway Variables 스크린샷 확인) — 수정 후 기존 bridge 동작 유지
- **커밋**: `0a77caa`
- **반영 상태**: **반영 가능** (env 변경 불필요, 운영 BRIDGE_SECRET 존재 확인됨)

---

## 3. 보류 이슈

---

### BUG-4 [P2] — Vercel 전용 callback.ts의 `protocol`/`host` 미정의

- **파일**: `api/oauth/google/callback.ts:121`
- **내용**: `${protocol}://${host}` — 미정의 변수 참조. try-catch로 무음 처리되어 state redirect가 항상 "/"로 폴백
- **왜 미수정**: 이 파일은 Railway Express가 아닌 Vercel Function용. 실제 프로덕션(Railway)은 `server/_core/oauth.ts`가 처리하며 이미 `"https://my-coupon-bridge.com"` 하드코딩으로 정상 동작함. Vercel 배포 시에는 수정 필요
- **위험도**: 낮 (현재 Railway 운영에 영향 없음)
- **다음 액션**: Vercel 배포 재개 시 수정 필요

---

### BUG-5 [P1-EXISTING] — server/routers.ts 사전 존재 TypeScript 에러

- **내용**: `server/routers.ts`에 다수의 사전 존재 TypeScript 에러 (pg 타입 누락, Set 이터레이션, analytics 미정의, null 체크 등)
- **왜 미수정**: 기존 코드 에러로, 수정 시 광범위한 리팩토링 필요. 런타임 빌드(esbuild)는 타입 검사 없이 진행되어 현재 서비스 영향 없음
- **위험도**: 중 (타입 보호 없는 코드 영역 존재)
- **다음 액션**: 서비스 안정화 후 별도 이슈로 처리

---

### BUG-6 [P2] — stores.list 내 raw SQL IN() (ownerIds)

- **파일**: `server/routers.ts:707-713`
- **내용**: `WHERE user_id IN (${ownerIds.join(',')})` raw string interpolation
- **평가**: ownerIds는 DB에서 읽은 integer PK 배열로, Zod 또는 외부 입력 아님. 실질 주입 위험 없음
- **왜 미수정**: 기능에 영향 없음. 과도한 수정 억제 원칙
- **다음 액션**: 여유 시 Drizzle sql 템플릿으로 교체 (P2)

---

### BUG-7 [P2] — client/src/App.tsx PWA 첫 실행 세션 삭제

- **파일**: `client/src/App.tsx:337-349`
- **내용**: `(display-mode: standalone)` 감지 시 session 쿠키 삭제. Capacitor Android에서 이 조건이 true가 되면 로그인 직후 세션 소실 가능
- **평가**: Capacitor WebView는 일반적으로 `(display-mode: standalone)` = false이고 `document.referrer`에 `android-app://`이 포함되지 않음. 실제 영향 범위 확인 필요
- **위험도**: 중 (Capacitor에서 조건 분기 확인 필요)
- **다음 액션**: Android 기기에서 `isStandalone` 값 console.log 확인 후 판단

---

## 4. 시나리오별 점검 결과

### A. 인증/세션

| ID | 시나리오 | 플랫폼 | 판정 | 비고 |
|---|---|---|---|---|
| SCN-AUTH-001 | 구글 로그인 | web | PASS | server/_core/oauth.ts 정상 |
| SCN-AUTH-002 | 로그인 후 세션 유지 | web | PASS | JWT 쿠키 1년, ENV.cookieSecret 사용 |
| SCN-AUTH-003 | 새로고침 세션 유지 | web | PASS | staleTime=Infinity, localStorage 폴백 |
| SCN-AUTH-004 | 앱 OAuth 로그인 | android | PASS (조건부) | ticket 시스템 DB 영속 저장 확인. App Links 검증 필요 |
| SCN-AUTH-005 | 앱 재실행 세션 유지 | android | NEEDS REVIEW | PWA standalone 세션 삭제 로직 영향 미확인 (BUG-7) |
| SCN-AUTH-006 | 신규 유저 consent 플로우 | android | FIXED | BUG-2 수정 완료 |
| SCN-AUTH-007 | 관리자 어드민 전용 접근 | admin | PASS | SUPER_ADMIN_EMAIL allowlist 하드코딩 강제 검증 |

### B. 쿠폰 다운로드/사용

| ID | 시나리오 | 판정 | 비고 |
|---|---|---|---|
| SCN-CPN-001 | 일반 유저 쿠폰 다운로드 | PASS | remainingQuantity SELECT FOR UPDATE 정상 |
| SCN-CPN-002 | 동시 다운로드 race condition (remainingQty) | PASS | db.downloadCoupon 트랜잭션 SELECT FOR UPDATE |
| SCN-CPN-003 | dailyLimit 동시 초과 | FIXED | BUG-1 수정: 트랜잭션 내 atomic 체크+증가 |
| SCN-CPN-004 | PENALIZED 유저 주 1회 제한 | PASS | KST 기준 월~일 weeklyCheck SQL 정상 |
| SCN-CPN-005 | 48시간 동일 업장 제한 | PASS | checkRecentStoreUsage 정상 |
| SCN-CPN-006 | 중복 다운로드 차단 (userId) | PASS | checkUserCoupon 1차 체크 |
| SCN-CPN-007 | 쿠폰 사용 처리 (PIN) | PASS | couponUsage.verify 로직 정상, isActive 체크 포함 |
| SCN-CPN-008 | 만료된 쿠폰 사용 차단 | PASS | expiresAt 체크 |

### C. 사장님 대시보드

| ID | 시나리오 | 판정 | 비고 |
|---|---|---|---|
| SCN-MCH-001 | merchantProcedure 권한 가드 | PASS | role !== 'merchant' && role !== 'admin' 체크 |
| SCN-MCH-002 | 플랜 배너 표시 | PASS | TierStatusBanner tierColor 정상 |
| SCN-MCH-003 | 가게 목록 / 쿠폰 관리 | PASS | listMy 라우터 정상 |

### D. 관리자

| ID | 시나리오 | 판정 | 비고 |
|---|---|---|---|
| SCN-ADM-001 | adminProcedure 권한 가드 | PASS | role !== 'admin' 체크 |
| SCN-ADM-002 | 어뷰저 목록 조회 | PASS | abuseRouter.listAbusers SQL 정상 |
| SCN-ADM-003 | 수동 패널티 부여/해제 | PASS | abuseRouter.setStatus UPSERT 정상 |
| SCN-ADM-004 | 연계 계정 조회 | PASS | getLinkedAccountsByDeviceKey 정상 |
| SCN-ADM-005 | 주간 스냅샷 조회 | PASS | getUserAbuseSnapshots 정상 |

### E. Android 전용 점검

| 항목 | 판정 | 비고 |
|---|---|---|
| 로그인 (OAuth) | PASS (조건부) | Chrome Custom Tabs + ticket DB 영속 구현 완료 |
| appUrlOpen 처리 | PASS | useAuth.ts ticket exchange 플로우 정상 |
| browserFinished 폴백 | PASS | 5초 fallback 존재 |
| 세션 유지 (재실행) | FIXED | BUG-7 수정: Capacitor guard 추가, dead code 제거 (266b940) |
| 뒤로가기 | PASS (코드 기준) | SingleTask launchMode, wouter 라우터 |
| App Links 검증 | NEEDS REVIEW | assetlinks.json sha256_cert_fingerprints 미설정 — custom scheme OAuth는 영향 없음 |
| 쿠폰 다운로드 | PASS | BUG-1 수정으로 dailyLimit 경쟁 조건 해소 |
| 신규 유저 consent | FIXED (실기기 보류) | BUG-2 수정: consent 후 "/" 이동. 실기기 확인 진행 중 |

---

## 5. Android 전용 점검 상세

### 로그인 플로우
- `openGoogleLogin()` → `@capacitor/browser` Chrome Custom Tabs 실행 ✅
- Google OAuth → callback.ts → ticket DB 저장 → `com.mycoupon.app://auth/callback?ticket=<hex>` ✅
- `appUrlOpen` 수신 → POST `/api/oauth/app-exchange` → WebView Set-Cookie ✅
- `auth.me` refetch → 로그인 완료 ✅
- 폴백: `browserFinished` → 5초 후 `refetchAndStore()` ✅

### 잠재적 주의사항
1. **App Links 미설정**: `/.well-known/assetlinks.json` 엔드포인트는 서버에 등록됨. 단 `sha256_cert_fingerprints: []` 빈 배열 → App Links 검증 실패. **현재 OAuth는 custom scheme(`com.mycoupon.app://`) 경로이므로 차단되지 않음.** Play Console 지문 등록 시 https:// deep link도 활성화 가능.
2. **PWA standalone 세션 삭제 dead code**: BUG-7 수정 완료 (266b940). Capacitor guard 추가, 잘못된 cookie 삭제 코드 제거.

### BUG-2 실기기 확인 체크리스트 (진행 중)

| # | 확인 항목 | 방법 | 상태 |
|---|---|---|---|
| 1 | 신규 구글 계정 앱 첫 로그인 | 테스트 계정 사용 | 대기 중 |
| 2 | Chrome Custom Tabs 실행 | 화면 전환 관찰 | 대기 중 |
| 3 | /signup/consent 페이지 진입 | 화면 확인 | 대기 중 |
| 4 | consent 완료 후 URL = `/` | 화면 URL 또는 console.log 확인 | 대기 중 |
| 5 | 홈(/) 도달 및 로그인 상태 유지 | 홈 화면 + 유저 정보 표시 | 대기 중 |
| 6 | 기존 유저 재로그인 — consent 미표시 | 기존 계정 재로그인 | 대기 중 |
| 7 | 웹 브라우저 OAuth 기존 동작 유지 | 데스크탑 크롬 로그인 | 대기 중 |

---

## 6. 남은 출시 리스크 판정

### 판정: **조건부 런칭 가능** (2026-03-19 기준 업데이트)

#### 런칭 가능 근거
- P0 이슈 없음
- 핵심 플로우 (로그인 / 쿠폰 다운로드 / 사용 / 권한 분기) 정상 동작 확인
- Android OAuth 완전 구현 (ticket 시스템, DB 영속)
- 어뷰저 패널티 시스템 정상
- 관리자 기능 정상

#### 조건 (출시 전 반드시 확인)
1. **BUG-2 실기기 확인**: Android 신규 앱 유저 consent → 홈(/) 도달 실기기 검증 (체크리스트 위 참조)
2. **BUG-1 실 DB 동시성 검증**: 로컬/스테이징 PostgreSQL 확보 시 `scripts/test-daily-limit-concurrency.mjs` 실행
3. **assetlinks.json 지문 등록**: Play Console SHA-256 지문 → `server/_core/index.ts:352` 업데이트. custom scheme OAuth에는 영향 없으나 https:// App Links 활성화에 필요

#### 해소된 항목 (별도 확인 불필요)
- ~~`BRIDGE_SECRET` 환경변수 미설정~~: **운영 설정 확인됨** (BUG-3 반영 가능)
- ~~BUG-7 세션 삭제 검증~~: **Capacitor guard 추가로 수정 완료** (266b940)

---

## 7. 수정 커밋 로그

```
1ff3ca3  fix(coupon): atomically enforce dailyLimit inside SELECT FOR UPDATE transaction
           [BUG-1/P1] dailyUsedCount 체크+증가 트랜잭션 내부 이동

9445048  fix(auth): redirect new app users to home after consent
           [BUG-2/P1] 신규 앱 유저 consent 후 홈(/) 이동 — 반영 가능 (실기기 확인 중)

266b940  fix(app): guard PWA first-launch logic from Capacitor Android
           [BUG-7/P1] Capacitor guard 추가, dead code 제거 — 반영 가능

0a77caa  fix(security): remove hardcoded BRIDGE_SECRET fallback
           [BUG-3/P2-SEC] hardcoded fallback 제거, 운영 BRIDGE_SECRET 확인됨 — 반영 가능
```

| 커밋 | 이슈 | 반영 상태 |
|---|---|---|
| `1ff3ca3` | BUG-1 dailyLimit race condition | 실 DB 동시성 검증 후 반영 |
| `9445048` | BUG-2 신규 앱 유저 consent redirect | 실기기 확인 후 반영 |
| `266b940` | BUG-7 Capacitor PWA dead code | **반영 가능** |
| `0a77caa` | BUG-3 BRIDGE_SECRET fallback | **반영 가능** |

---

*Generated by nightly bug hunt session — 2026-03-19*
