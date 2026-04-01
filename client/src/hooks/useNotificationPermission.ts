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

  // 마운트 시 현재 권한 상태 동기화
  useEffect(() => {
    if (!('Notification' in window)) {
      setPermission('unsupported');
      return;
    }
    setPermission(Notification.permission as NotifPermission);
  }, []);

  /**
   * 알림 권한 요청
   * - Android 13+: 시스템 다이얼로그가 뜸 (한 번 거부하면 다시 요청 불가)
   * - 이미 granted/denied 상태면 시스템 다이얼로그 없이 현재 상태 반환
   */
  const requestPermission = useCallback(async (): Promise<NotifPermission> => {
    if (!('Notification' in window)) return 'unsupported';
    if (Notification.permission !== 'default') {
      const current = Notification.permission as NotifPermission;
      setPermission(current);
      return current;
    }

    setIsRequesting(true);
    try {
      const result = await Notification.requestPermission();
      const state = result as NotifPermission;
      setPermission(state);
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
