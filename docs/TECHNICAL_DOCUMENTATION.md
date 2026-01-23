# 마이쿠폰 (MyCoupon) 기술 문서

**버전**: 1.0.0  
**최종 수정일**: 2025년 1월 14일  
**작성자**: Manus AI  
**프로덕션 URL**: https://mycoupon-bridge.com

---

## 1. 프로젝트 개요

마이쿠폰은 위치 기반 쿠폰 서비스 플랫폼으로, 소비자와 지역 상점을 연결하는 O2O(Online to Offline) 서비스입니다. 사용자는 현재 위치 주변의 상점에서 제공하는 쿠폰을 검색하고 다운로드하여 오프라인 매장에서 사용할 수 있습니다. 상점 운영자는 쿠폰을 발행하고 사용 현황을 실시간으로 모니터링할 수 있습니다.

### 1.1 핵심 기능

| 기능 영역 | 설명 |
|----------|------|
| **쿠폰 검색 및 다운로드** | GPS 기반 주변 상점 쿠폰 검색, 실시간 다운로드 |
| **쿠폰 사용** | PIN 코드 기반 쿠폰 검증 시스템 |
| **상점 관리** | 상점 등록, 쿠폰 발행, 사용 통계 조회 |
| **게이미피케이션** | 포인트 시스템, 레벨업, 뱃지, 미션 |
| **관리자 대시보드** | 전체 통계, 사용자 분석, 매출 리포트 |
| **PWA 지원** | Progressive Web App으로 모바일 앱 경험 제공 |

### 1.2 사용자 역할

시스템은 세 가지 사용자 역할을 지원합니다.

| 역할 | 권한 |
|------|------|
| **user** | 쿠폰 검색, 다운로드, 사용, 리뷰 작성 |
| **merchant** | 상점 관리, 쿠폰 발행, 사용 검증, 통계 조회 |
| **admin** | 전체 시스템 관리, 모든 상점/쿠폰 관리, 분석 리포트 |

---

## 2. 기술 스택

### 2.1 프론트엔드

| 기술 | 버전 | 용도 |
|------|------|------|
| React | 19.1.1 | UI 프레임워크 |
| TypeScript | 5.9.3 | 타입 안전성 |
| Tailwind CSS | 4.1.14 | 스타일링 |
| Vite | 7.1.7 | 빌드 도구 |
| Wouter | 3.3.5 | 클라이언트 라우팅 |
| TanStack Query | 5.90.2 | 서버 상태 관리 |
| tRPC Client | 11.6.0 | 타입 안전 API 호출 |
| Radix UI | - | 접근성 컴포넌트 |
| Lucide React | 0.453.0 | 아이콘 |
| Chart.js | 4.5.1 | 데이터 시각화 |
| Framer Motion | 12.23.22 | 애니메이션 |

### 2.2 백엔드

| 기술 | 버전 | 용도 |
|------|------|------|
| Node.js | 22.13.0 | 런타임 |
| Express | 4.21.2 | HTTP 서버 |
| tRPC Server | 11.6.0 | 타입 안전 API |
| Drizzle ORM | 0.44.5 | 데이터베이스 ORM |
| MySQL2 | 3.15.0 | 데이터베이스 드라이버 |
| Jose | 6.1.0 | JWT 인증 |
| Zod | 4.1.12 | 스키마 검증 |
| QRCode | 1.5.4 | QR 코드 생성 |
| Nodemailer | 7.0.11 | 이메일 발송 |
| Node-cron | 4.2.1 | 스케줄링 |

### 2.3 인프라

| 구성 요소 | 설명 |
|----------|------|
| **데이터베이스** | MySQL/TiDB (Manus 관리형) |
| **파일 저장소** | AWS S3 |
| **인증** | Manus OAuth + Google OAuth |
| **지도 서비스** | Google Maps API (Manus 프록시) |
| **호스팅** | Manus Platform |

---

## 3. 프로젝트 구조

