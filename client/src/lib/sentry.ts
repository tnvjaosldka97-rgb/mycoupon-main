/**
 * Sentry Client-side Error Monitoring — @sentry/react v10
 * @sentry/tracing 제거: v8부터 @sentry/react에 통합됨
 */

import * as Sentry from '@sentry/react';

export function initClientSentry() {
  const dsn = import.meta.env.VITE_SENTRY_DSN;
  if (!dsn) return; // DSN 없으면 조용히 skip — 개발 환경 정상

  try {
    Sentry.init({
      dsn,
      environment: import.meta.env.MODE || 'development',
      release: import.meta.env.VITE_APP_VERSION || 'unknown',

      // v10: browserTracingIntegration() — @sentry/tracing BrowserTracing 대체
      integrations: [
        Sentry.browserTracingIntegration(),
      ],

      tracesSampleRate: import.meta.env.MODE === 'production' ? 0.05 : 0,

      // 노이즈 필터링
      beforeSend(event, hint) {
        // ResizeObserver loop — Chrome 엔진 버그, 무시
        if (event.message?.includes('ResizeObserver loop')) return null;
        // 네트워크 단절 에러 태깅
        if (
          hint.originalException instanceof TypeError &&
          hint.originalException.message.includes('fetch')
        ) {
          event.tags = { ...event.tags, errorType: 'network' };
        }
        return event;
      },
    });
  } catch (e) {
    // Sentry init 실패가 앱 부팅을 막으면 안 됨
    console.warn('[Sentry] init failed — monitoring disabled:', e);
  }
}

// 에러 바운더리 HOC
export const ErrorBoundary = Sentry.ErrorBoundary;

// 커스텀 에러 리포팅
export function reportClientError(error: Error, context?: Record<string, unknown>) {
  Sentry.withScope((scope) => {
    if (context) {
      Object.entries(context).forEach(([key, value]) => scope.setExtra(key, value));
    }
    Sentry.captureException(error);
  });
}

export default Sentry;
