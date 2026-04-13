import { getLoginUrl } from "@/lib/const";
import { trpc } from "@/lib/trpc";
import { isCapacitorNative, openGoogleLogin, fireAuthStep } from "@/lib/capacitor";
import { getDeviceId } from "@/lib/deviceId";
import { sweepStaleAuthState, markOAuthStart, clearOAuthMarker } from "@/lib/authRecovery";
import { isMobileChromeWeb } from "@/lib/browserDetect";
import { TRPCClientError } from "@trpc/client";
import { useCallback, useEffect, useMemo, useRef } from "react";

type UseAuthOptions = {
  redirectOnUnauthenticated?: boolean;
  redirectPath?: string;
};

// ══════════════════════════════════════════════════════════════════════════════
// 모듈 레벨 전역 가드 — useAuth()가 여러 컴포넌트에서 동시 호출되어도
// 아래 리스너/refetch가 중복 실행되지 않도록 차단한다.
//
// 문제 원인:
//   SessionLoadingGate / MapPage / Home 등이 동시에 useAuth()를 호출하면
//   각 인스턴스마다 Capacitor 리스너 · storage 리스너 · OAuth URL 처리가
//   중복 등록된다.
//   browserFinished / appUrlOpen 이벤트 1회에 N개 리스너 모두 호출 →
//   N × retry 회수 = auth.me 폭주.
// ══════════════════════════════════════════════════════════════════════════════

// Capacitor 리스너: 모듈 전체에서 1회만 등록
let _capacitorListenersRegistered = false;
// storage 이벤트 리스너: 모듈 전체에서 1회만 등록
let _storageListenerRegistered = false;
// OAuth URL 파라미터 처리: 모듈 전체에서 1회만
let _oauthUrlHandled = false;
// refetchAndStore in-flight 가드: 동시 호출 방지
let _isRefetchingFromOAuth = false;
// browserFinished 예외 fallback 타이머
// appUrlOpen 미도착 시 5초 후 1회만 확인. appUrlOpen 도착 시 취소.
let _browserFinishedFallbackTimer: ReturnType<typeof setTimeout> | null = null;
// OAuth Custom Tabs 진행 중 플래그
// login() 시작 시 true → appUrlOpen 완료 or 5s fallback 후 false
// appStateChange foreground refetch가 ticket exchange 전에 실행되는 race 차단용
let _oauthInProgress = false;
// deeplink 미수신 시 90s 후 _oauthInProgress 강제 해제 (stuck 방지)
let _oauthProgressSafetyTimer: ReturnType<typeof setTimeout> | null = null;

// ── Capacitor 모듈 즉시 사전 로딩 ───────────────────────────────────────────
// 목적: useEffect 실행 전에 appUrlOpen이 도착하는 timing race 방지
// Dynamic import는 첫 호출 시 네트워크(로컬 번들)를 거치므로 캐시 확보가 중요.
// 모듈 로드 즉시 시작 → useEffect에서 Promise.all 호출 시 이미 캐시 히트.
if (typeof window !== 'undefined' && isCapacitorNative()) {
  import('@capacitor/app').catch(() => {});
  import('@capacitor/browser').catch(() => {});
  import('@/lib/pendingDeeplink').catch(() => {}); // PendingDeeplink 모듈 사전 캐시
}