```
local_recommendation_engine/
├── client/                     # 프론트엔드 소스
│   ├── public/                 # 정적 파일 (아이콘, manifest.json)
│   └── src/
│       ├── components/         # 재사용 컴포넌트
│       │   ├── ui/            # shadcn/ui 컴포넌트
│       │   ├── Map.tsx        # Google Maps 통합
│       │   ├── QRScanner.tsx  # QR 스캐너
│       │   └── ...
│       ├── pages/             # 페이지 컴포넌트
│       │   ├── Home.tsx       # 메인 랜딩 페이지
│       │   ├── MapPage.tsx    # 지도 기반 쿠폰 검색
│       │   ├── MyCoupons.tsx  # 내 쿠폰북
│       │   ├── AdminDashboard.tsx  # 관리자 대시보드
│       │   └── ...
│       ├── hooks/             # 커스텀 훅
│       ├── contexts/          # React Context
│       ├── lib/               # 유틸리티 함수
│       ├── App.tsx            # 라우트 설정
│       └── main.tsx           # 앱 진입점
├── server/                     # 백엔드 소스
│   ├── _core/                 # 프레임워크 코어 (수정 금지)
│   │   ├── context.ts         # tRPC 컨텍스트
│   │   ├── env.ts             # 환경 변수
│   │   ├── googleOAuth.ts     # Google OAuth 구현
│   │   ├── llm.ts             # LLM 통합
│   │   ├── map.ts             # Google Maps 프록시
│   │   └── ...
│   ├── routers.ts             # tRPC 라우터 정의
│   ├── db.ts                  # 데이터베이스 쿼리 헬퍼
│   ├── analytics.ts           # 분석 쿼리
│   ├── email.ts               # 이메일 서비스
│   └── storage.ts             # S3 파일 저장
├── drizzle/                    # 데이터베이스
│   ├── schema.ts              # 테이블 스키마 정의
│   └── *.sql                  # 마이그레이션 파일
├── shared/                     # 공유 코드
│   ├── const.ts               # 상수
│   ├── geoUtils.ts            # 거리 계산 유틸리티
│   └── version.ts             # 버전 관리
└── package.json
```

---

## 4. 데이터베이스 스키마

### 4.1 핵심 테이블

#### users (사용자)

| 컬럼 | 타입 | 설명 |
|------|------|------|
| id | INT | Primary Key, Auto Increment |
| openId | VARCHAR(64) | OAuth 고유 ID |
| name | TEXT | 사용자 이름 |
| email | VARCHAR(320) | 이메일 주소 |
| loginMethod | VARCHAR(64) | 로그인 방식 (google, manus) |
| role | ENUM | user, admin, merchant |
| ageGroup | ENUM | 10s, 20s, 30s, 40s, 50s |
| gender | ENUM | male, female, other |
| preferredDistrict | VARCHAR(50) | 선호 지역 |
| emailNotificationsEnabled | BOOLEAN | 이메일 알림 수신 여부 |
| createdAt | TIMESTAMP | 가입일 |
| lastSignedIn | TIMESTAMP | 마지막 로그인 |

#### stores (상점)

| 컬럼 | 타입 | 설명 |
|------|------|------|
| id | INT | Primary Key |
| ownerId | INT | 소유자 users.id |
| name | VARCHAR(255) | 상점명 |
| category | ENUM | cafe, restaurant, beauty, hospital, fitness, other |
| description | TEXT | 상점 설명 |
| address | TEXT | 주소 |
| latitude | VARCHAR(50) | 위도 |
| longitude | VARCHAR(50) | 경도 |
| phone | VARCHAR(20) | 전화번호 |
| district | VARCHAR(50) | 지역구 |
| imageUrl | TEXT | 이미지 URL (JSON 배열) |
| naverPlaceUrl | TEXT | 네이버 플레이스 링크 |
| rating | DECIMAL(2,1) | 별점 (1.0~5.0) |
| ratingCount | INT | 리뷰 수 |
| isActive | BOOLEAN | 활성화 상태 |

#### coupons (쿠폰)

| 컬럼 | 타입 | 설명 |
|------|------|------|
| id | INT | Primary Key |
| storeId | INT | 상점 ID (FK) |
| title | VARCHAR(255) | 쿠폰 제목 |
| description | TEXT | 쿠폰 설명 |
| discountType | ENUM | percentage, fixed, freebie |
| discountValue | INT | 할인 값 |
| minPurchase | INT | 최소 구매 금액 |
| maxDiscount | INT | 최대 할인 금액 |
| totalQuantity | INT | 총 발행 수량 |
| remainingQuantity | INT | 남은 수량 |
| startDate | TIMESTAMP | 시작일 |
| endDate | TIMESTAMP | 종료일 |
| isActive | BOOLEAN | 활성화 상태 |

#### user_coupons (사용자 쿠폰)

