/**
 * Sentry Server-side Error Monitoring — @sentry/node v10
 * startTransaction() 제거됨 (v8+): Sentry.startSpan() 사용
 */

import * as Sentry from '@sentry/node';
import { nodeProfilingIntegration } from '@sentry/profiling-node';

export function initSentry() {
  if (!process.env.SENTRY_DSN) {
    console.warn('⚠️ [Sentry] SENTRY_DSN not set — error monitoring disabled');
    return;
  }

  try {
    Sentry.init({
      dsn: process.env.SENTRY_DSN,
      environment: process.env.RAILWAY_ENVIRONMENT || process.env.NODE_ENV || 'development',
      tracesSampleRate: process.env.NODE_ENV === 'production' ? 0.05 : 0,
      profilesSampleRate: process.env.NODE_ENV === 'production' ? 0.05 : 0,
      integrations: [nodeProfilingIntegration()],

      beforeSend(event) {
        // 민감 정보 제거
        if (event.request) {
          delete event.request.cookies;
          if (event.request.headers) {
            delete (event.request.headers as Record<string, unknown>)['authorization'];
            delete (event.request.headers as Record<string, unknown>)['cookie'];
          }
        }
        return event;
      },
    });
    console.log('✅ [Sentry] Server error monitoring initialized');
  } catch (e) {
    // Sentry init 실패가 서버 부팅을 막으면 안 됨
    console.warn('[Sentry] init failed — monitoring disabled:', e);
  }
}

export function captureException(error: Error, context?: Record<string, unknown>) {
  Sentry.withScope((scope) => {
    if (context) {
      Object.entries(context).forEach(([k, v]) => scope.setExtra(k, v));
    }
    Sentry.captureException(error);
  });
}

export function captureMessage(message: string, level: 'info' | 'warning' | 'error' = 'info') {
  Sentry.captureMessage(message, level);
}

// v10: startSpan 기반 — 동기/비동기 span 추적
export async function withSpan<T>(
  name: string,
  op: string,
  fn: () => Promise<T>,
): Promise<T> {
  return Sentry.startSpan({ name, op }, fn);
}

export function captureBusinessCriticalError(
  error: Error,
  details: {
    userId?: number;
    storeId?: number;
    couponId?: number;
    action: string;
  },
) {
  Sentry.withScope((scope) => {
    scope.setLevel('fatal');
    scope.setTag('business-critical', 'true');
    scope.setTag('action', details.action);
    if (details.userId) scope.setUser({ id: String(details.userId) });
    if (details.storeId) scope.setExtra('storeId', details.storeId);
    if (details.couponId) scope.setExtra('couponId', details.couponId);
    Sentry.captureException(error);
  });

  console.error('🚨 [BUSINESS CRITICAL ERROR]', { error: error.message, ...details });
}

export default Sentry;
