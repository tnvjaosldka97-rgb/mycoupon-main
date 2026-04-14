/**
 * AppAuthDebug — 앱 OAuth 진행 단계 인라인 디버그 오버레이
 *
 * Capacitor 네이티브 앱 전용. 로그인 시도 시 상단 고정 바가 나타나
 * 각 단계(S1~S9)의 진행/성공/실패 상태를 실시간으로 표시한다.
 * adb 없이 기기에서 직접 확인 가능.
 *
 * 이벤트 소스:
 *   fireAuthStep(step, status, msg?) → window CustomEvent 'app-auth-progress'
 *   capacitor.ts: S1(login), S2(nonce), S3(tab)
 *   useAuth.ts:   S5(deeplink), S7(proc), S8(exchange), S9(auth.me)
 *
 * 자동 해제:
 *   S9 success → 5초 후 사라짐
 *   60초 무활동 → 자동 해제
 */
import { useState, useEffect, useRef } from 'react';
import { isCapacitorNative } from '@/lib/capacitor';
import { getAuthDebug, subscribeAuthDebug, type AuthDebugState } from '@/lib/authDebugStore';

type StepStatus = 'idle' | 'progress' | 'success' | 'fail';

interface AuthStep {
  step: number;
  status: StepStatus;
  msg?: string;
}

// 표시할 단계 순서
const STEP_NUMS = [1, 2, 3, 5, 7, 8, 9];
const STEP_LABEL: Record<number, string> = {
  1: 'login',
  2: 'nonce',
  3: 'tab',
  5: 'link',
  7: 'proc',
  8: 'exch',
  9: 'me',
};

export function AppAuthDebug() {
  const [visible, setVisible] = useState(false);
  const [steps, setSteps] = useState<Record<number, AuthStep>>({});
  const [hasFail, setHasFail] = useState(false);
  const successTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const maxTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!isCapacitorNative()) return;

    // 60s 전체 타임아웃 (새 로그인 시작마다 리셋됨)
    const resetMaxTimer = () => {
      if (maxTimerRef.current) clearTimeout(maxTimerRef.current);
      maxTimerRef.current = setTimeout(() => {
        setVisible(false);
        setSteps({});
        setHasFail(false);
      }, 60_000);
    };

    const handler = (e: Event) => {
      const { step, status, msg } = (e as CustomEvent).detail as {
        step: number;
        status: StepStatus;
        msg?: string;
      };

      // 새 로그인 시작(S1) 시 상태 초기화
      if (step === 1 && status === 'progress') {
        setSteps({});
        setHasFail(false);
        if (successTimerRef.current) clearTimeout(successTimerRef.current);
      }

      setVisible(true);
      setSteps(prev => ({ ...prev, [step]: { step, status, msg } }));
      resetMaxTimer();

      if (status === 'fail') {
        setHasFail(true);
      }

      // S9 or S10 success → 5s 후 자동 해제
      if ((step === 9 || step === 10) && status === 'success') {
        if (successTimerRef.current) clearTimeout(successTimerRef.current);
        successTimerRef.current = setTimeout(() => {
          setVisible(false);
          setSteps({});
          setHasFail(false);
        }, 5000);
      }
    };

    window.addEventListener('app-auth-progress', handler);
    return () => {
      window.removeEventListener('app-auth-progress', handler);
      if (successTimerRef.current) clearTimeout(successTimerRef.current);
      if (maxTimerRef.current) clearTimeout(maxTimerRef.current);
    };
  }, []);

  if (!isCapacitorNative()) return null;

  return (
    <>
      <AuthDebugPersistentBox />
      {visible && (
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        zIndex: 99000,
        background: hasFail ? 'rgba(153,0,0,0.93)' : 'rgba(12,12,12,0.91)',
        color: '#fff',
        fontSize: 10,
        padding: '5px 10px 5px 10px',
        display: 'flex',
        alignItems: 'center',
        gap: 5,
        fontFamily: 'monospace',
        flexWrap: 'wrap',
        pointerEvents: 'auto',
      }}
    >
      <span style={{ fontWeight: 700, marginRight: 4, fontSize: 11 }}>AUTH</span>
      {STEP_NUMS.map(n => {
        const s = steps[n];
        const icon = !s
          ? '·'
          : s.status === 'success'
          ? '✓'
          : s.status === 'fail'
          ? '✗'
          : '…';
        const color = !s
          ? '#555'
          : s.status === 'success'
          ? '#4ade80'
          : s.status === 'fail'
          ? '#f87171'
          : '#fbbf24';
        return (
          <span key={n} style={{ color, marginRight: 3 }}>
            {icon}S{n}
            {STEP_LABEL[n] ? `(${STEP_LABEL[n]})` : ''}
          </span>
        );
      })}
      <button
        onClick={() => setVisible(false)}
        style={{
          marginLeft: 'auto',
          background: 'transparent',
          border: 'none',
          color: '#888',
          fontSize: 14,
          cursor: 'pointer',
          padding: '0 4px',
          lineHeight: 1,
        }}
      >
        ✕
      </button>
    </div>
      )}
    </>
  );
}