| 컬럼 | 타입 | 설명 |
|------|------|------|
| id | INT | Primary Key |
| userId | INT | 사용자 ID (FK) |
| couponId | INT | 쿠폰 ID (FK) |
| couponCode | VARCHAR(20) | 고유 쿠폰 코드 (CPN-YYYYMMDD-XXXXXX) |
| pinCode | VARCHAR(6) | 6자리 PIN 코드 |
| deviceId | VARCHAR(255) | 기기 ID (중복 방지) |
| status | ENUM | active, used, expired |
| downloadedAt | TIMESTAMP | 다운로드 시간 |
| usedAt | TIMESTAMP | 사용 시간 |
| expiresAt | TIMESTAMP | 만료 시간 |

### 4.2 게이미피케이션 테이블

#### user_stats (사용자 통계)

| 컬럼 | 타입 | 설명 |
|------|------|------|
| userId | INT | 사용자 ID (Unique) |
| points | INT | 포인트 |
| level | INT | 레벨 (1=브론즈, 2=실버, 3=골드, 4=다이아) |
| totalCouponsDownloaded | INT | 총 다운로드 수 |
| totalCouponsUsed | INT | 총 사용 수 |
| consecutiveCheckIns | INT | 연속 출석일 |
| referralCode | VARCHAR(20) | 초대 코드 |
| totalReferrals | INT | 추천 수 |

#### badges (뱃지)

| 컬럼 | 타입 | 설명 |
|------|------|------|
| id | INT | Primary Key |
| name | VARCHAR(100) | 뱃지 이름 |
| description | TEXT | 설명 |
| icon | VARCHAR(50) | 아이콘 |
| requirement | TEXT | 획득 조건 (JSON) |
| points | INT | 획득 시 포인트 |

#### missions (미션)

| 컬럼 | 타입 | 설명 |
|------|------|------|
| id | INT | Primary Key |
| type | ENUM | daily, weekly |
| title | VARCHAR(255) | 미션 제목 |
| requirement | TEXT | 조건 (JSON) |
| rewardPoints | INT | 보상 포인트 |

### 4.3 분석 및 모니터링 테이블

| 테이블 | 용도 |
|--------|------|
| coupon_usage | 쿠폰 사용 내역 |
| visits | 상점 방문 기록 |
| search_logs | 검색 로그 |
| session_logs | 세션 로그 (버전/브라우저 분포) |
| client_errors | 클라이언트 오류 수집 |
| install_funnel_events | PWA 설치 퍼널 추적 |
| email_logs | 이메일 발송 기록 |
| notifications | 푸시 알림 기록 |

### 4.4 운영 테이블

| 테이블 | 용도 |
|--------|------|
| app_versions | 앱 버전 관리 (강제 업데이트) |
| emergency_banners | 긴급 공지/차단 배너 |
| feature_flags | 기능 플래그 / 점진 롤아웃 |

---

## 5. API 명세

### 5.1 인증 API (auth)

| 엔드포인트 | 메서드 | 설명 | 권한 |
|-----------|--------|------|------|
| `auth.me` | Query | 현재 로그인 사용자 정보 | Public |
| `auth.logout` | Mutation | 로그아웃 | Public |
| `auth.devLogin` | Mutation | 개발용 로그인 (테스트 전용) | Public |

### 5.2 사용자 API (users)

| 엔드포인트 | 메서드 | 설명 | 권한 |
|-----------|--------|------|------|
| `users.updateProfile` | Mutation | 프로필 업데이트 (연령/성별/지역) | Protected |
| `users.getNotificationSettings` | Query | 알림 설정 조회 | Protected |
| `users.updateNotificationSettings` | Mutation | 알림 설정 업데이트 | Protected |

### 5.3 상점 API (stores)

| 엔드포인트 | 메서드 | 설명 | 권한 |
|-----------|--------|------|------|
| `stores.list` | Query | 상점 목록 (GPS 거리 포함) | Public |
| `stores.getById` | Query | 상점 상세 정보 | Public |
| `stores.create` | Mutation | 상점 등록 | Merchant |
| `stores.search` | Query | 상점 검색 (카테고리, 거리) | Public |
| `stores.nearby` | Query | 주변 상점 조회 | Public |

### 5.4 쿠폰 API (coupons)

