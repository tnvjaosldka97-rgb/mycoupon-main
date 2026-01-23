/**
 * Keep-alive 스케줄러
 * 
 * 서버가 잠들지 않도록 1분마다 헬스체크 엔드포인트를 호출합니다.
 * Cold Start 문제를 방지하여 사용자 경험을 개선합니다.
 */

const KEEPALIVE_INTERVAL = 60 * 1000; // 1분
const PERFORMANCE_THRESHOLD = 500; // 500ms 초과 시 경고
// 환경 변수에서 앱 URL 가져오기 (프로덕션 환경에서는 실제 도메인 사용)
const HEALTHCHECK_URL = process.env.APP_URL || 'http://localhost:3000';

let keepaliveTimer: NodeJS.Timeout | null = null;

/**
 * 헬스체크 요청을 보내는 함수
 */
async function sendHealthcheck() {
  try {
    const startTime = Date.now();
    const response = await fetch(`${HEALTHCHECK_URL}/api/health`, {
      method: 'GET',
      headers: {
        'User-Agent': 'Keep-Alive-Scheduler',
      },
    });
    const responseTime = Date.now() - startTime;
    
    if (response.ok) {
      // 성능 수치가 500ms 초과 시에만 경고 표시
      if (responseTime > PERFORMANCE_THRESHOLD) {
        console.warn(`[Keep-alive] ⚠️ Slow response: ${responseTime}ms (threshold: ${PERFORMANCE_THRESHOLD}ms)`);
      } else {
        console.log(`[Keep-alive] ✅ Healthcheck successful (${responseTime}ms)`);
      }
    } else {
      console.warn(`[Keep-alive] ⚠️ Status ${response.status} (${responseTime}ms)`);
    }
  } catch (error) {
    console.error('[Keep-alive] ❌ Failed:', error);
  }
}

/**
 * Keep-alive 스케줄러 시작
 */
export function startKeepAlive() {
  if (keepaliveTimer) {
    console.warn('[Keep-Alive] Scheduler is already running');
    return;
  }

  console.log(`[Keep-Alive] 🚀 Starting scheduler (interval: ${KEEPALIVE_INTERVAL / 1000}s)`);
  
  // 즉시 한 번 실행
  sendHealthcheck();
  
  // 1분마다 반복 실행
  keepaliveTimer = setInterval(sendHealthcheck, KEEPALIVE_INTERVAL);
}

/**
 * Keep-alive 스케줄러 중지
 */
export function stopKeepAlive() {
  if (keepaliveTimer) {
    clearInterval(keepaliveTimer);
    keepaliveTimer = null;
    console.log('[Keep-Alive] 🛑 Scheduler stopped');
  }
}
