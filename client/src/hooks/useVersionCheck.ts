/**
 * 버전 체크 훅 — buildSha 기반 자동 reload
 *
 * Capacitor 앱에서 서버 배포 후 앱 재실행 시 최신 버전을 강제 반영.
 * - 앱 시작 시 /healthz의 buildSha를 캡처
 * - appStateChange(isActive=true) 시마다 재체크
 * - buildSha가 다르면 window.location.reload()
 */
import { useEffect, useRef } from 'react';
import { isCapacitorNative } from '@/lib/capacitor';

export function useVersionCheck() {
  const buildShaRef = useRef<string | null>(null);
  const checkingRef = useRef(false);

  const checkVersion = async () => {
    if (checkingRef.current) return;
    checkingRef.current = true;
    try {
      const res = await fetch('/healthz', {
        cache: 'no-store',
        headers: { 'Cache-Control': 'no-cache' },
      });
      if (!res.ok) return;
      const data = await res.json();
      const { buildSha } = data as { buildSha?: string };
      if (!buildSha) return;

      if (buildShaRef.current === null) {
        buildShaRef.current = buildSha;
        console.log('[VERSION] 초기 buildSha 캡처:', buildSha);
        return;
      }

      if (buildShaRef.current !== buildSha) {
        console.log(`[VERSION] 새 배포 감지 (${buildShaRef.current} → ${buildSha}). 즉시 리로드`);
        window.location.reload();
      }
    } catch {
      // 오프라인/네트워크 오류 무시
    } finally {
      checkingRef.current = false;
    }
  };

  useEffect(() => {
    if (!isCapacitorNative()) return;

    checkVersion();

    let removeListener: (() => void) | null = null;
    import('@capacitor/app').then(({ App }) => {
      App.addListener('appStateChange', ({ isActive }) => {
        if (isActive) checkVersion();
      }).then(handle => {
        removeListener = () => handle.remove();
      });
    });

    return () => { removeListener?.(); };
  }, []);
}