| 엔드포인트 | 메서드 | 설명 | 권한 |
|-----------|--------|------|------|
| `coupons.listActive` | Query | 활성 쿠폰 목록 | Public |
| `coupons.listByStore` | Query | 상점별 쿠폰 목록 | Public |
| `coupons.download` | Mutation | 쿠폰 다운로드 | Protected |
| `coupons.myCoupons` | Query | 내 쿠폰 목록 | Protected |
| `coupons.markAsUsed` | Mutation | 쿠폰 사용 완료 처리 | Protected |
| `coupons.create` | Mutation | 쿠폰 생성 | Merchant |

### 5.5 쿠폰 사용 API (couponUsage)

| 엔드포인트 | 메서드 | 설명 | 권한 |
|-----------|--------|------|------|
| `couponUsage.preview` | Query | PIN 코드로 쿠폰 정보 미리보기 | Merchant |
| `couponUsage.verify` | Mutation | PIN 코드로 쿠폰 사용 처리 | Merchant |
| `couponUsage.listByStore` | Query | 상점별 사용 내역 | Merchant |

### 5.6 게이미피케이션 API (gamification)

| 엔드포인트 | 메서드 | 설명 | 권한 |
|-----------|--------|------|------|
| `gamification.stats` | Query | 사용자 통계 (포인트, 레벨) | Protected |
| `gamification.checkIn` | Mutation | 출석 체크 | Protected |
| `gamification.badges` | Query | 획득한 뱃지 목록 | Protected |
| `gamification.missions` | Query | 미션 목록 및 진행 상황 | Protected |
| `gamification.leaderboard` | Query | 리더보드 | Public |

### 5.7 분석 API (analytics)

| 엔드포인트 | 메서드 | 설명 | 권한 |
|-----------|--------|------|------|
| `analytics.overview` | Query | 전체 통계 개요 | Merchant |
| `analytics.storeStats` | Query | 상점별 통계 | Merchant |
| `analytics.storeDetails` | Query | 상점 상세 분석 | Merchant |
| `analytics.dailySignups` | Query | 일별 가입자 통계 | Admin |
| `analytics.dailyActiveUsers` | Query | DAU 통계 | Admin |
| `analytics.demographicDistribution` | Query | 연령/성별 분포 | Admin |
| `analytics.downloadHistory` | Query | 다운로드 내역 (엑셀용) | Merchant |
| `analytics.usageHistory` | Query | 사용 내역 (엑셀용) | Merchant |

### 5.8 관리자 API (admin)

| 엔드포인트 | 메서드 | 설명 | 권한 |
|-----------|--------|------|------|
| `admin.createStore` | Mutation | 상점 등록 (GPS 자동 변환) | Admin |
| `admin.updateStore` | Mutation | 상점 수정 | Admin |
| `admin.deleteStore` | Mutation | 상점 삭제 | Admin |
| `admin.createCoupon` | Mutation | 쿠폰 등록 | Admin |
| `admin.updateCoupon` | Mutation | 쿠폰 수정 | Admin |
| `admin.deleteCoupon` | Mutation | 쿠폰 삭제 | Admin |
| `admin.listStores` | Query | 전체 상점 목록 | Admin |
| `admin.listCoupons` | Query | 전체 쿠폰 목록 | Admin |
| `admin.updateStoreComment` | Mutation | 상점 한줄평 수정 | Admin |

---

## 6. 인증 시스템

### 6.1 OAuth 플로우

마이쿠폰은 두 가지 OAuth 인증 방식을 지원합니다.

#### Manus OAuth (기본)

```
1. 사용자 → /api/oauth/callback 리다이렉트
2. Manus OAuth 서버에서 인증
3. 콜백으로 JWT 토큰 수신
4. 세션 쿠키 설정
```

#### Google OAuth (직접 연동)

```
1. 사용자 → /api/oauth/google/login
2. Google OAuth 화면으로 리다이렉트
3. /api/oauth/google/callback에서 토큰 수신
4. 사용자 정보 조회 및 DB 저장
5. JWT 세션 쿠키 설정
```

### 6.2 세션 관리

세션은 JWT 토큰 기반으로 관리되며, HTTP-only 쿠키에 저장됩니다.

```typescript
// 세션 쿠키 옵션
{
  httpOnly: true,
  secure: true, // HTTPS 환경
  sameSite: 'lax',
  maxAge: 7 * 24 * 60 * 60 * 1000 // 7일
}
```

### 6.3 권한 검사

tRPC 미들웨어를 통해 권한을 검사합니다.

