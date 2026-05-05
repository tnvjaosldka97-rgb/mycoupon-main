import { useEffect, useRef, useState } from 'react';
import { registerPlugin } from '@capacitor/core';
import type { BackgroundGeolocationPlugin } from '@capacitor-community/background-geolocation';
import { trpc } from '@/lib/trpc';
import { isCapacitorNative } from '@/lib/capacitor';
import { useAuth } from '@/hooks/useAuth';

/**
 * PR-58: 백그라운드 위치 추적 (사용자 앱 minimized 상태에서도 GPS).
 *
 * 라이브러리: @capacitor-community/background-geolocation (무료 MIT)
 * - JS entry 없음 (Capacitor native bridge 전용) → registerPlugin() 패턴 사용 (Capacitor 표준)
 * - type-only import → vite build 에서 제거 → 빌드 entry resolve 회피
 *
 * 가드:
 *   - isCapacitorNative() = true 만 (web 환경 native bridge 없음 → 자동 skip)
 *   - isAuthenticated + user.id = 로그인 사용자만
 *
 * 한계:
 *   - force-quit (사용자 최근 앱 swipe) → OS 정책 추적 중단 (카톡 동일)
 *   - 앱 minimized → ForegroundService 영구 추적 OK
 */
const BackgroundGeolocation = registerPlugin<BackgroundGeolocationPlugin>('BackgroundGeolocation');

export function useBackgroundLocation() {
  const { user, isAuthenticated } = useAuth();
  // PR-64: cascade off — locationNotificationsEnabled OFF 시 watcher 자동 정지 (사장님 명시)
  const { data: settings } = trpc.users.getNotificationSettings.useQuery(undefined, { enabled: isAuthenticated });
  const locOn = settings?.locationNotificationsEnabled ?? false;
  const updateLocation = trpc.users.updateLocation.useMutation();
  const watcherIdRef = useRef<string | null>(null);
  const livePushRef = useRef<((args: { latitude: number; longitude: number; accuracy?: number }) => Promise<unknown>) | null>(null);
  // PR-68: 외부 'bg-location-perm-recheck' 신호 받으면 watcher 재시작 (사용자 OS Settings 다녀온 후)
  const [recheckSignal, setRecheckSignal] = useState(0);

  livePushRef.current = (args) => updateLocation.mutateAsync({
    latitude: args.latitude,
    longitude: args.longitude,
    accuracy: args.accuracy,
  });

  useEffect(() => {
    const handler = () => setRecheckSignal((c) => c + 1);
    window.addEventListener('bg-location-perm-recheck', handler);
    return () => window.removeEventListener('bg-location-perm-recheck', handler);
  }, []);

  useEffect(() => {
    if (!isCapacitorNative()) return;
    if (!isAuthenticated || !user?.id) return;
    if (!locOn) return;  // PR-64: 토글 OFF 시 watcher 시작 X (cascade off)

    let cancelled = false;
    const grantedDispatchedRef = { current: false }; // PR-68: 첫 'granted' dispatch 1회만

    (async () => {
      try {
        const watcherId = await BackgroundGeolocation.addWatcher(
          {
            backgroundMessage: '마이쿠폰이 위치를 사용하여 근처 쿠폰을 알려드립니다',
            backgroundTitle: '마이쿠폰 위치 추적',
            requestPermissions: true,
            stale: false,
            distanceFilter: 50,
          },
          (location, error) => {
            if (error) {
              if (error.code === 'NOT_AUTHORIZED') {
                console.warn('[BgLocation] permission denied');
                // PR-68: 백그라운드 위치 권한 NG → 모달 트리거
                window.dispatchEvent(new CustomEvent('bg-location-perm-denied'));
              } else {
                console.error('[BgLocation] error:', error);
              }
              return;
            }
            if (!location) return;
            console.log('[BgLocation] update:', location.latitude, location.longitude, location.accuracy);
            // PR-68: 첫 location 수신 = 권한 OK 신호 → 모달 자동 닫음
            if (!grantedDispatchedRef.current) {
              grantedDispatchedRef.current = true;
              window.dispatchEvent(new CustomEvent('bg-location-perm-granted'));
            }
            void livePushRef.current?.({
              latitude: location.latitude,
              longitude: location.longitude,
              accuracy: location.accuracy,
            }).catch((err) => console.error('[BgLocation] mutation failed:', err));
          },
        );

        if (cancelled) {
          await BackgroundGeolocation.removeWatcher({ id: watcherId });
          return;
        }
        watcherIdRef.current = watcherId;
        console.log('[BgLocation] watcher started:', watcherId);
      } catch (e) {
        console.error('[BgLocation] init failed:', e);
      }
    })();

    return () => {
      cancelled = true;
      const wid = watcherIdRef.current;
      if (wid) {
        BackgroundGeolocation.removeWatcher({ id: wid })
          .then(() => console.log('[BgLocation] watcher removed:', wid))
          .catch(() => { /* unmount cleanup fail 무시 */ });
        watcherIdRef.current = null;
      }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthenticated, user?.id, locOn, recheckSignal]);
}
