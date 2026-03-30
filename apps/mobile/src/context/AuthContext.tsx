/**
 * AuthContext — 실제 구글 OAuth 흐름 + 디버그 상태 가시성
 *
 * authStep: 실기기 검증 시 어느 단계에서 막히는지 화면/콘솔에서 확인 가능
 */
import React, { createContext, useContext, useState } from 'react';
import * as WebBrowser from 'expo-web-browser';
import type { UserInfo } from '../types/contracts';
import {
  API_BASE, OAUTH_URL, OAUTH_CALLBACK_PREFIX, COOKIE_NAME,
} from '../lib/constants';

// AuthSession 완료 처리 — iOS에서 필수
WebBrowser.maybeCompleteAuthSession();

// ── 인증 단계 enum ─────────────────────────────────────────────────────────
export type AuthStep =
  | 'idle'
  | 'opening_oauth'
  | 'callback_received'
  | 'ticket_extracted'
  | 'app_exchange_pending'
  | 'app_exchange_success'
  | 'auth_me_pending'
  | 'auth_me_success'
  | 'login_complete'
  | 'login_failed';

// 세션 쿠키 ephemeral 저장 (AsyncStorage 미사용 — 별도 브랜치에서 처리)
let _sessionCookie: string | null = null;
export function getSessionCookie(): string | null { return _sessionCookie; }

// 디버그 로그 헬퍼 — 콘솔 + 단계 추적
function dbg(step: AuthStep, msg: string, data?: unknown) {
  const prefix = `[AUTH:${step.toUpperCase()}]`;
  if (data !== undefined) {
    console.log(prefix, msg, data);
  } else {
    console.log(prefix, msg);
  }
}

interface AuthContextValue {
  isLoggedIn: boolean;
  user: UserInfo | null;
  authLoading: boolean;
  authError: string | null;
  authStep: AuthStep;
  login: () => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue>({
  isLoggedIn: false,
  user: null,
  authLoading: false,
  authError: null,
  authStep: 'idle',
  login: async () => {},
  logout: () => {},
});

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [user, setUser]             = useState<UserInfo | null>(null);
  const [authLoading, setLoading]   = useState(false);
  const [authError, setError]       = useState<string | null>(null);
  const [authStep, setStep]         = useState<AuthStep>('idle');

  const setFailed = (msg: string) => {
    setStep('login_failed');
    setError(msg);
  };

