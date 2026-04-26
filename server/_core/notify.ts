/**
 * server/_core/notify.ts — Phase 2b-1 알림 발송 wrapper (단일 진입점)
 *
 * 사용자 입장:
 *   - TRANSACTIONAL (긴급): coupon_expiring, nudge_activated → cap skip, silent skip(coupon_expiring 만)
 *   - MARKETING: newly_opened_nearby → cap 5/일 합산 (push 채널만)
 *   - new_coupon: email only — cap/cooldown 적용, push 발송 0
 *
 * 가맹점 입장 (MERCHANT): cap 미적용, cooldown 적용, silent 적용 (긴급 제외 X — 가맹점 영역)
 *
 * 채널 매핑 (followup §3): 모든 카테고리 inapp default + push/email 조합
 *
 * 흐름:
 *   1) 야간 silent (KST 22~8) — 긴급(coupon_expiring)만 통과, 나머지 → pending_queue
 *   2) cooldown 체크 (-1 = skip)
 *   3) cap 체크 (USER_MARKETING_CATEGORIES + push 채널만)
 *   4) 통과 → 채널별 발송 (inapp/push/email) + dispatch_log INSERT
 */

import { getDb, sendRealPush, createNotification } from '../db';
import { sendEmail } from '../email';
import {
  notificationDispatchLog,
  notificationPendingQueue,
  users,
} from '../../drizzle/schema';
import { eq, and, gt, sql, isNull, inArray } from 'drizzle-orm';

// ── Phase 2b 범위 카테고리 (followup §3 의 8 카테고리) ──
export type SupportedCategory =
  | 'coupon_expiring'
  | 'nudge_activated'
  | 'newly_opened_nearby'
  | 'new_coupon'
  | 'merchant_coupon_reminder'
  | 'merchant_coupon_exhausted'
  | 'merchant_plan_expiry_reminder'
  | 'merchant_nudge_received';

export type Channel = 'push' | 'email' | 'inapp';

// ── E4=(α): 사용자 입장 카테고리 분류 ──
const TRANSACTIONAL_CATEGORIES = new Set<SupportedCategory>([
  'coupon_expiring',
  'nudge_activated',
]);

// MARKETING = push cap 합산 대상. new_coupon 은 email only → 제외
const USER_MARKETING_CATEGORIES = new Set<SupportedCategory>([
  'newly_opened_nearby',
]);

const MERCHANT_CATEGORIES = new Set<SupportedCategory>([
  'merchant_coupon_reminder',
  'merchant_coupon_exhausted',
  'merchant_plan_expiry_reminder',
  'merchant_nudge_received',
]);

const USER_MARKETING_DAILY_CAP = 5;

// ── E2: 카테고리별 채널 매핑 (followup §3) — 모든 카테고리 'inapp' default ──
const CATEGORY_CHANNELS: Record<SupportedCategory, Channel[]> = {
  coupon_expiring:               ['inapp', 'push'],
  nudge_activated:               ['inapp', 'push'],
  newly_opened_nearby:           ['inapp', 'push'],
  new_coupon:                    ['inapp', 'email'],
  merchant_coupon_reminder:      ['inapp', 'push', 'email'],
  merchant_coupon_exhausted:     ['inapp', 'push', 'email'],
  merchant_plan_expiry_reminder: ['inapp', 'push', 'email'],
  merchant_nudge_received:       ['inapp', 'push'],
};

// ── D11=B': 카테고리별 cooldown (분 단위, -1 = skip) ──
const CATEGORY_COOLDOWN_MINUTES: Record<SupportedCategory, number> = {
  coupon_expiring:               -1,      // per-coupon dedup, cooldown skip
  nudge_activated:               24 * 60, // 24h (NUDGE_DEDUP_HOURS 보존)
  newly_opened_nearby:           60,      // 1h (기존 newly_opened_nearby 운영 룰 보존)
  new_coupon:                    24 * 60, // 24h
  merchant_coupon_reminder:      72 * 60, // 3 일
  merchant_coupon_exhausted:     24 * 60,
  merchant_plan_expiry_reminder: 24 * 60,
  merchant_nudge_received:       60,
};

// ── 야간 silent KST 22~8시 (긴급 coupon_expiring 즉시 통과) ──
const SILENT_HOUR_START = 22;
const SILENT_HOUR_END = 8;

// ── 카테고리 → email 함수 매핑 (sendEmail.type union) ──
// 매핑 미존재 카테고리는 'email_not_implemented' SKIP
type EmailType =
  | 'new_coupon'
  | 'expiry_reminder'
  | 'merchant_renewal_nudge'
  | 'merchant_coupon_reminder'
  | 'merchant_plan_expiry_reminder';

const CATEGORY_EMAIL_TYPE: Partial<Record<SupportedCategory, EmailType>> = {
  coupon_expiring:               'expiry_reminder',
  new_coupon:                    'new_coupon',
  merchant_coupon_reminder:      'merchant_coupon_reminder',
  merchant_plan_expiry_reminder: 'merchant_plan_expiry_reminder',
  merchant_nudge_received:       'merchant_renewal_nudge',
  // merchant_coupon_exhausted 는 sendEmail.type union 미존재 → SKIP
};

