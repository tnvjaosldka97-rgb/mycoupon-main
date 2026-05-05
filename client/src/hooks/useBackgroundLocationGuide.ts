import { useState, useEffect, useCallback, useRef } from 'react';
import { App } from '@capacitor/app';
import { isCapacitorNative } from '@/lib/capacitor';

/**
 * PR-68: 백그라운드 위치 권한 ("항상 허용") 가이드 hook.
 *
 * Android 11+ 정책:
 *   ACCESS_BACKGROUND_LOCATION 은 앱이 다이얼로그 직접 표시 불가.
 *   사용자가 OS Settings 에서 "항상 허용" 직접 클릭해야 함.
 *   앱은 안내 모달 + Settings 자동 이동만 가능 (카톡/네이버지도 패턴).
 *
 * 권한 검출 방식 (paranoid):
 *   @capacitor/geolocation.checkPermissions() 는 백그라운드 권한 별도 표시 X.
 *   → 글로벌 CustomEvent 'bg-location-perm-denied' 구독.
 *   → useBackgroundLocation hook 의 BackgroundGeolocation.addWatcher onError NOT_AUTHORIZED 시 발화.
 *   → 즉 watcher 시도가 NOT_AUTHORIZED 받으면 권한 NG 확정.
 *
 * 사용 시점:
 *   1. App.tsx mount: 매 앱 부팅 시 자동 권한 재체크
 *   2. ConsentPage onSuccess: 회원가입 직후 1번
 *   3. MapPage mount: GPS 핵심 페이지 진입 시 강제 모달
 *
 * 자동 감지:
 *   App.appStateChange isActive=true (앱 복귀) → 권한 재체크 트리거.
 *   "항상 허용" 으로 변경 → useBackgroundLocation 이 다음 watcher 시도 시 success → 신호 dismiss.
 */
export type BgLocationPermStatus = 'unknown' | 'granted' | 'denied';

export function useBackgroundLocationGuide() {
  const [status, setStatus] = useState<BgLocationPermStatus>('unknown');
  const [modalOpen, setModalOpen] = useState(false);
  const [forceMode, setForceMode] = useState(false); // 시점 3 (Map): 닫기 X
  // 최신 status 를 closure 안에서 참조 (force-prompt 시점의 status 확인용)
  const statusRef = useRef<BgLocationPermStatus>('unknown');
  useEffect(() => { statusRef.current = status; }, [status]);

  // CustomEvent listen — useBackgroundLocation 에서 NOT_AUTHORIZED 시 발화 + 외부 force-prompt
  useEffect(() => {
    if (!isCapacitorNative()) return;
    const onDenied = () => {
      setStatus('denied');
      setModalOpen(true);
    };
    const onGranted = () => {
      setStatus('granted');
      setModalOpen(false);
      setForceMode(false);
    };
    // 시점 3 (Map 진입): 외부에서 강제 모드 트리거 — 권한 'granted' 면 무시 (UX 깜빡 차단)
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

  // 앱 복귀 시 권한 재체크 트리거 — useBackgroundLocation 이 새 watcher 시도 → 결과 dispatch
  useEffect(() => {
    if (!isCapacitorNative()) return;
    let handle: { remove: () => Promise<void> } | undefined;
    (async () => {
      try {
        handle = await App.addListener('appStateChange', (state) => {
          if (state.isActive) {
            // 앱 복귀 — 권한 재체크 신호 (useBackgroundLocation 이 watcher 재시작)
            window.dispatchEvent(new CustomEvent('bg-location-perm-recheck'));
          }
        });
      } catch (e) {
        console.warn('[BgLocGuide] appStateChange listen failed:', e);
      }
    })();
    return () => { void handle?.remove(); };
  }, []);

  /** 시점 1: 회원가입 직후 / 시점 2: 앱 부팅 시 — 부드러운 모드 (닫기 가능) */
  const promptSoft = useCallback(() => {
    if (status === 'denied') {
      setForceMode(false);
      setModalOpen(true);
    }
  }, [status]);

  /** 시점 3: Map 진입 — 강제 모드 (닫기 X) */
  const promptForced = useCallback(() => {
    if (status === 'denied') {
      setForceMode(true);
      setModalOpen(true);
    }
  }, [status]);

  /** OS Settings 자동 이동 */
  const openSettings = useCallback(async () => {
    if (!isCapacitorNative()) return;
    try {
      const { NativeSettings, AndroidSettings } = await import('capacitor-native-settings');
      await NativeSettings.openAndroid({ option: AndroidSettings.ApplicationDetails });
    } catch (e) {
      console.warn('[BgLocGuide] openSettings failed (non-blocking):', e);
    }
  }, []);

  /** 모달 닫기 (부드러운 모드만) */
  const dismiss = useCallback(() => {
    if (forceMode) return; // 강제 모드는 닫기 X
    setModalOpen(false);
  }, [forceMode]);

  return { status, modalOpen, forceMode, promptSoft, promptForced, openSettings, dismiss };
}
