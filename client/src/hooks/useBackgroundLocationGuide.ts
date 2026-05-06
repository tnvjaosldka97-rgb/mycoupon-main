import { useState, useEffect, useCallback } from 'react';
import { isCapacitorNative } from '@/lib/capacitor';

/**
 * PR-93 / PR-95 v2 / PR-97 — 백그라운드 위치 권한 안내 모달 hook.
 *
 * 사장님 명세 (PR-95 v2 + PR-97):
 *   - 필터 (100/200/500m) click trigger only (자동 trigger X)
 *   - 사용자 dismiss 후 다시 필터 click 시 매번 모달 표시 (PR-97 사장님 명세)
 *   - "이게 싫은 사용자는 위치 항상 허용 하면 됨" (사장님 명시)
 *
 * dismiss 2가지: X 버튼 / 외부 영역 터치
 * 자동 닫힘: 'bg-location-perm-granted' dispatch (권한 부여 후 watcher location 수신 시).
 */
export function useBackgroundLocationGuide() {
  const [modalOpen, setModalOpen] = useState(false);

  useEffect(() => {
    if (!isCapacitorNative()) return;
    const onDenied = () => {
      setModalOpen(true);  // PR-97: 매번 표시 (dismissedRef 가드 제거)
    };
    const onGranted = () => {
      setModalOpen(false);
    };
    window.addEventListener('bg-location-perm-denied', onDenied as EventListener);
    window.addEventListener('bg-location-perm-granted', onGranted as EventListener);
    return () => {
      window.removeEventListener('bg-location-perm-denied', onDenied as EventListener);
      window.removeEventListener('bg-location-perm-granted', onGranted as EventListener);
    };
  }, []);

  const dismiss = useCallback(() => {
    setModalOpen(false);
  }, []);

  return { modalOpen, dismiss };
}
