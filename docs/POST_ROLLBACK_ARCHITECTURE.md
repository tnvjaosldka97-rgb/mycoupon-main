# 마이쿠폰 롤백 이후 핵심 구현 사항 및 아키텍처 명세서

**작성일**: 2025년 1월 23일  
**작성자**: Manus AI  
**버전**: 15c6344d

---

## 1. 인증 및 권한 (Auth & Security)

### 1.1 Google OAuth 클라이언트 설정

#### 클라이언트 ID 오타 수정 내역

| 항목 | 수정 전 | 수정 후 |
|------|---------|---------|
| GOOGLE_CLIENT_ID | `818978356640-6j20tt09ci7i9avhrap6dq9lc0mdfltn.apps.googleusercontent.com` | `818978356640-6j20t09ci7i9avhrap6dq9lc0mdfltn.apps.googleusercontent.com` |
| 오타 위치 | `6j20tt09` (t가 2개) | `6j20t09` (t가 1개) |

#### 프로덕션 리디렉션 URI

Google Cloud Console에 등록해야 하는 정확한 리디렉션 URI:

```
https://my-coupon-bridge.com/api/oauth/google/callback
```

**파일 위치**: `server/_core/oauth.ts` (라인 27, 60)

```typescript
// 프로덕션 URL로 강제 고정 (Google Cloud Console에 등록된 URI와 일치)
const redirectUri = "https://my-coupon-bridge.com/api/oauth/google/callback";
```

### 1.2 관리자 권한 강제 주입 로직

#### 마스터 관리자 계정 목록

| 이메일 | 권한 | 설명 |
|--------|------|------|
| `tnvjaosldka97@gmail.com` | admin | 프로젝트 소유자 |
| `sakuradaezun@gmail.com` | admin | 추가 관리자 |

#### 백엔드 구현 (server/_core/context.ts)

```typescript
// 비상 마스터 관리자 이메일 목록 (하드코딩)
const MASTER_ADMIN_EMAILS = ['tnvjaosldka97@gmail.com', 'sakuradaezun@gmail.com'];

export async function createContext(
  opts: CreateExpressContextOptions
): Promise<TrpcContext> {
  let user: User | null = null;
  let isAdmin = false;

  try {
    user = await sdk.authenticateRequest(opts.req);
    
    // 비상 관리자 권한 주입: DB 상태나 세션에 관계없이 무조건 admin 권한 부여
    if (user && user.email && MASTER_ADMIN_EMAILS.includes(user.email)) {
      user.role = 'admin';
      isAdmin = true;
      console.log(`[Auth] ⚡ EMERGENCY ADMIN: ${user.email} - role forced to admin`);
    }
  } catch (error) {
    user = null;
  }

  return { req: opts.req, res: opts.res, user, isAdmin };
}
```

#### 프론트엔드 구현 (client/src/hooks/useAuth.ts)

```typescript
// 비상 마스터 관리자 이메일 (하드코딩)
const MASTER_ADMIN_EMAILS = ['tnvjaosldka97@gmail.com', 'sakuradaezun@gmail.com'];

const state = useMemo(() => {
  let currentUser = meQuery.data;
  
  // 비상 관리자 권한 주입: DB 상태나 세션에 관계없이 무조건 admin 권한 부여
  if (currentUser && currentUser.email && MASTER_ADMIN_EMAILS.includes(currentUser.email)) {
    currentUser = {
      ...currentUser,
      role: 'admin' as const,
    };
    console.log('[Auth] ⚡ EMERGENCY ADMIN: 프론트엔드에서 admin 권한 강제 적용');
  }
  
  // isAdmin 플래그 계산
  const isAdmin = currentUser ? (
    currentUser.role === 'admin' || 
    MASTER_ADMIN_EMAILS.includes(currentUser.email || '')
  ) : false;
  
  return {
    user: currentUser ?? null,
    loading: meQuery.isLoading || logoutMutation.isPending,
    error: meQuery.error ?? logoutMutation.error ?? null,
    isAuthenticated: Boolean(currentUser),
    isAdmin, // 비상 관리자 플래그 추가
  };
}, [meQuery.data, meQuery.error, meQuery.isLoading, logoutMutation.error, logoutMutation.isPending]);
```

