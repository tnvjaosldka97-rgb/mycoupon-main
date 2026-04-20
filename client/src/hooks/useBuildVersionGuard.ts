import { useEffect, useRef, useState } from 'react';

/**
 * useBuildVersionGuard — 배포 후 캐시된 옛 빌드 유저 자동 감지 + 리로드 유도
 *
 * 동작:
 *   1. 앱 마운트 시 /healthz fetch 로 initialSha 1회 기록
 *   2. 60초 주기 polling 으로 현재 buildSha 비교
 *   3. 다르면 updateAvailable=true 플래그 반환
 *
 * 원칙:
 *   - initialSha 는 useRef 로 저장해 "한 번 기록 후 불변" (무한 reload 루프 방어)
 *   - fetch 실패 silent 무시 (네트워크 요동 false-positive 방지)
 *   - initial 기록 실패 시 이후 체크도 skip (unknown 상태에서 배너 띄우지 않음)
 *   - reload 는 유저 선택 (배너 CTA 클릭 시 location.reload)
 *
 * Capacitor 앱은 앱 번들 자체 교체가 스토어 업데이트 경로라 이 가드 범위 밖이지만,
 * WebView 내 웹 리소스 캐시는 동일 원리로 보호됨.
 */
export interface BuildVersionGuardState {
  updateAvailable: boolean;
  reload: () => void;
}

const POLL_INTERVAL_MS = 60_000;

export function useBuildVersionGuard(): BuildVersionGuardState {
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const initialShaRef = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    const check = async () => {
      try {
        const res = await fetch('/healthz', { cache: 'no-store' });
        if (!res.ok) return;
        const data = await res.json();
        const sha: string | undefined = data?.buildSha;
        if (!sha || cancelled) return;

        if (initialShaRef.current === null) {
          initialShaRef.current = sha;
          return;
        }
        if (sha !== initialShaRef.current) {
          setUpdateAvailable(true);
        }
      } catch {
        // silent — 네트워크 요동 false-positive 방지
      }
    };

    // 마운트 즉시 1회 (initial SHA 기록)
    check();
    const id = setInterval(check, POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  return {
    updateAvailable,
    reload: () => {
      try {
        window.location.reload();
      } catch {
        // noop
      }
    },
  };
}
