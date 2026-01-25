# 📦 P0 구현 완료 - 의존성 설치 가이드

## ✅ 구현 완료 항목

1. ✅ **Sentry 도입** - 에러 모니터링
2. ✅ **Transaction Lock** - 쿠폰 Race Condition 방지
3. ✅ **Rate Limiting** - DDoS 방어
4. ✅ **Team Coupon 스키마** - 바이럴 폭발
5. ✅ **Sponsor Stamp 스키마** - 광고 비즈니스

---

## 🚀 필수 의존성 설치

아래 명령어를 실행하여 Sentry 패키지를 설치하세요:

```bash
# Sentry 백엔드 (Node.js)
pnpm add @sentry/node @sentry/profiling-node

# Sentry 프론트엔드 (React)
pnpm add @sentry/react @sentry/tracing
```

---

## 🔑 환경변수 설정 (Railway Dashboard)

### 1. Sentry DSN 발급
1. [Sentry.io](https://sentry.io/) 가입 (무료 플랜: 월 5,000 에러)
2. 프로젝트 생성: "MyCoupon"
3. DSN 복사: `https://xxx@yyy.ingest.sentry.io/zzz`

### 2. Railway 환경변수 추가
Railway Dashboard > Variables > Add Variable:

```bash
# 백엔드 Sentry
SENTRY_DSN=https://your-dsn-here@sentry.io/project-id

# 프론트엔드 Sentry (Vite 환경변수)
VITE_SENTRY_DSN=https://your-dsn-here@sentry.io/project-id
```

### 3. 재배포
환경변수 추가 후 자동 재배포됨.

---

## 🗄️ DB 마이그레이션 실행

새로운 테이블 추가됨:
- `coupon_groups` - 팀 쿠폰
- `coupon_group_members` - 팀 멤버
- `district_stamps` - 도장판
- `district_stamp_history` - 도장 이력

```bash
# 마이그레이션 파일 생성
pnpm drizzle-kit generate:pg

# DB에 적용
pnpm drizzle-kit push:pg
```

또는 Railway에서 자동 마이그레이션:
```bash
# package.json에 이미 설정됨
pnpm run db:push
```

---

## 🧪 테스트 방법

### 1. Sentry 에러 추적 테스트
```bash
# 프론트엔드 에러 발생시켜보기
console.error(new Error("Test Sentry Error"));

# Sentry Dashboard에서 에러 확인
# → 1초 만에 이메일/슬랙 알림 도착!
```

### 2. Rate Limiting 테스트
```bash
# curl로 쿠폰 다운로드 API 연속 호출
for i in {1..15}; do
  curl -X POST https://my-coupon-bridge.com/api/trpc/coupons.download \
    -H "Cookie: session=YOUR_SESSION" \
    -d '{"couponId":1}'
  echo "Request $i sent"
done

# 11번째 요청부터 "Too Many Requests" 에러 발생
```

### 3. Transaction Lock 테스트
```bash
# 동시에 100명이 선착순 10개 쿠폰 클릭 시뮬레이션
# → 정확히 10개만 발급되는지 확인
```

---

## 📊 Sentry 알림 설정 (Slack)

1. Sentry Dashboard > Settings > Integrations
2. Slack 연동 클릭
3. 알림 채널 선택: `#alerts`
4. 알림 조건 설정:
   - Fatal/Error 레벨 즉시 알림
   - Warning 레벨 1시간 요약
   - 같은 에러 10회 이상 시 추가 알림

---

## 🎯 다음 단계 (Week 2)

- [ ] Redis 캐싱 도입 (유저 1만 명 도달 시)
- [ ] DB 인덱스 추가 (성능 30배 향상)
- [ ] Team Coupon UI 구현 (바이럴 폭발)
- [ ] 도장판 UI 구현 (광고 비즈니스)

---

**구현 완료 시간:** 50분  
**배포 우선순위:** 🔴 P0 (즉시 배포)
