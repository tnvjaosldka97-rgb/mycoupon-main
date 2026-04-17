/**
 * popupUtils — 이벤트 팝업 숨김 상태 관리 유틸
 *
 * 저장소 전략:
 * - "닫기(X)": sessionStorage — 탭/세션 단위 숨김, 새 탭/새로고침 시 재노출
 * - "24시간 닫기": localStorage — 브라우저 영속, popup ID 단위, 24시간 expiry
 *
 * 키 형식:
 * - sessionStorage: popup_dismissed_session:{popupId}
 * - localStorage:   popup_hide_until:{popupId}
 */

// ── 라우트 제한 ─────────────────────────────────────────────────────────────

/** 팝업 자동 노출이 허용되는 라우트인지 판정 */
export function isHomeRoute(pathname: string): boolean {
  return pathname === '/' || pathname === '';
}

// ── 세션 닫기 (X 버튼) ──────────────────────────────────────────────────────

function sessionKey(popupId: number): string {
  return `popup_dismissed_session:${popupId}`;
}

/** 현재 세션에서 해당 팝업을 숨김 처리 */
export function dismissPopupForSession(popupId: number): void {
  try {
    sessionStorage.setItem(sessionKey(popupId), '1');
    console.log(`[Popup] session dismiss: popup ${popupId}`);
  } catch { /* private browsing 등 */ }
}

/** 현재 세션에서 해당 팝업이 숨김 상태인지 */
export function isSessionDismissed(popupId: number): boolean {
  try {
    return sessionStorage.getItem(sessionKey(popupId)) === '1';
  } catch {
    return false;
  }
}

// ── 24시간 닫기 ──────────────────────────────────────────────────────────────

function hide24hKey(uid: string | number, popupId: number): string {
  return `popup_hide_until:${uid}:${popupId}`;
}

/** 24시간 숨김 저장 (유저+팝업 스코프) */
export function dismissPopupFor24Hours(uid: string | number, popupId: number): void {
  try {
    const hideUntil = Date.now() + 24 * 60 * 60 * 1000;
    localStorage.setItem(hide24hKey(uid, popupId), String(hideUntil));
    console.log(`[Popup] 24h dismiss: uid=${uid} popup=${popupId}, hideUntil=${new Date(hideUntil).toISOString()}`);
  } catch { /* quota exceeded 등 */ }
}

/** 24시간 숨김 상태인지 (유저+팝업 스코프, 시간 만료 체크 포함) */
export function is24hDismissed(uid: string | number, popupId: number): boolean {
  try {
    const val = localStorage.getItem(hide24hKey(uid, popupId));
    if (!val) return false;
    const hideUntil = Number(val);
    if (Date.now() < hideUntil) return true;
    localStorage.removeItem(hide24hKey(uid, popupId));
    return false;
  } catch {
    return false;
  }
}

// ── 종합 판정 ────────────────────────────────────────────────────────────────

/** 팝업을 표시해야 하는지 종합 판정 */
export function isPopupVisible(uid: string | number, popupId: number): boolean {
  if (isSessionDismissed(popupId)) return false;
  if (is24hDismissed(uid, popupId)) return false;
  return true;
}

// ── 레거시 키 정리 ───────────────────────────────────────────────────────────

/** 이전 버전의 localStorage 키 정리 (1회성) */
export function cleanupLegacyKeys(): void {
  try {
    const toRemove = Object.keys(localStorage).filter(k =>
      k.startsWith('event_popup_seen_') || k.startsWith('event_popup_hide24h_')
    );
    toRemove.forEach(k => localStorage.removeItem(k));
    if (toRemove.length > 0) {
      console.log(`[Popup] cleaned ${toRemove.length} legacy keys`);
    }
  } catch { /* 무시 */ }
}
