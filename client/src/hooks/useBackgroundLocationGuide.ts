import { useState, useEffect, useCallback, useRef } from 'react';
import { App } from '@capacitor/app';
import { isCapacitorNative } from '@/lib/capacitor';
import { suspendBadgeClear } from '@/lib/badgeClear';

/**
 * PR-68 / PR-91-C / PR-91-E — 백그라운드 위치 권한 안내 모달 hook.
 *
 * Android 11+ 정책: ACCESS_BACKGROUND_LOCATION 은 앱 다이얼로그 직접 표시 불가.
 * 카톡/네이버지도/배민 동일 패턴.
 *
 * PR-91-E 사장님 명세 (모달 = 정보성 팝업):
 *   - dismiss 후 그 세션 동안 모달 재발화 차단 (dismissedRef)
 *   - 사용자가 권한 부여 시 (onGranted) → ref 초기화
 *   - watcher NOT_AUTHORIZED race 영구 차단
 */
export type BgLocationPermStatus = 'unknown' | 'granted' | 'denied';

export function useBackgroundLocationGuide() {
  const [status, setStatus] = useState<BgLocationPermStatus>('unknown');
  const [modalOpen, setModalOpen] = useState(false);

  const statusRef = useRef<BgLocationPermStatus>('unknown');
  useEffect(() => { statusRef.current = status; }, [status]);

  // PR-91-E: dismiss 후 그 세션 동안 모달 재발화 차단
  //   결함 raw: useBackgroundLocation watcher 가 NOT_AUTHORIZED 마다 'bg-location-perm-denied'
  //   발화 → 사장님 dismiss 해도 즉시 재발화 → 모달 영구 표시 (race)
  //   fix: dismiss 시 ref true → onDenied/onForcePrompt 가 ref 체크하여 무시
  const dismissedRef = useRef(false);

  useEffect(() => {
    if (!isCapacitorNative()) return;
    const onDenied = () => {
      setStatus('denied');
      if (dismissedRef.current) return;  // PR-91-E: dismiss 후 차단
      setModalOpen(true);
    };
    const onGranted = () => {
      setStatus('granted');
      setModalOpen(false);
      dismissedRef.current = false;  // PR-91-E: 권한 부여 시 ref 초기화
    };
    const onForcePrompt = () => {
      if (statusRef.current === 'granted') return;
      if (dismissedRef.current) return;  // PR-91-E: dismiss 후 차단
      setModalOpen(true);
    };
    window.addEventListener('bg-location-perm-denied', onDenied as EventListener);
    window.addEventListener('bg-location-perm-granted', onGranted as EventListener);
    window.addEventListener('bg-location-perm-force-prompt', onForcePrompt as EventListener);
    return () => {
      window.removeEventListener('bg-location-perm-denied', onDenied as EventListener);
      window.removeEventListener('bg-location-perm-granted', onGranted as EventListener);
      window.removeEventListener('bg-location-perm-force-prompt', onForcePrompt as EventListener);
    };
  }, []);

  // 앱 복귀 시 권한 재체크 — useBackgroundLocation watcher 재시작 트리거
  useEffect(() => {
    if (!isCapacitorNative()) return;
    let handle: { remove: () => Promise<void> } | undefined;
    (async () => {
      try {
        handle = await App.addListener('appStateChange', (state) => {
          if (state.isActive) {
            window.dispatchEvent(new CustomEvent('bg-location-perm-recheck'));
          }
        });
      } catch (e) {
        console.warn('[BgLocGuide] appStateChange listen failed:', e);
      }
    })();
    return () => { void handle?.remove(); };
  }, []);

  const openSettings = useCallback(async () => {
    if (!isCapacitorNative()) return;
    // PR-91-B: BadgeClear 폭주 race 차단 — main thread free 보장 → ANR/멈춤 차단
    suspendBadgeClear(5000);
    try {
      const { NativeSettings, AndroidSettings } = await import('capacitor-native-settings');
      await NativeSettings.openAndroid({ option: AndroidSettings.ApplicationDetails });
    } catch (e) {
      console.warn('[BgLocGuide] openSettings failed (non-blocking):', e);
    }
  }, []);

  const dismiss = useCallback(() => {
    dismissedRef.current = true;  // PR-91-E: 그 세션 동안 재발화 차단
    setModalOpen(false);
  }, []);

  return { status, modalOpen, openSettings, dismiss };
}