---

## 2. 위치 기반 서비스 UX (Location UX)

### 2.1 useGeolocation 훅 작동 원리

**파일 위치**: `client/src/hooks/useGeolocation.ts`

#### 즉시 요청 금지 로직

페이지 로드 시 위치 권한을 즉시 요청하지 않고, 사용자가 "내 위치" 버튼을 클릭할 때만 권한을 요청합니다.

```typescript
// 위치 요청 함수 (사용자가 버튼 클릭 시에만 호출)
const requestLocation = useCallback(async () => {
  if (!navigator.geolocation) {
    setState(prev => ({
      ...prev,
      permissionStatus: 'unavailable',
      error: '브라우저가 위치 정보를 지원하지 않습니다.',
      isUsingDefaultLocation: true,
    }));
    return;
  }

  // 먼저 권한 상태 확인
  const currentPermission = await checkPermission();
  
  if (currentPermission === 'denied') {
    setState(prev => ({
      ...prev,
      permissionStatus: 'denied',
      error: '위치 권한이 거부되었습니다. 브라우저 설정에서 위치 권한을 허용해주세요.',
      isUsingDefaultLocation: true,
    }));
    return;
  }

  setState(prev => ({ ...prev, isLoading: true, error: null }));
  // ... 실제 위치 요청
}, [checkPermission]);
```

### 2.2 Permissions API를 통한 권한 체크

```typescript
// Permissions API로 현재 권한 상태 확인
const checkPermission = useCallback(async (): Promise<PermissionStatus> => {
  if (!navigator.geolocation) {
    return 'unavailable';
  }

  try {
    // Permissions API 지원 여부 확인
    if (navigator.permissions && navigator.permissions.query) {
      const result = await navigator.permissions.query({ name: 'geolocation' });
      return result.state as PermissionStatus;
    }
    // Permissions API를 지원하지 않는 경우 'prompt'로 가정
    return 'prompt';
  } catch (error) {
    console.warn('[Geolocation] Permissions API 오류:', error);
    return 'prompt';
  }
}, []);
```

#### 권한 상태 타입

```typescript
export type PermissionStatus = 'prompt' | 'granted' | 'denied' | 'unavailable';
```

### 2.3 IP 기반 Fallback 위치 처리

#### 한국 주요 도시 위치 데이터

```typescript
const KOREA_CITY_LOCATIONS: Record<string, { lat: number; lng: number; name: string }> = {
  'Seoul': { lat: 37.5665, lng: 126.9780, name: '서울' },
  'Busan': { lat: 35.1796, lng: 129.0756, name: '부산' },
  'Incheon': { lat: 37.4563, lng: 126.7052, name: '인천' },
  'Daegu': { lat: 35.8714, lng: 128.6014, name: '대구' },
  'Daejeon': { lat: 36.3504, lng: 127.3845, name: '대전' },
  'Gwangju': { lat: 35.1595, lng: 126.8526, name: '광주' },
  'Ulsan': { lat: 35.5384, lng: 129.3114, name: '울산' },
  'Sejong': { lat: 36.4800, lng: 127.2890, name: '세종' },
};
```

#### IP 기반 위치 추정 함수

```typescript
// IP 기반 대략적인 위치 추정 (무료 API 사용)
async function getIPBasedLocation(): Promise<{ lat: number; lng: number; city: string } | null> {
  try {
    // ip-api.com 무료 API 사용 (비상업적 용도 무료)
    const response = await fetch('http://ip-api.com/json/?fields=status,city,lat,lon', {
      signal: AbortSignal.timeout(3000), // 3초 타임아웃
    });
    
    if (!response.ok) return null;
    
    const data = await response.json();
    
    if (data.status === 'success' && data.lat && data.lon) {
      console.log('[Geolocation] IP 기반 위치 추정 성공:', data.city);
      return {
        lat: data.lat,
        lng: data.lon,
        city: data.city || '알 수 없음',
      };
    }
    
    return null;
  } catch (error) {
    console.warn('[Geolocation] IP 기반 위치 추정 실패:', error);
    return null;
  }
}
```

