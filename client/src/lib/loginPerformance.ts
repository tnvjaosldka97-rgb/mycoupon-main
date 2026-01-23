/**
 * E2E 로그인 성능 측정 유틸리티
 * 로그인 버튼 클릭부터 세션 저장까지 전체 시간 측정
 */

const LOGIN_PERF_KEY = 'login_perf_start';

/**
 * 로그인 시작 시간 기록 (로그인 버튼 클릭 시)
 */
export function markLoginStart() {
  const startTime = performance.now();
  sessionStorage.setItem(LOGIN_PERF_KEY, startTime.toString());
  console.log('[Login Performance] 로그인 시작:', new Date().toISOString());
}

/**
 * 로그인 완료 시간 측정 및 보고 (OAuth 콜백 후 세션 확인 시)
 */
export function measureLoginComplete() {
  const startTimeStr = sessionStorage.getItem(LOGIN_PERF_KEY);
  if (!startTimeStr) {
    console.warn('[Login Performance] 시작 시간이 기록되지 않음');
    return null;
  }

  const startTime = parseFloat(startTimeStr);
  const endTime = performance.now();
  const totalTime = endTime - startTime;

  // 측정 완료 후 삭제
  sessionStorage.removeItem(LOGIN_PERF_KEY);

  const result = {
    totalTime: Math.round(totalTime),
    startTime: new Date(Date.now() - totalTime).toISOString(),
    endTime: new Date().toISOString(),
    isFast: totalTime < 500,
  };

  console.log(
    `[Login Performance] ===== E2E 로그인 완료 =====\n` +
    `총 소요 시간: ${result.totalTime}ms\n` +
    `목표 달성: ${result.isFast ? '✅ PASS (<500ms)' : '❌ FAIL (≥500ms)'}\n` +
    `시작: ${result.startTime}\n` +
    `완료: ${result.endTime}`
  );

  // 서버로 측정 결과 전송 (비동기, 실패해도 무시)
  fetch('/api/trpc/system.reportLoginPerformance', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ json: result }),
  }).catch(err => {
    console.warn('[Login Performance] 서버 전송 실패:', err);
  });

  return result;
}
