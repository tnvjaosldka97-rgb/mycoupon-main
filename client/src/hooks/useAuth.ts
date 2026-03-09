import { getLoginUrl } from "@/lib/const";
import { trpc } from "@/lib/trpc";
import { isCapacitorNative } from "@/lib/capacitor";
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

  const logout = useCallback(async () => {
    try {
      utils.auth.me.setData(undefined, null);
      await logoutMutation.mutateAsync();
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

    meQuery.refetch().then(r => {
      if (r.data) {
        try { localStorage.setItem("mycoupon-user-info", JSON.stringify(r.data)); } catch (_) {}
        utils.auth.me.setData(undefined, r.data);
        setTimeout(() => { window.location.href = '/'; }, 100);
      } else {
        window.location.href = getLoginUrl();
      }
    }).catch(() => {
      window.location.href = getLoginUrl();
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── localStorage 하이드레이션: 첫 렌더 시 캐시 없으면 localStorage 로 채우기 ─
  const hydrationDoneRef = useRef(false);
  useEffect(() => {
    if (hydrationDoneRef.current) return;
    if (meQuery.data !== undefined) return; // 이미 데이터 있음
    hydrationDoneRef.current = true;

    try {
      const saved = localStorage.getItem("mycoupon-user-info");
      if (saved) {
        const userInfo = JSON.parse(saved);
        utils.auth.me.setData(undefined, userInfo);
      }
    } catch (_) {}
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

    // in-flight 가드 포함 refetchAndStore
    const refetchAndStore = async () => {
      if (_isRefetchingFromOAuth) {
        console.log('[AUTH] Capacitor OAuth refetch 이미 진행 중 — 중복 차단');
        return;
      }
      _isRefetchingFromOAuth = true;
      try {
        console.log('[AUTH] Capacitor OAuth return → auth.me refetch 시작');
        const result = await meQuery.refetch();
        if (result.data) {
          try { localStorage.setItem('mycoupon-user-info', JSON.stringify(result.data)); } catch (_) {}
          console.log('[AUTH] ✅ Capacitor 세션 복원 완료:', result.data.email);
        } else {
          console.warn('[AUTH] ⚠️ Capacitor OAuth 후 auth.me null — 쿠키 미설정 가능');
        }
      } catch (err) {
        console.error('[AUTH] ❌ Capacitor auth.me refetch 실패:', err);
      } finally {
        _isRefetchingFromOAuth = false;
      }
    };

    // 동적 import: 웹 번들에 포함되지 않도록
    Promise.all([
      import('@capacitor/browser'),
      import('@capacitor/app'),
    ]).then(([{ Browser }, { App }]) => {
      // browserFinished: Custom Tabs 닫힘 (뒤로가기 or OAuth 완료 후 자동 닫힘)
      Browser.addListener('browserFinished', refetchAndStore).catch(() => {});

      // appUrlOpen: 외부에서 딥링크로 앱 진입 시
      // 핵심 수정: 'my-coupon-bridge.com' 전체 포함 조건 제거
      //   → 모든 내부 네비게이션에서 auth.me가 트리거되던 문제 차단
      //   → OAuth 콜백 URL(code=, access_token=, /oauth/)에서만 처리
      App.addListener('appUrlOpen', (data: { url: string }) => {
        console.log('[AUTH] appUrlOpen:', data.url.slice(0, 80));
        const isOAuthCallback =
          data.url.includes('code=') ||
          data.url.includes('access_token=') ||
          data.url.includes('/oauth/') ||
          data.url.includes('/auth/callback');
        if (isOAuthCallback) {
          refetchAndStore();
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
      loading: meQuery.isLoading || logoutMutation.isPending,
      error: meQuery.error ?? logoutMutation.error ?? null,
      isAuthenticated: Boolean(currentUser),
      isAdmin,
    };
  }, [meQuery.data, meQuery.error, meQuery.isLoading, logoutMutation.error, logoutMutation.isPending]);

  // ── 진단 로그 (상태 변화 시만) ────────────────────────────────────────────
  useEffect(() => {
    if (meQuery.isLoading) {
      console.log('[AUTH] auth.me 요청 중 (isLoading=true)');
    }
  }, [meQuery.isLoading]);

  useEffect(() => {
    if (meQuery.data !== undefined) {
      console.log('[AUTH] ✅ auth.me 성공 → user:', meQuery.data ? meQuery.data.email : 'null(미로그인)');
    }
  }, [meQuery.data]);

  useEffect(() => {
    if (meQuery.error) {
      console.error('[AUTH] ❌ auth.me 실패 → fetchStatus:', meQuery.fetchStatus, '| error:', meQuery.error?.message?.slice(0, 80));
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
    logout,
  };
}
