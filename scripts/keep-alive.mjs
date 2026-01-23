#!/usr/bin/env node
/**
 * Keep-Alive & DB Warm-up Script
 * 
 * 목적:
 * 1. 서버 휴면 방지 (Cold Start 차단)
 * 2. DB Connection Pool 활성 상태 유지
 * 3. 5분마다 실서버에 핑 전송
 * 
 * 사용법:
 * node scripts/keep-alive.mjs
 * 
 * 또는 백그라운드 실행:
 * nohup node scripts/keep-alive.mjs > /tmp/keep-alive.log 2>&1 &
 */

import https from 'https';
import http from 'http';

// 실서버 주소 설정
const PRODUCTION_URL = 'https://mycoupon-bridge.com';
const HEALTH_ENDPOINT = '/api/health';
const PING_INTERVAL = 5 * 60 * 1000; // 5분 (밀리초)

/**
 * HTTP/HTTPS 요청 헬퍼
 */
function makeRequest(url) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const client = urlObj.protocol === 'https:' ? https : http;
    
    const startTime = Date.now();
    
    const req = client.get(url, { timeout: 10000 }, (res) => {
      const duration = Date.now() - startTime;
      let data = '';
      
      res.on('data', (chunk) => {
        data += chunk;
      });
      
      res.on('end', () => {
        resolve({
          statusCode: res.statusCode,
          duration,
          data: data.substring(0, 500), // 처음 500자만 저장
        });
      });
    });
    
    req.on('error', (error) => {
      reject(error);
    });
    
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Request timeout'));
    });
  });
}

/**
 * 서버 핑 전송 (Health Check + DB Warm-up)
 */
async function pingServer() {
  const timestamp = new Date().toISOString();
  console.log(`\n[${timestamp}] 🔄 Keep-Alive 핑 전송 시작...`);
  
  try {
    const result = await makeRequest(PRODUCTION_URL + HEALTH_ENDPOINT);
    
    console.log(`✅ 서버 응답 성공`);
    console.log(`   - 상태 코드: ${result.statusCode}`);
    console.log(`   - 응답 시간: ${result.duration}ms`);
    
    // 응답 데이터 파싱 시도
    try {
      const healthData = JSON.parse(result.data);
      console.log(`   - 서버 상태: ${healthData.status || 'unknown'}`);
      console.log(`   - DB 상태: ${healthData.database || 'unknown'}`);
      
      if (healthData.performance) {
        console.log(`   - OAuth 성능: ${healthData.performance.oauth || 'N/A'}`);
      }
    } catch (parseError) {
      // JSON 파싱 실패 시 원본 데이터 일부 출력
      console.log(`   - 응답 데이터: ${result.data.substring(0, 100)}...`);
    }
    
    // 성능 경고
    if (result.duration > 1000) {
      console.warn(`⚠️  경고: 응답 시간이 1초를 초과했습니다 (${result.duration}ms)`);
    } else if (result.duration > 500) {
      console.warn(`⚠️  주의: 응답 시간이 500ms를 초과했습니다 (${result.duration}ms)`);
    }
    
  } catch (error) {
    console.error(`❌ 서버 핑 실패:`, error.message);
    
    // 재시도 로직 (1회)
    console.log(`   🔄 5초 후 재시도...`);
    await new Promise(resolve => setTimeout(resolve, 5000));
    
    try {
      const retryResult = await makeRequest(PRODUCTION_URL + HEALTH_ENDPOINT);
      console.log(`✅ 재시도 성공 (응답 시간: ${retryResult.duration}ms)`);
    } catch (retryError) {
      console.error(`❌ 재시도 실패:`, retryError.message);
    }
  }
}

/**
 * 메인 실행 함수
 */
async function main() {
  console.log('='.repeat(60));
  console.log('🚀 Keep-Alive & DB Warm-up 스크립트 시작');
  console.log('='.repeat(60));
  console.log(`📍 대상 서버: ${PRODUCTION_URL}`);
  console.log(`⏱️  핑 간격: ${PING_INTERVAL / 1000}초 (${PING_INTERVAL / 60000}분)`);
  console.log(`🎯 엔드포인트: ${HEALTH_ENDPOINT}`);
  console.log('='.repeat(60));
  
  // 즉시 첫 번째 핑 전송
  await pingServer();
  
  // 주기적으로 핑 전송
  setInterval(async () => {
    await pingServer();
  }, PING_INTERVAL);
  
  console.log(`\n✅ Keep-Alive 스케줄러 활성화됨 (${PING_INTERVAL / 60000}분마다 실행)`);
  console.log(`💡 종료하려면 Ctrl+C를 누르세요.\n`);
}

// 스크립트 실행
main().catch((error) => {
  console.error('❌ 치명적 오류:', error);
  process.exit(1);
});

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\n\n👋 Keep-Alive 스크립트 종료 중...');
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('\n\n👋 Keep-Alive 스크립트 종료 중...');
  process.exit(0);
});
