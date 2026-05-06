import { useState, useEffect, useCallback, useRef } from 'react';
import { App } from '@capacitor/app';
import { isCapacitorNative } from '@/lib/capacitor';
import { suspendBadgeClear } from '@/lib/badgeClear';

/**
 * PR-68 / PR-91-C — 백그라운드 위치 권한 ("항상 허용") 안내 모달 hook.
 *
 * Android 11+ 정책: ACCESS_BACKGROUND_LOCATION 은 앱 다이얼로그 직접 표시 불가.
 * 카톡/네이버지도/배민 동일 패턴 — 안내 모달 + Settings 자동 이동만 가능.
 *
 * PR-91-C 사장님 명세 (forceMode 폐지):
 *   - 모달 dismiss 항상 가능 (X / 외부 터치 / [나중에 하기])
 *   - "항상 허용" 강제 X — 메리트 설명으로 설득
 *
 * CustomEvent 기반 단일 instance.
 */
export type BgLocationPermStatus = 'unknown' | 'granted' | 'denied';

export function useBackgroundLocationGuide() {
  const [status, setStatus] = useState<BgLocationPermStatus>('unknown');
  const [modalOpen, setModalOpen] = useState(false);

  const statusRef = useRef<BgLocationPermStatus>('unknown');
  useEffect(() => { statusRef.current = status; }, [status]);

  useEffect(() => {
    if (!isCapacitorNative()) return;
    const onDenied = () => {
      setStatus('denied');
      setModalOpen(true);
    };
    const onGranted = () => {
      setStatus('granted');
      setModalOpen(false);
    };
    const onForcePrompt = () => {
      if (statusRef.current === 'granted') return;
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
    setModalOpen(false);
  }, []);

  return { status, modalOpen, openSettings, dismiss };
}
