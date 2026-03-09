import { getLoginUrl } from "@/lib/const";
import { trpc } from "@/lib/trpc";
import { isCapacitorNative } from "@/lib/capacitor";
import { TRPCClientError } from "@trpc/client";
import { useCallback, useEffect, useMemo, useRef } from "react";

type UseAuthOptions = {
  redirectOnUnauthenticated?: boolean;
  redirectPath?: string;
};

export function useAuth(options?: UseAuthOptions) {
  const { redirectOnUnauthenticated = false, redirectPath = getLoginUrl() } =
    options ?? {};
  const utils = trpc.useUtils();

  console.log('[AUTH] useAuth 훅 호출됨');

  const meQuery = trpc.auth.me.useQuery(undefined, {
    retry: 2,                   // Railway 슬립 복귀 / 앱 초기화 지연 대비 재시도 2회 허용
    retryDelay: 1500,           // 1.5초 간격 (빠른 재시도)
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

  // ── OAuth 콜백 감지: URL에 code/state 있으면 1회만 refetch ─────────────────
  const oauthHandledRef = useRef(false);
  useEffect(() => {
    if (oauthHandledRef.current) return;
    const urlParams = new URLSearchParams(window.location.search);
    if (!urlParams.has('code') && !urlParams.has('state')) return;

    oauthHandledRef.current = true;
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

  // ── 다른 탭 로그인/로그아웃 동기화 ─────────────────────────────────────────
  useEffect(() => {
    const handler = (e: StorageEvent) => {
      if (e.key === 'mycoupon-user-info') {
        meQuery.refetch().catch(() => {});
      }
    };
    window.addEventListener('storage', handler);
    return () => window.removeEventListener('storage', handler);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Capacitor Android: OAuth 완료 후 세션 복원 ─────────────────────────────
  // Chrome Custom Tabs로 OAuth 실행 후 아래 이벤트로 세션 상태를 갱신.
  // 쿠키 공유: Chrome Custom Tabs + WebView 동일 Android 앱 → 같은 쿠키 저장소 사용.
  //
  // 이벤트 1) browserFinished: 사용자가 Custom Tabs를 닫음 (뒤로가기 등)
  //          → 이 시점에 Set-Cookie 이미 저장됨 → auth.me 재시도
  // 이벤트 2) appUrlOpen: App Links 또는 custom scheme으로 복귀 시
  //          → 딥링크 URL을 파싱해 인증 완료 여부 확인
  useEffect(() => {
    if (!isCapacitorNative()) return;

    let browserHandle: { remove: () => void } | null = null;
    let appUrlHandle: { remove: () => void } | null = null;

    const refetchAndStore = async () => {
      try {
        console.log('[Capacitor] OAuth return detected, refetching auth.me...');
        const result = await meQuery.refetch();
        if (result.data) {
          try { localStorage.setItem('mycoupon-user-info', JSON.stringify(result.data)); } catch (_) {}
          console.log('[Capacitor] ✅ Session restored after OAuth:', result.data.email);
        } else {
          console.warn('[Capacitor] ⚠️ auth.me returned null after OAuth — cookie may not be set');
        }
      } catch (err) {
        console.error('[Capacitor] auth.me refetch failed after OAuth:', err);
      }
    };

    // 동적 import: 웹 번들에 포함되지 않도록
    Promise.all([
      import('@capacitor/browser'),
      import('@capacitor/app'),
    ]).then(([{ Browser }, { App }]) => {
      // browserFinished: Custom Tabs 닫힘 (뒤로가기 or OAuth 완료 후 자동 닫힘)
      Browser.addListener('browserFinished', refetchAndStore)
        .then(h => { browserHandle = h; })
        .catch(() => {});

      // appUrlOpen: App Links / custom scheme 복귀
      // (추후 App Links 설정 시 자동으로 발동)
      App.addListener('appUrlOpen', (data: { url: string }) => {
        console.log('[Capacitor] appUrlOpen:', data.url);
        // auth 관련 URL에서만 refetch
        if (data.url.includes('auth') || data.url.includes('login') || data.url.includes('my-coupon-bridge.com')) {
          refetchAndStore();
        }
      }).then(h => { appUrlHandle = h; })
        .catch(() => {});
    }).catch(err => {
      console.warn('[Capacitor] Could not set up Capacitor listeners:', err);
    });

    return () => {
      browserHandle?.remove();
      appUrlHandle?.remove();
    };
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

  // auth.me 상태 변화 진단 로그
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