#### 브라우저별 권한 설정 안내

```typescript
export function getPermissionDeniedMessage(): string {
  const isChrome = /Chrome/.test(navigator.userAgent) && !/Edge/.test(navigator.userAgent);
  const isSafari = /Safari/.test(navigator.userAgent) && !/Chrome/.test(navigator.userAgent);
  const isFirefox = /Firefox/.test(navigator.userAgent);

  if (isChrome) {
    return '주소창 왼쪽의 자물쇠(🔒) 아이콘을 클릭 → "사이트 설정" → "위치"를 "허용"으로 변경해주세요.';
  } else if (isSafari) {
    return 'Safari 설정 → 웹사이트 → 위치에서 이 사이트의 위치 접근을 허용해주세요.';
  } else if (isFirefox) {
    return '주소창 왼쪽의 아이콘을 클릭 → "권한" → "위치 접근"을 허용해주세요.';
  }
  
  return '브라우저 설정에서 이 사이트의 위치 접근 권한을 허용해주세요.';
}
```

---

## 3. 브릿지 서버 연동 (Bridge Integration)

### 3.1 /api/awake 엔드포인트

**파일 위치**: `server/_core/index.ts` (라인 72-120)

#### Deep Awake 구현 방식

```typescript
// Deep Awake 엔드포인트 - Railway 브릿지 서버에서 서버 깨우기
// DB Connection Pool까지 즉시 활성화
app.get("/api/awake", async (req, res) => {
  const startTime = Date.now();
  const bridgeSecret = req.headers['x-bridge-secret'];
  const expectedSecret = process.env.BRIDGE_SECRET || 'my-coupon-bridge-secret-2025';
  
  // 보안 인증 (선택적 - Secret이 없으면 기본 응답)
  const isAuthenticated = bridgeSecret === expectedSecret;
  
  try {
    // DB Connection Pool 활성화 (SELECT 1 쿼리 실행)
    const { getDb } = await import("../db");
    const db = await getDb();
    if (!db) {
      throw new Error('DB connection failed');
    }
    const dbStartTime = Date.now();
    await db.execute('SELECT 1 as awake_check');
    const dbLatency = Date.now() - dbStartTime;
    
    const totalLatency = Date.now() - startTime;
    
    console.log(`[Awake] 서버 깨우기 성공 - DB: ${dbLatency}ms, Total: ${totalLatency}ms, Auth: ${isAuthenticated}`);
    
    res.json({
      status: "awake",
      message: "마이쿠폰 서버가 활성화되었습니다.",
      authenticated: isAuthenticated,
      dbConnectionActive: true,
      latency: {
        db: dbLatency,
        total: totalLatency,
      },
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
      version: process.env.VITE_APP_VERSION || "unknown",
    });
  } catch (error) {
    // 에러 처리
  }
});
```

#### 응답 형식

```json
{
  "status": "awake",
  "message": "마이쿠폰 서버가 활성화되었습니다.",
  "authenticated": true,
  "dbConnectionActive": true,
  "latency": {
    "db": 5,
    "total": 12
  },
  "uptime": 3600.123,
  "timestamp": "2025-01-23T10:30:00.000Z",
  "version": "v2025012303361"
}
```

### 3.2 Webhook 발송 시스템

**파일 위치**: `server/webhook.ts`

#### X-Bridge-Secret 보안 헤더

```typescript
const BRIDGE_SECRET = process.env.BRIDGE_SECRET || 'my-coupon-bridge-secret-2025';

export async function sendWebhook(
  event: WebhookEventType,
  data: Record<string, unknown>,
  userId?: string | number
): Promise<{ success: boolean; error?: string }> {
  const payload: WebhookPayload = {
    appId: 'mycoupon',
    event,
    userId,
    timestamp: new Date().toISOString(),
    data,
  };

  try {
    const response = await fetch(`${BRIDGE_SERVER_URL}/api/bridge/webhook`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Bridge-Secret': BRIDGE_SECRET,  // 보안 헤더
      },
      body: JSON.stringify(payload),
    });
    // ...
  } catch (error) {
    // ...
  }
}
```

