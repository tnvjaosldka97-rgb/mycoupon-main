# MyCoupon E2E 테스트 가이드

## 프로젝트 스택 진단 결과

| 항목 | 내용 |
|------|------|
| **프론트** | React 19 + Vite 7 + TypeScript |
| **백엔드** | Express 4 + tRPC 11 + Node.js |
| **DB** | PostgreSQL + Drizzle ORM |
| **인증** | JWT 쿠키 (httpOnly, SameSite=lax, Secure=true) |
| **배포** | Railway (자동 GitHub 연동) |
| **API prefix** | `/api/trpc` (tRPC batch) |
| **마이그레이션** | 서버 시작 시 자동 실행 (index.ts) |

## 환경변수 목록

```env
DATABASE_URL=postgresql://...
OAUTH_SERVER_URL=https://my-coupon-bridge.com
NEXTAUTH_URL=https://my-coupon-bridge.com
MYCOUPON_SERVER_URL=https://my-coupon-bridge.com
```

---

## E2E 테스트 실행 방법

### 1. 의존성 설치

```bash
pnpm install
# Playwright 브라우저 설치 (최초 1회)
npx playwright install chromium webkit
```

### 2. 전체 테스트 실행 (모바일 + 데스크톱)

```bash
pnpm test:e2e
# 또는
npx playwright test
```

### 3. 모바일만 실행 (Pixel 7 + iPhone 13)

```bash
pnpm test:e2e:mobile
# 또는
npx playwright test --project="Mobile Chrome (Pixel 7)" --project="Mobile Safari (iPhone 13)"
```

### 4. 특정 spec만 실행

```bash
npx playwright test tests/e2e/mobile/01-pwa-manifest.spec.ts
npx playwright test tests/e2e/mobile/03-auth-security.spec.ts
```

### 5. 로컬 개발 서버 대상 테스트

```bash
BASE_URL=http://localhost:3000 npx playwright test
```

### 6. 리포트 확인

```bash
pnpm test:e2e:report
# 또는
npx playwright show-report
```

---

## 모바일 디바이스 프로파일

`playwright.config.ts`에 정의된 프로파일:

| 프로파일 | 디바이스 | 용도 |
|----------|---------|------|
| `Mobile Chrome (Pixel 7)` | Pixel 7, Chrome | Android PWA 주요 테스트 |
| `Mobile Safari (iPhone 13)` | iPhone 13, Safari | iOS PWA, safe-area, 홈화면 추가 |
| `Desktop Chrome` | 1280×720 | 관리자 대시보드 |
| `Mobile Chrome Slow 3G` | Pixel 7 | 느린 네트워크 시뮬레이션 |

---

## 테스트 파일 목록

| 파일 | 커버리지 | TC 수 |
|------|---------|-------|
| `01-pwa-manifest.spec.ts` | PWA 매니페스트, iOS 아이콘, 서비스워커 | 10 |
| `02-homepage.spec.ts` | 홈 렌더링, 네비게이션, 보안 기본 | 8 |
| `03-auth-security.spec.ts` | 인증/권한/IDOR/XSS | 7 |
| `04-coupons.spec.ts` | 쿠폰 목록/지도/API 차단 | 7 |
| `05-mobile-ux.spec.ts` | safe-area, 스크롤, 에러처리, 중복클릭 | 10 |
| `06-subscription-packs.spec.ts` | 구독팩 API 보안 | 5 |
| **합계** | | **47개** |

---

## iOS PWA 홈화면 추가 수동 체크리스트

자동화 불가 항목 — iOS Simulator 또는 실기기에서 직접 확인:

- [ ] Safari에서 `https://my-coupon-bridge.com` 접속
- [ ] 공유 → "홈 화면에 추가" 탭
- [ ] 앱 이름이 "마이쿠폰"으로 표시되는지 확인 (`apple-mobile-web-app-title`)
- [ ] 아이콘이 `/apple-touch-icon-v2.png` 이미지로 표시되는지 확인
- [ ] 홈화면에서 앱 실행 → 주소바 없는 standalone 모드로 시작되는지
- [ ] 재실행 시 로그인 세션 유지되는지 (쿠키 `httpOnly` + `secure` 설정 확인)
- [ ] 오프라인 상태에서 실행 → 적절한 안내 화면 표시되는지

---

## Railway 배포 후 확인 체크리스트

```bash
# 1. 배포 완료 확인
# Railway 대시보드 → 최신 커밋 Deployment successful

# 2. DB 마이그레이션 확인 (Railway 로그에서)
# ✅ [Migration] subscription plan tables ready

# 3. E2E 테스트 재실행
pnpm test:e2e

# 4. 주요 경로 수동 확인
# - / : 홈 정상 렌더링
# - /map : 쿠폰 지도 로드
# - /merchant/dashboard : 사장님 대시보드 구독팩 탭
# - /admin : 어드민 발주요청/계급 관리 탭
```

---

## 알려진 제한사항

1. **로그인 필요 플로우 미커버**: tRPC 쿠키 기반 인증이라 Playwright에서 세션 주입이 복잡함. 테스트 계정 제공 시 추가 가능.
2. **실기기 safe-area 검증**: 브라우저 에뮬레이션에서 `env(safe-area-inset-*)` = 0px이라 수치 검증 불가. 실기기/Simulator 필요.
3. **Google OAuth 플로우**: 외부 OAuth 리다이렉트는 Playwright에서 자동화 어려움.