// ── KST 시간대 hour ──
function getKstHour(): number {
  return (new Date().getUTCHours() + 9) % 24;
}

function isSilentHours(): boolean {
  const h = getKstHour();
  return h >= SILENT_HOUR_START || h < SILENT_HOUR_END;
}

// 다음 KST 8시 + jitter(0~15분) timestamp
// KST 8시 = UTC 23시 (전일)
function nextMorningWithJitter(): Date {
  const now = new Date();
  const next = new Date(now);
  next.setUTCHours(23, 0, 0, 0); // KST 다음 08:00 = UTC 23:00 (같은 UTC 일자)
  if (next.getTime() <= now.getTime()) {
    next.setUTCDate(next.getUTCDate() + 1);
  }
  const jitterMs = Math.floor(Math.random() * 15 * 60 * 1000);
  return new Date(next.getTime() + jitterMs);
}

export interface NotifyPayload {
  title: string;
  message: string;
  relatedId?: number;
  targetUrl?: string;
  groupId?: string;   // Phase 2c (H1=a-1): notification_stats 통계 추적 키 (chunk bulk 발송 시)
}

export interface ChannelResult {
  channel: Channel;
  blocked: boolean;
  blockedReason: string | null;
  success: number;
  failure: number;
  invalid: number;
}

export interface NotifyResult {
  category: SupportedCategory;
  channelResults: ChannelResult[];
}

/**
 * notify — Phase 2b-1 알림 발송 wrapper
 *
 * 호출 예:
 *   await notify(userId, 'coupon_expiring', { title: '만료 임박', message: '...', targetUrl: '/coupons/123' });
 */
