import { useEffect, useRef } from 'react';
import { trpc } from '@/lib/trpc';
import { isCapacitorNative } from '@/lib/capacitor';
import { useAuth } from '@/hooks/useAuth';

/**
 * PR-58: 백그라운드 위치 추적 (사용자 앱 minimized 상태에서도 GPS).
 *
 * 사장님 명시:
 *   - 대다수 사용자 = 앱 닫고 다님 (실제 사용 패턴)
 *   - GPS 이동 시마다 server 위치 갱신 + nearby_store / newly_opened_nearby push 도달 의무
 *
 * 라이브러리: @capacitor-community/background-geolocation (무료, MIT)
 * 동작 환경: Capacitor 네이티브 (Android/iOS APK) — web 미지원
 *
 * 가드 (다른 hook 와 정합):
 *   - isCapacitorNative() = true 만 (web 환경 미지원)
 *   - isAuthenticated + user.id = 로그인 사용자만
 *   - locationNotificationsEnabled = true (서버 SELECT 로 검증, server gate 정합)
 *
 * 한계:
 *   - 사용자 force-quit (최근 앱 swipe 강제 종료) → OS 정책 추적 중단 (카톡 동일)
 *   - 앱 minimized (홈 버튼 / 다른 앱 사용) → ForegroundService 로 영구 추적 OK
 *
 * 정책:
 *   - 50m drift filter (배터리 절약, server 도배 방지)
 *   - foreground notification = 영구 표시 (Android 정책)
 */
export function useBackgroundLocation() {
  const { user, isAuthenticated } = useAuth();
  const updateLocation = trpc.users.updateLocation.useMutation();
  const watcherIdRef = useRef<string | null>(null);
  const livePushRef = useRef<((args: { latitude: number; longitude: number; accuracy?: number }) => Promise<unknown>) | null>(null);

  // 매 렌더마다 최신 mutation 참조 — listener closure 가 stale mutation 방지
  livePushRef.current = (args) => updateLocation.mutateAsync({
    latitude: args.latitude,
    longitude: args.longitude,
    accuracy: args.accuracy,
  });

  useEffect(() => {
    if (!isCapacitorNative()) return;
    if (!isAuthenticated || !user?.id) return;

    let cancelled = false;

    (async () => {
      try {
        const mod = await import('@capacitor-community/background-geolocation');
        const BackgroundGeolocation = (mod as any).BackgroundGeolocation ?? (mod as any).default;
        if (!BackgroundGeolocation) {
          console.error('[BgLocation] plugin not loaded');
          return;
        }

        if (cancelled) return;

        const watcherId = await BackgroundGeolocation.addWatcher(
          {
            backgroundMessage: '마이쿠폰이 위치를 사용하여 근처 쿠폰을 알려드립니다',
            backgroundTitle: '마이쿠폰 위치 추적',
            requestPermissions: true,
            stale: false,
            distanceFilter: 50,
          },
          (location: any, error: any) => {
            if (error) {
              if (error.code === 'NOT_AUTHORIZED') {
                console.warn('[BgLocation] permission denied — user must allow background location');
              } else {
                console.error('[BgLocation] error:', error);
              }
              return;
            }
            if (!location) return;
            console.log('[BgLocation] update:', location.latitude, location.longitude, location.accuracy);
            void livePushRef.current?.({
              latitude: location.latitude,
              longitude: location.longitude,
              accuracy: location.accuracy,
            }).catch((err) => console.error('[BgLocation] updateLocation mutation failed:', err));
          },
        );

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
        (async () => {
          try {
            const mod = await import('@capacitor-community/background-geolocation');
            const BackgroundGeolocation = (mod as any).BackgroundGeolocation ?? (mod as any).default;
            await BackgroundGeolocation?.removeWatcher({ id: wid });
            console.log('[BgLocation] watcher removed:', wid);
          } catch {
            // unmount 시 fail 무시
          }
        })();
        watcherIdRef.current = null;
      }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthenticated, user?.id]);
}
