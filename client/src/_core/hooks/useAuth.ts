import { getLoginUrl } from "@/const";
import { trpc } from "@/lib/trpc";
import { TRPCClientError } from "@trpc/client";
import { useCallback, useEffect, useMemo } from "react";

type UseAuthOptions = {
  redirectOnUnauthenticated?: boolean;
  redirectPath?: string;
};

export function useAuth(options?: UseAuthOptions) {
  const { redirectOnUnauthenticated = false, redirectPath = getLoginUrl() } =
    options ?? {};
  const utils = trpc.useUtils();

  const meQuery = trpc.auth.me.useQuery(undefined, {
    retry: 1, // 1회 재시도
    refetchOnWindowFocus: true, // 포커스 시 refetch 활성화 (로그인 후 상태 업데이트)
    refetchOnMount: true, // 마운트 시 refetch 활성화 (로그인 후 상태 업데이트)
    staleTime: 0, // 항상 최신 데이터 가져오기
    gcTime: 0, // 캐시 즉시 삭제
  });

  const logoutMutation = trpc.auth.logout.useMutation({
    onSuccess: () => {
      utils.auth.me.setData(undefined, null);
    },
  });

  const logout = useCallback(async () => {
    try {
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
      await utils.auth.me.invalidate();
      
      // 로그아웃 시 localStorage 이벤트 트리거 (캐시 강제 갱신)
      localStorage.setItem('auth-state-changed', Date.now().toString());
      localStorage.removeItem('auth-state-changed');
    }
  }, [logoutMutation, utils]);

  const state = useMemo(() => {
    const currentUser = meQuery.data;
    
    // 사용자 정보가 있으면 localStorage에 저장
    if (currentUser) {
      localStorage.setItem(
        "mycoupon-user-info",
        JSON.stringify(currentUser)
      );
    } else {
      // 사용자 정보가 없으면 localStorage에서 제거
      localStorage.removeItem("mycoupon-user-info");
    }
    
    // 로그인 상태 변경 시 캐시 갱신 이벤트는 제거 (무한 새로고침 방지)
    // 로그아웃 시에만 캐시 갱신 이벤트 발생 (logout 함수에서 처리)
    
    return {
      user: currentUser ?? null,
      loading: meQuery.isLoading || logoutMutation.isPending,
      error: meQuery.error ?? logoutMutation.error ?? null,
      isAuthenticated: Boolean(currentUser),
    };
  }, [
    meQuery.data,
    meQuery.error,
    meQuery.isLoading,
    logoutMutation.error,
    logoutMutation.isPending,
  ]);

  // 로그인 후 상태 업데이트 강화
  useEffect(() => {
    // OAuth 콜백 후 리다이렉트된 경우 감지
    const urlParams = new URLSearchParams(window.location.search);
    const isOAuthCallback = urlParams.has('code') || urlParams.has('state');
    
    // OAuth 콜백인 경우 즉시 refetch (타임아웃 없이)
    if (isOAuthCallback) {
      console.log('[Auth] OAuth 콜백 감지, 즉시 사용자 정보 가져오기');
      // URL에서 OAuth 파라미터 제거
      urlParams.delete('code');
      urlParams.delete('state');
      const newUrl = window.location.pathname + (urlParams.toString() ? '?' + urlParams.toString() : '');
      window.history.replaceState({}, '', newUrl);
      
      // 즉시 refetch (여러 번 시도)
      const fetchUser = async () => {
        try {
          await utils.auth.me.invalidate();
          const result = await meQuery.refetch();
          if (result.data) {
            console.log('[Auth] 사용자 정보 가져오기 성공:', result.data);
          } else {
            // 1초 후 재시도
            setTimeout(() => {
              meQuery.refetch().catch(console.error);
            }, 1000);
          }
        } catch (error) {
          console.error('[Auth] 사용자 정보 가져오기 실패:', error);
          // 2초 후 재시도
          setTimeout(() => {
            meQuery.refetch().catch(console.error);
          }, 2000);
        }
      };
      fetchUser();
      return;
    }
    
    // 페이지 로드 시 쿠키가 있지만 사용자 정보가 없는 경우 (로그인 직후)
    if (!meQuery.data && !meQuery.isLoading && !meQuery.error) {
      // 즉시 refetch (타임아웃 없이)
      console.log('[Auth] 사용자 정보 없음, 즉시 refetch');
      meQuery.refetch()
        .then((result) => {
          if (result.data) {
            console.log('[Auth] 사용자 정보 가져오기 성공');
            utils.auth.me.invalidate();
          }
        })
        .catch(console.error);
    }
  }, [meQuery, utils]);
  
  // 로그인 상태 변경 감지 및 강제 업데이트
  useEffect(() => {
    // storage 이벤트로 다른 탭에서 로그인/로그아웃 감지
    const handleStorageChange = (e: StorageEvent) => {
      if (e.key === 'auth-state-changed' || e.key === 'mycoupon-user-info') {
        // 인증 상태 변경 시 즉시 refetch
        meQuery.refetch().then(() => {
          utils.auth.me.invalidate();
        }).catch(console.error);
      }
    };
    
    window.addEventListener('storage', handleStorageChange);
    
    return () => {
      window.removeEventListener('storage', handleStorageChange);
    };
  }, [meQuery, utils]);

  useEffect(() => {
    if (!redirectOnUnauthenticated) return;
    if (meQuery.isLoading || logoutMutation.isPending) return;
    if (state.user) return;
    if (typeof window === "undefined") return;
    if (window.location.pathname === redirectPath) return;

    window.location.href = redirectPath
  }, [
    redirectOnUnauthenticated,
    redirectPath,
    logoutMutation.isPending,
    meQuery.isLoading,
    state.user,
  ]);

  return {
    ...state,
    refresh: () => meQuery.refetch(),
    logout,
  };
}
