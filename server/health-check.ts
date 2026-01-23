/**
 * Health Check API with OAuth Performance Monitoring
 * 
 * 이 파일은 서버 상태와 DB 연결을 확인하고,
 * OAuth 성능 메트릭을 수집합니다.
 */

import { getDb } from './db';
import { sql } from 'drizzle-orm';

export interface HealthCheckResponse {
  status: 'healthy' | 'degraded' | 'unhealthy';
  timestamp: string;
  uptime: number;
  database: 'connected' | 'disconnected' | 'slow';
  performance?: {
    oauth?: string;
    dbQuery?: number;
  };
}

/**
 * OAuth 성능 측정 (마지막 인증 요청 시간)
 * 실제 구현은 OAuth 미들웨어에서 측정된 값을 사용
 */
let lastOAuthDuration: number | null = null;

export function recordOAuthPerformance(duration: number) {
  lastOAuthDuration = duration;
  console.log(`[OAuth Performance] ${duration.toFixed(2)}ms`);
}

/**
 * Health Check 핸들러
 */
export async function healthCheck(): Promise<HealthCheckResponse> {
  const startTime = Date.now();
  
  let dbStatus: 'connected' | 'disconnected' | 'slow' = 'disconnected';
  let dbQueryTime: number | undefined;
  
  try {
    // DB 연결 확인 (간단한 SELECT 1 쿼리)
    const dbStartTime = Date.now();
    const db = await getDb();
    if (!db) throw new Error('DB connection failed');
    await db.execute(sql`SELECT 1`);
    dbQueryTime = Date.now() - dbStartTime;
    
    // DB 응답 시간에 따라 상태 분류
    if (dbQueryTime < 100) {
      dbStatus = 'connected';
    } else if (dbQueryTime < 500) {
      dbStatus = 'slow';
      console.warn(`[Health Check] DB 응답 느림: ${dbQueryTime}ms`);
    } else {
      dbStatus = 'slow';
      console.error(`[Health Check] DB 응답 매우 느림: ${dbQueryTime}ms`);
    }
  } catch (error) {
    console.error('[Health Check] DB 연결 실패:', error);
    dbStatus = 'disconnected';
  }
  
  // 전체 상태 판단
  let overallStatus: 'healthy' | 'degraded' | 'unhealthy' = 'healthy';
  
  if (dbStatus === 'disconnected') {
    overallStatus = 'unhealthy';
  } else if (dbStatus === 'slow') {
    overallStatus = 'degraded';
  }
  
  const response: HealthCheckResponse = {
    status: overallStatus,
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    database: dbStatus,
    performance: {
      dbQuery: dbQueryTime,
    },
  };
  
  // OAuth 성능 데이터가 있으면 추가
  if (lastOAuthDuration !== null) {
    response.performance!.oauth = `${lastOAuthDuration.toFixed(2)}ms`;
  }
  
  return response;
}
