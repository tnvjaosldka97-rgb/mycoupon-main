/**
 * Sentry Error Monitoring Setup
 * 새벽 3시에 서버 터져도 1초 만에 알림 받기
 */

import * as Sentry from '@sentry/node';
import { nodeProfilingIntegration } from '@sentry/profiling-node';

// Sentry 초기화
export function initSentry() {
  if (process.env.SENTRY_DSN) {
    Sentry.init({
      dsn: process.env.SENTRY_DSN,
      
      // Railway 환경 감지
      environment: process.env.RAILWAY_ENVIRONMENT || process.env.NODE_ENV || 'development',
      
      // 성능 모니터링 (API 응답 시간 추적)
      tracesSampleRate: process.env.NODE_ENV === 'production' ? 0.1 : 1.0, // 10% 샘플링
      
      // 프로파일링 (느린 함수 찾기)
      profilesSampleRate: process.env.NODE_ENV === 'production' ? 0.1 : 1.0,
      
      integrations: [
        nodeProfilingIntegration(),
      ],
      
      // 민감한 정보 필터링
      beforeSend(event) {
        // 쿠키, 토큰, 비밀번호 제거
        if (event.request) {
          delete event.request.cookies;
          if (event.request.headers) {
            delete event.request.headers['Authorization'];
            delete event.request.headers['Cookie'];
          }
        }
        return event;
      },
    });
    
    console.log('✅ [Sentry] Error monitoring initialized');
  } else {
    console.warn('⚠️ [Sentry] SENTRY_DSN not found, skipping initialization');
  }
}

// 에러 캡처 헬퍼 함수
export function captureException(error: Error, context?: Record<string, any>) {
  console.error('[Sentry] Capturing exception:', error);
  
  if (context) {
    Sentry.setContext('additional', context);
  }
  
  Sentry.captureException(error);
}

// 커스텀 이벤트 로깅
export function captureMessage(message: string, level: 'info' | 'warning' | 'error' = 'info') {
  Sentry.captureMessage(message, level);
}

// 트랜잭션 추적 (성능 모니터링)
export function startTransaction(name: string, op: string) {
  return Sentry.startTransaction({
    name,
    op,
  });
}

// 비즈니스 크리티컬 에러 (즉시 알림)
export function captureBusinessCriticalError(error: Error, details: {
  userId?: number;
  storeId?: number;
  couponId?: number;
  action: string;
}) {
  Sentry.withScope((scope) => {
    scope.setLevel('fatal'); // 최고 우선순위
    scope.setTag('business-critical', 'true');
    scope.setTag('action', details.action);
    
    if (details.userId) scope.setUser({ id: String(details.userId) });
    if (details.storeId) scope.setExtra('storeId', details.storeId);
    if (details.couponId) scope.setExtra('couponId', details.couponId);
    
    Sentry.captureException(error);
  });
  
  console.error('🚨 [BUSINESS CRITICAL ERROR]', {
    error: error.message,
    ...details,
  });
}

export default Sentry;