```typescript
// Protected Procedure (로그인 필수)
const protectedProcedure = publicProcedure.use(({ ctx, next }) => {
  if (!ctx.user) throw new TRPCError({ code: 'UNAUTHORIZED' });
  return next({ ctx });
});

// Merchant Procedure (사장님/관리자)
const merchantProcedure = protectedProcedure.use(({ ctx, next }) => {
  if (ctx.user.role !== 'merchant' && ctx.user.role !== 'admin') {
    throw new Error('Merchant access required');
  }
  return next({ ctx });
});
```

---

## 7. 핵심 비즈니스 로직

### 7.1 쿠폰 다운로드 프로세스

```
1. 쿠폰 유효성 검사 (수량, 만료일)
2. 48시간 재다운로드 제한 확인 (동일 상점)
3. 기기당 1회 제한 확인 (deviceId)
4. 고유 쿠폰 코드 생성 (CPN-YYYYMMDD-XXXXXX)
5. 6자리 PIN 코드 생성
6. QR 코드 생성 (레거시)
7. user_coupons 테이블에 저장
8. 남은 수량 감소
9. 사용자 통계 업데이트
```

### 7.2 쿠폰 사용 프로세스

#### 사용자 셀프 사용

```
1. 사용자가 "사용 완료" 버튼 클릭
2. 쿠폰 상태 확인 (active 상태만)
3. status를 'used'로 변경
4. coupon_usage 테이블에 기록
5. 사용자 통계 업데이트
```

#### 사장님 PIN 검증

```
1. 사장님이 PIN 코드 입력
2. 본인 상점 확인
3. 쿠폰 상태 확인
4. status를 'used'로 변경
5. coupon_usage 테이블에 기록 (verifiedBy 포함)
6. 사용자 통계 업데이트
```

### 7.3 거리 계산 (Haversine 공식)

```typescript
// shared/geoUtils.ts
export function calculateDistance(
  lat1: number, lon1: number,
  lat2: number, lon2: number
): number {
  const R = 6371e3; // 지구 반경 (미터)
  const φ1 = lat1 * Math.PI / 180;
  const φ2 = lat2 * Math.PI / 180;
  const Δφ = (lat2 - lat1) * Math.PI / 180;
  const Δλ = (lon2 - lon1) * Math.PI / 180;

  const a = Math.sin(Δφ/2) * Math.sin(Δφ/2) +
            Math.cos(φ1) * Math.cos(φ2) *
            Math.sin(Δλ/2) * Math.sin(Δλ/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));

  return R * c; // 미터 단위
}
```

---

## 8. PWA 구성

### 8.1 Service Worker

Service Worker는 Network-First 전략을 사용하여 항상 최신 콘텐츠를 제공합니다.

```javascript
// 캐시 전략
- API 요청: Network Only
- 정적 자산: Network First (캐시 폴백)
- 이미지: Cache First (네트워크 폴백)
```

### 8.2 manifest.json

```json
{
  "name": "마이쿠폰",
  "short_name": "마이쿠폰",
  "start_url": "/",
  "display": "standalone",
  "background_color": "#ffffff",
  "theme_color": "#f97316",
  "icons": [
    { "src": "/icon-192.png", "sizes": "192x192", "type": "image/png" },
    { "src": "/icon-512.png", "sizes": "512x512", "type": "image/png" }
  ]
}
```

### 8.3 설치 퍼널 추적

```typescript
// install_funnel_events 테이블
eventType: [
  'landing_view',        // 랜딩 페이지 조회
  'install_cta_view',    // 설치 CTA 노출
  'install_cta_click',   // 설치 CTA 클릭
  'appinstalled',        // 앱 설치 완료
  'first_open_standalone', // PWA 첫 실행
  'login_complete'       // 로그인 완료
]
```

---

## 9. 환경 변수

### 9.1 시스템 환경 변수 (자동 주입)

| 변수명 | 설명 |
|--------|------|
| DATABASE_URL | MySQL/TiDB 연결 문자열 |
| JWT_SECRET | 세션 쿠키 서명 키 |
| VITE_APP_ID | Manus OAuth 앱 ID |
| OAUTH_SERVER_URL | Manus OAuth 서버 URL |
| VITE_OAUTH_PORTAL_URL | Manus 로그인 포털 URL |
| OWNER_OPEN_ID | 소유자 OpenID |
| BUILT_IN_FORGE_API_URL | Manus 내장 API URL |
| BUILT_IN_FORGE_API_KEY | Manus 내장 API 키 |

