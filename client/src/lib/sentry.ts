/**
 * Sentry Client-side Error Monitoring
 * 프론트엔드 에러도 실시간 추적
 */

import * as Sentry from '@sentry/react';
import { BrowserTracing } from '@sentry/tracing';

export function initClientSentry() {
  if (import.meta.env.VITE_SENTRY_DSN) {
    Sentry.init({
      dsn: import.meta.env.VITE_SENTRY_DSN,
      
      // 환경 구분
      environment: import.meta.env.MODE || 'development',
      
      // 성능 모니터링
      integrations: [new BrowserTracing()],
      tracesSampleRate: import.meta.env.MODE === 'production' ? 0.1 : 1.0,
      
      // Release 버전 추적
      release: import.meta.env.VITE_APP_VERSION || 'unknown',
      
      // 에러 필터링 (노이즈 제거)
      beforeSend(event, hint) {
        // ResizeObserver loop 에러 무시 (Chrome 버그)
        if (event.message?.includes('ResizeObserver loop')) {
          return null;
        }
        
        // Network 에러는 별도 처리
        if (hint.originalException instanceof TypeError && 
            hint.originalException.message.includes('fetch')) {
          event.tags = { ...event.tags, errorType: 'network' };
        }
        
        return event;
      },
      
      // User Context 자동 수집
      beforeSendTransaction(transaction) {
        // 성능이 나쁜 트랜잭션만 전송 (500ms 초과)
        if (transaction.measurements && 
            transaction.measurements['lcp']?.value > 500) {
          return transaction;
        }
        return null;
      },
    });
    
    console.log('✅ [Sentry Client] Error monitoring initialized');
  }
}

// 에러 바운더리용 HOC
export const ErrorBoundary = Sentry.ErrorBoundary;

// 커스텀 에러 리포팅
export function reportClientError(error: Error, context?: Record<string, any>) {
  Sentry.withScope((scope) => {
    if (context) {
      Object.entries(context).forEach(([key, value]) => {
        scope.setExtra(key, value);
      });
    }
    
    Sentry.captureException(error);
  });
}

export default Sentry;