#### Webhook 페이로드 규격

```typescript
export interface WebhookPayload {
  appId: string;           // 항상 'mycoupon'
  event: WebhookEventType; // 이벤트 타입
  userId?: string | number; // 대상 사용자 ID (선택)
  timestamp: string;       // ISO 8601 형식
  data: Record<string, unknown>; // 이벤트별 데이터
}
```

#### 지원 이벤트 타입

| 이벤트 | 설명 | 트리거 시점 |
|--------|------|-------------|
| `coupon.created` | 신규 쿠폰 등록 | 관리자가 쿠폰 생성 시 |
| `coupon.expiring` | 쿠폰 마감 임박 | 만료 24시간 전 |
| `coupon.downloaded` | 쿠폰 다운로드 | 사용자가 쿠폰 다운로드 시 |
| `coupon.used` | 쿠폰 사용 완료 | 쿠폰 사용 처리 시 |
| `user.levelup` | 유저 레벨업 | 포인트 적립으로 레벨업 시 |
| `user.signup` | 신규 가입 | 회원가입 완료 시 |
| `store.created` | 신규 업장 등록 | 업장 등록 승인 시 |
| `notification.nearby` | 근처 쿠폰 알림 | 거리 기반 알림 시 |
| `system.awake` | 시스템 깨우기 | 서버 활성화 시 |

#### 거리 기반 유저 필터링

```typescript
// 거리 기반 알림 대상 범위
export type NotificationRadius = 100 | 200 | 500; // meters

// Haversine 공식으로 두 지점 간 거리 계산 (미터 단위)
export function calculateDistance(
  lat1: number, lng1: number,
  lat2: number, lng2: number
): number {
  const R = 6371000; // 지구 반지름 (미터)
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
    Math.sin(dLng / 2) * Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

// 특정 반경 내 유저 필터링
export function filterUsersByRadius(
  storeLocation: { lat: number; lng: number },
  users: Array<{ id: number | string; lat: number; lng: number }>,
  radiusMeters: NotificationRadius
): Array<{ id: number | string; distance: number }> {
  return users
    .map(user => ({
      id: user.id,
      distance: calculateDistance(
        storeLocation.lat, storeLocation.lng,
        user.lat, user.lng
      ),
    }))
    .filter(user => user.distance <= radiusMeters)
    .sort((a, b) => a.distance - b.distance);
}
```

### 3.3 보안 인증 미들웨어

**파일 위치**: `server/bridgeAuth.ts`

```typescript
const BRIDGE_SECRET = process.env.BRIDGE_SECRET || 'my-coupon-bridge-secret-2025';

// X-Bridge-Secret 헤더 검증 미들웨어
export function validateBridgeSecret(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const bridgeSecret = req.headers['x-bridge-secret'];

  if (!bridgeSecret) {
    console.warn('[BridgeAuth] X-Bridge-Secret 헤더 누락');
    res.status(401).json({
      error: 'Unauthorized',
      message: 'X-Bridge-Secret header is required',
    });
    return;
  }

  if (bridgeSecret !== BRIDGE_SECRET) {
    console.warn('[BridgeAuth] 잘못된 X-Bridge-Secret');
    res.status(403).json({
      error: 'Forbidden',
      message: 'Invalid X-Bridge-Secret',
    });
    return;
  }

  console.log('[BridgeAuth] 인증 성공');
  next();
}
```

---

## 4. 성능 최적화 (Optimization)

### 4.1 이미지 레이지 로딩

#### 적용된 주요 컴포넌트

| 컴포넌트 | 파일 위치 | 적용 방식 |
|----------|-----------|-----------|
| CouponCard | `client/src/components/CouponCard.tsx` | `loading="lazy"` 속성 |
| StoreCard | `client/src/components/StoreCard.tsx` | `loading="lazy"` 속성 |
| MapPage 마커 | `client/src/pages/MapPage.tsx` | 뷰포트 내 마커만 렌더링 |
| 홈페이지 배너 | `client/src/pages/Home.tsx` | Intersection Observer |

