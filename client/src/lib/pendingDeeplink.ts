/**
 * PendingDeeplink — 로컬 Capacitor 플러그인 JS wrapper
 *
 * MainActivity가 App Links intent URL을 정적으로 보관한 것을
 * JS 부팅 시점에 꺼내오는 브리지.
 *
 * 사용처: useAuth.ts — native guard 내부 부팅 우선순위 체인
 *   1. PendingDeeplink.getPendingUrl()   ← MainActivity 보관 URL
 *   2. App.getLaunchUrl()                ← Capacitor 표준 cold start URL
 *   3. App.addListener('appUrlOpen', …)  ← warm start / 이후 딥링크
 */
import { registerPlugin } from '@capacitor/core';

export interface PendingDeeplinkPlugin {
  getPendingUrl(): Promise<{ url: string }>;
  clearPendingUrl(): Promise<void>;
}

export const PendingDeeplink = registerPlugin<PendingDeeplinkPlugin>('PendingDeeplink');
