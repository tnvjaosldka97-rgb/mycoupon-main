import { isCapacitorNative } from '@/lib/capacitor';

/**
 * PR-91-B — BadgeClear 폭주 cap + [설정으로 이동] race 차단
 *
 * 결함 (logcat raw 증거):
 *   1분간 100+회 BadgeClear 호출 → main thread 점유 → ANR (App Not Responding)
 *   → [설정으로 이동] 클릭 시 멈춤/튕김
 *
 * fix:
 *   Layer 1) 호출 cap (1초 1회) — 폭주 차단
 *   Layer 2) [설정으로 이동] 진행 중 일시 차단 (5초) — race 영구 차단
 *
 * 사용:
 *   import { clearBadgeWithCap, suspendBadgeClear } from '@/lib/badgeClear';
 *   await clearBadgeWithCap();
 *   suspendBadgeClear(5000);  // [설정으로 이동] 직전 호출
 */

const COOLDOWN_MS = 1000;

let lastClearAt = 0;
let suspendedUntil = 0;

export function suspendBadgeClear(durationMs: number): void {
  suspendedUntil = Date.now() + durationMs;
}

export async function clearBadgeWithCap(): Promise<void> {
  if (!isCapacitorNative()) return;

  const now = Date.now();
  if (now < suspendedUntil) return;
  if (now - lastClearAt < COOLDOWN_MS) return;
  lastClearAt = now;

  try {
    const { PushNotifications } = await import('@capacitor/push-notifications');
    await PushNotifications.removeAllDeliveredNotifications();
  } catch { /* graceful */ }

  try {
    const { registerPlugin } = await import('@capacitor/core');
    const BadgeClear = registerPlugin<{ clear: () => Promise<void> }>('BadgeClear');
    await BadgeClear.clear();
  } catch { /* graceful */ }
}
