import { useState, useEffect, useCallback } from 'react';
import { isCapacitorNative } from '@/lib/capacitor';

export type NotifPermission = 'default' | 'granted' | 'denied' | 'unsupported';

/**
 * 푸시 알림 런타임 권한 훅
 *
 * Android 13+(API 33) 에서는 POST_NOTIFICATIONS 런타임 권한이 필수.
 * Manifest 선언만으로는 알림이 작동하지 않음.
 *
 * 상태:
 *   default     → 아직 요청 안 함 (requestPermission() 호출 가능)
 *   granted     → 허용됨
 *   denied      → 영구 거부됨 → 시스템 설정 유도 필요
 *   unsupported → 환경이 Notification API를 지원하지 않음
 */
export function useNotificationPermission() {
  const [permission, setPermission] = useState<NotifPermission>('default');
  const [isRequesting, setIsRequesting] = useState(false);

  // Capacitor PushNotifications.checkPermissions() 의 receive 값을 NotifPermission 으로 매핑
  // 'granted' | 'denied' | 'prompt' | 'prompt-with-rationale' → 'granted' | 'denied' | 'default'
  const mapNativeReceive = (v: string | undefined): NotifPermission => {
    if (v === 'granted') return 'granted';
    if (v === 'denied') return 'denied';
    return 'default';
  };

  // 마운트 시 현재 권한 상태 동기화
  // 네이티브: Capacitor PushNotifications.checkPermissions() (Android 13+ POST_NOTIFICATIONS 신뢰 가능)
  // 웹:      Notification.permission (브라우저 표준 API)
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (isCapacitorNative()) {
        try {
          const { PushNotifications } = await import('@capacitor/push-notifications');
          const status = await PushNotifications.checkPermissions();
          if (!cancelled) setPermission(mapNativeReceive(status.receive));
        } catch (e) {
          console.error('[Push:native] checkPermissions 실패:', e);
          if (!cancelled) setPermission('unsupported');
        }
        return;
      }
      if (!('Notification' in window)) {
        setPermission('unsupported');
        return;
      }
      setPermission(Notification.permission as NotifPermission);
    })();
    return () => { cancelled = true; };
  }, []);

  // PR-59: 1-launch delay fix (followup_fcm_permission_state_sync 옵션 a')
  //   문제: PushPermissionBanner / usePushTokenRegistration 가 useNotificationPermission 의 다른 instance 사용.
  //         배너에서 grant → 그 instance 만 'granted' 업데이트 → usePushTokenRegistration 의 permission state 그대로
  //         → useEffect deps `permission` 미변동 → register() 미발화 → push_tokens 미등록 → silent fail.
  //   fix: requestPermission() 결과를 window CustomEvent 'fcm-perm-changed' 로 발화 + 양 hook instance 가 mount effect 에서 구독.
  //         즉시 모든 instance 의 permission state 동기화 → register() 즉시 호출 → push_tokens 즉시 등록.
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<NotifPermission>).detail;
      if (detail) setPermission(detail);
    };
    window.addEventListener('fcm-perm-changed', handler as EventListener);
    return () => window.removeEventListener('fcm-perm-changed', handler as EventListener);
  }, []);

  /**
   * 알림 권한 요청
   * - 네이티브(Capacitor): PushNotifications.requestPermissions() — Android 13+ POST_NOTIFICATIONS 시스템 다이얼로그 발화
   * - 웹: Notification.requestPermission() — 브라우저 표준
   * - 이미 granted/denied 상태면 다이얼로그 없이 현재 상태 반환
   */
  const requestPermission = useCallback(async (): Promise<NotifPermission> => {
    if (isCapacitorNative()) {
      setIsRequesting(true);
      try {
        const { PushNotifications } = await import('@capacitor/push-notifications');
        const status = await PushNotifications.requestPermissions();
        const state = mapNativeReceive(status.receive);
        setPermission(state);
        // PR-59: 1-launch delay fix — 다른 hook instance 동기화
        window.dispatchEvent(new CustomEvent<NotifPermission>('fcm-perm-changed', { detail: state }));
        console.log('[Push:native] 권한 요청 결과:', state);
        return state;
      } catch (e) {
        console.error('[Push:native] requestPermissions 실패:', e);
        return 'denied';
      } finally {
        setIsRequesting(false);
      }
    }

    if (!('Notification' in window)) return 'unsupported';
    if (Notification.permission !== 'default') {
      const current = Notification.permission as NotifPermission;
      setPermission(current);
      // PR-59: 1-launch delay fix — web path 도 동일 적용
      window.dispatchEvent(new CustomEvent<NotifPermission>('fcm-perm-changed', { detail: current }));
      return current;
    }

    setIsRequesting(true);
    try {
      const result = await Notification.requestPermission();
      const state = result as NotifPermission;
      setPermission(state);
      // PR-59: 1-launch delay fix — web path 동일
      window.dispatchEvent(new CustomEvent<NotifPermission>('fcm-perm-changed', { detail: state }));
      console.log(`[Push] 권한 요청 결과: ${state}`);
      return state;
    } catch (e) {
      console.error('[Push] Notification.requestPermission() 실패:', e);
      return 'denied';
    } finally {
      setIsRequesting(false);
    }
  }, []);

  /**
   * 시스템 알림 설정 유도 안내
   * Android에서 영구 거부 후 재허용은 반드시 시스템 설정에서만 가능.
   *
   * @capacitor/android 네이티브 intent 없이도 사용자에게 경로를 안내할 수 있음.
   * 실제 인텐트 열기는 커스텀 플러그인 또는 Capacitor Preferences + 네이티브 코드 필요.
   */
  const getSettingsGuide = useCallback((): string => {
    if (isCapacitorNative()) {
      return '설정 → 앱 → 마이쿠폰 → 알림 → 모든 마이쿠폰 알림 허용';
    }
    return '브라우저 주소창 왼쪽 자물쇠 아이콘 → 알림 → 허용';
  }, []);

  return {
    permission,
    isRequesting,
    requestPermission,
    getSettingsGuide,
    isGranted: permission === 'granted',
    isDenied: permission === 'denied',
    isPending: permission === 'default',
    isUnsupported: permission === 'unsupported',
  };
}
