# 모니터링 설정 가이드

마이쿠폰 서버의 헬스 체크 모니터링 시스템 설정 및 운영 가이드입니다.

---

## 📊 현재 설정

### 자동 헬스 체크
- **엔드포인트**: `/api/trpc/healthz`
- **체크 주기**: 5분마다 (300초)
- **로그 형식**: JSON
- **구현 파일**: `server/monitoring.ts`

### 서버 시작 시 자동 활성화
서버가 시작되면 `server/_core/index.ts`에서 자동으로 healthz 모니터링이 시작됩니다.

```typescript
// server/_core/index.ts
startHealthCheckMonitoring(); // 자동 시작
```

---

## 📝 로그 확인

### 1. 정상 로그 예시
```json
[HEALTHZ] {"timestamp":"2025-12-20T07:00:00.000Z","status":"ok","version":"v2025121911271","uptime":3600.5,"responseTime":12}
```

**필드 설명:**
- `timestamp`: 체크 시각 (ISO 8601)
- `status`: 서버 상태 ("ok" 또는 "error")
- `version`: 앱 버전
- `uptime`: 서버 가동 시간 (초)
- `responseTime`: 응답 시간 (밀리초)

### 2. 에러 로그 예시
```json
[HEALTHZ ERROR] {"timestamp":"2025-12-20T07:05:00.000Z","status":"error","responseTime":5002,"error":"Connection timeout"}
```

---

## 🔍 로그 분석 명령어

### 정상 로그만 보기
```bash
grep "HEALTHZ]" server.log | grep -v "ERROR"
```

### 에러 로그만 보기
```bash
grep "HEALTHZ ERROR" server.log
```

### 최근 24시간 헬스 체크 통계
```bash
# 5분 간격 * 12 * 24 = 288개
grep "HEALTHZ" server.log | tail -n 288
```

### 응답 시간 분석
```bash
# 응답 시간 1초 이상인 로그 찾기
grep "HEALTHZ" server.log | grep -E "responseTime\":[0-9]{4,}"
```

### 시간대별 에러 빈도
```bash
# 에러 발생 시각만 추출
grep "HEALTHZ ERROR" server.log | grep -oP '"timestamp":"[^"]*"' | cut -d'"' -f4
```

---

## 🚨 알림 설정 (선택사항)

### 방법 A: 서버 로그 기반 알림 (현재 구현됨)

**장점:**
- 별도 외부 서비스 불필요
- 서버 로그에 모든 기록 남음
- 간단한 구현

**활용 방법:**
1. 로그 파일을 주기적으로 모니터링
2. `[HEALTHZ ERROR]` 패턴 감지 시 알림 발송
3. 예시 스크립트 (cron 등록):

```bash
#!/bin/bash
# /home/ubuntu/scripts/healthz_alert.sh

LOG_FILE="/var/log/mycoupon/server.log"
ALERT_EMAIL="admin@mycoupon.kr"

# 최근 5분간 에러 로그 확인
ERROR_COUNT=$(grep "HEALTHZ ERROR" "$LOG_FILE" | tail -n 1 | wc -l)

if [ "$ERROR_COUNT" -gt 0 ]; then
  echo "Health check failed at $(date)" | mail -s "[ALERT] MyCoupon Server Health Check Failed" "$ALERT_EMAIL"
fi
```

### 방법 B: Uptime Robot 설정

**무료 플랜:**
- 최대 50개 모니터
- 5분 간격 체크
- 이메일/SMS/슬랙 알림

