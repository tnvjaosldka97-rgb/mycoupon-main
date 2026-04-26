/**
 * server/notify.cap.test.ts — Phase 2b-1 cap/cooldown/silent 룰 working 입증
 *
 * DRY-RUN mock 패턴 (F2=Y):
 *   - vi.mock('./db') — getDb/sendRealPush/createNotification 모두 mock
 *   - vi.mock('./email') — sendEmail mock
 *   - 운영 DB INSERT/SELECT/DELETE 영향 0, 외부 push/email 호출 0
 *
 * 본 레포 첫 vi.mock 도입 (기존 12 test 모두 mock 미사용 — 사장님 raw 결정 F2=Y).
 *
 * 시나리오 6종:
 *   S1: cap 5건 도달 (newly_opened_nearby) → cap_exceeded 차단
 *   S2: cap 4건 (newly_opened_nearby) → 통과 + 발송
 *   S3: cooldown match (newly_opened_nearby) → cooldown 차단
 *   S4: 야간 KST 23시 (newly_opened_nearby) → queued_for_morning + pending_queue insert
 *   S5: TRANSACTIONAL (coupon_expiring) → cap 체크 자체 도달 X (skip)
 *   S6: MERCHANT (merchant_nudge_received) → cap 체크 자체 도달 X (cooldown SELECT 1건만)
 */

import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';

const mockState = vi.hoisted(() => ({
  insertCalls: [] as Array<{ table: any; values: any }>,
  selectQueue: [] as any[],
  selectCallCount: 0,
  pushResult: { success: 1, failure: 0, invalid: 0 },
}));

vi.mock('./db', () => {
  function makeChainable(result: any) {
    const p = Promise.resolve(result);
    const c: any = {
      from: () => c,
      where: () => c,
      limit: () => c,
      then: p.then.bind(p),
      catch: p.catch.bind(p),
      finally: p.finally.bind(p),
    };
    return c;
  }
  return {
    getDb: vi.fn(async () => ({
      select: vi.fn(() => {
        mockState.selectCallCount++;
        const next = mockState.selectQueue.shift() ?? [];
        return makeChainable(next);
      }),
      insert: vi.fn((table: any) => ({
        values: vi.fn((vals: any) => {
          mockState.insertCalls.push({ table, values: vals });
          return Promise.resolve();
        }),
      })),
    })),
    sendRealPush: vi.fn(async () => mockState.pushResult),
    createNotification: vi.fn(async () => [{ id: 999 }]),
  };
});

vi.mock('./email', () => ({
  sendEmail: vi.fn(async () => true),
}));

import { notify } from './_core/notify';
import * as dbModule from './db';

