import { useState, useEffect, useCallback, useRef } from 'react';
import { App } from '@capacitor/app';
import { isCapacitorNative } from '@/lib/capacitor';

/**
 * PR-68 — 백그라운드 위치 권한 ("항상 허용") 안내 모달 hook.
 *
 * Android 11+ 정책: ACCESS_BACKGROUND_LOCATION 은 앱 다이얼로그 직접 표시 불가.
 * 사용자가 OS Settings 에서 "항상 허용" 직접 클릭해야 함.
 * 카톡/네이버지도/배민 동일 패턴 — 안내 모달 + Settings 자동 이동만 가능.
 *
 * 사장님 명시 (강도): 모든 시점 (1/2/3) 강제 모드 — [나중에] 버튼 X, 무조건 "항상 허용".
 *
 * CustomEvent 기반 단일 instance:
 *   listen: 'bg-location-perm-denied' / 'granted' / 'force-prompt' / 'recheck'
 *   App.appStateChange isActive=true → 자동 'recheck' dispatch (사용자 OS Settings 다녀온 후)
 */
export type BgLocationPermStatus = 'unknown' | 'granted' | 'denied';

export function useBackgroundLocationGuide() {
  const [status, setStatus] = useState<BgLocationPermStatus>('unknown');
  const [modalOpen, setModalOpen] = useState(false);
  const [forceMode, setForceMode] = useState(false);

  const statusRef = useRef<BgLocationPermStatus>('unknown');
  useEffect(() => { statusRef.current = status; }, [status]);

  useEffect(() => {
    if (!isCapacitorNative()) return;
    const onDenied = () => {
      setStatus('denied');
      // 사장님 명시 — 모든 시점 강제 모드
      setForceMode(true);
      setModalOpen(true);
    };
    const onGranted = () => {
      setStatus('granted');
      setModalOpen(false);
      setForceMode(false);
    };
    const onForcePrompt = () => {
      if (statusRef.current === 'granted') return;
      setForceMode(true);
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
    // PR-74 (DISASTER fix): 자작 plugin 의 MANAGE_APP_PERMISSIONS = Samsung S25 crash 발생.
    //   → ApplicationDetails 우선 (100% 작동, 안 멈춤).
    //   사용자 단계: [설정] → [권한] → [위치] → [항상 허용] (3 단계 — Samsung One UI 자동 펼침 시 1~2 단계)
    try {
      const { NativeSettings, AndroidSettings } = await import('capacitor-native-settings');
      await NativeSettings.openAndroid({ option: AndroidSettings.ApplicationDetails });
      return;
    } catch (e) {
      console.warn('[BgLocGuide] ApplicationDetails failed, fallback to AppLocationSettings:', e);
    }
    // 2차 (마지막 수단): 자작 plugin — 단축 시도, 단 일부 OEM crash
    try {
      const { registerPlugin } = await import('@capacitor/core');
      const AppLocationSettings = registerPlugin<{ open: () => Promise<void> }>('AppLocationSettings');
      await AppLocationSettings.open();
    } catch (e) {
      console.warn('[BgLocGuide] all fallback failed:', e);
    }
  }, []);

  const dismiss = useCallback(() => {
    if (forceMode) return;
    setModalOpen(false);
  }, [forceMode]);

  return { status, modalOpen, forceMode, openSettings, dismiss };
}
