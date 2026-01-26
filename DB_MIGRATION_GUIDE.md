# 🗄️ DB 마이그레이션 가이드

**중요:** 이 프로젝트는 **Drizzle ORM**을 사용합니다 (Prisma 아님)

---

## ✅ 새로 추가된 테이블

1. **coupon_groups** - 팀 쿠폰 그룹
2. **coupon_group_members** - 팀 쿠폰 멤버
3. **district_stamps** - 도장판
4. **district_stamp_history** - 도장 획득 이력

---

## 🚀 Railway에서 마이그레이션 실행

### 방법 1: Railway Dashboard (권장)

```
1. https://railway.app/dashboard 접속
2. MyCoupon 프로젝트 선택
3. Settings 탭
4. "Deploy" 섹션
5. Custom Start Command에 추가 (일회성):
   pnpm run db:push
6. 또는 Railway Shell 사용:
   - Project > Shell 아이콘 클릭
   - 명령어 입력: pnpm run db:push
   - Enter
```

### 방법 2: Railway CLI

```bash
# 1. Railway CLI 설치 (없으면)
npm install -g @railway/cli

# 2. 로그인
railway login

# 3. 프로젝트 연결
railway link

# 4. DB 마이그레이션 실행
railway run pnpm run db:push
```

---

## 📝 실행 명령어 상세

```bash
pnpm run db:push
```

이 명령어는 다음을 실행합니다:
1. `drizzle-kit generate` - SQL 마이그레이션 파일 생성
2. `drizzle-kit migrate` - DB에 적용

---

## ✅ 마이그레이션 성공 확인

Railway Shell에서 다음 로그가 보이면 성공:

```
✅ Generating migration files...
✅ Migration files generated
✅ Applying migrations...
✅ Migration complete
```

---

## 🧪 테스트 쿼리

마이그레이션 완료 후 Railway Shell에서:

```sql
-- 테이블 생성 확인
SELECT table_name FROM information_schema.tables 
WHERE table_schema = 'public' 
AND table_name IN ('coupon_groups', 'district_stamps');

-- 결과: 2개 행이 나와야 함
```

---

## ⚠️ 문제 발생 시

### DATABASE_URL 없음
```
Railway Dashboard > Variables
DATABASE_URL 확인 (자동 생성됨)
```

### 마이그레이션 실패
```bash
# 수동으로 SQL 실행
railway run psql $DATABASE_URL
```

---

## 🎯 마이그레이션 후 다음 단계

1. ✅ 서버 재시작 (Railway 자동)
2. ✅ Team Coupon 기능 테스트
3. ✅ District Stamps 기능 테스트

---

**Railway Dashboard에서 Shell을 열어 실행하세요!**
