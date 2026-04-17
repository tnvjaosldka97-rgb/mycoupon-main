/**
 * Auth state recovery utilities
 *
 * sweepStaleAuthState  — Boot/timeout 시 Chrome 일반모드 누적 오염 정리
 * resetAuthBootstrap   — me 연속 실패 확정 후 전체 초기화
 * markOAuthStart       — OAuth 시작 타임스탬프 기록 (TTL 탐지용)
 * clearOAuthMarker     — OAuth 완료/실패 후 마커 삭제
 */

/** OAuth 플로우 최대 허용 시간 (3분 초과 시 stale 간주) */
const OAUTH_PENDING_TTL_MS = 3 * 60 * 1000;

export interface SweepResult {
  cleared: string[];
}

/**
 * 앱 시작 / 타임아웃 / OAuth 실패 후 호출.
 * Chrome 일반모드에서 누적된 오염 상태를 자동 정리한다.
 */
export function sweepStaleAuthState(): SweepResult {
  const cleared: string[] = [];
  try {
    // 1. TTL 만료된 OAuth pending 마커 제거
    const ts = sessionStorage.getItem('_oauth_start_ts');
    if (ts && Date.now() - parseInt(ts, 10) > OAUTH_PENDING_TTL_MS) {
      sessionStorage.removeItem('_oauth_start_ts');
      cleared.push('_oauth_start_ts (expired)');
    }

    // 2. 스키마 불일치 user-info 제거 (id·role 없으면 오염 데이터)
    const saved = localStorage.getItem('mycoupon-user-info');
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        if (!parsed || typeof parsed !== 'object' || !parsed.id || !parsed.role) {
          localStorage.removeItem('mycoupon-user-info');
          cleared.push('mycoupon-user-info (invalid-schema)');
        }
      } catch {
        localStorage.removeItem('mycoupon-user-info');
        cleared.push('mycoupon-user-info (parse-error)');
      }
    }

    // 3. 현재 버전 이외의 sw-force-reload 키 제거
    const swVer = localStorage.getItem('sw-version') ?? '';
    Object.keys(sessionStorage).forEach(k => {
      if (k.startsWith('sw-force-reload-') && !k.endsWith(swVer)) {
        sessionStorage.removeItem(k);
        cleared.push(k);
      }
    });

    // 4. 이벤트 팝업 키 과다 누적 정리 (20개 초과 시)
    const popupKeys = Object.keys(localStorage).filter(k => k.startsWith('popup_hide_until:'));
    if (popupKeys.length > 20) {
      popupKeys.forEach(k => localStorage.removeItem(k));
      cleared.push(`${popupKeys.length}x popup_hide_until:*`);
    }
  } catch { /* localStorage/sessionStorage 사용 불가 환경 무시 */ }

  if (cleared.length > 0) {
    console.warn('[AUTH-RECOVERY] sweep cleared:', cleared);
  }
  return { cleared };
}

/**
 * me 연속 실패 확정 후 인증 상태 전체 초기화.
 * @param setData - utils.auth.me.setData(undefined, null) 에 해당하는 함수
 */
export function resetAuthBootstrap(setData: (data: null) => void): void {
  try { localStorage.removeItem('mycoupon-user-info'); } catch {}
  try { localStorage.removeItem('user-manually-logged-in'); } catch {}
  try { sessionStorage.removeItem('_oauth_start_ts'); } catch {}
  setData(null);
}

/** OAuth 플로우 시작 시 타임스탬프 기록 */
export function markOAuthStart(): void {
  try { sessionStorage.setItem('_oauth_start_ts', String(Date.now())); } catch {}
}

/** OAuth 플로우 완료/실패 후 마커 삭제 */
export function clearOAuthMarker(): void {
  try { sessionStorage.removeItem('_oauth_start_ts'); } catch {}
}
