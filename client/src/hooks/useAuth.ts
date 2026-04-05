import { getLoginUrl } from "@/lib/const";
import { trpc } from "@/lib/trpc";
import { isCapacitorNative, openGoogleLogin } from "@/lib/capacitor";
import { getDeviceId } from "@/lib/deviceId";
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
    networkMode: 'online',
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
    if (isCapacitorNative()) {
      // Custom Tabs 웹 OAuth — SHA 등록 불필요, 서버 ticket 체인으로 세션 확립
      await openGoogleLogin(`/api/oauth/google/login?redirect=${encodeURIComponent('_app_')}`);
      return;
    }
    // 웹: 기존 OAuth 흐름 그대로
    window.location.href = loginUrl ?? getLoginUrl();
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

  // ── OAuth 콜백 감지: URL에 code/state 있으면 모듈 전체에서 1회만 처리 ────────
  useEffect(() => {
    if (_oauthUrlHandled) return; // 모듈 레벨 가드 (다른 인스턴스가 이미 처리)
    const urlParams = new URLSearchParams(window.location.search);
    if (!urlParams.has('code') && !urlParams.has('state')) return;

    _oauthUrlHandled = true;
    urlParams.delete('code');
    urlParams.delete('state');
    const newUrl = window.location.pathname + (urlParams.toString() ? '?' + urlParams.toString() : '');
    window.history.replaceState({}, '', newUrl);

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

  // ── localStorage 하이드레이션: 첫 렌더 시 캐시 없으면 localStorage 로 채우기 ─
  // 스키마 검증: id·role 필드가 없는 오염 데이터는 무시하고 제거
  const hydrationDoneRef = useRef(false);
  useEffect(() => {
    if (hydrationDoneRef.current) return;
    if (meQuery.data !== undefined) return;
    hydrationDoneRef.current = true;

    try {
      const saved = localStorage.getItem("mycoupon-user-info");
      if (saved) {
        const userInfo = JSON.parse(saved);
        // 최소 스키마 검증: id와 role이 있어야 유효한 유저 객체
        if (userInfo && typeof userInfo === 'object' && userInfo.id && userInfo.role) {
          utils.auth.me.setData(undefined, userInfo);
        } else {
          // 오염된 데이터 — 제거 후 서버에서 새로 받음
          localStorage.removeItem("mycoupon-user-info");
        }
      }
    } catch (_) {
      // JSON 파싱 실패 — 오염 데이터 정리
      try { localStorage.removeItem("mycoupon-user-info"); } catch (_2) {}
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── localStorage에 현재 유저 저장 (로그인 상태 유지) ───────────────────────
  useEffect(() => {
    if (meQuery.isLoading) return;
    if (meQuery.data) {
      try { localStorage.setItem("mycoupon-user-info", JSON.stringify(meQuery.data)); } catch (_) {}
    } else if (meQuery.data === null) {
      // data===null: 서버가 "로그인 안 됨"을 명시적으로 반환한 경우만 제거
      try { localStorage.removeItem("mycoupon-user-info"); } catch (_) {}
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

    // ── refetchAndStore: auth.me 1회 처리, 중복 차단 ─────────────────────────
    const refetchAndStore = async () => {
      if (_isRefetchingFromOAuth) return;
      _isRefetchingFromOAuth = true;
      try {
        const result = await meQuery.refetch();
        if (result.data) {
          try { localStorage.setItem('mycoupon-user-info', JSON.stringify(result.data)); } catch (_) {}
        } else {
          console.warn('[AUTH] OAuth 완료 후 세션 없음 — 쿠키 미설정 가능');
        }
      } catch (err) {
        console.error('[AUTH] refetch 실패:', err);
      } finally {
        _isRefetchingFromOAuth = false;
      }
    };

    // 동적 import: 웹 번들에 포함되지 않도록
    Promise.all([
      import('@capacitor/browser'),
      import('@capacitor/app'),
    ]).then(([{ Browser }, { App }]) => {
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

      // ── appUrlOpen: OAuth 복귀의 유일한 주 트리거 ───────────────────────────
      // com.mycoupon.app://auth/callback?ticket=<ticket>
      //   = 서버 OAuth 완료 후 발급한 1회용 login ticket
      //
      // 흐름:
      //   1. appUrlOpen 수신 → URL에서 ticket 추출
      //   2. POST /api/oauth/app-exchange { ticket }
      //      → 서버: ticket 검증 + 1회용 처리 + WebView에 Set-Cookie
      //   3. auth.me 1회 호출 → WebView 쿠키로 로그인 확인 → 홈 진입
      //
      // 핵심:
      //   /api/oauth/app-exchange는 WebView의 fetch()로 호출됨
      //   → 응답의 Set-Cookie가 WebView 쿠키 저장소에 저장됨
      //   → Chrome Custom Tabs 쿠키와 무관하게 WebView가 직접 세션을 획득
      App.addListener('appUrlOpen', async (data: { url: string }) => {
        console.log('[OAUTH] appUrlOpen fired —', data.url.slice(0, 100));

        if (!data.url.startsWith('com.mycoupon.app://auth/')) {
          console.log('[OAUTH] appUrlOpen — OAuth URL 아님 → 건너뜀');
          return;
        }

        // fallback 타이머 취소 (정상 경로로 처리)
        if (_browserFinishedFallbackTimer) {
          clearTimeout(_browserFinishedFallbackTimer);
          _browserFinishedFallbackTimer = null;
        }

        if (_isRefetchingFromOAuth) {
          console.log('[AUTH] appUrlOpen blocked — already in-flight');
          return;
        }
        _isRefetchingFromOAuth = true;

        try {
          // ticket 추출: com.mycoupon.app://auth/callback?ticket=<hex>
          let ticket: string | null = null;
          try {
            const urlForParsing = data.url.replace('com.mycoupon.app://', 'https://placeholder/');
            ticket = new URL(urlForParsing).searchParams.get('ticket');
          } catch (_) {}

          if (ticket) {
            // ── 정상 경로: ticket exchange ────────────────────────────────
            console.log('[AUTH] app-exchange start — ticket:', ticket.slice(0, 8) + '...');
            const resp = await fetch('/api/oauth/app-exchange', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              credentials: 'include', // WebView 쿠키 저장소에 Set-Cookie 적용
              body: JSON.stringify({ ticket }),
            });

            if (!resp.ok) {
              const errData = await resp.json().catch(() => ({})) as Record<string, unknown>;
              console.error('[AUTH] app-exchange fail — status:', resp.status, 'error:', errData.error);
              return;
            }
            console.log('[AUTH] app-exchange success — WebView에 쿠키 설정됨');
          } else {
            // ticket 없음: legacy URL (fallback)
            console.warn('[AUTH] appUrlOpen: ticket 없음 → legacy fallback (쿠키 동기화 기대)');
          }

          // auth.me 1회: WebView 쿠키로 로그인 확인
          console.log('[AUTH] refetch start — auth.me 호출');
          const result = await meQuery.refetch();
          if (result.data) {
            try { localStorage.setItem('mycoupon-user-info', JSON.stringify(result.data)); } catch (_) {}
            console.log('[AUTH] refetch success — user:', result.data.email, '| role:', result.data.role);
            console.log('[NAV] post-login navigate — 홈 진입');
          } else {
            console.warn('[AUTH] refetch success (null) — 세션 미설정 (ticket 만료 or exchange 실패)');
          }
        } catch (err) {
          console.error('[AUTH] refetch fail —', err);
        } finally {
          _isRefetchingFromOAuth = false;
        }
      }).catch(() => {});
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
      loading: meQuery.isPending || logoutMutation.isPending,
      error: meQuery.error ?? logoutMutation.error ?? null,
      isAuthenticated: Boolean(currentUser),
      isAdmin,
    };
  }, [meQuery.data, meQuery.error, meQuery.isPending, logoutMutation.error, logoutMutation.isPending]);

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
