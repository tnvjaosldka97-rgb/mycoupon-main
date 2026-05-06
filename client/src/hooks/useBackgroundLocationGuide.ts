import { useState, useEffect, useCallback, useRef } from 'react';
import { isCapacitorNative } from '@/lib/capacitor';

/**
 * PR-93 — 백그라운드 위치 권한 안내 모달 hook (단순 정보성).
 *
 * 사장님 명시: 이점 정도만 안내 (액션 버튼 X).
 *
 * 5중 안전망:
 *   Layer 1) useBackgroundLocation watcher 안 dispatch 1회 제한 (notAuthDispatchedRef)
 *   Layer 2) hook 안 dismissedRef = 그 세션 영구 차단
 *   Layer 3) 모달 component = 단순 (X / 외부 dismiss 만, 버튼 0개)
 *   Layer 4) capacitor-native-settings 호출 0 (영구 포기)
 *   Layer 5) appStateChange / visibilitychange listener 0
 *
 * 자동 닫힘:
 *   useBackgroundLocation 이 location 첫 수신 시 'bg-location-perm-granted' dispatch
 *   → 모달 자동 닫힘 + dismissedRef 초기화 (다음 잃을 때 다시 안내).
 */
export function useBackgroundLocationGuide() {
  const [modalOpen, setModalOpen] = useState(false);
  const dismissedRef = useRef(false);

  useEffect(() => {
    if (!isCapacitorNative()) return;
    const onDenied = () => {
      if (dismissedRef.current) return;  // Layer 2: 그 세션 영구 차단
      setModalOpen(true);
    };
    const onGranted = () => {
      setModalOpen(false);
      dismissedRef.current = false;  // 권한 부여 시 ref 초기화
    };
    window.addEventListener('bg-location-perm-denied', onDenied as EventListener);
    window.addEventListener('bg-location-perm-granted', onGranted as EventListener);
    return () => {
      window.removeEventListener('bg-location-perm-denied', onDenied as EventListener);
      window.removeEventListener('bg-location-perm-granted', onGranted as EventListener);
    };
  }, []);

  const dismiss = useCallback(() => {
    dismissedRef.current = true;
    setModalOpen(false);
  }, []);

  return { modalOpen, dismiss };
}
