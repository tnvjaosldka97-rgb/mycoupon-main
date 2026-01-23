/**
 * Railway 브릿지 서버 보안 인증 미들웨어
 * X-Bridge-Secret 헤더를 검증하여 인증된 요청만 허용
 */

import { Request, Response, NextFunction } from 'express';
import { ENV } from './_core/env';

// 환경 변수에서 Secret 가져오기
const BRIDGE_SECRET = ENV.bridgeSecret || 'my-coupon-bridge-secret-2025';

/**
 * X-Bridge-Secret 헤더 검증 미들웨어
 * Railway 브릿지 서버에서 오는 요청만 허용
 */
export function validateBridgeSecret(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const bridgeSecret = req.headers['x-bridge-secret'];

  if (!bridgeSecret) {
    console.warn('[BridgeAuth] X-Bridge-Secret 헤더 누락');
    res.status(401).json({
      error: 'Unauthorized',
      message: 'X-Bridge-Secret header is required',
    });
    return;
  }

  if (bridgeSecret !== BRIDGE_SECRET) {
    console.warn('[BridgeAuth] 잘못된 X-Bridge-Secret');
    res.status(403).json({
      error: 'Forbidden',
      message: 'Invalid X-Bridge-Secret',
    });
    return;
  }

  console.log('[BridgeAuth] 인증 성공');
  next();
}

/**
 * 선택적 인증 미들웨어
 * Secret이 있으면 검증, 없으면 통과 (인증 상태만 기록)
 */
export function optionalBridgeAuth(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const bridgeSecret = req.headers['x-bridge-secret'];
  
  if (bridgeSecret) {
    (req as any).isAuthenticated = bridgeSecret === BRIDGE_SECRET;
    if ((req as any).isAuthenticated) {
      console.log('[BridgeAuth] 선택적 인증 성공');
    } else {
      console.warn('[BridgeAuth] 선택적 인증 실패 - 잘못된 Secret');
    }
  } else {
    (req as any).isAuthenticated = false;
  }
  
  next();
}

/**
 * 관리자 이메일 검증
 */
export function isAdminEmail(email: string): boolean {
  return ENV.masterAdminEmails.includes(email);
}

/**
 * Socket.io 연결 시 관리자 인증
 */
export function validateSocketConnection(
  userId: string | number,
  email?: string
): { isValid: boolean; isAdmin: boolean; reason?: string } {
  if (!userId) {
    return { isValid: false, isAdmin: false, reason: 'userId is required' };
  }

  const isAdmin = email ? isAdminEmail(email) : false;

  return {
    isValid: true,
    isAdmin,
    reason: isAdmin ? 'Admin user' : 'Regular user',
  };
}

/**
 * Webhook Payload 검증
 */
export interface WebhookPayload {
  appId: string;
  event: string;
  userId?: string | number;
  timestamp: string;
  data: Record<string, unknown>;
}

export function validateWebhookPayload(
  payload: unknown
): { isValid: boolean; error?: string; payload?: WebhookPayload } {
  if (!payload || typeof payload !== 'object') {
    return { isValid: false, error: 'Payload must be an object' };
  }

  const p = payload as Record<string, unknown>;

  if (p.appId !== 'mycoupon') {
    return { isValid: false, error: 'Invalid appId' };
  }

  if (!p.event || typeof p.event !== 'string') {
    return { isValid: false, error: 'event is required and must be a string' };
  }

  if (!p.timestamp || typeof p.timestamp !== 'string') {
    return { isValid: false, error: 'timestamp is required and must be a string' };
  }

  if (!p.data || typeof p.data !== 'object') {
    return { isValid: false, error: 'data is required and must be an object' };
  }

  return {
    isValid: true,
    payload: {
      appId: p.appId as string,
      event: p.event as string,
      userId: p.userId as string | number | undefined,
      timestamp: p.timestamp as string,
      data: p.data as Record<string, unknown>,
    },
  };
}

/**
 * 환경 변수 설정 가이드
 */
export const BRIDGE_ENV_GUIDE = `
# Railway 브릿지 서버 연동을 위한 환경 변수 설정

# 마이쿠폰 서버 (.env)
BRIDGE_SECRET=my-coupon-bridge-secret-2025
BRIDGE_SERVER_URL=https://your-railway-url.railway.app

# Railway 서버 (.env)
BRIDGE_SECRET=my-coupon-bridge-secret-2025
MYCOUPON_SERVER_URL=https://my-coupon-bridge.com
`;
