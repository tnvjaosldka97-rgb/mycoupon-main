/**
 * authDebugStore — 앱 로그인 디버그 상태를 localStorage에 영속
 *
 * 목적: logcat / chrome inspect / network 탭 없이도 기기 화면에서 바로
 *       로그인 실패 원인을 좁힐 수 있도록 10개 핵심 필드를 영속 저장한다.
 *
 * 페이지 리로드/재시작 후에도 값이 유지되어야 한다. (실패 후 스크린샷용)
 */

const KEY = 'mycoupon-auth-debug-v1';
const EVT = 'mycoupon-auth-debug-update';

export interface AuthDebugState {
  app_build: string;        // APP BUILD ID (client compiled-in)
  server_build: string;     // SERVER BUILD ID (/api/build-info)
  bridge_build: string;     // BRIDGE BUILD ID (/api/build-info)
  last_stage: string;       // LAST AUTH STAGE — e.g. "S8:exchange"
  last_error: string;       // LAST AUTH ERROR REASON — e.g. "exchange_failed:401"
  trace_id: string;         // LAST TRACE ID — per-login short id
  raw_deeplink: string;     // LAST RAW DEEPLINK PREVIEW — first 120 chars, ticket masked
  exchange_status: string;  // LAST EXCHANGE STATUS — e.g. "200" | "429" | "net_fail"
  me_status: string;        // LAST ME STATUS — "ok:user@x" | "null" | "err"
  cookie_verify: string;    // COOKIE VERIFY RESULT — "ok" | "fail" | "retry_ok" | "-"
  updated_at: string;       // 마지막 갱신 시각 (HH:MM:SS)
}

const DEFAULT: AuthDebugState = {
  app_build: '-',
  server_build: '-',
  bridge_build: '-',
  last_stage: '-',
  last_error: '-',
  trace_id: '-',
  raw_deeplink: '-',
  exchange_status: '-',
  me_status: '-',
  cookie_verify: '-',
  updated_at: '-',
};

// SSR/Node/early-init 안전 가드 — window / localStorage 미존재 시 전부 no-op
function hasWindow(): boolean {
  return typeof window !== 'undefined';
}
function hasStorage(): boolean {
  try {
    return hasWindow() && typeof window.localStorage !== 'undefined';
  } catch {
    return false;
  }
}

function safeRead(): AuthDebugState {
  if (!hasStorage()) return { ...DEFAULT };
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULT };
    const parsed = JSON.parse(raw) as Partial<AuthDebugState>;
    return { ...DEFAULT, ...parsed };
  } catch {
    return { ...DEFAULT };
  }
}

function safeWrite(state: AuthDebugState): void {
  if (!hasStorage()) return;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(state));
    try {
      window.dispatchEvent(new CustomEvent(EVT));
    } catch {
      /* CustomEvent unavailable — ignore */
    }
  } catch {
    /* quota / serialization errors — ignore */
  }
}

function nowHMS(): string {
  try {
    return new Date().toISOString().slice(11, 19);
  } catch {
    return '-';
  }
}

export function getAuthDebug(): AuthDebugState {
  return safeRead();
}

export function setAuthDebug(patch: Partial<AuthDebugState>): void {
  const next: AuthDebugState = {
    ...safeRead(),
    ...patch,
    updated_at: nowHMS(),
  };
  safeWrite(next);
}

export function resetAuthDebugForNewLogin(traceId: string): void {
  const prev = safeRead();
  // build ids는 유지, 진행 필드만 초기화
  safeWrite({
    ...DEFAULT,
    app_build: prev.app_build,
    server_build: prev.server_build,
    bridge_build: prev.bridge_build,
    trace_id: traceId,
    last_stage: 'S1:login',
    updated_at: nowHMS(),
  });
}

export function subscribeAuthDebug(listener: () => void): () => void {
  if (!hasWindow()) return () => {};
  const handler = () => {
    try { listener(); } catch { /* ignore */ }
  };
  window.addEventListener(EVT, handler);
  window.addEventListener('storage', handler);
  return () => {
    window.removeEventListener(EVT, handler);
    window.removeEventListener('storage', handler);
  };
}

/** 짧은 trace id (8자) */
export function newTraceId(): string {
  try {
    return Math.random().toString(36).slice(2, 10);
  } catch {
    return String(Date.now()).slice(-8);
  }
}

/** deeplink 미리보기 (ticket 마스킹, 120자 제한) */
export function previewDeeplink(raw: string): string {
  if (!raw) return '-';
  const masked = raw.replace(/((?:app_)?ticket=)[^&;#\s]+/gi, '$1***');
  return masked.slice(0, 120);
}