### 9.2 커스텀 환경 변수

| 변수명 | 설명 |
|--------|------|
| GOOGLE_CLIENT_ID | Google OAuth 클라이언트 ID |
| GOOGLE_CLIENT_SECRET | Google OAuth 시크릿 |
| EMAIL_USER | 이메일 발송 계정 |
| EMAIL_PASS | 이메일 앱 비밀번호 |

---

## 10. 개발 가이드

### 10.1 로컬 개발 환경 설정

```bash
# 의존성 설치
pnpm install

# 개발 서버 실행
pnpm dev

# 데이터베이스 마이그레이션
pnpm db:push

# 테스트 실행
pnpm test

# 타입 체크
pnpm check
```

### 10.2 새 기능 추가 체크리스트

1. **스키마 수정**: `drizzle/schema.ts`에 테이블/컬럼 추가
2. **마이그레이션**: `pnpm db:push` 실행
3. **DB 헬퍼**: `server/db.ts`에 쿼리 함수 추가
4. **API 라우터**: `server/routers.ts`에 프로시저 추가
5. **프론트엔드**: `trpc.*.useQuery/useMutation` 사용
6. **테스트**: `server/*.test.ts`에 테스트 추가

### 10.3 코드 컨벤션

- **TypeScript**: 모든 코드에 타입 명시
- **tRPC**: REST API 대신 tRPC 사용
- **Zod**: 입력 검증에 Zod 스키마 사용
- **Tailwind**: 인라인 스타일 대신 Tailwind 클래스 사용
- **컴포넌트**: shadcn/ui 컴포넌트 우선 사용

---

## 11. 배포

### 11.1 빌드

```bash
# 프로덕션 빌드
pnpm build

# 빌드 결과물
dist/
├── index.js      # 서버 번들
└── client/       # 클라이언트 정적 파일
```

### 11.2 Manus 플랫폼 배포

1. 체크포인트 저장 (`webdev_save_checkpoint`)
2. Management UI에서 Publish 버튼 클릭
3. 커스텀 도메인 설정 (Settings > Domains)

### 11.3 Google OAuth 리디렉션 URI 설정

프로덕션 배포 시 Google Cloud Console에 다음 URI를 등록해야 합니다:

```
https://mycoupon-bridge.com/api/oauth/google/callback
```

---

## 12. 모니터링 및 로깅

### 12.1 클라이언트 오류 수집

```typescript
// client_errors 테이블에 자동 기록
- JavaScript 오류
- Promise 거부
- API 실패
- 네트워크 오류
```

### 12.2 세션 로그

```typescript
// session_logs 테이블
- 앱 버전
- 브라우저 정보
- PWA 여부
- 인앱 브라우저 여부
```

### 12.3 Health Check

```typescript
// GET /api/trpc/healthz
{
  status: 'ok',
  database: 'connected',
  version: '1.0.0',
  uptime: 12345
}
```

---

## 13. 보안 고려사항

### 13.1 인증 보안

- JWT 토큰은 HTTP-only 쿠키에 저장
- CSRF 보호를 위한 SameSite 쿠키 설정
- 세션 만료 시간 7일

### 13.2 입력 검증

- 모든 API 입력은 Zod 스키마로 검증
- SQL Injection 방지 (Drizzle ORM 사용)
- XSS 방지 (React 자동 이스케이프)

### 13.3 권한 검사

- 모든 민감한 작업에 권한 미들웨어 적용
- 상점 소유권 확인 (ownerId 검증)
- 역할 기반 접근 제어 (RBAC)

---

## 14. 알려진 제한사항

| 제한사항 | 설명 |
|----------|------|
| 쿠폰 재다운로드 | 동일 상점 쿠폰 사용 후 48시간 제한 |
| 기기당 다운로드 | 동일 쿠폰은 기기당 1회만 다운로드 가능 |
| 이미지 크롤링 | 네이버 플레이스 이미지만 지원 |
| 지도 API | Google Maps API만 지원 (Manus 프록시) |

---

## 15. 참고 자료

- [tRPC 공식 문서](https://trpc.io/docs)
- [Drizzle ORM 문서](https://orm.drizzle.team/docs/overview)
- [React 19 문서](https://react.dev)
- [Tailwind CSS 4 문서](https://tailwindcss.com/docs)
- [shadcn/ui 컴포넌트](https://ui.shadcn.com)

---

**문서 끝**
