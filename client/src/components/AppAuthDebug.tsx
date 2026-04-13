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

  if (!isCapacitorNative() || !visible) return null;

  return (
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
  );
}