// ── Persistent 10-field debug box ─────────────────────────────────────────────
// logcat / inspect / network 없이 기기 스크린샷 1~2장으로 원인 확정 가능하게
// 하는 영속 디버그 박스. 좌하단 작게 표시. 탭하면 접기/펼치기.
// 실패 후에도 값이 남아 있어야 하므로 localStorage 기반.
function AuthDebugPersistentBox() {
  const [state, setState] = useState<AuthDebugState>(() => getAuthDebug());
  const [collapsed, setCollapsed] = useState<boolean>(() => {
    try { return localStorage.getItem('mycoupon-auth-debug-collapsed') === '1'; }
    catch { return false; }
  });

  useEffect(() => {
    const unsubscribe = subscribeAuthDebug(() => setState(getAuthDebug()));
    // 최초 1회 반영
    setState(getAuthDebug());
    return unsubscribe;
  }, []);

  const toggleCollapsed = () => {
    setCollapsed(prev => {
      const next = !prev;
      try { localStorage.setItem('mycoupon-auth-debug-collapsed', next ? '1' : '0'); } catch {}
      return next;
    });
  };

  const boxStyle: React.CSSProperties = {
    position: 'fixed',
    left: 4,
    bottom: 'calc(4px + env(safe-area-inset-bottom, 0px))',
    zIndex: 99001,
    background: 'rgba(0,0,0,0.82)',
    color: '#e5e7eb',
    fontSize: 9,
    lineHeight: 1.25,
    fontFamily: 'monospace',
    padding: collapsed ? '3px 6px' : '5px 7px',
    borderRadius: 4,
    maxWidth: collapsed ? 90 : 260,
    pointerEvents: 'auto',
    border: '1px solid rgba(255,255,255,0.15)',
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-all',
    boxShadow: '0 2px 6px rgba(0,0,0,0.4)',
  };

  const labelColor = '#9ca3af';
  const valueColor = '#f3f4f6';
  const warnColor = '#fbbf24';

  if (collapsed) {
    return (
      <div style={boxStyle} onClick={toggleCollapsed}>
        <span style={{ color: warnColor, fontWeight: 700 }}>DBG</span>
        <span style={{ color: labelColor }}> {state.trace_id}</span>
      </div>
    );
  }

  const row = (label: string, value: string, highlight = false) => (
    <div style={{ display: 'flex', gap: 4 }}>
      <span style={{ color: labelColor, minWidth: 58, flexShrink: 0 }}>{label}</span>
      <span style={{ color: highlight ? warnColor : valueColor, flex: 1 }}>{value || '-'}</span>
    </div>
  );

  return (
    <div style={boxStyle}>
      <div
        onClick={toggleCollapsed}
        style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 2, cursor: 'pointer' }}
      >
        <span style={{ color: warnColor, fontWeight: 700 }}>AUTH DBG</span>
        <span style={{ color: labelColor }}>{state.updated_at} ▾</span>
      </div>
      {row('app',      state.app_build)}
      {row('server',   state.server_build, state.server_build !== state.app_build && state.server_build !== '-')}
      {row('bridge',   state.bridge_build, state.bridge_build !== state.app_build && state.bridge_build !== '-')}
      {row('trace',    state.trace_id)}
      {row('stage',    state.last_stage)}
      {row('error',    state.last_error, state.last_error !== '-' && state.last_error !== '')}
      {row('deeplink', state.raw_deeplink)}
      {row('exch',     state.exchange_status, state.exchange_status !== '200' && state.exchange_status !== '-')}
      {row('me',       state.me_status, state.me_status.startsWith('err') || state.me_status === 'null')}
      {row('cookie',   state.cookie_verify, state.cookie_verify !== 'ok' && state.cookie_verify !== 'retry_ok' && state.cookie_verify !== '-')}
    </div>
  );
}