**설정 방법:**
1. [Uptime Robot](https://uptimerobot.com) 가입
2. "Add New Monitor" 클릭
3. 설정:
   - **Monitor Type**: HTTP(s)
   - **Friendly Name**: MyCoupon Health Check
   - **URL**: `https://your-domain.com/api/trpc/healthz?batch=1&input=%7B%220%22%3A%7B%7D%7D`
   - **Monitoring Interval**: 5 minutes
4. Alert Contacts 설정 (이메일/슬랙)

**응답 검증 추가:**
- Advanced Settings → Keyword Monitoring
- Keyword: `"status":"ok"`
- Alert if keyword not found

### 방법 C: 슬랙 웹훅 연동

**구현 예시:**

```typescript
// server/monitoring.ts에 추가

const SLACK_WEBHOOK_URL = process.env.SLACK_WEBHOOK_URL;

async function sendSlackAlert(message: string) {
  if (!SLACK_WEBHOOK_URL) return;
  
  try {
    await fetch(SLACK_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: `🚨 *MyCoupon Health Check Alert*\n${message}`,
      }),
    });
  } catch (error) {
    console.error('Failed to send Slack alert:', error);
  }
}

// performHealthCheck 함수 내 에러 처리 부분에 추가
if (healthResult.status === 'error') {
  await sendSlackAlert(
    `Health check failed at ${healthResult.timestamp}\n` +
    `Error: ${healthResult.error}\n` +
    `Response time: ${healthResult.responseTime}ms`
  );
}
```

---

## 📈 성능 기준

### 정상 범위
- **응답 시간**: < 100ms
- **가동 시간**: 연속 증가 (재시작 없음)
- **에러율**: 0%

### 경고 기준
- **응답 시간**: 100ms ~ 1000ms
- **연속 에러**: 1회 (일시적 네트워크 문제 가능)

### 긴급 대응 필요
- **응답 시간**: > 1000ms
- **연속 에러**: 3회 이상
- **서버 다운**: healthz 응답 없음

---

## 🛠️ 트러블슈팅

### 문제: healthz 로그가 보이지 않음

**원인:**
- 서버가 정상 시작되지 않음
- 모니터링 스크립트 오류

**해결:**
```bash
# 서버 프로세스 확인
ps aux | grep "tsx watch"

# 서버 로그 확인
tail -f /path/to/server.log

# 수동 healthz 호출 테스트
curl "http://localhost:3000/api/trpc/healthz?batch=1&input=%7B%220%22%3A%7B%7D%7D"
```

### 문제: 응답 시간이 계속 느림

**원인:**
- 데이터베이스 연결 지연
- 서버 리소스 부족
- 네트워크 병목

**해결:**
```bash
# CPU/메모리 사용량 확인
top -p $(pgrep -f "tsx watch")

# 데이터베이스 연결 확인
mysql -h [DB_HOST] -u [DB_USER] -p -e "SELECT 1"

# 네트워크 지연 확인
ping [DB_HOST]
```

### 문제: 간헐적 에러 발생

**원인:**
- 일시적 네트워크 불안정
- 데이터베이스 타임아웃
- 서버 재시작

**해결:**
- 에러 로그 패턴 분석
- 재시도 로직 추가 고려
- 데이터베이스 연결 풀 설정 검토

---

## 📊 대시보드 구축 (고급)

### Grafana + Prometheus 연동

1. **Prometheus Exporter 추가**
```typescript
// server/metrics.ts
import { Registry, Counter, Histogram } from 'prom-client';

const register = new Registry();

export const healthCheckCounter = new Counter({
  name: 'healthz_check_total',
  help: 'Total number of health checks',
  labelNames: ['status'],
  registers: [register],
});

export const healthCheckDuration = new Histogram({
  name: 'healthz_response_time_ms',
  help: 'Health check response time in milliseconds',
  buckets: [10, 50, 100, 500, 1000, 5000],
  registers: [register],
});

export { register };
```

2. **메트릭 엔드포인트 추가**
```typescript
// server/_core/index.ts
import { register } from '../metrics';

app.get('/metrics', async (req, res) => {
  res.set('Content-Type', register.contentType);
  res.end(await register.metrics());
});
```

3. **Grafana 대시보드 설정**
- Prometheus 데이터 소스 추가
- Health check 성공률 그래프
- 응답 시간 히스토그램
- 가동 시간 추이

---

## 📅 정기 점검 체크리스트

### 일일 점검
- [ ] 에러 로그 확인 (0건 유지)
- [ ] 평균 응답 시간 확인 (< 100ms)
- [ ] 서버 가동 시간 확인 (연속 증가)

### 주간 점검
- [ ] 로그 파일 크기 확인 및 로테이션
- [ ] 응답 시간 추이 분석
- [ ] 에러 패턴 분석 (발생 시)

### 월간 점검
- [ ] 모니터링 시스템 자체 점검
- [ ] 알림 테스트 (의도적 에러 발생)
- [ ] 성능 기준 재검토

---

**최종 업데이트**: 2025-12-20  
**담당자**: DevOps Team  
**문의**: devops@mycoupon.kr
