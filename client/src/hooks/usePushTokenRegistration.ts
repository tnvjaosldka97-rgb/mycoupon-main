import { useEffect } from 'react';
import { useLocation } from 'wouter';
import { isCapacitorNative } from '@/lib/capacitor';
import { trpc } from '@/lib/trpc';
import { useAuth } from '@/hooks/useAuth';
import { useNotificationPermission } from '@/hooks/useNotificationPermission';
import { getDeviceId } from '@/lib/deviceId';

// Capacitor PushNotifications 리스너는 앱 lifetime 동안 1회만 등록.
// 모듈 레벨 가드 + ref 패턴: 콜백이 항상 최신 user/mutation/setLocation 을 참조하도록 한다.
let listenersInstalled = false;
const liveRefs = {
  userId: 0,
  registerTokenMutate: null as ((args: { deviceToken: string; osType: 'android' | 'ios'; deviceId: string }) => Promise<unknown>) | null,
  setLocation: null as ((path: string) => void) | null,
};

function detectOsType(): 'android' | 'ios' {
  try {
    const platform = (window as unknown as { Capacitor?: { getPlatform?: () => string } }).Capacitor?.getPlatform?.();
    return platform === 'ios' ? 'ios' : 'android';
  } catch {
    return 'android';
  }
}

/**
 * FCM 토큰 등록 훅 — 앱 부팅 후 인증 + 권한 확인되면 토큰을 서버에 UPSERT.
 *
 * 동작 조건 (모두 true일 때만 register 호출):
 *   - isCapacitorNative()           — 네이티브 앱 환경
 *   - isAuthenticated && user.id    — 로그인된 사용자 (protectedProcedure)
 *   - permission === 'granted'      — POST_NOTIFICATIONS 허용됨
 *
 * 흐름:
 *   1) PushNotifications.register() 호출 → FCM 토큰 발급/조회
 *   2) 'registration' 리스너에서 토큰 수신 → trpc.notifications.registerToken UPSERT
 *   3) 'pushNotificationActionPerformed' 리스너 → data.targetUrl 로 SPA 라우팅
 *
 * 계정 전환: user.id 변경 시 register() 재호출 → 동일 deviceId 로 UPSERT
 *           서버 upsertPushToken 이 소유권 이전을 자동 처리.
 *
 * 미발송 단계: 본 단계는 토큰 수집만. firebase-admin 발송은 다음 단계.
 */
export function usePushTokenRegistration() {
  const { user, isAuthenticated } = useAuth();
  const { isGranted, permission, requestPermission } = useNotificationPermission();
  const [, setLocation] = useLocation();
  const registerToken = trpc.notifications.registerToken.useMutation();

  // 매 렌더마다 최신 참조 갱신 — 리스너 콜백은 closure 대신 ref 로 읽음
  liveRefs.userId = user?.id ?? 0;
  liveRefs.registerTokenMutate = (args) => registerToken.mutateAsync(args);
  liveRefs.setLocation = setLocation;

  useEffect(() => {
    if (!isCapacitorNative()) return;
    if (!isAuthenticated || !user) return;

    // Android 13+ POST_NOTIFICATIONS 런타임 권한 자동 요청
    // permission === 'default' (한 번도 요청 안 함) 시 시스템 다이얼로그 자동 발화
    // (카톡/인스타/배민 패턴 — 첫 로그인 직후 자동)
    if (permission === 'default') {
      void requestPermission();
      return;
    }

    if (!isGranted) return;

    let cancelled = false;
    (async () => {
      try {
        const { PushNotifications } = await import('@capacitor/push-notifications');

        if (!listenersInstalled) {
          listenersInstalled = true;

          await PushNotifications.addListener('registration', async (t) => {
            const uid = liveRefs.userId;
            if (!uid) {
              console.log('[FCM] token received but no authenticated user — skip UPSERT');
              return;
            }
            const tokenLen = t.value?.length ?? 0;
            console.log('[FCM] registration token received — len:', tokenLen, '| userId:', uid);
            try {
              await liveRefs.registerTokenMutate?.({
                deviceToken: t.value,
                osType: detectOsType(),
                deviceId: getDeviceId(),
              });
              console.log('[FCM] UPSERT success — userId:', uid, '| deviceId prefix:', getDeviceId().slice(0, 8));
            } catch (err) {
              console.error('[FCM] registerToken mutation failed:', err);
            }
          });

          await PushNotifications.addListener('registrationError', (err) => {
            console.error('[FCM] registrationError:', JSON.stringify(err));
          });

          await PushNotifications.addListener('pushNotificationReceived', async (n) => {
            console.log('[FCM] foreground push received:', n.title, '|', n.body);
            // 카톡/네이버 패턴: foreground 시에도 OS status bar 알림 강제 표시.
            // Capacitor PushNotifications 기본 동작 = foreground 시 OS bar X (사용자 방해 방지).
            // → LocalNotifications 로 직접 OS notification 발화 = 일관된 UX.
            try {
              const { LocalNotifications } = await import('@capacitor/local-notifications');
              await LocalNotifications.schedule({
                notifications: [{
                  title: n.title ?? '마이쿠폰',
                  body: n.body ?? '',
                  id: Math.floor(Date.now() % 2147483647),
                  extra: n.data ?? {},
                  // sound, smallIcon 등 default 사용 (AndroidManifest channelId='default' 와 일치)
                }],
              });
            } catch (e) {
              console.error('[FCM] LocalNotifications.schedule failed:', e);
            }
          });

          await PushNotifications.addListener('pushNotificationActionPerformed', (action) => {
            const targetUrl = (action.notification.data as Record<string, unknown> | undefined)?.targetUrl;
            console.log('[FCM] tap action → targetUrl:', targetUrl);
            if (typeof targetUrl === 'string' && targetUrl.startsWith('/') && liveRefs.setLocation) {
              liveRefs.setLocation(targetUrl);
            }
          });
        }

        if (cancelled) return;
        // register() 는 idempotent — 매 호출 시 cached FCM 토큰으로 'registration' 이벤트 재발화.
        // user.id 변경(계정 전환) 시 재호출되어 새 userId 로 서버 UPSERT 트리거.
        await PushNotifications.register();
      } catch (e) {
        console.error('[FCM] init failed:', e);
      }
    })();

    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthenticated, isGranted, user?.id, permission, requestPermission]);
}
