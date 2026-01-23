# 마이쿠폰 (MyCoupon) - Railway 배포 환경 변수 가이드

## 필수 환경 변수

Railway 대시보드 → Variables 탭에서 아래 변수들을 설정하세요.

### 1. 데이터베이스 (자동 설정)
```
DATABASE_URL=postgresql://username:password@host:5432/database?sslmode=require
```
> Railway에서 PostgreSQL 추가 시 자동으로 주입됩니다.

### 2. JWT 세션 비밀키
```
JWT_SECRET=your-super-secret-jwt-key-min-32-chars
```
> 32자 이상의 랜덤 문자열을 사용하세요.

### 3. 앱 ID
```
VITE_APP_ID=mycoupon-app
```

### 4. Google OAuth 설정
```
GOOGLE_CLIENT_ID=your-google-client-id.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=your-google-client-secret
```
> [Google Cloud Console](https://console.cloud.google.com/apis/credentials)에서 발급

**중요**: Google Cloud Console에서 Authorized redirect URIs에 추가:
```
https://your-app.railway.app/api/oauth/google/callback
```

### 5. 마스터 관리자 이메일
```
MASTER_ADMIN_EMAILS=tnvjaosldka97@gmail.com,sakuradaezun@gmail.com,onlyup.myr@gmail.com,mapo8887@gmail.com
```
> 쉼표로 구분하여 여러 이메일 등록 가능

### 6. 브릿지 서버 연동 (실시간 알림)
```
BRIDGE_SERVER_URL=https://your-bridge-server.railway.app
BRIDGE_SECRET=your-bridge-secret-key
```

---

## 선택 환경 변수

### 이메일 알림 (Gmail SMTP)
```
EMAIL_USER=your-email@gmail.com
EMAIL_PASS=your-app-password
```
> Gmail 앱 비밀번호 사용 권장

### Manus OAuth (레거시)
```
OAUTH_SERVER_URL=https://api.manus.im
VITE_OAUTH_PORTAL_URL=https://manus.im/login
```
> Google OAuth만 사용할 경우 불필요

---

## Railway 배포 단계

1. **GitHub 연동**: Railway에서 GitHub 저장소 연결
2. **PostgreSQL 추가**: Railway 대시보드에서 PostgreSQL 서비스 추가
3. **환경 변수 설정**: 위 변수들을 Variables 탭에서 설정
4. **배포**: 자동 배포 또는 수동 Deploy 클릭

### 빌드 설정 (자동 감지됨)
- Build Command: `pnpm install && pnpm build`
- Start Command: `pnpm start`

### 서버 시작점
- `dist/index.js` (빌드 후 생성)
- 원본: `server/_core/index.ts`

---

## DB 마이그레이션

Railway PostgreSQL 연결 후 아래 명령어 실행:
```bash
pnpm db:push
```

또는 `drizzle/` 폴더의 SQL 파일을 직접 실행할 수 있습니다.

---

## 주의사항

1. **PORT 환경변수**: Railway가 자동 설정하므로 직접 설정하지 마세요
2. **DATABASE_URL**: Railway PostgreSQL 추가 시 자동 주입됩니다
3. **Google OAuth**: redirect URI를 Railway 도메인으로 변경해야 합니다
4. **HTTPS**: Railway는 기본적으로 HTTPS를 제공합니다
