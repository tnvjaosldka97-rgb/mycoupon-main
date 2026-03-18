/**
 * notificationQueue.ts — BullMQ 기반 알림 발송 큐 설계 (확장 예약)
 *
 * 현재 상태: Placeholder (BullMQ 미설치, 로직 미활성화)
 * 활성화 조건: 동시 접속 유저 10만 명 초과 or setImmediate 메모리 압박 감지 시
 *
 * ── 도입 이유 ─────────────────────────────────────────────────────────────────
 * setImmediate 방식의 한계:
 *   - 발송 로직이 Node.js 메인 프로세스 힙에 상주
 *   - 10만 명 대상 시 청크 200개 × 500라운드 → 메모리 누적
 *   - 서버 재시작 시 진행 중인 발송 작업 유실
 *
 * BullMQ 도입 후 이점:
 *   - 작업을 Redis에 직렬화 → 메인 서버 메모리 제로
 *   - Worker 프로세스 수평 확장 (Railway replicas)
 *   - 서버 재시작 후 자동 재개 (at-least-once 보장)
 *   - 실패 작업 자동 재시도 (exponential backoff)
 *   - Bull Board UI로 큐 상태 실시간 모니터링
 *
 * ── 전환 체크리스트 ───────────────────────────────────────────────────────────
 * 1. pnpm add bullmq ioredis
 * 2. Railway에 Redis 서비스 추가 (REDIS_URL 환경변수 설정)
 * 3. 아래 주석 해제
 * 4. server/main.ts (또는 index.ts) 에서 notificationWorker.run() 호출
 * 5. setImmediate 블록을 enqueueNotificationJob() 호출로 교체
 * ─────────────────────────────────────────────────────────────────────────────
 */

// ── 활성화 시 사용할 타입 정의 ────────────────────────────────────────────────
export interface NotificationJobData {
  storeId:      number;
  storeName:    string;
  couponId:     number;
  couponTitle:  string;
  storeLat:     number;
  storeLng:     number;
  groupId:      string;    // notification_stats groupId
  triggeredAt:  string;    // ISO 8601
}

// ── Placeholder: 큐 등록 함수 ─────────────────────────────────────────────────
// 실전 전환 시 아래 주석 해제
export async function enqueueNotificationJob(_data: NotificationJobData): Promise<void> {
  // import { Queue } from 'bullmq';
  // import { redis } from './_core/redis';             // ioredis 클라이언트
  //
  // const notifQueue = new Queue('notifications', { connection: redis });
  //
  // await notifQueue.add('send-location-push', data, {
  //   attempts:    3,
  //   backoff:     { type: 'exponential', delay: 5_000 },
  //   removeOnComplete: { count: 500 },  // 완료 작업 최대 500개 보존
  //   removeOnFail:     { count: 200 },
  // });
  console.log('[NotifQueue:stub] Job enqueued (BullMQ 미활성화):', _data.groupId);
}

// ── Placeholder: Worker 정의 ──────────────────────────────────────────────────
// 실전 전환 시 별도 worker 프로세스 또는 server 시작 시 등록
//
// import { Worker } from 'bullmq';
// import { redis } from './_core/redis';
// import * as db from './db';
//
// export const notificationWorker = new Worker<NotificationJobData>(
//   'notifications',
//   async (job) => {
//     const { storeId, storeName, couponTitle, storeLat, storeLng, groupId } = job.data;
//
//     // ① Bounding Box SQL (Phase 1 동일)
//     // ② Phase 1.5 Dual Cool-down
//     // ③ Phase 2 Chunk INSERT + FCM Multicast (500개 단위)
//     //    → sendEachForMulticast() 결과에서 Invalid 토큰 → purgeInvalidTokens()
//     // ④ incrementDeliveredCount(groupId, chunk.length)
//
//     await db.sendLocationNotifications({ storeId, storeName, couponTitle, storeLat, storeLng, groupId });
//   },
//   {
//     connection:  redis,
//     concurrency: 3,    // 동시 처리 Worker 수 (Railway replica당)
//   }
// );
//
// notificationWorker.on('failed', (job, err) => {
//   console.error(`[NotifQueue] Job ${job?.id} failed:`, err.message);
// });
