# ⚡ 빠른 DB 마이그레이션 방법

## 🎯 가장 쉬운 방법

### 1. Railway DATABASE_URL 복사
```
Railway Dashboard
→ mycoupon-main 서비스 클릭
→ Variables 탭
→ DATABASE_URL 값 복사
```

### 2. .env 파일 생성
```
프로젝트 루트에 .env 파일 생성:

DATABASE_URL="복사한_URL_붙여넣기"
```

### 3. 로컬에서 마이그레이션 실행
```bash
cd c:\Users\sgsml\Desktop\mycoupon-main\mycoupon_railway_production
pnpm run db:push
```

**완료!** 새 테이블이 Railway DB에 생성됩니다.

---

## 🔍 Railway Shell이 안 보이는 경우

Railway UI 버전에 따라 Shell 위치가 다릅니다:

### 옵션 A: Settings 탭
```
Settings > Deploy > Run Command
```

### 옵션 B: 우측 상단 메뉴
```
서비스 상세 페이지 > 우측 상단 "..." > Run Command
```

### 옵션 C: CLI 사용
```bash
npm install -g @railway/cli
railway login
railway link
railway run pnpm run db:push
```

---

## ⚠️ 주의사항

`.env` 파일에 DATABASE_URL을 추가했으면:
- ✅ 마이그레이션 실행 후
- ⚠️ `.env` 파일 삭제 (보안)
- 또는 `.gitignore`에 추가됨 확인

---

**가장 빠른 방법: DATABASE_URL 복사 → .env 생성 → pnpm run db:push** 🚀