beforeEach(() => {
  mockState.insertCalls.length = 0;
  mockState.selectQueue.length = 0;
  mockState.selectCallCount = 0;
  mockState.pushResult = { success: 1, failure: 0, invalid: 0 };
  vi.mocked(dbModule.sendRealPush).mockClear();
  vi.mocked(dbModule.createNotification).mockClear();
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-04-26T03:00:00Z')); // KST 12:00 (silent off)
  vi.spyOn(Math, 'random').mockReturnValue(0);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('Phase 2b-1 notify() cap/cooldown/silent 룰', () => {
  it('S1: cap 5건 도달 → cap_exceeded 차단 (newly_opened_nearby)', async () => {
    // cooldown SELECT 0건 (통과) + cap COUNT = 5 (cap exceed)
    mockState.selectQueue = [
      [],              // cooldown SELECT (recent.length=0)
      [{ cnt: 5 }],    // cap COUNT (>= 5)
    ];

    const result = await notify(1, 'newly_opened_nearby', { title: 't', message: 'm' });

    // channels = ['inapp', 'push'] → 2개 모두 cap_exceeded blocked
    expect(result.channelResults).toHaveLength(2);
    expect(result.channelResults.every(r => r.blocked && r.blockedReason === 'cap_exceeded')).toBe(true);

    // dispatch_log INSERT 2건 (cap_exceeded)
    const blockedInserts = mockState.insertCalls.filter(c => c.values.blockedReason === 'cap_exceeded');
    expect(blockedInserts).toHaveLength(2);

    // sendRealPush, createNotification 미호출
    expect(vi.mocked(dbModule.sendRealPush)).not.toHaveBeenCalled();
    expect(vi.mocked(dbModule.createNotification)).not.toHaveBeenCalled();
  });

  it('S2: cap 4건 → 통과 + 발송 (newly_opened_nearby)', async () => {
    mockState.selectQueue = [
      [],              // cooldown SELECT (recent.length=0)
      [{ cnt: 4 }],    // cap COUNT (4 < 5 → 통과)
    ];

    const result = await notify(1, 'newly_opened_nearby', { title: 't', message: 'm' });

    expect(result.channelResults).toHaveLength(2);
    expect(result.channelResults.every(r => !r.blocked)).toBe(true);

    // sendRealPush 1번 + createNotification 1번
    expect(vi.mocked(dbModule.sendRealPush)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(dbModule.createNotification)).toHaveBeenCalledTimes(1);

    // dispatch_log success INSERT 2건 (blockedReason null)
    const successInserts = mockState.insertCalls.filter(c => c.values.blockedReason == null);
    expect(successInserts).toHaveLength(2);
  });

  it('S3: cooldown match → cooldown 차단 (newly_opened_nearby)', async () => {
    mockState.selectQueue = [
      [{ id: 999 }],   // cooldown SELECT 매칭 (recent.length=1)
    ];

    const result = await notify(1, 'newly_opened_nearby', { title: 't', message: 'm' });

    expect(result.channelResults).toHaveLength(2);
    expect(result.channelResults.every(r => r.blocked && r.blockedReason === 'cooldown')).toBe(true);

    const cooldownInserts = mockState.insertCalls.filter(c => c.values.blockedReason === 'cooldown');
    expect(cooldownInserts).toHaveLength(2);

    // cap 체크 자체 도달 X (cooldown 매칭 후 즉시 return)
    expect(mockState.selectCallCount).toBe(1);

    expect(vi.mocked(dbModule.sendRealPush)).not.toHaveBeenCalled();
    expect(vi.mocked(dbModule.createNotification)).not.toHaveBeenCalled();
  });

  it('S4: 야간 KST 23시 → queued_for_morning + pending_queue insert (newly_opened_nearby)', async () => {
    vi.setSystemTime(new Date('2026-04-26T14:00:00Z')); // UTC 14:00 = KST 23:00 (silent on)

    const result = await notify(1, 'newly_opened_nearby', { title: 't', message: 'm' });

    expect(result.channelResults).toHaveLength(2);
    expect(result.channelResults.every(r => r.blocked && r.blockedReason === 'queued_for_morning')).toBe(true);

    // pending_queue 1건 + dispatch_log 2건 = 3 inserts total
    expect(mockState.insertCalls).toHaveLength(3);

    // 첫 INSERT 가 pending_queue (scheduledFor 컬럼 보유)
    expect(mockState.insertCalls[0].values).toHaveProperty('scheduledFor');
    expect(mockState.insertCalls[0].values.scheduledFor).toBeInstanceOf(Date);

    // dispatch_log 2건 모두 queued_for_morning
    const queuedInserts = mockState.insertCalls.filter(c => c.values.blockedReason === 'queued_for_morning');
    expect(queuedInserts).toHaveLength(2);

    // SELECT 도달 X (silent 분기에서 즉시 return)
    expect(mockState.selectCallCount).toBe(0);

    // sendRealPush, createNotification 미호출
    expect(vi.mocked(dbModule.sendRealPush)).not.toHaveBeenCalled();
    expect(vi.mocked(dbModule.createNotification)).not.toHaveBeenCalled();
  });

  it('S5: TRANSACTIONAL coupon_expiring → cap 체크 자체 도달 X (cooldown -1 + cap skip)', async () => {
    // coupon_expiring: cooldownMin = -1 (skip), TRANSACTIONAL → cap skip
    // selectQueue 비워둠 → SELECT 호출 0건 예상

    const result = await notify(1, 'coupon_expiring', { title: 't', message: 'm' });

    expect(result.channelResults).toHaveLength(2); // ['inapp', 'push']
    expect(result.channelResults.every(r => !r.blocked)).toBe(true);

    // cooldown SELECT skip + cap SELECT skip = 0 호출
    expect(mockState.selectCallCount).toBe(0);

    // sendRealPush + createNotification 통과 호출
    expect(vi.mocked(dbModule.sendRealPush)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(dbModule.createNotification)).toHaveBeenCalledTimes(1);
  });

  it('S6: MERCHANT merchant_nudge_received → cap 체크 자체 도달 X (cooldown SELECT 1건만)', async () => {
    // merchant_nudge_received: cooldownMin = 60 (SELECT 1건), MERCHANT → cap skip
    mockState.selectQueue = [
      [],  // cooldown SELECT (첫 호출 0건 매칭)
    ];

    const result = await notify(2, 'merchant_nudge_received', { title: 't', message: 'm' });

    expect(result.channelResults).toHaveLength(2); // ['inapp', 'push']
    expect(result.channelResults.every(r => !r.blocked)).toBe(true);

    // cooldown SELECT 1건만 (cap SELECT skip)
    expect(mockState.selectCallCount).toBe(1);

    expect(vi.mocked(dbModule.sendRealPush)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(dbModule.createNotification)).toHaveBeenCalledTimes(1);
  });
});
