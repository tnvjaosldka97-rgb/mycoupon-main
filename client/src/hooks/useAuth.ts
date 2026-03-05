import { getLoginUrl } from "@/lib/const";
import { trpc } from "@/lib/trpc";
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

  const meQuery = trpc.auth.me.useQuery(undefined, {
    retry: 0,
    refetchOnWindowFocus: false,
    refetchOnMount: false,
    staleTime: 5 * 60 * 1000,  // 5분
    gcTime: 30 * 60 * 1000,
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
