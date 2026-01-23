/**
 * 서버 헬스 체크 모니터링 스크립트
 * 
 * 주기적으로 /healthz 엔드포인트를 호출하여 서버 상태를 로그에 기록합니다.
 * 운영 환경에서 서버 가동 시간, 응답 시간, 에러 발생 여부를 추적할 수 있습니다.
 */

import { appRouter } from './routers';

const HEALTHZ_CHECK_INTERVAL = 5 * 60 * 1000; // 5분마다 체크

interface HealthCheckResult {
  timestamp: string;
  status: 'ok' | 'error';
  version?: string;
  uptime?: number;
  responseTime?: number;
  error?: string;
}

/**
 * healthz 엔드포인트 호출 및 결과 로깅
 */
async function performHealthCheck(): Promise<HealthCheckResult> {
  const startTime = Date.now();
  
  try {
    // tRPC 라우터 직접 호출 (내부 호출)
    const caller = appRouter.createCaller({
      req: {} as any,
      res: {} as any,
      user: null,
      isAdmin: false,
    });
    
    const result = await caller.healthz();
    const responseTime = Date.now() - startTime;
    
    const healthResult: HealthCheckResult = {
      timestamp: new Date().toISOString(),
      status: 'ok',
      version: result.version,
      uptime: result.uptime,
      responseTime,
    };
    
    // 정상 상태 로그
    console.log('[HEALTHZ]', JSON.stringify(healthResult));
    
    return healthResult;
  } catch (error) {
    const responseTime = Date.now() - startTime;
    const errorMessage = error instanceof Error ? error.message : String(error);
    
    const healthResult: HealthCheckResult = {
      timestamp: new Date().toISOString(),
      status: 'error',
      responseTime,
      error: errorMessage,
    };
    
    // 에러 상태 로그 (경고 레벨)
    console.error('[HEALTHZ ERROR]', JSON.stringify(healthResult));
    
    return healthResult;
  }
}

/**
 * 주기적 헬스 체크 시작
 */
export function startHealthCheckMonitoring() {
  // 즉시 1회 실행
  performHealthCheck();
  
  // 주기적 실행
  const intervalId = setInterval(performHealthCheck, HEALTHZ_CHECK_INTERVAL);
  
  console.log(`[HEALTHZ MONITOR] Started with interval: ${HEALTHZ_CHECK_INTERVAL / 1000}s`);
  
  // Graceful shutdown 지원
  process.on('SIGTERM', () => {
    console.log('[HEALTHZ MONITOR] Stopping...');
    clearInterval(intervalId);
  });
  
  process.on('SIGINT', () => {
    console.log('[HEALTHZ MONITOR] Stopping...');
    clearInterval(intervalId);
  });
  
  return intervalId;
}

/**
 * 로그 분석 가이드:
 * 
 * 1. 정상 로그 예시:
 *    [HEALTHZ] {"timestamp":"2025-12-20T07:00:00.000Z","status":"ok","version":"v2025121911271","uptime":3600.5,"responseTime":12}
 * 
 * 2. 에러 로그 예시:
 *    [HEALTHZ ERROR] {"timestamp":"2025-12-20T07:05:00.000Z","status":"error","responseTime":5002,"error":"Connection timeout"}
 * 
 * 3. 로그 필터링 명령어:
 *    # 정상 로그만 보기
 *    grep "HEALTHZ]" server.log | grep -v "ERROR"
 *    
 *    # 에러 로그만 보기
 *    grep "HEALTHZ ERROR" server.log
 *    
 *    # 최근 24시간 헬스 체크 통계
 *    grep "HEALTHZ" server.log | tail -n 288  # 5분 간격 * 12 * 24 = 288개
 * 
 * 4. 알림 설정 (선택사항):
 *    - 에러 로그 발생 시 이메일/슬랙 알림 연동
 *    - responseTime > 1000ms 시 성능 경고
 *    - 연속 3회 이상 에러 시 긴급 알림
 */
