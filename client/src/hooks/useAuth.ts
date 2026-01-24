import { getLoginUrl } from "@/lib/const";
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
    retry: 0, // 재시도 없음 (빠른 응답)
    refetchOnWindowFocus: false, // 포커스 시 refetch 비활성화
    refetchOnMount: false, // 마운트 시 refetch 비활성화
    staleTime: 10 * 60 * 1000, // 10분간 신선하게 유지 (캐시 활용)
    gcTime: 30 * 60 * 1000, // 30분간 캐시 유지
    networkMode: 'online', // 온라인일 때만 요청 (Standalone 모드 최적화)
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
        localStorage.removeItem('mycoupon-user-info');
        localStorage.removeItem('user-manually-logged-in'); // Remember Me 플래그도 제거
      } catch (e) {
        console.error('[Auth] localStorage 정리 실패:', e);
      }
      
      // iOS Safari 호환: 캐시 직접 삭제 (storage 이벤트 대신)
      // iOS Safari는 같은 탭에서 발생한 storage 이벤트를 감지하지 못하므로
      // logout 함수 내부에서 직접 캐시를 삭제합니다.
      try {
        console.log('[Auth] 로그아웃 - 캐시 삭제 시작');
        if ('caches' in window) {
          caches.keys().then(cacheNames => {
            return Promise.all(
              cacheNames.map(cacheName => {
                console.log('[Auth] 캐시 삭제:', cacheName);
                return caches.delete(cacheName);
              })
            );
          }).then(() => {
            console.log('[Auth] ✅ 모든 캐시 삭제 완료');
            // 캐시 삭제 후 페이지 새로고침 (한 번만)
            if (!sessionStorage.getItem('cache-cleared-after-logout')) {
              sessionStorage.setItem('cache-cleared-after-logout', 'true');
              console.log('[Auth] 🔄 로그아웃 완료 - 페이지 새로고침');
              window.location.href = '/';
            }
          }).catch(error => {
            console.error('[Auth] ❌ 캐시 삭제 실패:', error);
            // 캐시 삭제 실패해도 페이지 새로고침
            window.location.href = '/';
          });
        } else {
          // caches API가 없으면 바로 페이지 새로고침
          window.location.href = '/';
        }
      } catch (e) {
        console.error('[Auth] 캐시 정리 실패:', e);
        window.location.href = '/';
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
        const savedUserInfo = localStorage.getItem("mycoupon-user-info");
        if (savedUserInfo) {
          const userInfo = JSON.parse(savedUserInfo);
          console.log('[Auth] iOS PWA 세션 하이드레이션: localStorage에서 사용자 정보 복구 시도');
          // 임시로 데이터 설정 (실제 API 호출은 계속 진행)
          utils.auth.me.setData(undefined, userInfo);
          // 백그라운드에서 실제 API 호출로 검증
          meQuery.refetch().catch(() => {
            // API 호출 실패 시 localStorage 데이터도 삭제
            localStorage.removeItem("mycoupon-user-info");
            utils.auth.me.setData(undefined, null);
          });
        }
      } catch (error) {
        console.error('[Auth] iOS 세션 하이드레이션 실패:', error);
        localStorage.removeItem("mycoupon-user-info");
      }
    }
  }, [meQuery.data, meQuery.isLoading, utils]);

  // 비상 마스터 관리자 이메일 (하드코딩) - 4명만 유지
  const MASTER_ADMIN_EMAILS = [
    'tnvjaosldka97@gmail.com',   // 마스터 관리자
    'sakuradaezun@gmail.com',    // 서버 관리자 (임시)
    'onlyup.myr@gmail.com',      // 서버 관리자 (임시)
    'mapo8887@gmail.com',        // 서버 관리자 (임시)
  ];

  const state = useMemo(() => {
    let currentUser = meQuery.data;
    
    // 비상 관리자 권한 주입: DB 상태나 세션에 관계없이 무조건 admin 권한 부여
    if (currentUser && currentUser.email && MASTER_ADMIN_EMAILS.includes(currentUser.email)) {
      currentUser = {
        ...currentUser,
        role: 'admin' as const,
      };
      console.log('[Auth] ⚡ EMERGENCY ADMIN: 프론트엔드에서 admin 권한 강제 적용');
    }
    
    // 사용자 정보가 있으면 localStorage에 저장 (iOS 세션 유지)
    if (currentUser) {
      try {
    localStorage.setItem(
      "mycoupon-user-info",
          JSON.stringify(currentUser)
    );
      } catch (error) {
        console.error('[Auth] localStorage 저장 실패:', error);
      }
    } else {
      // 사용자 정보가 없으면 localStorage에서 제거
      try {
        localStorage.removeItem("mycoupon-user-info");
      } catch (error) {
        console.error('[Auth] localStorage 삭제 실패:', error);
      }
    }
    
    // 로그인 상태 변경 시 캐시 갱신 이벤트는 제거 (무한 새로고침 방지)
    // 로그아웃 시에만 캐시 갱신 이벤트 발생 (logout 함수에서 처리)
    
    // isAdmin 플래그 계산
    const isAdmin = currentUser ? (currentUser.role === 'admin' || MASTER_ADMIN_EMAILS.includes(currentUser.email || '')) : false;
    
    return {
      user: currentUser ?? null,
      loading: meQuery.isLoading || logoutMutation.isPending,
      error: meQuery.error ?? logoutMutation.error ?? null,
      isAuthenticated: Boolean(currentUser),
      isAdmin, // 비상 관리자 플래그 추가
    };
  }, [
    meQuery.data,
    meQuery.error,
    meQuery.isLoading,
    logoutMutation.error,
    logoutMutation.isPending,
  ]);

  // 로그인 후 상태 업데이트 강화 (즉시 반영)
  useEffect(() => {
    // OAuth 콜백 후 리다이렉트된 경우 감지
    const urlParams = new URLSearchParams(window.location.search);
    const isOAuthCallback = urlParams.has('code') || urlParams.has('state');
    
    // OAuth 콜백인 경우 즉시 refetch (타임아웃 없이)
    if (isOAuthCallback) {
      // 무한 루프 방지: 이미 처리 중이면 건너뛰기
      const processingKey = 'oauth-callback-processing';
      if (sessionStorage.getItem(processingKey)) {
        console.log('[Auth] OAuth 콜백 이미 처리 중, 건너뛰기');
        return;
      }
      
      console.log('[Auth] OAuth 콜백 감지, 즉시 사용자 정보 가져오기');
      sessionStorage.setItem(processingKey, 'true');
      
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
            console.log('[Auth] ✅ 로그인 성공 - 즉시 UI 업데이트!');
            // localStorage에 저장
            try {
              localStorage.setItem("mycoupon-user-info", JSON.stringify(refetchResult.data));
              localStorage.setItem("user-manually-logged-in", "true");
            } catch (e) {
              console.error('[Auth] localStorage 저장 실패:', e);
            }
            
            // 페이지 새로고침 없이 즉시 상태 업데이트! (초고속)
            utils.auth.me.setData(undefined, refetchResult.data);
            sessionStorage.removeItem(processingKey);
            
            console.log('[Auth] ✅ 로그인 완료 (새로고침 없음, 즉시 반영!)');
            return;
          } else {
            // 사용자 정보가 없으면 즉시 로그인 페이지로 안내 (재시도 제거)
            console.warn('[Auth] 사용자 정보 없음, 로그인 페이지로 안내');
            sessionStorage.removeItem(processingKey);
            const loginUrl = getLoginUrl();
            window.location.href = loginUrl;
            return;
          }
        } catch (error) {
          console.error('[Auth] 사용자 정보 가져오기 실패:', error);
          sessionStorage.removeItem(processingKey);
          
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
            if (retryResult.data) {
              utils.auth.me.setData(undefined, retryResult.data);
              try {
                localStorage.setItem("mycoupon-user-info", JSON.stringify(retryResult.data));
                localStorage.setItem("user-manually-logged-in", "true");
              } catch (e) {
                console.error('[Auth] localStorage 저장 실패:', e);
              }
              sessionStorage.removeItem(processingKey);
              // 재시도 성공 시에도 새로고침
              setTimeout(() => {
                window.location.reload();
              }, 100);
            } else {
              sessionStorage.removeItem(processingKey);
              const loginUrl = getLoginUrl();
              window.location.href = loginUrl;
            }
          } catch (retryError) {
            console.error('[Auth] 재시도 실패:', retryError);
            sessionStorage.removeItem(processingKey);
            const loginUrl = getLoginUrl();
            window.location.href = loginUrl;
          }
        }
      };
      fetchUser();
      return;
    }
    
    // 페이지 로드 시 쿠키가 있지만 사용자 정보가 없는 경우 (로그인 직후)
    // 또는 localStorage에 사용자 정보가 있지만 React Query에 없는 경우
    const savedUserInfo = localStorage.getItem("mycoupon-user-info");
    if (!meQuery.data && !meQuery.isLoading && !meQuery.error) {
      // localStorage에 사용자 정보가 있으면 즉시 표시 (하이드레이션)
      if (savedUserInfo) {
        try {
          const userInfo = JSON.parse(savedUserInfo);
          console.log('[Auth] localStorage에서 사용자 정보 복구 (하이드레이션)');
          utils.auth.me.setData(undefined, userInfo);
        } catch (e) {
          console.error('[Auth] localStorage 파싱 실패:', e);
        }
      }
      
      // 즉시 refetch (타임아웃 없이)
      console.log('[Auth] 사용자 정보 없음, 즉시 refetch');
      meQuery.refetch()
        .then((result) => {
          if (result.data) {
            console.log('[Auth] 사용자 정보 가져오기 성공');
            // localStorage에 저장
            try {
              localStorage.setItem("mycoupon-user-info", JSON.stringify(result.data));
            } catch (e) {
              console.error('[Auth] localStorage 저장 실패:', e);
            }
            // 강제로 상태 갱신하여 UI 즉시 업데이트
            utils.auth.me.setData(undefined, result.data);
            
            // 로그인 후 즉시 UI 업데이트를 위해 requestAnimationFrame 사용
            requestAnimationFrame(() => {
              utils.auth.me.invalidate();
            });
          }
        })
        .catch(console.error);
    } else if (savedUserInfo && !meQuery.data && meQuery.isLoading) {
      // 로딩 중이지만 localStorage에 사용자 정보가 있으면 즉시 표시 (로딩 중에도 UI 업데이트)
      try {
        const userInfo = JSON.parse(savedUserInfo);
        console.log('[Auth] 로딩 중 localStorage에서 사용자 정보 복구 (즉시 표시)');
        utils.auth.me.setData(undefined, userInfo);
      } catch (e) {
        console.error('[Auth] localStorage 파싱 실패:', e);
      }
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
