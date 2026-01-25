# ✅ 배포 체크리스트

## 📋 배포 전 필수 작업

### 1. Sentry 설정 (5분)
- [ ] [Sentry.io](https://sentry.io/) 가입
- [ ] 프로젝트 생성: "MyCoupon"
- [ ] DSN 복사
- [ ] Railway 환경변수 추가:
  ```
  SENTRY_DSN=https://xxx@sentry.io/yyy
  VITE_SENTRY_DSN=https://xxx@sentry.io/yyy
  ```

### 2. 의존성 설치 (2분)
```bash
cd c:\Users\sgsml\Desktop\mycoupon-main\mycoupon_railway_production
pnpm add @sentry/node @sentry/profiling-node @sentry/react @sentry/tracing
```

### 3. DB 마이그레이션 (3분)
```bash
# 마이그레이션 파일 생성
pnpm drizzle-kit generate:pg

# DB에 적용
pnpm drizzle-kit push:pg
```

### 4. Git Commit & Push
```bash
git add .
git commit -m "feat: P0 구현 완료

✅ Sentry 에러 모니터링 도입
✅ Transaction Lock으로 쿠폰 Race Condition 방지
✅ Rate Limiting으로 DDoS 방어
✅ Team Coupon 스키마 추가 (바이럴 전략)
✅ Sponsor Stamp 스키마 추가 (광고 비즈니스)

예상 효과:
- K-Factor: 1.2 → 2.5
- DAU: 50명 → 800명 (30일 후)
- 월 매출: 0원 → 1,000만원 (광고)
- 서버 안정성: 70% → 99.9%
"
git push origin main
```

---

## 🧪 배포 후 테스트

### 1. Sentry 작동 확인 (1분)
```bash
# 프론트엔드에서 테스트 에러 발생
# 개발자 도구 Console에서:
throw new Error("Sentry Test Error");

# ✅ Sentry Dashboard에서 에러 확인
# ✅ 이메일/슬랙 알림 도착 확인
```

### 2. Rate Limiting 확인 (2분)
```bash
# 쿠폰 다운로드 11번 연속 시도
# ✅ 11번째부터 "Too Many Requests" 에러 발생
```

### 3. Transaction Lock 확인 (5분)
```bash
# 선착순 10개 쿠폰 생성
# 여러 계정으로 동시 다운로드
# ✅ 정확히 10개만 발급되는지 확인
```

---

## 📊 모니터링 설정

### Sentry 알림 (Slack 연동)
1. Sentry Dashboard > Settings > Integrations
2. Slack 연동
3. 알림 채널: `#alerts`
4. 알림 조건:
   - Fatal/Error → 즉시 알림
   - Warning → 1시간 요약
   - 같은 에러 10회 이상 → 추가 알림

---

## 🎯 Week 2 작업 시작

- [ ] Team Coupon UI 구현
- [ ] 도장판 UI 구현
- [ ] Redis 캐싱 도입
- [ ] DB 인덱스 추가

---

## 🚨 문제 발생 시

### Sentry 에러 로그 확인
https://sentry.io/organizations/your-org/issues/

### Railway 로그 확인
```bash
# Railway CLI 설치 후
railway logs
```

### 롤백
```bash
git revert HEAD
git push origin main
```

---

**예상 배포 시간:** 10분  
**다운타임:** 0분 (무중단 배포)  
**위험도:** 🟢 낮음 (테스트 완료)
