/**
 * Rate Limiting Middleware
 * IP 기반 + 유저 기반 이중 방어
 */

import { TRPCError } from '@trpc/server';
import { captureMessage } from './sentry';

// 메모리 기반 Rate Limit Cache (Railway 단일 인스턴스에 적합)
// 프로덕션에서는 Redis로 교체 권장
interface RateLimitEntry {
  count: number;
  resetAt: number;
}

const ipCache = new Map<string, RateLimitEntry>();
const userCache = new Map<number, RateLimitEntry>();

// 주기적으로 만료된 엔트리 정리 (메모리 누수 방지)
setInterval(() => {
  const now = Date.now();
  
  // IP 캐시 정리
  for (const [ip, entry] of ipCache.entries()) {
    if (entry.resetAt < now) {
      ipCache.delete(ip);
    }
  }
  
  // 유저 캐시 정리
  for (const [userId, entry] of userCache.entries()) {
    if (entry.resetAt < now) {
      userCache.delete(userId);
    }
  }
  
  console.log(`[Rate Limit] Cache cleaned. IP: ${ipCache.size}, User: ${userCache.size}`);
}, 60 * 1000); // 1분마다 정리

/**
 * IP 기반 Rate Limiting
 * @param maxRequests 허용 요청 수
 * @param windowMs 시간 윈도우 (밀리초)
 */
export function rateLimitByIP(maxRequests: number, windowMs: number) {
  return async ({ ctx, next }: any) => {
    const ip = ctx.req.ip || 
               ctx.req.headers['x-forwarded-for'] || 
               ctx.req.socket.remoteAddress || 
               'unknown';
    
    const now = Date.now();
    const entry = ipCache.get(ip);
    
    // 새로운 IP이거나 윈도우 만료
    if (!entry || entry.resetAt < now) {
      ipCache.set(ip, {
        count: 1,
        resetAt: now + windowMs,
      });
      return next({ ctx });
    }
    
    // 요청 수 초과
    if (entry.count >= maxRequests) {
      const resetInSeconds = Math.ceil((entry.resetAt - now) / 1000);
      
      // Sentry에 Rate Limit 초과 기록
      captureMessage(`Rate limit exceeded: IP ${ip}`, 'warning');
      
      throw new TRPCError({
        code: 'TOO_MANY_REQUESTS',
        message: `요청이 너무 많습니다. ${resetInSeconds}초 후 다시 시도해주세요.`,
      });
    }
    
    // 카운트 증가
    entry.count++;
    ipCache.set(ip, entry);
    
    return next({ ctx });
  };
}

/**
 * 유저 기반 Rate Limiting
 * @param maxRequests 허용 요청 수
 * @param windowMs 시간 윈도우 (밀리초)
 */
export function rateLimitByUser(maxRequests: number, windowMs: number) {
  return async ({ ctx, next }: any) => {
    if (!ctx.user) {
      // 비로그인 유저는 IP 기반으로만 제한
      return next({ ctx });
    }
    
    const userId = ctx.user.id;
    const now = Date.now();
    const entry = userCache.get(userId);
    
    // 새로운 유저이거나 윈도우 만료
    if (!entry || entry.resetAt < now) {
      userCache.set(userId, {
        count: 1,
        resetAt: now + windowMs,
      });
      return next({ ctx });
    }
    
    // 요청 수 초과
    if (entry.count >= maxRequests) {
      const resetInSeconds = Math.ceil((entry.resetAt - now) / 1000);
      
      // Sentry에 의심스러운 유저 활동 기록
      captureMessage(`Suspicious activity: User ${userId} exceeded rate limit`, 'warning');
      
      throw new TRPCError({
        code: 'TOO_MANY_REQUESTS',
        message: `요청이 너무 많습니다. ${resetInSeconds}초 후 다시 시도해주세요.`,
      });
    }
    
    // 카운트 증가
    entry.count++;
    userCache.set(userId, entry);
    
    return next({ ctx });
  };
}

/**
 * 고위험 액션 Rate Limiting (선착순 쿠폰, 포인트 사용 등)
 * 더 엄격한 제한 적용
 */
export function rateLimitCriticalAction(maxRequests: number = 5, windowMs: number = 60000) {
  return async ({ ctx, next }: any) => {
    // IP + 유저 이중 체크
    const ip = ctx.req.ip || ctx.req.socket.remoteAddress || 'unknown';
    const userId = ctx.user?.id;
    
    const cacheKey = userId ? `critical:user:${userId}` : `critical:ip:${ip}`;
    const now = Date.now();
    
    // 간단히 Map 키로 구분
    const entry = ipCache.get(cacheKey);
    
    if (!entry || entry.resetAt < now) {
      ipCache.set(cacheKey, {
        count: 1,
        resetAt: now + windowMs,
      });
      return next({ ctx });
    }
    
    if (entry.count >= maxRequests) {
      const resetInSeconds = Math.ceil((entry.resetAt - now) / 1000);
      
      // 🚨 비즈니스 크리티컬 에러 (봇 의심)
      captureMessage(`CRITICAL: Possible bot activity - ${cacheKey}`, 'error');
      
      throw new TRPCError({
        code: 'TOO_MANY_REQUESTS',
        message: `의심스러운 활동이 감지되었습니다. ${resetInSeconds}초 후 다시 시도해주세요.`,
      });
    }
    
    entry.count++;
    ipCache.set(cacheKey, entry);
    
    return next({ ctx });
  };
}

// 캐시 상태 조회 (모니터링용)
export function getRateLimitStats() {
  return {
    ipCacheSize: ipCache.size,
    userCacheSize: userCache.size,
    totalEntries: ipCache.size + userCache.size,
  };
}