export async function notify(
  userId: number,
  category: SupportedCategory,
  payload: NotifyPayload,
): Promise<NotifyResult> {
  const result: NotifyResult = { category, channelResults: [] };
  const channels = CATEGORY_CHANNELS[category];
  if (!channels) {
    throw new Error(`[notify] Unknown category: ${category}`);
  }

  const db = await getDb();
  if (!db) {
    console.warn(`[notify] DB unavailable, skip notify userId=${userId} category=${category}`);
    return result;
  }

  // ── (1) 야간 silent (긴급 coupon_expiring 즉시 통과) ──
  if (isSilentHours() && category !== 'coupon_expiring') {
    const scheduledFor = nextMorningWithJitter();
    await db.insert(notificationPendingQueue).values({
      userId,
      category,
      payload: payload as unknown as Record<string, unknown>,
      scheduledFor,
    });
    for (const channel of channels) {
      await db.insert(notificationDispatchLog).values({
        userId,
        category,
        channel,
        blockedReason: 'queued_for_morning',
      });
      result.channelResults.push({
        channel,
        blocked: true,
        blockedReason: 'queued_for_morning',
        success: 0,
        failure: 0,
        invalid: 0,
      });
    }
    return result;
  }

  // ── (2) cooldown 체크 (-1 = skip) ──
  const cooldownMin = CATEGORY_COOLDOWN_MINUTES[category];
  if (cooldownMin > 0) {
    const recent = await db
      .select({ id: notificationDispatchLog.id })
      .from(notificationDispatchLog)
      .where(
        and(
          eq(notificationDispatchLog.userId, userId),
          eq(notificationDispatchLog.category, category),
          gt(notificationDispatchLog.sentAt, sql`NOW() - (${cooldownMin} || ' minutes')::interval`),
          isNull(notificationDispatchLog.blockedReason),
        ),
      )
      .limit(1);
    if (recent.length > 0) {
      for (const channel of channels) {
        await db.insert(notificationDispatchLog).values({
          userId,
          category,
          channel,
          blockedReason: 'cooldown',
        });
        result.channelResults.push({
          channel,
          blocked: true,
          blockedReason: 'cooldown',
          success: 0,
          failure: 0,
          invalid: 0,
        });
      }
      return result;
    }
  }

  // ── (3) cap 체크 (USER_MARKETING_CATEGORIES, push 채널만) — KST 자정 리셋 ──
  // 24h rolling 이 아니라 KST 오늘 00:00 이후 카운트.
  // 사장님 의도: "하루 5개, 다음날 자정에 리셋" — 알림 누적 부담 감소.
  if (USER_MARKETING_CATEGORIES.has(category)) {
    const marketingArr = Array.from(USER_MARKETING_CATEGORIES);
    const recent = await db
      .select({ cnt: sql<number>`COUNT(*)::int` })
      .from(notificationDispatchLog)
      .where(
        and(
          eq(notificationDispatchLog.userId, userId),
          inArray(notificationDispatchLog.category, marketingArr),
          eq(notificationDispatchLog.channel, 'push'),
          gt(notificationDispatchLog.sentAt, sql`(NOW() AT TIME ZONE 'Asia/Seoul')::date AT TIME ZONE 'Asia/Seoul'`),
          isNull(notificationDispatchLog.blockedReason),
        ),
      );
    const count = Number(recent[0]?.cnt ?? 0);
    if (count >= USER_MARKETING_DAILY_CAP) {
      for (const channel of channels) {
        await db.insert(notificationDispatchLog).values({
          userId,
          category,
          channel,
          blockedReason: 'cap_exceeded',
        });
        result.channelResults.push({
          channel,
          blocked: true,
          blockedReason: 'cap_exceeded',
          success: 0,
          failure: 0,
          invalid: 0,
        });
      }
      return result;
    }
  }

  // ── (4) 통과 → 채널별 발송 ──
  for (const channel of channels) {
    if (channel === 'inapp') {
      try {
        await createNotification({
          userId,
          title: payload.title,
          message: payload.message,
          type: category as any, // notificationTypeEnum 호환 (8 카테고리 모두 enum 등록됨)
          relatedId: payload.relatedId ?? null,
          targetUrl: payload.targetUrl ?? null,
          groupId: payload.groupId ?? null,   // Phase 2c (H1=a-1)
        });
        await db.insert(notificationDispatchLog).values({
          userId,
          category,
          channel,
          successCount: 1,
        });
        result.channelResults.push({
          channel,
          blocked: false,
          blockedReason: null,
          success: 1,
          failure: 0,
          invalid: 0,
        });
      } catch (e) {
        console.error(`[notify:inapp] userId=${userId} category=${category} error:`, e);
        await db.insert(notificationDispatchLog).values({
          userId,
          category,
          channel,
          failureCount: 1,
        });
        result.channelResults.push({
          channel,
          blocked: false,
          blockedReason: null,
          success: 0,
          failure: 1,
          invalid: 0,
        });
      }
    } else if (channel === 'push') {
      try {
        const pushResult = await sendRealPush({
          userId,
          title: payload.title,
          message: payload.message,
          targetUrl: payload.targetUrl ?? null,
        });
        await db.insert(notificationDispatchLog).values({
          userId,
          category,
          channel,
          successCount: pushResult.success,
          failureCount: pushResult.failure,
          invalidCount: pushResult.invalid,
        });
        result.channelResults.push({
          channel,
          blocked: false,
          blockedReason: null,
          success: pushResult.success,
          failure: pushResult.failure,
          invalid: pushResult.invalid,
        });
      } catch (e) {
        console.error(`[notify:push] userId=${userId} category=${category} error:`, e);
        await db.insert(notificationDispatchLog).values({
          userId,
          category,
          channel,
          failureCount: 1,
        });
        result.channelResults.push({
          channel,
          blocked: false,
          blockedReason: null,
          success: 0,
          failure: 1,
          invalid: 0,
        });
      }
    } else if (channel === 'email') {
      const emailType = CATEGORY_EMAIL_TYPE[category];
      if (!emailType) {
        await db.insert(notificationDispatchLog).values({
          userId,
          category,
          channel,
          blockedReason: 'email_not_implemented',
        });
        result.channelResults.push({
          channel,
          blocked: true,
          blockedReason: 'email_not_implemented',
          success: 0,
          failure: 0,
          invalid: 0,
        });
        continue;
      }

      const userRows = await db
        .select({ email: users.email })
        .from(users)
        .where(eq(users.id, userId))
        .limit(1);
      const email = userRows[0]?.email;
      if (!email) {
        await db.insert(notificationDispatchLog).values({
          userId,
          category,
          channel,
          blockedReason: 'no_email',
        });
        result.channelResults.push({
          channel,
          blocked: true,
          blockedReason: 'no_email',
          success: 0,
          failure: 0,
          invalid: 0,
        });
        continue;
      }

      try {
        const sent = await sendEmail({
          userId,
          email,
          subject: payload.title,
          html: payload.message,
          type: emailType,
        });
        await db.insert(notificationDispatchLog).values({
          userId,
          category,
          channel,
          successCount: sent ? 1 : 0,
          failureCount: sent ? 0 : 1,
        });
        result.channelResults.push({
          channel,
          blocked: false,
          blockedReason: null,
          success: sent ? 1 : 0,
          failure: sent ? 0 : 1,
          invalid: 0,
        });
      } catch (e) {
        console.error(`[notify:email] userId=${userId} category=${category} error:`, e);
        await db.insert(notificationDispatchLog).values({
          userId,
          category,
          channel,
          failureCount: 1,
        });
        result.channelResults.push({
          channel,
          blocked: false,
          blockedReason: null,
          success: 0,
          failure: 1,
          invalid: 0,
        });
      }
    }
  }

  return result;
}

// ── 외부 노출 (Phase 2b-2 queue flush, 테스트용) ──
export {
  TRANSACTIONAL_CATEGORIES,
  USER_MARKETING_CATEGORIES,
  MERCHANT_CATEGORIES,
  CATEGORY_CHANNELS,
  CATEGORY_COOLDOWN_MINUTES,
  USER_MARKETING_DAILY_CAP,
};
