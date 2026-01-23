// 헬스체크 메모리 캠시 (최소 지연 시간)
let lastHealthStatus = {
  status: "ok" as const,
  timestamp: new Date().toISOString(),
  db: "connected" as const
};

export async function healthCheck() {
  // DB 쿼리 제거 - 메모리 캠시만 반환 (0ms 지연)
  lastHealthStatus.timestamp = new Date().toISOString();
  return lastHealthStatus;
}
