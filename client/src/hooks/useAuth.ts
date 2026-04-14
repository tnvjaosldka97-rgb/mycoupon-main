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
        // [BATCH FIX] OAuth 진행 중: appUrlOpen 대기 + pendingDeeplink 재확인
        // appStateChange가 appUrlOpen보다 먼저 발화되므로 bare refetch는 skip
        // 단, pendingDeeplink에 URL이 저장돼있을 수 있음 → 200ms 후 재확인
        if (_oauthInProgress) {
          console.log('[resume] OAuth 진행 중 — foreground refetch skip, pendingDeeplink 200ms 후 재확인');
          setTimeout(async () => {
            try {
              const { PendingDeeplink: PDResume } = await import('@/lib/pendingDeeplink');
              const { url: resumeUrl } = await PDResume.getPendingUrl();
              console.log('[APP-AUTH-R3] pending raw (resume-check) — url:', resumeUrl ?? '(empty)', '| t=' + Math.round(performance.now()));
              if (resumeUrl) {
                console.log('[resume] pendingDeeplink found on foreground — consumeAuthDeepLink');
                PDResume.clearPendingUrl().catch(() => {});
                // dynamic import consumeAuthDeepLink는 이 스코프 안에 있으므로 직접 호출 가능
                // 단, appUrlOpen이 이미 처리 중이면 ticket dedup이 차단
                import('@/lib/pendingDeeplink').then(() => {
                  // consumeAuthDeepLink는 클로저 변수 — 직접 접근 불가
                  // dispatchEvent로 내부 핸들러에 URL 전달
                  window.dispatchEvent(new CustomEvent('__mycoupon_pending_url', { detail: { url: resumeUrl, source: 'resume' } }));
                }).catch(() => {});
              }
            } catch (_) {}
          }, 200);
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

      // ═══════════════════════════════════════════════════════════════════════════
      // NEW APP LOGIN CONTRACT — ticket-first design
      // Contract:  mycoupon://auth?app_ticket=<opaque-token>
      // Pipeline:  raw → extractAppTicket → handleAppTicket → exchange → me → gate
      // Legacy fallback: processDeepLink (ticket 추출 실패 시만)
      // ═══════════════════════════════════════════════════════════════════════════

      // [APP-BUILD] 빌드 핑거프린트 — APK 교체 확인용
      const _buildTs = '20260414-T1';
      console.log('[APP-BUILD-1] contract=ticket-first | scheme=mycoupon:// | build=' + _buildTs + ' | t=' + Math.round(performance.now()));
      console.log('[APP-BUILD-2] extractAppTicket=8step | handleAppTicket=single | consumeFromRaw=unified | t=' + Math.round(performance.now()));
      console.log('[APP-BUILD-3] dedup=inFlight+handled | legacy=processDeepLink(fallback) | t=' + Math.round(performance.now()));
      console.log('[APP-BUILD-4] receive_paths=appUrlOpen+pending+launchUrl | alias=consumeAuthDeepLink→consumeFromRaw | t=' + Math.round(performance.now()));

      // Ticket dedup sets
      const _inFlightTickets = new Set<string>();  // exchange 진행 중
      const _handledTickets  = new Set<string>();  // exchange 성공 완료

      // ── extractAppTicket(raw): raw URL → { ticket, reason } ─────────────────────
      // URL 전체를 auth URL로 판정하지 않는다 — app_ticket 하나만 추출한다.
      //
      // 추출 우선순위:
      //  1. query param  app_ticket  (새 계약 key)
      //  2. query param  ticket      (fallback alias)
      //  3. fragment에서 app_ticket / ticket
      //  4. 1차 decodeURIComponent → 1~3 반복
      //  5. 2차 decodeURIComponent → 1~3 반복 (이중 인코딩 방어)
      //  6. intent:// unwrap → 1~3 반복
      //  7. nested URL (redirect/url/callback 파라미터) → 1~3 반복
      //  8. 전체 raw 대상 정규식 fallback (maxi permissive charset)
      //
      // ticket charset: A-Za-z0-9_-.~ (opaque token — hex 가정 금지)
      const extractAppTicket = (raw: string): { ticket: string | null; reason: 'ticket_missing' | 'ticket_decode_failed' } => {
        if (!raw || !raw.trim()) return { ticket: null, reason: 'ticket_missing' };

        // Helper: URL 문자열 → app_ticket / ticket 추출 (query + fragment)
        const fromUrlStr = (u: string): string | null => {
          try {
            const base = u.startsWith('mycoupon://')
              ? u.replace('mycoupon://', 'https://placeholder/')
              : u.startsWith('com.mycoupon.app://')
              ? u.replace('com.mycoupon.app://', 'https://placeholder/')
              : u.startsWith('intent://')
              ? null
              : u;
            if (!base) return null;
            const parsed = new URL(base);
            const fromQ = parsed.searchParams.get('app_ticket') ?? parsed.searchParams.get('ticket');
            if (fromQ) return fromQ;
            // fragment
            const frag = parsed.hash?.slice(1);
            if (frag) {
              const fp = new URLSearchParams(frag);
              const fromF = fp.get('app_ticket') ?? fp.get('ticket');
              if (fromF) return fromF;
            }
          } catch (_) {}
          return null;
        };

        // Helper: 정규식 fallback — opaque token charset 포함
        const regexExtract = (s: string): string | null => {
          const m1 = s.match(/[?&#]app_ticket=([A-Za-z0-9_\-.~]+)/);
          if (m1) return m1[1];
          const m2 = s.match(/[?&#]ticket=([A-Za-z0-9_\-.~]+)/);
          if (m2) return m2[1];
          // URL-encoded = (%3D)
          const m3 = s.match(/app_ticket(?:=|%3[Dd])([A-Za-z0-9_\-.~]+)/i);
          if (m3) return m3[1];
          const m4 = s.match(/(?:^|[?&#])ticket(?:=|%3[Dd])([A-Za-z0-9_\-.~]+)/i);
          if (m4) return m4[1];
          return null;
        };

        // Helper: nested URL 파라미터 (redirect/url/callback 등) 에서 추출
        const fromNested = (u: string): string | null => {
          const NESTED = ['redirect', 'redirect_uri', 'url', 'callback', 'next', 'return_url'];
          try {
            const base = u.startsWith('mycoupon://')
              ? u.replace('mycoupon://', 'https://placeholder/')
              : u.startsWith('com.mycoupon.app://')
              ? u.replace('com.mycoupon.app://', 'https://placeholder/')
              : u;
            const parsed = new URL(base);
            for (const p of NESTED) {
              let val = parsed.searchParams.get(p);
              if (!val) continue;
              try { val = decodeURIComponent(val); } catch (_) {}
              const t = fromUrlStr(val) ?? regexExtract(val);
              if (t) return t;
            }
          } catch (_) {}
          return null;
        };

        // Step 1: raw 직접 추출
        let t = fromUrlStr(raw);
        if (t) return { ticket: t, reason: 'ticket_missing' };

        // Step 2: intent:// unwrap
        let unwrapped = raw;
        if (raw.startsWith('intent://')) {
          try {
            const hIdx = raw.indexOf('#Intent;');
            const body = hIdx >= 0 ? raw.slice('intent://'.length, hIdx) : raw.slice('intent://'.length);
            const schM = raw.match(/[#;]scheme=([^;&\s]+)/);
            const scheme = schM?.[1] ?? 'mycoupon';
            unwrapped = `${scheme}://${body}`;
            t = fromUrlStr(unwrapped) ?? regexExtract(unwrapped);
            if (t) return { ticket: t, reason: 'ticket_missing' };
          } catch (_) {}
        }

        // Step 3: 1차 decode
        let dec1 = raw;
        try {
          const d = decodeURIComponent(raw);
          if (d !== raw) {
            dec1 = d;
            t = fromUrlStr(dec1) ?? regexExtract(dec1);
            if (t) return { ticket: t, reason: 'ticket_missing' };
          }
        } catch (_) { return { ticket: null, reason: 'ticket_decode_failed' }; }

        // Step 4: 2차 decode (이중 인코딩)
        if (/%[0-9a-fA-F]{2}/.test(dec1)) {
          try {
            const d2 = decodeURIComponent(dec1);
            if (d2 !== dec1) {
              t = fromUrlStr(d2) ?? regexExtract(d2) ?? fromNested(d2);
              if (t) return { ticket: t, reason: 'ticket_missing' };
            }
          } catch (_) {}
        }

        // Step 5: nested URL 추출 (decode 이전/이후 모두 시도)
        t = fromNested(raw) ?? fromNested(dec1) ?? fromNested(unwrapped);
        if (t) return { ticket: t, reason: 'ticket_missing' };

        // Step 6: 전체 raw 정규식 fallback (마지막 수단)
        t = regexExtract(raw) ?? regexExtract(dec1);
        if (t) return { ticket: t, reason: 'ticket_missing' };

        return { ticket: null, reason: 'ticket_missing' };
      };

      // ── handleAppTicket(ticket): 앱 로그인 success path 단일 책임 함수 ───────────
      //  1. 중복 가드 (_inFlightTickets / _handledTickets)
      //  2. POST /api/oauth/app-exchange { app_ticket, ticket }
      //  3. exchange 성공 → 300ms delay → meQuery.refetch()
      //  4. me 성공 → localStorage 저장 + gate 해제
      //  5. 실패 시 utils.auth.me.setData(null) → gate 강제 해제 (stuck 방지)
      const handleAppTicket = async (ticket: string, source: string): Promise<void> => {
        // 중복 가드
        if (_inFlightTickets.has(ticket) || _handledTickets.has(ticket)) {
          console.log('[APP-AUTH-T3] exchange SKIP — duplicate ticket | source:', source, '| ticket:', ticket.slice(0, 8) + '... | inFlight:', _inFlightTickets.has(ticket), '| handled:', _handledTickets.has(ticket));
          return;
        }
        _inFlightTickets.add(ticket);
        _isRefetchingFromOAuth = true;

        try {
          console.log('[APP-AUTH-T3] exchange called | ticket:', ticket.slice(0, 8) + '... | source:', source, '| t=' + Math.round(performance.now()));
          fireAuthStep(8, 'progress');

          const resp = await fetch('/api/oauth/app-exchange', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            // app_ticket: 새 계약 key | ticket: 서버 backward compat
            body: JSON.stringify({ app_ticket: ticket, ticket }),
          });

          let respBody: Record<string, unknown> = {};
          try { respBody = await resp.json() as Record<string, unknown>; } catch (_) {}
          console.log('[APP-AUTH-T3] exchange response status:', resp.status, '| t=' + Math.round(performance.now()));

          if (!resp.ok) {
            console.warn('[APP-AUTH-T4] exchange fail | status:', resp.status, '| error:', respBody.error, '| reason: exchange_failed | t=' + Math.round(performance.now()));
            fireAuthStep(8, 'fail', `exchange_failed:${resp.status}`);
            console.warn('[APP-AUTH-T5] me fail — reason: exchange_failed | t=' + Math.round(performance.now()));
            console.warn('[APP-AUTH-T6B] gate not released — reason: exchange_failed');
            utils.auth.me.setData(undefined, null);
            return;
          }

          console.log('[APP-AUTH-T4] exchange success | t=' + Math.round(performance.now()));
          _handledTickets.add(ticket);
          fireAuthStep(8, 'success');

          // 300ms cookie-commit delay
          await new Promise(r => setTimeout(r, 300));

          // me refetch
          console.log('[APP-AUTH-T5] me refetch start | t=' + Math.round(performance.now()));
          fireAuthStep(9, 'progress');
          let result = await meQuery.refetch();

          // 1x retry: cookie commit 지연 가능성
          if (!result.data) {
            console.warn('[APP-AUTH-T5] me null — 1x retry 500ms | t=' + Math.round(performance.now()));
            await new Promise(r => setTimeout(r, 500));
            result = await meQuery.refetch();
          }

          if (result.data) {
            try { localStorage.setItem('mycoupon-user-info', JSON.stringify(result.data)); } catch (_) {}
            console.log('[APP-AUTH-T5] me success | user:', result.data.email, '| t=' + Math.round(performance.now()));
            fireAuthStep(9, 'success', result.data.email);
            console.log('[APP-AUTH-T6] gate released | user:', result.data.email, '| t=' + Math.round(performance.now()));
            fireAuthStep(10, 'success', 'gate_released');
          } else {
            console.warn('[APP-AUTH-T5] me fail — null after exchange+retry | reason: me_failed | t=' + Math.round(performance.now()));
            fireAuthStep(9, 'fail', 'me_failed');
            console.warn('[APP-AUTH-T6B] gate not released — reason: me_failed | t=' + Math.round(performance.now()));
            utils.auth.me.setData(undefined, null);
          }
        } catch (err) {
          console.error('[APP-AUTH-handleAppTicket] exception:', String(err).slice(0, 120));
          utils.auth.me.setData(undefined, null);
        } finally {
          _inFlightTickets.delete(ticket);
          _isRefetchingFromOAuth = false;
          _oauthInProgress = false;
          if (_oauthProgressSafetyTimer) { clearTimeout(_oauthProgressSafetyTimer); _oauthProgressSafetyTimer = null; }
          clearOAuthMarker();
          console.log('[AUTH] handleAppTicket complete — _oauthInProgress=false | t=' + Math.round(performance.now()));
        }
      };

      // ── consumeFromRaw: 3개 수신 경로의 단일 진입점 ───────────────────────────
      // raw → extractAppTicket → handleAppTicket
      // ticket 추출 실패 시 → processDeepLink legacy fallback (마지막 수단)
      const consumeFromRaw = async (raw: string, source: 'appUrlOpen' | 'launchUrl' | 'pending'): Promise<void> => {
        console.log('[APP-AUTH-T1] source=' + source + ' raw=' + raw + ' | t=' + Math.round(performance.now()));
        const extracted = extractAppTicket(raw);
        if (extracted.ticket) {
          console.log('[APP-AUTH-T2] extracted ticket=' + extracted.ticket.slice(0, 8) + '... | source=' + source + ' | t=' + Math.round(performance.now()));
          fireAuthStep(5, 'success', source);
          await handleAppTicket(extracted.ticket, source);
        } else {
          console.warn('[APP-AUTH-T2B] extract fail reason=' + extracted.reason + ' | source=' + source + ' | raw=' + raw.slice(0, 200));
          fireAuthStep(5, 'fail', extracted.reason);
          // Legacy fallback: processDeepLink (ticket 추출 실패 시만)
          console.log('[APP-AUTH-T7] legacy processDeepLink fallback entered | source=' + source + ' | raw:', raw.slice(0, 100));
          await processDeepLink(raw, source);
        }
      };

      // ── URL 정규화 (normalizeAuthUrl) — legacy fallback 전용 ───────────────────
      // 처리 순서:
      //  0. null/empty 방어
      //  1. intent:// wrapper 완전 제거 (decode 이전에 먼저 — 구조 보존)
      //  2. #Intent;...;end / # fragment 제거 (fragment→query auth 파라미터 병합 포함)
      //  3. 1차 decodeURIComponent
      //  4. 2차 decode: %3A %2F %3F %3D 잔류 시 재시도 (이중 인코딩 방어)
      //  5. 중첩 redirect/callback 파라미터 안의 auth URL 추출
      //  6. trailing slash 정규화
      // 반환: { url: string; skipReason: string | null }
      const _AUTH_SIGNALS = ['ticket=', 'app_ticket=', 'code=', 'auth_callback', 'state='];
      const normalizeAuthUrl = (raw: string): { url: string; skipReason: string | null } => {
        // 0. null/empty 방어
        if (!raw || !raw.trim()) return { url: '', skipReason: 'raw_missing' };
        let url = raw.trim();

        // 1. intent:// 완전 unwrap — decode 이전에 처리해야 구조 보존됨
        // intent://auth/callback?ticket=X#Intent;scheme=com.mycoupon.app;package=...;end
        if (url.startsWith('intent://')) {
          try {
            const intentBodyEnd = url.indexOf('#Intent;');
            const body = intentBodyEnd >= 0
              ? url.slice('intent://'.length, intentBodyEnd)
              : url.slice('intent://'.length);
            const schemeMatch = url.match(/[#;]scheme=([^;&\s]+)/);
            const scheme = schemeMatch ? schemeMatch[1] : 'com.mycoupon.app';
            url = `${scheme}://${body}`;
            console.log('[APP-AUTH-NORM] intent:// unwrapped → scheme:', scheme, '| body:', body.slice(0, 80));
          } catch (_) {
            console.warn('[APP-AUTH-NORM] intent:// unwrap failed → raw:', raw.slice(0, 100));
            return { url: raw, skipReason: 'malformed_intent' };
          }
        }

        // 2. # fragment 처리: auth 파라미터가 fragment에 있으면 query로 병합, 아니면 제거
        const hashIdx = url.indexOf('#');
        if (hashIdx >= 0) {
          const fragment = url.slice(hashIdx + 1);
          const beforeHash = url.slice(0, hashIdx);
          // fragment가 auth 파라미터를 포함하면 query string으로 합침
          if (_AUTH_SIGNALS.some(s => fragment.includes(s))) {
            const hasQuery = beforeHash.includes('?');
            url = beforeHash + (hasQuery ? '&' : '?') + fragment;
            console.log('[APP-AUTH-NORM] fragment→query merged | fragment:', fragment.slice(0, 60));
          } else {
            url = beforeHash;
          }
        }

        // 3. 1차 decodeURIComponent
        try {
          const d1 = decodeURIComponent(url);
          if (d1 !== url) {
            url = d1;
            console.log('[APP-AUTH-NORM] 1차 decode 적용 | first80:', url.slice(0, 80));
          }
        } catch (_) { /* decode 실패 → 현재 url 유지 */ }

        // 4. 2차 decode: %3A(%3a) %2F(%2f) %3F(%3f) %3D(%3d) 잔류 여부 체크
        // 이중 인코딩된 URL: com.mycoupon.app%3A%2F%2Fauth... → 1차 decode 후에도 scheme 인식 불가
        if (/%3[AaFf2f]|%3[Ff]|%3[Dd]|%2[Ff]/i.test(url)) {
          try {
            const d2 = decodeURIComponent(url);
            if (d2 !== url) {
              url = d2;
              console.log('[APP-AUTH-NORM] 2차 decode 적용 (이중 인코딩) | first80:', url.slice(0, 80));
            }
          } catch (_) { /* 실패 → 현재 url 유지 */ }
        }

        // 5. 중첩 auth URL 추출 (redirect/url/callback/next 파라미터 안의 실제 auth URL)
        const NESTED_PARAMS = ['redirect', 'redirect_uri', 'url', 'callback', 'next', 'return_url'];
        try {
          const parseBase = url.startsWith('com.mycoupon.app://')
            ? url.replace('com.mycoupon.app://', 'https://placeholder/')
            : url;
          const parsed = new URL(parseBase);
          for (const param of NESTED_PARAMS) {
            const val = parsed.searchParams.get(param);
            if (!val) continue;
            let candidate = val;
            try { candidate = decodeURIComponent(val); } catch (_) {}
            if (_AUTH_SIGNALS.some(s => candidate.includes(s))) {
              console.log('[APP-AUTH-NORM] nested URL extracted | param:', param, '| candidate:', candidate.slice(0, 80));
              url = candidate;
              break;
            }
          }
        } catch (_) { /* URL parse 실패 → 현재 url 유지 */ }

        // 6. trailing slash 정규화
        const qIdx = url.indexOf('?');
        if (qIdx >= 0) {
          url = url.slice(0, qIdx).replace(/\/$/, '') + url.slice(qIdx);
        } else {
          url = url.replace(/\/$/, '');
        }

        return { url, skipReason: null };
      };

      // ── auth 후보 판정 (checkAuthCandidate) — BATCH FIX v2 ────────────────────
      // 핵심 원칙: auth 파라미터 존재 여부를 scheme/host보다 먼저 확인.
      // 어떤 scheme이든 ticket= / app_ticket= / code= / state= / auth_callback 있으면 후보.
      // custom scheme / bridge domain은 파라미터 없어도 후보.
      const AUTH_CANDIDATE_PARAMS = ['ticket=', 'app_ticket=', 'code=', 'state=', 'auth_callback'];
      const checkAuthCandidate = (url: string): { isCandidate: boolean; reason: string } => {
        if (!url) return { isCandidate: false, reason: 'raw_missing' };

        // auth 파라미터 체크 FIRST — scheme/host보다 우선 (핵심 변경)
        const hasAuthParam = AUTH_CANDIDATE_PARAMS.some(p => url.includes(p));
        if (hasAuthParam) return { isCandidate: true, reason: '' };

        // 알려진 scheme / domain — 파라미터 없어도 auth 후보
        if (url.startsWith('com.mycoupon.app://')) return { isCandidate: true, reason: '' };
        if (url.startsWith('mycoupon://'))         return { isCandidate: true, reason: '' };
        if (url.startsWith('https://my-coupon-bridge.com')) return { isCandidate: true, reason: '' };

        // non-auth 판정 — skip reason 세분화
        if (url.startsWith('intent://'))
          return { isCandidate: false, reason: 'malformed_intent' };
        if (!url.startsWith('https://') && !url.startsWith('http://') && !url.startsWith('com.'))
          return { isCandidate: false, reason: 'unsupported_scheme' };
        if (url.startsWith('https://') && !url.includes('my-coupon-bridge.com'))
          return { isCandidate: false, reason: 'unsupported_host' };
        return { isCandidate: false, reason: 'missing_auth_params' };
      };

      // consumeAuthDeepLink: backward-compat alias → consumeFromRaw로 위임
      const consumeAuthDeepLink = (rawUrl: string, source: 'appUrlOpen' | 'launchUrl' | 'pending') =>
        consumeFromRaw(rawUrl, source);

      // ── processDeepLink: LEGACY FALLBACK ONLY ────────────────────────────────
      // Happy path: consumeFromRaw → extractAppTicket → handleAppTicket
      // 이 함수는 extractAppTicket이 ticket 추출에 실패했을 때만 진입.
      // URL 전체로 exchange를 시도하는 마지막 수단.
      const processDeepLink = async (url: string, source: 'appUrlOpen' | 'launchUrl' | 'pending'): Promise<void> => {
        console.log('[APP-AUTH-7] processDeepLink legacy-fallback start — source:', source, '| url:', url.slice(0, 100), '| t=' + Math.round(performance.now()));
        fireAuthStep(7, 'progress', source);

        if (_isRefetchingFromOAuth) {
          console.log('[APP-AUTH-7B] processDeepLink skip — exchange already in progress | reason: skipped_by_guard');
          return;
        }
        _isRefetchingFromOAuth = true;

        try {
          // ticket 재추출 (extractAppTicket 실패 이후이므로 URL parse만 시도)
          let ticket: string | null = null;
          try {
            const pb = url.startsWith('mycoupon://')
              ? url.replace('mycoupon://', 'https://placeholder/')
              : url.startsWith('com.mycoupon.app://')
              ? url.replace('com.mycoupon.app://', 'https://placeholder/')
              : url;
            const p = new URL(pb);
            ticket = p.searchParams.get('app_ticket') ?? p.searchParams.get('ticket');
          } catch (_) {}

          if (!ticket) {
            console.warn('[APP-AUTH-7B] processDeepLink SKIP — no ticket found | reason: exchange_not_called | url:', url.slice(0, 100));
            fireAuthStep(7, 'fail', 'exchange_not_called');
            utils.auth.me.setData(undefined, null);
            return;
          }

          console.log('[APP-AUTH-7] processDeepLink ticket found — prefix:', ticket.slice(0, 8) + '... | attempting exchange');
          fireAuthStep(8, 'progress');
          const resp = await fetch('/api/oauth/app-exchange', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ app_ticket: ticket, ticket }),
          });
          let respBody: Record<string, unknown> = {};
          try { respBody = await resp.json() as Record<string, unknown>; } catch (_) {}

          if (!resp.ok) {
            console.warn('[APP-AUTH-8] exchange FAILED (legacy) — status:', resp.status, '| error:', respBody.error);
            fireAuthStep(8, 'fail', String(resp.status));
            utils.auth.me.setData(undefined, null);
            return;
          }

          _handledTickets.add(ticket);
          fireAuthStep(8, 'success');
          await new Promise(r => setTimeout(r, 300));

          fireAuthStep(9, 'progress');
          let result = await meQuery.refetch();
          if (!result.data) {
            await new Promise(r => setTimeout(r, 500));
            result = await meQuery.refetch();
          }

          if (result.data) {
            try { localStorage.setItem('mycoupon-user-info', JSON.stringify(result.data)); } catch (_) {}
            console.log('[APP-AUTH-9] meQuery.refetch SUCCESS (legacy) — user:', result.data.email, '| t=' + Math.round(performance.now()));
            fireAuthStep(9, 'success', result.data.email);
          } else {
            console.warn('[APP-AUTH-9] meQuery.refetch null (legacy) | t=' + Math.round(performance.now()));
            fireAuthStep(9, 'fail', 'me_failed');
            utils.auth.me.setData(undefined, null);
          }
        } catch (err) {
          console.error('[APP-AUTH] processDeepLink legacy exception:', String(err).slice(0, 120));
          utils.auth.me.setData(undefined, null);
        } finally {
          _isRefetchingFromOAuth = false;
          _oauthInProgress = false;
          if (_oauthProgressSafetyTimer) { clearTimeout(_oauthProgressSafetyTimer); _oauthProgressSafetyTimer = null; }
          clearOAuthMarker();
          console.log('[AUTH] processDeepLink legacy complete — _oauthInProgress=false');
        }
      };

      // ── resume pending URL 이벤트 리스너 (appStateChange → pending URL 전달용) ─
      // appStateChange 핸들러가 consumeAuthDeepLink 클로저에 직접 접근 불가 →
      // CustomEvent로 브릿지. appUrlOpen이 이미 처리 중이면 ticket dedup이 차단.
      window.addEventListener('__mycoupon_pending_url', (e) => {
        const evt = e as CustomEvent<{ url: string; source: string }>;
        const resumeRaw = evt.detail?.url;
        if (!resumeRaw) return;
        console.log('[APP-AUTH-R3] pending raw (resume-event) — url:', resumeRaw, '| t=' + Math.round(performance.now()));
        consumeAuthDeepLink(resumeRaw, 'pending').catch((err) => {
          console.error('[APP-AUTH-6] consumeAuthDeepLink(resume-event) exception:', String(err).slice(0, 100));
        });
      });

      // ── appUrlOpen: warm start (앱 background → foreground via deep link) ───
      App.addListener('appUrlOpen', async (data: { url: string }) => {
        // [APP-AUTH-5] raw URL 전체 출력 (ticket 파라미터 포함 여부 확인용)
        const rawAppUrl = data?.url ?? '';
        console.log('[APP-AUTH-R1] appUrlOpen raw — url:', rawAppUrl, '| t=' + Math.round(performance.now()));
        console.log('[APP-AUTH-5] appUrlOpen received — url(FULL):', rawAppUrl, '| hasTicket:', rawAppUrl.includes('ticket='), '| t=' + Math.round(performance.now()));
        fireAuthStep(5, 'success', 'appUrlOpen');
        // fallback 타이머 취소 (정상 경로로 처리)
        if (_browserFinishedFallbackTimer) {
          clearTimeout(_browserFinishedFallbackTimer);
          _browserFinishedFallbackTimer = null;
        }
        if (!rawAppUrl) {
          console.error('[APP-AUTH-5-EMPTY] appUrlOpen data.url empty/null — consumeAuthDeepLink 호출 불가');
          fireAuthStep(5, 'fail', 'empty_url');
          return;
        }
        // 명시적 try-catch: async handler 내부 예외가 silent rejection으로 사라지는 것 차단
        try {
          await consumeAuthDeepLink(rawAppUrl, 'appUrlOpen');
        } catch (handlerErr) {
          console.error('[APP-AUTH-5-HANDLER-ERR] appUrlOpen consumeAuthDeepLink exception:', String(handlerErr).slice(0, 120));
          fireAuthStep(7, 'fail', 'handler_exception');
        }
      }).catch((listenErr) => {
        console.error('[APP-AUTH-5-LISTEN-ERR] App.addListener appUrlOpen 등록 실패:', String(listenErr).slice(0, 80));
      });

      // ── Priority 1: PendingDeeplink (cold start App Links / JS 리스너 등록 전 타이밍 안전망) ──
      // MainActivity.storeDeepLinkIfAuth() → PendingDeeplinkPlugin.setPendingUrl()
      // [Cold-start race fix]: MainActivity가 super.onCreate 이전에 setPendingUrl 호출 → JS 타이밍보다 항상 앞섬
      // 1차 즉시 시도 + 2차 지연 재시도(600ms): 혹시 여전히 race가 발생한 경우 보완
      let _pendingHandled = false;

      const tryConsumePending = async (attempt: 1 | 2): Promise<boolean> => {
        try {
          const { PendingDeeplink } = await import('@/lib/pendingDeeplink');
          const { url: pendingUrl } = await PendingDeeplink.getPendingUrl();
          console.log(`[APP-AUTH-R3] pending raw attempt-${attempt} — url:`, pendingUrl ?? '(empty)', '| t=' + Math.round(performance.now()));
          console.log(`[APP-AUTH-6] PendingDeeplink attempt-${attempt} — url:`, pendingUrl ? pendingUrl.slice(0, 200) : '(empty)', '| hasTicket:', pendingUrl?.includes('ticket=') ?? false, '| t=' + Math.round(performance.now()));
          if (pendingUrl) {
            fireAuthStep(5, 'success', `pending-${attempt}`);
            // clearPendingUrl: fire-and-forget — await하면 에러 발생 시 processDeepLink 호출 차단
            PendingDeeplink.clearPendingUrl().catch((clearErr) => {
              console.warn('[APP-AUTH-6] clearPendingUrl error (ignored):', String(clearErr).slice(0, 60));
            });
            // 서버 ticket은 1회용(DB atomic UPDATE) → 중복 호출 시 401로 안전하게 처리됨
            consumeAuthDeepLink(pendingUrl, 'pending').catch((pendErr) => {
              console.error('[APP-AUTH-6] consumeAuthDeepLink(pending) exception:', String(pendErr).slice(0, 100));
            });
            return true;
          }
          return false;
        } catch (e) {
          console.warn(`[APP-AUTH-6] PendingDeeplink attempt-${attempt} error:`, String(e).slice(0, 80));
          return false;
        }
      };

      // 1차 즉시 시도
      _pendingHandled = await tryConsumePending(1);

      // 2차 지연 재시도: cold-start race — native가 JS보다 늦은 edge case 대비
      // [BATCH FIX] _isRefetchingFromOAuth 가드 제거 — ticket dedup이 중복을 처리함
      setTimeout(async () => {
        console.log('[APP-AUTH-6] PendingDeeplink retry-2 start | t=' + Math.round(performance.now()));
        const handled2 = await tryConsumePending(2);
        console.log('[APP-AUTH-6] PendingDeeplink retry-2 result:', handled2 ? 'handled' : 'no_url');
      }, 600);

      // ── Priority 2: getLaunchUrl (표준 cold start 경로) ────────────────────────────────
      // [BATCH FIX] _pendingHandled 조건 제거 → 항상 실행
      // 이유: pendingUrl이 있어도 normalizeAuthUrl/checkAuthCandidate에서 드롭된 경우 백업
      //       getLaunchUrl이 null 반환하면 warm start → 중복 실행 없음
      //       ticket dedup이 실제 중복 처리를 차단
      App.getLaunchUrl().then((result) => {
        const url = result?.url;
        if (!url) {
          console.log('[APP-AUTH-6] getLaunchUrl: null (warm start or no deep link)');
          return;
        }
        console.log('[APP-AUTH-R2] getLaunchUrl raw — url:', url, '| t=' + Math.round(performance.now()));
        console.log('[APP-AUTH-6] getLaunchUrl received — url(FULL):', url, '| hasTicket:', url.includes('ticket='), '| t=' + Math.round(performance.now()));
        fireAuthStep(5, 'success', 'launchUrl');
        consumeAuthDeepLink(url, 'launchUrl').catch((lErr) => {
          console.error('[APP-AUTH-6] consumeAuthDeepLink(launchUrl) exception:', String(lErr).slice(0, 100));
        });
      }).catch((lUrlErr) => {
        console.warn('[APP-AUTH-6] getLaunchUrl error:', String(lUrlErr).slice(0, 60));
      });
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
