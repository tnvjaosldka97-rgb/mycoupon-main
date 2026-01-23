# 환경 변수 설정 가이드

Vercel 대시보드에서 아래 환경 변수를 설정해야 합니다.

## 🔴 필수 환경 변수

### 1. 데이터베이스 설정

**DATABASE_URL**
- 설명: Supabase PostgreSQL 연결 문자열
- 형식: `postgresql://[user]:[password]@[host]:[port]/[database]?sslmode=require`
- 예시: `postgresql://postgres:password@db.supabase.co:5432/postgres?sslmode=require`
- 획득 방법: Supabase 프로젝트 설정 → Database → Connection String

### 2. OAuth 인증 설정

**VITE_APP_ID**
- 설명: Manus OAuth 애플리케이션 ID
- 형식: 문자열
- 획득 방법: Manus 대시보드에서 OAuth 앱 생성 후 발급

**OAUTH_SERVER_URL**
- 설명: Manus OAuth 서버 URL (백엔드)
- 값: `https://api.manus.im`

**VITE_OAUTH_PORTAL_URL**
- 설명: Manus OAuth 포털 URL (프론트엔드)
- 값: `https://portal.manus.im`

### 3. JWT 세션 설정

**JWT_SECRET**
- 설명: JWT 서명용 비밀키
- 형식: 랜덤 문자열 (최소 32자 권장)
- 생성 방법: `openssl rand -base64 32` 또는 온라인 랜덤 생성기

### 4. 소유자 정보

**OWNER_OPEN_ID**
- 설명: 프로젝트 소유자 OpenID
- 형식: 문자열
- 획득 방법: Manus 계정 설정에서 확인

**OWNER_NAME**
- 설명: 프로젝트 소유자 이름
- 형식: 문자열
- 예시: `홍길동`

---

## 🟡 선택 환경 변수 (기능에 따라 필요)

### 5. 이메일 알림 설정 (선택사항)

**EMAIL_USER**
- 설명: Gmail SMTP 사용자 이메일
- 형식: 이메일 주소
- 예시: `your_email@gmail.com`
- 필요 조건: Gmail 2단계 인증 활성화 필요

**EMAIL_PASS**
- 설명: Gmail SMTP 앱 비밀번호
- 형식: 16자 앱 비밀번호
- 획득 방법: Google 계정 → 보안 → 2단계 인증 → 앱 비밀번호 생성

### 6. 애플리케이션 메타데이터

**VITE_APP_VERSION**
- 설명: 앱 버전
- 형식: 시맨틱 버전 (예: 1.0.0)
- 기본값: `1.0.0`

**VITE_APP_TITLE**
- 설명: 앱 타이틀
- 형식: 문자열
- 예시: `지금쿠폰`

**VITE_APP_LOGO**
- 설명: 앱 로고 URL (선택사항)
- 형식: URL 또는 빈 문자열
- 예시: `https://example.com/logo.png`

### 7. Manus Built-in API (선택사항)

**BUILT_IN_FORGE_API_URL**
- 설명: Manus LLM/Storage API URL (백엔드)
- 값: `https://forge.manus.im`

**BUILT_IN_FORGE_API_KEY**
- 설명: Manus API 인증 키 (백엔드)
- 형식: API 키 문자열
- 획득 방법: Manus 대시보드에서 발급

**VITE_FRONTEND_FORGE_API_URL**
- 설명: Manus API URL (프론트엔드)
- 값: `https://forge.manus.im`

**VITE_FRONTEND_FORGE_API_KEY**
- 설명: Manus API 인증 키 (프론트엔드)
- 형식: API 키 문자열
- 획득 방법: Manus 대시보드에서 발급

### 8. Analytics (선택사항)

**VITE_ANALYTICS_ENDPOINT**
- 설명: Analytics 엔드포인트
- 형식: URL 또는 빈 문자열

**VITE_ANALYTICS_WEBSITE_ID**
- 설명: Analytics 웹사이트 ID
- 형식: 문자열 또는 빈 문자열

---

## 📝 Vercel 설정 방법

1. Vercel 대시보드 접속
2. 프로젝트 선택 → Settings → Environment Variables
3. 위 환경 변수를 하나씩 추가
4. Production, Preview, Development 환경 모두 체크
5. Save 클릭

---

## ⚠️ 주의사항

1. **DATABASE_URL**은 반드시 PostgreSQL 연결 문자열이어야 합니다 (MySQL 아님)
2. **JWT_SECRET**은 절대 공개하지 마세요
3. **EMAIL_PASS**는 Gmail 앱 비밀번호여야 합니다 (일반 비밀번호 아님)
4. 모든 `VITE_` 접두사 변수는 프론트엔드에 노출됩니다 (민감 정보 입력 금지)