export function useAuth(options?: UseAuthOptions) {
  const { redirectOnUnauthenticated = false, redirectPath = getLoginUrl() } =
    options ?? {};
  const utils = trpc.useUtils();

  // Capacitor 앱은 retry 1회만 (3회→2회로 총 auth.me 호출 감소)
  // 웹은 2회 유지 (Railway cold start 대응)
  const retryCount = isCapacitorNative() ? 1 : 2;

  const meQuery = trpc.auth.me.useQuery(undefined, {
    retry: retryCount,
    retryDelay: 2000,           // 2초 간격 (이전 1.5초보다 여유 있게)
    refetchOnWindowFocus: false,
    refetchOnMount: false,
    refetchOnReconnect: false,
    staleTime: Infinity,        // 세션 유지 중 재호출 완전 차단 (명시적 refetch만 허용)
    gcTime: 60 * 60 * 1000,    // 1시간 캐시 유지
    networkMode: 'always',   // 'online' → 'always': navigator.onLine=false 시 query 영구 pause 방지
  });

  const logoutMutation = trpc.auth.logout.useMutation({
    onSuccess: () => {
      utils.auth.me.setData(undefined, null);
    },
  });

  // ── Native Google Login (Option B) ──────────────────────────────────────────
  // Capacitor 앱 전용. 웹에서는 호출하지 말 것.
  //
  // 흐름:
  //   GoogleAuth.signIn() → idToken 획득
  //   → POST /api/oauth/google/native { idToken }
  //   → 서버: idToken 검증 + 세션 쿠키 설정
  //   → meQuery.refetch() → 로그인 완료
  //
  // needsConsent: true 응답:
  //   → /signup/consent?next=%2F&mode=app 으로 이동
  //   → 동의 완료 후 기존 ticket exchange 경로(appUrlOpen)가 로그인 완료 처리
  //
  // 실패 시:
  //   → throw — 호출부(UI)에서 에러 표시 처리
  //   → 기존 웹 OAuth fallback으로 자동 전환하지 않음 (의도적)
  //
  // BLOCKED: @codetrix-studio/capacitor-google-auth 미설치
  //   pnpm add @codetrix-studio/capacitor-google-auth 후 동작
  //   capacitor.config.ts의 GoogleAuth.serverClientId 설정 필수
  const nativeGoogleLogin = useCallback(async () => {
    try {
      // 동적 import: 웹 번들에 포함되지 않도록 (웹 빌드에 포함 안 됨)
      const { GoogleAuth } = await import('@codetrix-studio/capacitor-google-auth');

      // initialize: capacitor.config.ts의 GoogleAuth 플러그인 설정을 읽음
      // serverClientId (= 웹 클라이언트 ID) 를 capacitor.config.ts에 반드시 설정할 것
      await GoogleAuth.initialize();

      const googleUser = await GoogleAuth.signIn();
      const idToken = googleUser?.authentication?.idToken;

      if (!idToken) {
        console.error('[native-login] GoogleAuth.signIn() 성공했으나 idToken 없음');
        throw new Error('idToken_missing');
      }

      console.log('[native-login] idToken 획득 → /api/oauth/google/native 호출');

      const resp = await fetch('/api/oauth/google/native', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include', // WebView 쿠키 저장소에 Set-Cookie 적용
        body: JSON.stringify({ idToken }),
      });

      if (!resp.ok) {
        const errData = await resp.json().catch(() => ({})) as Record<string, unknown>;
        console.error('[native-login] 서버 응답 오류:', resp.status, errData.error);
        throw new Error(String(errData.error ?? `http_${resp.status}`));
      }

      const data = await resp.json() as { success: boolean; needsConsent?: boolean };

      if (data.needsConsent) {
        // 신규/미동의: 세션 쿠키는 이미 설정됨, consent 페이지로 이동
        // 동의 완료 후 기존 appUrlOpen → ticket exchange 경로가 로그인 완료 처리
        console.log('[native-login] needsConsent → /signup/consent 이동');
        window.location.href = '/signup/consent?next=%2F&mode=app';
        return;
      }

      // 로그인 완료: auth.me 재조회
      console.log('[native-login] ✅ 로그인 성공 → auth.me refetch');
      const result = await meQuery.refetch();
      if (result.data) {
        try { localStorage.setItem('mycoupon-user-info', JSON.stringify(result.data)); } catch (_) {}
        console.log('[native-login] user:', result.data.email, '| role:', result.data.role);
      } else {
        console.warn('[native-login] auth.me null — 세션 쿠키 미설정 가능성');
      }
    } catch (err) {
      console.error('[native-login] 실패:', err);
      throw err; // 호출부(UI)에서 에러 처리
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [meQuery]);

  // ── login: 웹/앱 통합 로그인 진입점 ──────────────────────────────────────────
  //
  // Capacitor 앱 — Chrome Custom Tabs 웹 OAuth (primary):
  //   SHA 지문 등록 불필요. 서버 /api/oauth/google/login?redirect=_app_ 흐름 재사용.
  //   완료 시 com.mycoupon.app://auth/callback?ticket=X deeplink → appUrlOpen 핸들러.
  //
  //   native Google Sign-In은 release SHA-1을 Google Cloud Console에 등록해야 동작.
  //   등록 전까지는 Custom Tabs를 primary로 사용. nativeGoogleLogin()은 별도 호출 가능.
  //
  // 웹 — window.location.href 기존 OAuth 흐름 유지.
  const login = useCallback(async (loginUrl?: string) => {
    console.log('[AUTH-DBG] entered login() — isNative:', isCapacitorNative());
    if (isCapacitorNative()) {
      // 연타 방지: OAuth 이미 진행 중이면 재진입 차단
      if (_oauthInProgress) {
        console.log('[AUTH] login 연타 무시 — OAuth already in progress');
        return;
      }
      // OAuth 시작 전 플래그 설정 — appStateChange foreground refetch race 차단
      // appUrlOpen 완료 or 5s fallback 후 false로 리셋됨
      _oauthInProgress = true;
      markOAuthStart(); // TTL 기반 stale 탐지용 타임스탬프 기록
      console.log('[AUTH] login — _oauthInProgress = true (Custom Tabs OAuth 시작)');
      // 90s safety timer: processDeepLink 미도착 시 stuck 방지
      if (_oauthProgressSafetyTimer) clearTimeout(_oauthProgressSafetyTimer);
      _oauthProgressSafetyTimer = setTimeout(() => {
        _oauthProgressSafetyTimer = null;
        if (_oauthInProgress) {
          _oauthInProgress = false;
          console.warn('[AUTH] _oauthInProgress safety reset (90s — deeplink never arrived)');
        }
      }, 90_000);
      // Custom Tabs 웹 OAuth — SHA 등록 불필요, 서버 ticket 체인으로 세션 확립
      await openGoogleLogin(`/api/oauth/google/login?redirect=${encodeURIComponent('_app_')}`);
      return;
    }
    // 웹: 기존 OAuth 흐름 그대로
    const webUrl = loginUrl ?? getLoginUrl();
    console.log('[AUTH-DBG] inputs { loginUrl:', loginUrl?.slice(0, 80) ?? 'undefined', '| computedUrl:', webUrl.slice(0, 80), '| href:', window.location.href.slice(0, 80), '| ua:', navigator.userAgent.slice(0, 60), '}');
    console.log('[AUTH-URL] web login real device →', webUrl.slice(0, 120));
    // [AUTH-NAV] location 이동 직전 — 이 로그 이후 페이지가 떠나면 Stage 1 정상
    console.log('[AUTH-NAV] t=' + Math.round(performance.now()) + ' — window.location.href change imminent → server will redirect to Google OAuth');
    window.location.href = webUrl;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const logout = useCallback(async () => {
    try {
      utils.auth.me.setData(undefined, null);
      // Capacitor 앱: deviceId 전달 → 서버에서 push token unlink
      const deviceId = isCapacitorNative() ? getDeviceId() : undefined;
      await logoutMutation.mutateAsync({ deviceId });
    } catch (error: unknown) {
      if (
        error instanceof TRPCClientError &&
        error.data?.code === "UNAUTHORIZED"
      ) {
        return;
      }
      throw error;
    } finally {
      utils.auth.me.setData(undefined, null);
      try {
        localStorage.removeItem('mycoupon-user-info');
        localStorage.removeItem('user-manually-logged-in');
      } catch (e) { /* ignore */ }
      try {
        if ('caches' in window) {
          const names = await caches.keys();
          await Promise.all(names.map(n => caches.delete(n)));
        }
      } catch (e) { /* ignore */ }
      window.location.href = '/';
    }
  }, [logoutMutation, utils]);

  // ── Capacitor 앱 resume: background → foreground 복귀 시 세션 재검증 ─────────
  // 문제: 앱을 며칠간 background에 두다가 복귀하면 세션이 만료됐어도 로그인 상태로 보임.
  //       auth.me staleTime=Infinity이므로 자동 재호출이 없음.
  // 해결: appStateChange(isActive=true) 이벤트에서 auth.me 1회 재검증.
  //       세션 유효 → 상태 유지. 세션 만료 → 자동 로그아웃 흐름으로 진입.
  useEffect(() => {
    if (!isCapacitorNative()) return;

    let resumeHandler: { remove: () => void } | null = null;
    import('@capacitor/app').then(({ App }) => {
      resumeHandler = App.addListener('appStateChange', ({ isActive }) => {
        if (!isActive) return; // background 진입은 무시
        // OAuth Custom Tabs 진행 중이면 refetch 건너뜀
        // 이유: appStateChange가 appUrlOpen보다 먼저 발화되므로
        //       ticket exchange 전에 auth.me=null이 되어 로그인 페이지로 날아가는 race 차단
        if (_oauthInProgress) {
          console.log('[resume] OAuth 진행 중 — foreground refetch 건너뜀 (ticket exchange 대기)');
          return;
        }
        // foreground 복귀 시 세션 조용히 재검증 (UI 블로킹 없음)
        meQuery.refetch().then(r => {
          if (r.data) {
            try { localStorage.setItem('mycoupon-user-info', JSON.stringify(r.data)); } catch (_) {}
          }
        }).catch(() => {});
      }) as any;
    }).catch(() => {});

    return () => { resumeHandler?.remove(); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── OAuth 콜백 감지: URL에 code/state/auth_callback 있으면 모듈 전체에서 1회만 처리 ─
  useEffect(() => {
    if (_oauthUrlHandled) return; // 모듈 레벨 가드 (다른 인스턴스가 이미 처리)
    const urlParams = new URLSearchParams(window.location.search);
    const hasOAuthParams = urlParams.has('code') || urlParams.has('state');
    const hasAuthCallback = urlParams.has('auth_callback');
    if (!hasOAuthParams && !hasAuthCallback) return;

    _oauthUrlHandled = true;
    urlParams.delete('code');
    urlParams.delete('state');
    urlParams.delete('auth_callback');
    const newUrl = window.location.pathname + (urlParams.toString() ? '?' + urlParams.toString() : '');
    window.history.replaceState({}, '', newUrl);

    if (hasAuthCallback && !hasOAuthParams) {
      // [OAUTH-RETURN-T0] OAuth 복귀 타이밍 측정 시작 — Stage 2 진단
      const _oauthReturnT0 = performance.now();
      console.log('[OAUTH-RETURN-T0] auth_callback detected — t=' + Math.round(_oauthReturnT0) + ' | meQuery.data:', meQuery.data !== undefined ? (meQuery.data ? 'user' : 'null') : 'undefined', '| meQuery.isPending:', meQuery.isPending);
      // [OAUTH-DIAG] regular vs incognito 차이 진단 — 구 SW · localStorage · sessionStorage · cookie 상태
      try {
        const _swCtrl = navigator.serviceWorker?.controller;
        console.log('[OAUTH-DIAG] sw.controller:', _swCtrl ? _swCtrl.scriptURL : 'none (no SW in control)');
        console.log('[OAUTH-DIAG] localStorage keys:', Object.keys(localStorage).join(',') || '(empty)');
        console.log('[OAUTH-DIAG] sessionStorage keys:', Object.keys(sessionStorage).join(',') || '(empty)');
        console.log('[OAUTH-DIAG] document.cookie (non-httponly only):', document.cookie || '(empty — HttpOnly cookies are invisible here)');
      } catch (_diagErr) { /* ignore */ }
      // 웹 OAuth 완료 신호 (auth_callback=1): bfcache stale null 우회용 강제 refetch
      console.log('[OAUTH] auth_callback 감지 → auth.me 강제 refetch (bfcache stale null 우회)');
      meQuery.refetch().then(r => {
        const _dt = Math.round(performance.now() - _oauthReturnT0);
        console.log('[OAUTH-RETURN-T1] refetch resolved — dt=' + _dt + 'ms | user:', r.data?.email ?? null);
        if (r.data) {
          try { localStorage.setItem("mycoupon-user-info", JSON.stringify(r.data)); } catch (_) {}
          utils.auth.me.setData(undefined, r.data);
          console.log('[OAUTH] ✅ 웹 로그인 완료');
        } else {
          // me가 null 반환: 쿠키 미설정 or 세션 불일치 → 오염 상태 정리
          console.warn('[OAUTH] ❌ auth_callback 후 auth.me null → localStorage 잔재 sweep');
          sweepStaleAuthState();
          try { localStorage.removeItem('mycoupon-user-info'); } catch (_) {}
          utils.auth.me.setData(undefined, null);
        }
      }).catch((err) => {
        const _dt = Math.round(performance.now() - _oauthReturnT0);
        console.error('[OAUTH-RETURN-ERR] refetch failed — dt=' + _dt + 'ms | err:', err);
        // 네트워크 실패 / abort → 오염 상태 정리 후 clean null 유지
        sweepStaleAuthState();
        try { localStorage.removeItem('mycoupon-user-info'); } catch (_) {}
        utils.auth.me.setData(undefined, null);
      });
      return;
    }

    console.log('[OAUTH] URL params 감지 (code/state) → auth.me refetch 시작 (웹 OAuth 콜백)');
    meQuery.refetch().then(r => {
      if (r.data) {
        try { localStorage.setItem("mycoupon-user-info", JSON.stringify(r.data)); } catch (_) {}
        utils.auth.me.setData(undefined, r.data);
        console.log('[NAV] 웹 OAuth 완료 → window.location.href = "/" 로 이동');
        setTimeout(() => { window.location.href = '/'; }, 100);
      } else {
        console.warn('[NAV] 웹 OAuth 후 auth.me null → 로그인 페이지로 redirect');
        window.location.href = getLoginUrl();
      }
    }).catch(() => {
      console.error('[NAV] 웹 OAuth refetch 실패 → 로그인 페이지로 redirect');
      window.location.href = getLoginUrl();
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── 부트 진단 로그 (1회) ──────────────────────────────────────────────────────
  useEffect(() => {
    console.log('[BOOT-2] meQuery start — status:', meQuery.status, '| fetchStatus:', meQuery.fetchStatus, '| isPending:', meQuery.isPending);
    console.log('[BOOT-4] exchange pending =', _oauthInProgress, '| refetching =', _isRefetchingFromOAuth);
    console.log('[BOOT] useAuth mount —', {
      isPending: meQuery.isPending,
      isFetching: meQuery.isFetching,
      fetchStatus: meQuery.fetchStatus,
      status: meQuery.status,
      data: meQuery.data !== undefined ? (meQuery.data ? 'user' : 'null') : 'undefined',
      networkOnline: navigator.onLine,
      networkMode: 'always',
      url: window.location.href.slice(0, 80),
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── [AUTH-ME-SETTLED] meQuery lifecycle — isFetching 변화 추적 ──────────────────
  useEffect(() => {
    const state = {
      status: meQuery.status,
      fetchStatus: meQuery.fetchStatus,
      isPending: meQuery.isPending,
      isFetching: meQuery.isFetching,
      hasData: meQuery.data !== undefined ? (meQuery.data ? 'user' : 'null') : 'undefined',
      t: Math.round(performance.now()),
    };
    if (meQuery.isFetching) {
      console.log('[AUTH-ME-SETTLED] fetching-start', state);
    } else {
      console.log('[AUTH-ME-SETTLED] fetching-end', state);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [meQuery.isFetching]);

  // ── bfcache 복귀 감지 (pageshow persisted=true) ───────────────────────────────
  // bfcache 복원 시 React Query in-memory 상태가 그대로 복구됨.
  // data=null + staleTime:Infinity + refetchOnMount:false → 자동 재호출 없음 → 영구 비로그인.
  // pageshow persisted=true 시:
  //   1. 오염 상태 sweep (TTL 만료 oauth 마커 등)
  //   2. 강제 refetch로 최신 세션 상태 반영
  useEffect(() => {
    const handlePageShow = (e: PageTransitionEvent) => {
      console.log('[BFCache] pageshow — persisted:', e.persisted, '| data:', meQuery.data ? 'user' : meQuery.data === null ? 'null' : 'undefined');
      if (e.persisted) {
        console.log('[BFCache] bfcache 복원 감지 → sweep + meQuery.refetch()');
        sweepStaleAuthState(); // TTL 만료 oauth 마커 등 정리
        meQuery.refetch().catch(() => {});
      }
    };
    window.addEventListener('pageshow', handlePageShow);
    return () => window.removeEventListener('pageshow', handlePageShow);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── localStorage 하이드레이션: 첫 렌더 시 캐시 없으면 localStorage 로 채우기 ─
  // 스키마 검증: id·role 필드가 없는 오염 데이터는 무시하고 제거
  // OAuth callback 중에는 건너뜀 — stale 데이터로 gate를 조기 해제하면
  //   SW 리다이렉트 + 리로드 타이밍에서 실제 auth.me 결과가 누락될 수 있음
  const hydrationDoneRef = useRef(false);
  useEffect(() => {
    console.log('[HYDRATE-CACHE] start', { url: window.location.search.slice(0, 40), hasCache: !!localStorage.getItem('mycoupon-user-info'), meDataStatus: meQuery.data !== undefined ? (meQuery.data ? 'user' : 'null') : 'undefined' });
    if (hydrationDoneRef.current) { console.log('[HYDRATE-CACHE] skip: already-done'); return; }
    if (meQuery.data !== undefined) { console.log('[HYDRATE-CACHE] skip: meQuery.data exists'); return; }
    // auth_callback=1 이 있으면 OAuth 방금 완료 → 신선한 서버 응답을 기다려야 함
    // 하이드레이션 건너뜀: gate는 실제 auth.me 응답으로 해제됨
    const _p = new URLSearchParams(window.location.search);
    if (_p.has('auth_callback') || _p.has('code')) { console.log('[HYDRATE-CACHE] skip: auth_callback present'); return; }
    // ── Mobile Chrome web: localStorage 하이드레이션 skip ──────────────────────
    // 이유: 즉시 setData(user) → authIdentity '' → userId:role 전환이 첫 렌더 직후 발생
    //       → Radix 컴포넌트 초기화와 race → scroll-lock stuck → 화면 이상 + 프리즈
    // 대신: auth.me 네트워크 응답 후 전환 (페이지가 guest 상태로 안정화된 후)
    //       → authTransitionStabilizing이 예측 가능한 시점에 정상 작동
    // 단: auth.me 응답 전까지 ~300–800ms 간 guest UI 표시 (cold start 시 더 길 수 있음)
    if (isMobileChromeWeb()) { console.log('[HYDRATE-CACHE] skip: mobile Chrome web (auth.me pending)'); return; }
    hydrationDoneRef.current = true;

    try {
      const saved = localStorage.getItem("mycoupon-user-info");
      if (saved) {
        const userInfo = JSON.parse(saved);
        // 최소 스키마 검증: id와 role이 있어야 유효한 유저 객체
        if (userInfo && typeof userInfo === 'object' && userInfo.id && userInfo.role) {
          console.log('[HYDRATE-CACHE] applied', { userId: userInfo.id, role: userInfo.role });
          utils.auth.me.setData(undefined, userInfo);
        } else {
          // 오염된 데이터 — 제거 후 서버에서 새로 받음
          console.warn('[HYDRATE-CACHE] removed-invalid-cache');
          localStorage.removeItem("mycoupon-user-info");
        }
      } else {
        console.log('[HYDRATE-CACHE] no-cache-found');
      }
    } catch (_) {
      // JSON 파싱 실패 — 오염 데이터 정리
      console.warn('[HYDRATE-CACHE] removed-invalid-cache (parse error)');
      try { localStorage.removeItem("mycoupon-user-info"); } catch (_2) {}
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── localStorage에 현재 유저 저장 + 서버 검증 타임스탬프 갱신 ──────────────
  useEffect(() => {
    console.log('[BOOT-3] meQuery result hasSession =', !!meQuery.data, '| data:', meQuery.data ? 'user' : meQuery.data === null ? 'null' : 'undefined', '| isLoading:', meQuery.isLoading);
    if (meQuery.isLoading) return;
    if (meQuery.data) {
      try { localStorage.setItem("mycoupon-user-info", JSON.stringify(meQuery.data)); } catch (_) {}
      // 서버에서 세션이 확인된 시각 기록 — 하이드레이션 재검증 기준점
      try { localStorage.setItem("mycoupon-auth-validated-at", String(Date.now())); } catch (_) {}
    } else if (meQuery.data === null) {
      // data===null: 서버가 "로그인 안 됨"을 명시적으로 반환한 경우만 제거
      try { localStorage.removeItem("mycoupon-user-info"); } catch (_) {}
      try { localStorage.removeItem("mycoupon-auth-validated-at"); } catch (_) {}
    }
  }, [meQuery.data, meQuery.isLoading]);

  // ── 다른 탭 로그인/로그아웃 동기화 (Capacitor는 탭 없으므로 웹 전용) ─────────
  useEffect(() => {
    if (isCapacitorNative()) return; // Capacitor 앱은 단일 윈도우 → storage 이벤트 불필요
    if (_storageListenerRegistered) return; // 모듈 레벨 가드
    _storageListenerRegistered = true;

    const handler = (e: StorageEvent) => {
      if (e.key === 'mycoupon-user-info') {
        meQuery.refetch().catch(() => {});
      }
    };
    window.addEventListener('storage', handler);
    // 앱 수명 동안 유지 (cleanup 없음 — 모듈 싱글톤)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Capacitor Android: OAuth 완료 후 세션 복원 ─────────────────────────────
  // 핵심 수정: 모듈 레벨 가드로 여러 useAuth() 인스턴스에서 중복 등록 차단
  // 이전 문제: SessionLoadingGate + MapPage + Home 등 N개 인스턴스 → N배 리스너 → 폭주
  useEffect(() => {
    if (!isCapacitorNative()) return;
    if (_capacitorListenersRegistered) return; // 모듈 레벨 가드 — 1회만
    _capacitorListenersRegistered = true;

    // ── refetchAndStore: browserFinished fallback 전용 bare refetch ──────────
    // 이 함수는 exchange 없이 auth.me만 1회 조회한다.
    // _isRefetchingFromOAuth = true를 설정하지 않는다.
    //   이유: 이 함수가 실행 중인 동안 appUrlOpen이 도착하면
    //         exchange를 반드시 수행해야 하므로 플래그로 차단하면 안 됨.
    // 차단 조건: appUrlOpen exchange가 진행 중인 경우(_isRefetchingFromOAuth = true)에만 스킵.
    const refetchAndStore = async () => {
      if (_isRefetchingFromOAuth) {
        console.log('[AUTH] refetchAndStore skipped — appUrlOpen exchange in progress');
        return;
      }
      // _isRefetchingFromOAuth 설정 안 함 — appUrlOpen이 도착하면 즉시 exchange 진행 가능
      try {
        const result = await meQuery.refetch();
        if (result.data) {
          try { localStorage.setItem('mycoupon-user-info', JSON.stringify(result.data)); } catch (_) {}
        } else {
          console.warn('[AUTH] OAuth 완료 후 세션 없음 — 쿠키 미설정 가능');
        }
      } catch (err) {
        console.error('[AUTH] refetch 실패:', err);
      }
    };

    // 동적 import: 웹 번들에 포함되지 않도록
    Promise.all([
      import('@capacitor/browser'),
      import('@capacitor/app'),
    ]).then(async ([{ Browser }, { App }]) => {
      // ══════════════════════════════════════════════════════════════════════
      // 새 OAuth 복귀 구조 (URL redirect 기반, 쿠키 의존 없음)
      //
      // 성공 경로 (정상):
      //   서버 /api/oauth/app-return → com.mycoupon.app://auth/callback
      //   → Custom Tabs 닫힘 → appUrlOpen 발화 → refetchAndStore() 1회
      //
      // 예외 경로 (Custom Tabs 자동 종료 실패 / 수동 닫기):
      //   browserFinished 발화 → appUrlOpen 대기(5초) → 미도착 & 미로그인 시 1회 fallback
      //
      // 중복 처리 방지:
      //   - _isRefetchingFromOAuth: 동시 호출 차단 (in-flight 가드)
      //   - 성공 경로(appUrlOpen)가 처리되면 meQuery.data가 세팅됨
      //     → fallback 타이머 발화 시 meQuery.data 체크로 중복 차단
      // ══════════════════════════════════════════════════════════════════════

      // ── browserFinished: 탭 닫힘 감지 전용 ─────────────────────────────────
      // ❌ 직접 refetch 금지: appUrlOpen이 주 트리거. 중복 refetch 방지.
      // ✅ appUrlOpen이 미도착한 예외 케이스에만 5초 후 1회 fallback.
      // ── browserFinished: 탭 닫힘 감지 전용 (성공 트리거 금지) ─────────────────
      // appUrlOpen이 주 트리거. browserFinished는 예외 fallback 용도만.
      Browser.addListener('browserFinished', () => {
        console.log('[OAUTH] browserFinished — Custom Tabs 닫힘 (탭 닫힘 이벤트만 기록)');
        _isRefetchingFromOAuth = false; // 강제 리셋 (안전망)

        // 중복 fallback 타이머 방지
        if (_browserFinishedFallbackTimer) {
          clearTimeout(_browserFinishedFallbackTimer);
          _browserFinishedFallbackTimer = null;
        }

        // 5초 대기: appUrlOpen이 정상 도착하면 이 타이머가 취소됨
        console.log('[OAUTH] browserFinished fallback start — appUrlOpen 5초 대기');
        _browserFinishedFallbackTimer = setTimeout(() => {
          _browserFinishedFallbackTimer = null;
          // 5초 후에도 appUrlOpen 미도착 → OAuth 취소/실패로 간주 → 플래그 해제
          _oauthInProgress = false;
          console.log('[AUTH] _oauthInProgress = false (5s fallback 타이머 — appUrlOpen 미도착)');

          if (meQuery.data) {
            // appUrlOpen이 먼저 처리 완료 → 중복 방지
            console.log('[OAUTH] fallback skipped: already authed (appUrlOpen이 처리함)');
            return;
          }
          // 예외: appUrlOpen 미도착 + 미로그인 → 1회만
          console.warn('[OAUTH] fallback executing: appUrlOpen 미도착 + 미로그인 → auth.me 1회');
          refetchAndStore();
        }, 5000);
      }).catch(() => {});

      // ── URL 정규화 ─────────────────────────────────────────────────────────────
      // intent:// unwrap, fragment 제거, trailing slash 제거
      const normalizeAuthDeepLink = (raw: string): string => {
        let url = raw;
        // 1. intent:// unwrap → scheme://path?params
        if (url.startsWith('intent://')) {
          const hashIdx = url.indexOf('#Intent;');
          const body = hashIdx >= 0 ? url.slice('intent://'.length, hashIdx) : url.slice('intent://'.length);
          const schemeMatch = url.match(/[#;]scheme=([^;]+)/);
          const scheme = schemeMatch ? schemeMatch[1] : 'com.mycoupon.app';
          url = `${scheme}://${body}`;
        }
        // 2. fragment 제거 (# 이후)
        const fragIdx = url.indexOf('#');
        if (fragIdx >= 0) url = url.slice(0, fragIdx);
        // 3. path trailing slash 제거 (query 앞)
        const qIdx = url.indexOf('?');
        if (qIdx >= 0) {
          url = url.slice(0, qIdx).replace(/\/$/, '') + url.slice(qIdx);
        } else {
          url = url.replace(/\/$/, '');
        }
        return url;
      };

      // ── 단일 진입점: consumeAuthDeepLink ─────────────────────────────────────
      // 모든 세 경로(appUrlOpen / launchUrl / pending)가 이 함수를 통해서만 processDeepLink를 호출
      const consumeAuthDeepLink = async (rawUrl: string, source: 'appUrlOpen' | 'launchUrl' | 'pending') => {
        console.log('[APP-AUTH-6B] consumeAuthDeepLink raw — source:', source, '| url:', rawUrl.slice(0, 120), '| t=' + Math.round(performance.now()));
        const normalized = normalizeAuthDeepLink(rawUrl);
        console.log('[APP-AUTH-6C] consumeAuthDeepLink normalized — url:', normalized.slice(0, 120), '| changed:', normalized !== rawUrl);
        await processDeepLink(normalized, source);
      };

      // ── 딥링크 처리 공통 함수 (warm start: appUrlOpen, cold start: getLaunchUrl) ──
      // server.url=remote 환경에서 cold start 시 appUrlOpen이 JS 리스너 등록 전에
      // 이미 발화될 수 있음 → getLaunchUrl() 로 동일 처리 경로 재사용
      const processDeepLink = async (url: string, source: 'appUrlOpen' | 'launchUrl' | 'pending') => {
        // [APP-AUTH-7] processDeepLink start
        console.log('[APP-AUTH-7] processDeepLink start — source:', source, '| url:', url.slice(0, 100), '| t=' + Math.round(performance.now()));
        fireAuthStep(7, 'progress', source);
        // [APP-DEEPLINK-1] raw url
        console.log('[APP-DEEPLINK-1]', source, 'raw url =', url.slice(0, 120));
        // [STEP-2] 딥링크 수신 — 이 로그가 찍히면 앱 복귀 성공
        console.log('[STEP-2] 📲 deeplink received —', url.slice(0, 80), `(source: ${source})`);

        // 두 가지 URL 패턴 허용:
        // 1. com.mycoupon.app://auth/callback?ticket=XXX  (정상 intent 경로)
        // 2. https://my-coupon-bridge.com/api/oauth/app-return?ticket=XXX
        //    (릴리즈 App Links fallback: intent 실패 시 S.browser_fallback_url이 App Links로 열린 경우)
        const isCustomScheme = url.startsWith('com.mycoupon.app://') && url.includes('ticket=');
        const isHttpsFallback = url.startsWith('https://my-coupon-bridge.com') && url.includes('ticket=');
        if (!isCustomScheme && !isHttpsFallback) {
          console.log('[APP-AUTH-7B] processDeepLink SKIP — non-auth URL | url:', url.slice(0, 80), '| source:', source);
          console.log('[APP-DEEPLINK-2] parsed path = (non-auth URL, skipped) —', url.slice(0, 60));
          fireAuthStep(7, 'fail', 'non_auth_url');
          return;
        }
        // [APP-DEEPLINK-2] parsed path
        console.log('[APP-DEEPLINK-2] parsed path =', url.slice(0, 80), `| isCustomScheme: ${isCustomScheme} | isHttpsFallback: ${isHttpsFallback}`);

        // _isRefetchingFromOAuth early return 제거 — 항상 exchange 진행
        // 이유: browserFinished 5초 fallback의 refetchAndStore가 이 플래그를 선점하면
        //       exchange가 완전히 누락되는 race가 발생함 (간헐 실패 원인)
        // 서버 ticket은 1회용(DB atomic UPDATE)이므로 중복 호출 시 401로 안전하게 거부됨
        console.log('[AUTH] deeplink proceeding — prior _isRefetchingFromOAuth was:', _isRefetchingFromOAuth, `| source: ${source}`);
        _isRefetchingFromOAuth = true;

        try {
          // ticket 추출: 두 URL 형식 모두 처리
          // 1. com.mycoupon.app://auth/callback?ticket=XXX → replace scheme 후 파싱
          // 2. https://my-coupon-bridge.com/api/oauth/app-return?ticket=XXX → 직접 파싱
          let ticket: string | null = null;
          try {
            const urlForParsing = url.startsWith('com.mycoupon.app://')
              ? url.replace('com.mycoupon.app://', 'https://placeholder/')
              : url;
            ticket = new URL(urlForParsing).searchParams.get('ticket');
          } catch (_) {}

          // [APP-DEEPLINK-3] ticket 존재 여부
          console.log('[APP-DEEPLINK-3] parsed ticket exists =', !!ticket, '| prefix =', ticket ? ticket.slice(0, 8) + '...' : 'null');
          // [APP-DEEPLINK-4] Browser.close: deep link intent가 앱을 열면서 Custom Tabs가 자동 닫힘 (명시적 Browser.close 없음)
          console.log('[APP-DEEPLINK-4] Browser.close = (implicit — deep link intent closes Custom Tabs)');

          let exchangeOk = false;
          if (ticket) {
            // [APP-EXCHANGE-1] exchange 시작
            console.log('[APP-EXCHANGE-1] exchange start ticketPrefix =', ticket.slice(0, 8) + '...');
            // [APP-EXCHANGE-2] URL
            console.log('[APP-EXCHANGE-2] request url = /api/oauth/app-exchange');
            // [APP-EXCHANGE-3] method
            console.log('[APP-EXCHANGE-3] request method = POST');
            // [APP-EXCHANGE-4] credentials
            console.log('[APP-EXCHANGE-4] credentials/include option = include');
            // [STEP-3] ticket exchange 시작
            console.log('[STEP-3] 🎫 app-exchange start — ticket:', ticket.slice(0, 8) + '...');
            fireAuthStep(8, 'progress');

            const resp = await fetch('/api/oauth/app-exchange', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              credentials: 'include', // WebView 쿠키 저장소에 Set-Cookie 적용
              body: JSON.stringify({ ticket }),
            });

            // body 1회 읽기
            let respBody: Record<string, unknown> = {};
            try { respBody = await resp.json() as Record<string, unknown>; } catch (_) {}

            // [APP-EXCHANGE-5] response status
            console.log('[APP-EXCHANGE-5] response status =', resp.status);
            // [APP-EXCHANGE-6] response body keys
            console.log('[APP-EXCHANGE-6] response body keys =', Object.keys(respBody).join(', ') || '(empty)');

            if (!resp.ok) {
              // [APP-EXCHANGE-7] fail
              console.warn('[APP-EXCHANGE-7] exchange fail — status:', resp.status, 'error:', respBody.error);
              console.warn('[APP-AUTH-8] app-exchange FAILED — status:', resp.status, '| error:', respBody.error, '| t=' + Math.round(performance.now()));
              // exchange 실패여도 auth.me는 반드시 호출 — 쿠키가 이미 설정됐을 수 있음
              console.warn('[AUTH] app-exchange fail — status:', resp.status, 'error:', respBody.error, '→ auth.me refetch 계속');
              fireAuthStep(8, 'fail', String(resp.status));
            } else {
              exchangeOk = true;
              // [APP-EXCHANGE-7] success
              console.log('[APP-EXCHANGE-7] exchange success');
              console.log('[APP-AUTH-8] app-exchange SUCCESS — WebView 쿠키 설정됨 | t=' + Math.round(performance.now()));
              fireAuthStep(8, 'success');
            }
          } else {
            // ticket 없음: legacy URL (fallback)
            console.warn('[AUTH] deeplink: ticket 없음 → legacy fallback (쿠키 동기화 기대)');
          }

          // [APP-DEEPLINK-5] handler 종료 직전
          console.log('[APP-DEEPLINK-5] deep link handler finished — ticket:', !!ticket, '| exchangeOk:', exchangeOk);

          // 300ms cookie-commit delay: WebView Set-Cookie가 즉시 반영 안 될 수 있음
          if (exchangeOk) {
            await new Promise(r => setTimeout(r, 300));
          }

          // [STEP-4] auth.me 호출 — exchange 성공/실패 무관하게 항상 실행
          console.log('[STEP-4] 🔐 auth.me refetch start — exchangeOk:', exchangeOk);
          console.log('[APP-AUTH-9] meQuery.refetch start — exchangeOk:', exchangeOk, '| t=' + Math.round(performance.now()));
          fireAuthStep(9, 'progress', 'auth.me...');
          let result = await meQuery.refetch();
          console.log('[AUTH] auth.me result — user:', result.data?.email ?? null, 'role:', result.data?.role ?? null);

          // 1x retry: exchange 성공 후 auth.me null이면 쿠키 커밋 지연 가능성
          if (!result.data && exchangeOk) {
            console.warn('[APP-AUTH-9] auth.me null after exchange — 1x retry in 500ms');
            await new Promise(r => setTimeout(r, 500));
            result = await meQuery.refetch();
            console.log('[APP-AUTH-9] retry result — user:', result.data?.email ?? null);
          }

          if (result.data) {
            try { localStorage.setItem('mycoupon-user-info', JSON.stringify(result.data)); } catch (_) {}
            console.log('[AUTH] ✅ 로그인 완료');
            console.log('[APP-AUTH-9] meQuery.refetch SUCCESS — user:', result.data.email, '| t=' + Math.round(performance.now()));
            fireAuthStep(9, 'success', result.data.email);
          } else {
            console.warn('[AUTH] ❌ auth.me null — exchangeOk:', exchangeOk, '| 서버 쿠키 미설정 또는 세션 만료');
            console.warn('[APP-AUTH-9] meQuery.refetch returned null — exchangeOk:', exchangeOk, '| 쿠키 미설정 가능 | t=' + Math.round(performance.now()));
            fireAuthStep(9, 'fail', exchangeOk ? 'cookie_miss' : 'no_exch');
            // SessionLoadingGate stuck 방지: auth.me null로 강제 설정 → loading=false
            utils.auth.me.setData(undefined, null);
          }
        } catch (err) {
          console.error('[AUTH] refetch fail —', err);
        } finally {
          _isRefetchingFromOAuth = false;
          _oauthInProgress = false;
          if (_oauthProgressSafetyTimer) { clearTimeout(_oauthProgressSafetyTimer); _oauthProgressSafetyTimer = null; }
          clearOAuthMarker(); // TTL 마커 삭제
          console.log('[AUTH] _oauthInProgress = false (deeplink 처리 완료)');
        }
      };

      // ── appUrlOpen: warm start (앱 background → foreground via deep link) ───
      App.addListener('appUrlOpen', async (data: { url: string }) => {
        console.log('[APP-AUTH-5] appUrlOpen received — url:', data.url.slice(0, 100), '| t=' + Math.round(performance.now()));
        fireAuthStep(5, 'success', 'appUrlOpen');
        // fallback 타이머 취소 (정상 경로로 처리)
        if (_browserFinishedFallbackTimer) {
          clearTimeout(_browserFinishedFallbackTimer);
          _browserFinishedFallbackTimer = null;
        }
        await consumeAuthDeepLink(data.url, 'appUrlOpen');
      }).catch(() => {});

      // ── Priority 1: PendingDeeplink (cold start App Links / JS 리스너 등록 전 타이밍 안전망) ──
      // MainActivity.captureDeepLinkIntent() → PendingDeeplinkPlugin.setPendingUrl()
      // appUrlOpen이 JS 등록 전에 발화될 경우 타이밍 의존 없이 URL 복구.
      let _pendingHandled = false;
      try {
        const { PendingDeeplink } = await import('@/lib/pendingDeeplink');
        const { url: pendingUrl } = await PendingDeeplink.getPendingUrl();
        if (pendingUrl) {
          console.log('[APP-AUTH-6] PendingDeeplink URL found — url:', pendingUrl.slice(0, 100), '| _isRefetchingFromOAuth:', _isRefetchingFromOAuth, '| t=' + Math.round(performance.now()));
          fireAuthStep(5, 'success', 'pendingDeeplink');
          _pendingHandled = true;
          // clearPendingUrl: fire-and-forget — await하면 에러 발생 시 processDeepLink 호출 차단
          PendingDeeplink.clearPendingUrl().catch(() => {});
          // _isRefetchingFromOAuth 가드 제거: 조건 없이 processDeepLink 호출
          // 서버 ticket은 1회용(DB atomic UPDATE) → 중복 호출 시 401로 안전하게 처리됨
          consumeAuthDeepLink(pendingUrl, 'pending');
        } else {
          console.log('[APP-AUTH-6] PendingDeeplink: no pending URL | _isRefetchingFromOAuth:', _isRefetchingFromOAuth);
        }
      } catch (e) {
        console.log('[APP-AUTH-6] PendingDeeplink error:', String(e).slice(0, 80));
      }

      // ── Priority 2: getLaunchUrl (표준 cold start 경로) ────────────────────────────────
      // server.url=remote 환경에서: 앱이 kill된 상태로 deep link 수신 →
      //   Capacitor가 appUrlOpen을 발화하지만 JS 리스너가 아직 미등록 →
      //   getLaunchUrl()로 동일 URL을 다시 읽어 processDeepLink 재실행
      // warm start에서는 getLaunchUrl()가 null을 반환하므로 중복 실행 없음
      if (!_pendingHandled) {
        App.getLaunchUrl().then((result) => {
          const url = result?.url;
          if (!url) {
            console.log('[APP-AUTH-6] getLaunchUrl: null (warm start or no deep link)');
            return;
          }
          console.log('[APP-AUTH-6] getLaunchUrl received — url:', url.slice(0, 120), '| _isRefetchingFromOAuth:', _isRefetchingFromOAuth, '| t=' + Math.round(performance.now()));
          fireAuthStep(5, 'success', 'launchUrl');
          // _isRefetchingFromOAuth 가드 제거: 조건 없이 processDeepLink 호출
          // 서버 ticket은 1회용(DB atomic UPDATE) → 중복 호출 시 401로 안전하게 처리됨
          consumeAuthDeepLink(url, 'launchUrl');
        }).catch(() => {});
      }
    }).catch(err => {
      console.warn('[AUTH] Capacitor 리스너 설정 실패:', err);
      _capacitorListenersRegistered = false; // 실패 시 재시도 허용
    });

    // 모듈 싱글톤 — cleanup 없음 (앱 수명 동안 1개 리스너 유지)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── 슈퍼어드민 allowlist (서버 context.ts와 동기화) ────────────────────────
  const SUPER_ADMIN_EMAIL = 'tnvjaosldka97@gmail.com';

  const state = useMemo(() => {
    let currentUser = meQuery.data ?? null;
    if (currentUser?.email === SUPER_ADMIN_EMAIL) {
      currentUser = { ...currentUser, role: 'admin' as const };
    }
    const isAdmin = currentUser?.role === 'admin' || currentUser?.email === SUPER_ADMIN_EMAIL;
    return {
      user: currentUser,
      // isFetching during error: refresh() 후 refetch가 hang해도 loading=true → 10s timeout 적용
      loading: meQuery.isPending || logoutMutation.isPending || (!!meQuery.error && meQuery.isFetching),
      error: meQuery.error ?? logoutMutation.error ?? null,
      isAuthenticated: Boolean(currentUser),
      isAdmin,
    };
  }, [meQuery.data, meQuery.error, meQuery.isPending, meQuery.isFetching, logoutMutation.error, logoutMutation.isPending]);

  // auth.me 실패만 로깅 (성공/로딩 verbose 로그 제거)
  useEffect(() => {
    if (meQuery.error) {
      console.error('[AUTH] auth.me 실패:', meQuery.error?.message?.slice(0, 120));
    }
  }, [meQuery.error, meQuery.fetchStatus]);

  // ── 비인증 시 리다이렉트 ─────────────────────────────────────────────────────
  useEffect(() => {
    if (!redirectOnUnauthenticated) return;
    if (meQuery.isLoading || logoutMutation.isPending) return;
    if (state.user) return;
    if (_oauthInProgress) return;       // native OAuth 진행 중 — Custom Tabs 열려있음
    if (_isRefetchingFromOAuth) return; // ticket exchange 진행 중 — auth.me 결과 대기
    if (typeof window === "undefined") return;
    if (window.location.pathname === redirectPath) return;
    window.location.href = redirectPath;
  }, [redirectOnUnauthenticated, redirectPath, logoutMutation.isPending, meQuery.isLoading, state.user]);

  return {
    ...state,
    refresh: () => meQuery.refetch(),
    login,             // 웹/앱 통합 로그인 — 환경 자동 분기
    logout,
    nativeGoogleLogin, // Capacitor 앱 전용 저수준 API — 직접 호출보다 login() 권장
  };
}