  const login = async () => {
    setLoading(true);
    setError(null);
    setStep('idle');

    try {
      // ── Step 1: 구글 OAuth 창 열기 ────────────────────────────────────
      setStep('opening_oauth');
      dbg('opening_oauth', `OAUTH_URL: ${OAUTH_URL}`);
      dbg('opening_oauth', `CALLBACK_PREFIX: ${OAUTH_CALLBACK_PREFIX}`);

      const result = await WebBrowser.openAuthSessionAsync(
        OAUTH_URL,
        OAUTH_CALLBACK_PREFIX,
      );

      dbg('callback_received', `result.type: ${result.type}`);

      if (result.type === 'cancel' || result.type === 'dismiss') {
        setFailed('로그인이 취소되었습니다.');
        return;
      }
      if (result.type !== 'success') {
        setFailed(`로그인에 실패했습니다. (type=${result.type})`);
        return;
      }

      // ── Step 2: 콜백 URL 수신 + ticket 추출 ──────────────────────────
      setStep('callback_received');
      const callbackUrl = result.url;
      dbg('callback_received', `callback URL: ${callbackUrl}`);

      let ticket: string | null = null;
      try {
        const httpEquiv = callbackUrl.replace(
          `${OAUTH_CALLBACK_PREFIX.split('://')[0]}://`,
          'https://placeholder/',
        );
        ticket = new URL(httpEquiv).searchParams.get('ticket');
      } catch (parseErr) {
        dbg('login_failed', 'URL 파싱 실패', parseErr);
        setFailed('인증 정보 처리 중 오류가 발생했습니다.');
        return;
      }

      dbg('ticket_extracted', `ticket: ${ticket ? ticket.slice(0, 8) + '...' : 'null'}`);

      if (!ticket) {
        setFailed('웹 브라우저에서 회원가입을 먼저 완료해 주세요.\n(my-coupon-bridge.com)');
        return;
      }
      setStep('ticket_extracted');

      // ── Step 3: app-exchange — 티켓 → 세션 쿠키 ─────────────────────
      setStep('app_exchange_pending');
      dbg('app_exchange_pending', `POST ${API_BASE}/api/oauth/app-exchange`);

      const exchangeRes = await fetch(`${API_BASE}/api/oauth/app-exchange`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ ticket }),
      });

      dbg('app_exchange_pending', `status: ${exchangeRes.status}`);

      if (!exchangeRes.ok) {
        const errData = await exchangeRes.json().catch(() => ({}));
        const errCode = (errData as any)?.error ?? 'unknown';
        dbg('login_failed', `app-exchange failed: ${errCode}`, errData);
        setFailed(
          errCode === 'ticket_invalid'
            ? '로그인 세션이 만료되었습니다. (60초 이내 완료 필요)'
            : `세션 설정 실패 (${errCode})`,
        );
        return;
      }

      setStep('app_exchange_success');
      const cookieHeader = exchangeRes.headers.get('set-cookie') ?? '';
      const match = cookieHeader.match(new RegExp(`${COOKIE_NAME}=[^;]+`));
      _sessionCookie = match ? match[0] : null;
      dbg('app_exchange_success', `cookie found: ${!!_sessionCookie}`);
      if (_sessionCookie) {
        dbg('app_exchange_success', `cookie prefix: ${_sessionCookie.slice(0, 20)}...`);
      }

      // ── Step 4: auth.me — 유저 정보 확인 ─────────────────────────────
      setStep('auth_me_pending');
      const meUrl = `${API_BASE}/api/trpc/auth.me?batch=1&input=%7B%220%22%3A%7B%22json%22%3Anull%7D%7D`;
      const meHeaders: Record<string, string> = {};
      if (_sessionCookie) meHeaders['Cookie'] = _sessionCookie;

      dbg('auth_me_pending', `GET ${meUrl}`);
      dbg('auth_me_pending', `cookie header: ${!!_sessionCookie}`);

      const meRes = await fetch(meUrl, {
        headers: meHeaders,
        credentials: 'include',
      });

      dbg('auth_me_pending', `auth.me status: ${meRes.status}`);

      if (!meRes.ok) {
        dbg('login_failed', `auth.me HTTP error: ${meRes.status}`);
        setFailed(`사용자 정보를 가져올 수 없습니다. (HTTP ${meRes.status})`);
        return;
      }

      const meJson = await meRes.json();
      const userData = meJson?.[0]?.result?.data;
      dbg('auth_me_pending', `auth.me data:`, userData ? { id: userData.id, email: userData.email, role: userData.role } : null);

      if (!userData || !userData.id) {
        dbg('login_failed', 'auth.me returned null/empty user');
        setFailed('로그인 정보를 확인할 수 없습니다.');
        return;
      }

      // ── Step 5: 로그인 완료 ───────────────────────────────────────────
      setStep('auth_me_success');
      dbg('auth_me_success', `user: id=${userData.id} email=${userData.email} role=${userData.role}`);

      setUser(userData as UserInfo);
      setIsLoggedIn(true);
      setStep('login_complete');
      dbg('login_complete', '✅ MainTabs 진입');

    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      dbg('login_failed', 'unexpected error', e);
      setFailed(
        message.includes('network') || message.includes('fetch')
          ? '네트워크 오류. 인터넷 연결을 확인해 주세요.'
          : `예기치 못한 오류: ${message}`,
      );
    } finally {
      setLoading(false);
    }
  };

  const logout = () => {
    _sessionCookie = null;
    setUser(null);
    setIsLoggedIn(false);
    setError(null);
    setStep('idle');
    dbg('idle', 'logged out');
  };

  return (
    <AuthContext.Provider value={{ isLoggedIn, user, authLoading, authError, authStep, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
