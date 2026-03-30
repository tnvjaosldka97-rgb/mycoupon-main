/**
 * AuthContext — 실제 구글 OAuth 흐름
 *
 * 흐름:
 *   1. openAuthSessionAsync(OAUTH_URL, OAUTH_CALLBACK_PREFIX)
 *      → 시스템 브라우저에서 구글 로그인
 *   2. 서버: 구글 인증 완료 → 티켓 발급 → com.mycoupon.app://auth/callback?ticket=xxx
 *   3. URL에서 ticket 추출
 *   4. POST /api/oauth/app-exchange { ticket }
 *      → 서버: 티켓 검증 + Set-Cookie: app_session_id=...
 *   5. 응답 헤더에서 세션 쿠키 추출 → 모듈 변수에 저장 (ephemeral)
 *   6. GET /api/trpc/auth.me (Cookie: app_session_id=...) → 유저 확인
 *   7. 성공 시 isLoggedIn = true, user 세팅
 *
 * 제한사항:
 *   - AsyncStorage 미사용 (앱 재시작 시 세션 초기화 — 별도 브랜치에서 처리)
 *   - 신규 가입(signupCompleted=false) 흐름 미지원 (웹 브라우저 가입 완료 필요)
 *   - typed AppRouter 미연동 (fetch 직접 사용)
 */
import React, { createContext, useContext, useState } from 'react';
import * as WebBrowser from 'expo-web-browser';
import type { UserInfo } from '../types/contracts';
import {
  API_BASE, OAUTH_URL, OAUTH_CALLBACK_PREFIX, COOKIE_NAME,
} from '../lib/constants';

// AuthSession 완료 처리 — iOS에서 필수
WebBrowser.maybeCompleteAuthSession();

// 세션 쿠키 ephemeral 저장 (AsyncStorage 미사용 — 이번 브랜치 범위 밖)
let _sessionCookie: string | null = null;
export function getSessionCookie(): string | null { return _sessionCookie; }

interface AuthContextValue {
  isLoggedIn: boolean;
  user: UserInfo | null;
  authLoading: boolean;
  authError: string | null;
  login: () => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue>({
  isLoggedIn: false,
  user: null,
  authLoading: false,
  authError: null,
  login: async () => {},
  logout: () => {},
});

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [user, setUser]             = useState<UserInfo | null>(null);
  const [authLoading, setLoading]   = useState(false);
  const [authError, setError]       = useState<string | null>(null);

  const login = async () => {
    setLoading(true);
    setError(null);

    try {
      // Step 1: 구글 OAuth — 시스템 브라우저 열기
      const result = await WebBrowser.openAuthSessionAsync(
        OAUTH_URL,
        OAUTH_CALLBACK_PREFIX,
      );

      if (result.type === 'cancel' || result.type === 'dismiss') {
        setError('로그인이 취소되었습니다.');
        return;
      }

      if (result.type !== 'success') {
        setError('로그인에 실패했습니다. 다시 시도해 주세요.');
        return;
      }

      // Step 2: 콜백 URL에서 ticket 추출
      // 예: com.mycoupon.app://auth/callback?ticket=abc123
      let ticket: string | null = null;
      try {
        const callbackUrl = result.url;
        // URL API (RN 0.64+ 지원)
        const httpEquiv = callbackUrl.replace(`${OAUTH_CALLBACK_PREFIX.split('://')[0]}://`, 'https://placeholder/');
        ticket = new URL(httpEquiv).searchParams.get('ticket');
      } catch {
        setError('인증 정보 처리 중 오류가 발생했습니다.');
        return;
      }

      if (!ticket) {
        // ticket 없음 = 신규 가입 흐름 (서버가 /signup/consent로 리다이렉트한 경우)
        setError('웹 브라우저에서 회원가입을 먼저 완료해 주세요.\n(my-coupon-bridge.com)');
        return;
      }

      // Step 3: 티켓 교환 → 서버가 Set-Cookie: app_session_id 설정
      const exchangeRes = await fetch(`${API_BASE}/api/oauth/app-exchange`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ ticket }),
      });

      if (!exchangeRes.ok) {
        const errData = await exchangeRes.json().catch(() => ({}));
        const errCode = (errData as any)?.error ?? 'unknown';
        if (errCode === 'ticket_invalid') {
          setError('로그인 세션이 만료되었습니다. 다시 시도해 주세요. (60초 이내 완료 필요)');
        } else {
          setError('세션 설정에 실패했습니다. 잠시 후 다시 시도해 주세요.');
        }
        return;
      }

      // Step 4: 응답 헤더에서 세션 쿠키 추출
      const cookieHeader = exchangeRes.headers.get('set-cookie') ?? '';
      const match = cookieHeader.match(new RegExp(`${COOKIE_NAME}=[^;]+`));
      _sessionCookie = match ? match[0] : null;

      // Step 5: auth.me 호출로 유저 정보 확인
      // tRPC v11 batch query format
      const meUrl = `${API_BASE}/api/trpc/auth.me?batch=1&input=%7B%220%22%3A%7B%22json%22%3Anull%7D%7D`;
      const meHeaders: Record<string, string> = {};
      if (_sessionCookie) meHeaders['Cookie'] = _sessionCookie;

      const meRes = await fetch(meUrl, {
        headers: meHeaders,
        credentials: 'include',
      });

      if (!meRes.ok) {
        setError('사용자 정보를 가져올 수 없습니다. 다시 시도해 주세요.');
        return;
      }

      const meJson = await meRes.json();
      // tRPC batch 응답: [{ result: { data: UserInfo | null } }]
      const userData = meJson?.[0]?.result?.data;

      if (!userData || !userData.id) {
        setError('로그인 정보를 확인할 수 없습니다. 다시 시도해 주세요.');
        return;
      }

      // Step 6: 로그인 성공
      setUser(userData as UserInfo);
      setIsLoggedIn(true);

    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      if (message.includes('network') || message.includes('fetch')) {
        setError('네트워크 오류가 발생했습니다. 인터넷 연결을 확인해 주세요.');
      } else {
        setError('로그인 중 예기치 못한 오류가 발생했습니다.');
      }
    } finally {
      setLoading(false);
    }
  };

  const logout = () => {
    _sessionCookie = null;
    setUser(null);
    setIsLoggedIn(false);
    setError(null);
  };

  return (
    <AuthContext.Provider value={{ isLoggedIn, user, authLoading, authError, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