### 4.2 API 캐싱

#### tRPC Query 캐싱 설정

```typescript
// useAuth 훅의 캐싱 설정
const meQuery = trpc.auth.me.useQuery(undefined, {
  retry: 1,                    // 1회 재시도
  refetchOnWindowFocus: false, // 포커스 시 refetch 비활성화
  refetchOnMount: false,       // 마운트 시 refetch 비활성화
  staleTime: 30 * 1000,        // 30초간 데이터를 신선하게 유지
  gcTime: 5 * 60 * 1000,       // 5분간 캐시 유지
});
```

#### 캐싱이 적용된 주요 API

| API | staleTime | gcTime | 설명 |
|-----|-----------|--------|------|
| `auth.me` | 30초 | 5분 | 사용자 인증 정보 |
| `coupons.nearby` | 1분 | 5분 | 근처 쿠폰 목록 |
| `stores.list` | 2분 | 10분 | 업장 목록 |
| `notifications.count` | 30초 | 2분 | 알림 개수 |

### 4.3 DB Connection Pool 최적화

```typescript
// 서버 시작 시 DB 연결 풀 미리 생성 (Warm-up)
const dbWarmupStart = Date.now();
try {
  const { getDb } = await import("../db");
  await getDb();
  console.log(`[Cold Start Measurement] DB connection pool warmed up in ${Date.now() - dbWarmupStart}ms`);
} catch (error) {
  console.error('[Cold Start Measurement] DB warm-up failed:', error);
}
```

---

## 5. 환경 변수 설정

### 5.1 마이쿠폰 서버 (.env)

```bash
# Google OAuth
GOOGLE_CLIENT_ID=818978356640-6j20t09ci7i9avhrap6dq9lc0mdfltn.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=your-google-client-secret

# Railway 브릿지 연동
BRIDGE_SECRET=my-coupon-bridge-secret-2025
BRIDGE_SERVER_URL=https://your-railway-url.railway.app

# 프론트엔드 (선택)
VITE_BRIDGE_SERVER_URL=https://your-railway-url.railway.app
```

### 5.2 Railway 서버 (.env)

```bash
# 마이쿠폰 서버 연동
BRIDGE_SECRET=my-coupon-bridge-secret-2025
MYCOUPON_SERVER_URL=https://my-coupon-bridge.com
```

---

## 6. 파일 구조 요약

```
server/
├── _core/
│   ├── context.ts       # 관리자 권한 강제 주입 (백엔드)
│   ├── index.ts         # /api/awake 엔드포인트
│   ├── oauth.ts         # Google OAuth 리디렉션 URI 고정
│   └── googleOAuth.ts   # Google OAuth 인증 로직
├── webhook.ts           # Webhook 발송 기능
├── bridgeAuth.ts        # X-Bridge-Secret 인증 미들웨어
└── webhook.test.ts      # Webhook 테스트

client/src/
├── hooks/
│   ├── useAuth.ts       # 관리자 권한 강제 주입 (프론트엔드)
│   ├── useGeolocation.ts # 위치 권한 관리 훅
│   └── useBridgeSocket.ts # Socket.io 클라이언트 훅
├── components/
│   └── LocationPermissionBanner.tsx # 위치 권한 배너
└── contexts/
    └── BridgeSocketContext.tsx # Socket.io 컨텍스트
```

---

## 7. Railway 서버 연동 코드 예시

```javascript
const axios = require('axios');
const cron = require('node-cron');

// 마누스 서버 깨우기 설정 (10분마다 실행)
cron.schedule('*/10 * * * *', async () => {
  try {
    console.log('--- 마누스 서버 깨우기 시도 ---');
    const response = await axios.get('https://my-coupon-bridge.com/api/awake', {
      headers: {
        'X-Bridge-Secret': 'my-coupon-bridge-secret-2025'
      }
    });
    console.log('마누스 응답:', response.data);
  } catch (error) {
    console.error('마누스 깨우기 실패:', error.message);
  }
});
```

---

**문서 끝**
