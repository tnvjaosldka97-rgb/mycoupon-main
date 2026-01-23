# 🚀 실서버 배포 가이드

## 📋 배포 체크리스트

### 1. 빌드 완료 확인
- ✅ 클린 빌드 완료 (캐시 삭제 후 재빌드)
- ✅ 프로덕션 빌드 성공
- ✅ 번들 크기: 2,023.13 kB (gzip: 487.45 kB)
- ✅ 서비스 워커 버전: v2025122603034

### 2. 체크포인트 생성 완료
- ✅ 체크포인트 ID: `e0428eca`
- ✅ 버전: PWA 최종 마스터 팩 v4

### 3. 실서버 배포 방법

#### Manus UI에서 배포
1. Manus UI 우측 상단의 **"Publish" 버튼** 클릭
2. 최신 체크포인트 선택 (e0428eca)
3. 배포 완료 대기 (약 1-2분 소요)

### 4. 배포 후 확인 사항

#### 4.1 실서버 접속 확인
```
URL: https://my-coupon-bridge.com
```

#### 4.2 브라우저 콘솔에서 성능 확인
1. 실서버 접속 (https://my-coupon-bridge.com)
2. 브라우저 개발자 도구 열기 (F12)
3. Console 탭에서 다음 로그 확인:
   ```
   [OAuth Performance] XXX.XXms
   ```
4. **목표: 500ms 이하**

#### 4.3 버전 확인
콘솔에서 다음 로그 확인:
```
[APP] Version: v2025122603034
```

### 5. Keep-Alive 스크립트 실행

#### 5.1 로컬에서 실행 (테스트용)
```bash
cd /home/ubuntu/local_recommendation_engine
node scripts/keep-alive.mjs
```

#### 5.2 백그라운드 실행 (프로덕션)
```bash
nohup node scripts/keep-alive.mjs > /tmp/keep-alive.log 2>&1 &
```

#### 5.3 실행 확인
```bash
ps aux | grep keep-alive
```

#### 5.4 로그 확인
```bash
tail -f /tmp/keep-alive.log
```

### 6. Keep-Alive 스크립트 동작 원리

#### 목적
1. **서버 휴면 방지**: Cold Start 차단
2. **DB Connection Pool 유지**: DB가 잠들지 않도록 유지
3. **주기적 Health Check**: 5분마다 실서버에 핑 전송

#### 동작 방식
```
매 5분마다:
  → GET https://my-coupon-bridge.com/api/health
  → 서버 응답 확인
  → DB 쿼리 실행 (SELECT 1)
  → 성능 메트릭 수집
  → 로그 출력
```

#### 예상 로그 출력
```
============================================================
🚀 Keep-Alive & DB Warm-up 스크립트 시작
============================================================
📍 대상 서버: https://my-coupon-bridge.com
⏱️  핑 간격: 300초 (5분)
🎯 엔드포인트: /api/health
============================================================

[2025-12-26T03:06:32.725Z] 🔄 Keep-Alive 핑 전송 시작...
✅ 서버 응답 성공
   - 상태 코드: 200
   - 응답 시간: 245ms
   - 서버 상태: healthy
   - DB 상태: connected
   - OAuth 성능: 123.45ms

✅ Keep-Alive 스케줄러 활성화됨 (5분마다 실행)
💡 종료하려면 Ctrl+C를 누르세요.
```

### 7. 성능 최적화 확인 항목

#### 7.1 OAuth 성능
- ✅ 목표: 500ms 이하
- ⚠️ 주의: 500ms ~ 1000ms
- ❌ 경고: 1000ms 초과

#### 7.2 DB 응답 시간
- ✅ 정상: 100ms 이하
- ⚠️ 느림: 100ms ~ 500ms
- ❌ 매우 느림: 500ms 초과

#### 7.3 전체 페이지 로드
- ✅ 목표: 3초 이내
- ⚠️ 주의: 3초 ~ 5초
- ❌ 경고: 5초 초과

### 8. 문제 해결

#### 8.1 배포 후 이전 버전이 보이는 경우
```bash
# 브라우저 캐시 강제 새로고침
Ctrl + Shift + R (Windows/Linux)
Cmd + Shift + R (Mac)
```

#### 8.2 Keep-Alive 스크립트 종료
```bash
# 프로세스 ID 확인
ps aux | grep keep-alive

# 프로세스 종료
kill <PID>
```

#### 8.3 성능이 느린 경우
1. Keep-Alive 스크립트가 실행 중인지 확인
2. 실서버 로그에서 Cold Start 발생 여부 확인
3. DB Connection Pool 상태 확인

### 9. 주요 변경사항 (v4)

#### 코드 수정
- ✅ `main.tsx`: import 경로 수정 (./const → ./lib/const)
- ✅ `useAuth.ts`: import 경로 수정 (@/const → @/lib/const)
- ✅ `App.tsx`: 누락된 컴포넌트 import 제거

#### 성능 최적화
- ✅ 클린 빌드 (캐시 완전 삭제)
- ✅ Service Worker 버전 자동 주입
- ✅ Keep-Alive 스크립트 추가
- ✅ Health Check API 개선

#### PWA 기능
- ✅ 서비스 워커 즉시 등록 전략
- ✅ 네트워크 지연 시 사용자 피드백
- ✅ 설치 상태 추적 및 로깅
- ✅ 앱 다운로드 버튼 UX 개선

### 10. 다음 단계

#### 10.1 모니터링
- 실서버 로그 주기적 확인
- OAuth 성능 메트릭 수집
- 사용자 피드백 수집

#### 10.2 추가 최적화
- CDN 설정 (정적 파일 캐싱)
- 이미지 최적화 (WebP 변환)
- 코드 스플리팅 (번들 크기 감소)

#### 10.3 기능 개선
- 오프라인 모드 강화
- 푸시 알림 추가
- 백그라운드 동기화

---

## 📞 지원

문제가 발생하면 다음 정보를 포함하여 문의하세요:
- 체크포인트 ID: e0428eca
- 배포 시간
- 브라우저 콘솔 로그
- Keep-Alive 스크립트 로그
