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
    refetchOnWindowFocus: false, // 포커스 시 refetch 비활성화 (성능 최적화)
    refetchOnMount: false, // 마운트 시 refetch 비활성화 (성능 최적화)
    staleTime: 30 * 1000, // 30초간 데이터를 신선하게 유지 (불필요한 요청 방지)
    gcTime: 5 * 60 * 1000, // 5분간 캐시 유지 (빠른 응답)
  });

  const logoutMutation = trpc.auth.logout.useMutation({
    onSuccess: () => {
      utils.auth.me.setData(undefined, null);
    },
  });

  const logout = useCallback(async () => {
    try {
      // 로그아웃 전에 즉시 UI 업데이트 (사용자 경험 개선)
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
      // 로그아웃 후 상태 즉시 업데이트 (페이지 새로고침 없이)
      utils.auth.me.setData(undefined, null);
      utils.auth.me.invalidate().catch(() => {}); // 비동기로 처리, 실패해도 계속 진행
      
      // localStorage 정리
      try {
        localStorage.removeItem('manus-runtime-user-info');
        localStorage.setItem('auth-state-changed', Date.now().toString());
        localStorage.removeItem('auth-state-changed');
      } catch (e) {
        console.error('[Auth] localStorage 정리 실패:', e);
      }
    }
  }, [logoutMutation, utils]);

  // iOS PWA 세션 하이드레이션: localStorage에서 사용자 정보 복구
  useEffect(() => {
    // iOS standalone 모드 감지
    const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
    const isStandalone = window.matchMedia('(display-mode: standalone)').matches || 
                        (window.navigator as any).standalone === true;
    
    // iOS standalone 모드이고 사용자 정보가 없으면 localStorage에서 복구 시도
    if (isIOS && isStandalone && !meQuery.data && !meQuery.isLoading) {
      try {
        const savedUserInfo = localStorage.getItem("manus-runtime-user-info");
        if (savedUserInfo) {
          const userInfo = JSON.parse(savedUserInfo);
          console.log('[Auth] iOS PWA 세션 하이드레이션: localStorage에서 사용자 정보 복구 시도');
          // 임시로 데이터 설정 (실제 API 호출은 계속 진행)
          utils.auth.me.setData(undefined, userInfo);
          // 백그라운드에서 실제 API 호출로 검증
          meQuery.refetch().catch(() => {
            // API 호출 실패 시 localStorage 데이터도 삭제
            localStorage.removeItem("manus-runtime-user-info");
            utils.auth.me.setData(undefined, null);
          });
        }
      } catch (error) {
        console.error('[Auth] iOS 세션 하이드레이션 실패:', error);
        localStorage.removeItem("manus-runtime-user-info");
      }
    }
  }, [meQuery.data, meQuery.isLoading, utils]);

  const state = useMemo(() => {
    const currentUser = meQuery.data;
    
    // 사용자 정보가 있으면 localStorage에 저장 (iOS 세션 유지)
    if (currentUser) {
      try {
        localStorage.setItem(
          "manus-runtime-user-info",
          JSON.stringify(currentUser)
        );
      } catch (error) {
        console.error('[Auth] localStorage 저장 실패:', error);
      }
    } else {
      // 사용자 정보가 없으면 localStorage에서 제거
      try {
        localStorage.removeItem("manus-runtime-user-info");
      } catch (error) {
        console.error('[Auth] localStorage 삭제 실패:', error);
      }
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
      
      // 즉시 refetch (성능 최적화: 재시도 최소화, 즉시 UI 업데이트)
      const fetchUser = async () => {
        try {
          // 캐시 무효화와 refetch를 동시에 실행 (Promise.all로 병렬 처리)
          const [_, refetchResult] = await Promise.all([
            utils.auth.me.invalidate(),
            meQuery.refetch()
          ]);
          
          if (refetchResult.data) {
            console.log('[Auth] 사용자 정보 가져오기 성공:', refetchResult.data);
            // 성공 시 localStorage에 즉시 저장
            try {
              localStorage.setItem("manus-runtime-user-info", JSON.stringify(refetchResult.data));
            } catch (e) {
              console.error('[Auth] localStorage 저장 실패:', e);
            }
            // React Query가 자동으로 UI를 업데이트하므로 추가 작업 불필요
            return;
          } else {
            // 사용자 정보가 없으면 즉시 로그인 페이지로 안내 (재시도 제거)
            console.warn('[Auth] 사용자 정보 없음, 로그인 페이지로 안내');
            const loginUrl = getLoginUrl();
            window.location.href = loginUrl;
            return;
          }
        } catch (error) {
          console.error('[Auth] 사용자 정보 가져오기 실패:', error);
          
          // 세션/인증 오류 감지
          const isAuthError = error instanceof TRPCClientError && 
                             (error.data?.code === 'UNAUTHORIZED' || 
                              error.message.includes('UNAUTHORIZED'));
          
          if (isAuthError) {
            console.warn('[Auth] 인증 오류 감지, 로그인 페이지로 안내');
            const loginUrl = getLoginUrl();
            window.location.href = loginUrl;
            return;
          }
          
          // 일반 오류: 1회만 재시도 (성능 최적화)
          try {
            const retryResult = await meQuery.refetch();
            if (!retryResult.data) {
              const loginUrl = getLoginUrl();
              window.location.href = loginUrl;
            }
          } catch (retryError) {
            console.error('[Auth] 재시도 실패:', retryError);
            const loginUrl = getLoginUrl();
            window.location.href = loginUrl;
          }
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
            // localStorage에 저장
            try {
              localStorage.setItem("manus-runtime-user-info", JSON.stringify(result.data));
            } catch (e) {
              console.error('[Auth] localStorage 저장 실패:', e);
            }
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
      if (e.key === 'auth-state-changed' || e.key === 'manus-runtime-user-info') {
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
