// Version 2.0.0 - Updated at 2025-12-21 (Force cache clear)
import { trpc } from "@/lib/trpc";
import { UNAUTHED_ERR_MSG } from '@shared/const';
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { httpBatchLink, TRPCClientError } from "@trpc/client";
import { createRoot } from "react-dom/client";
import superjson from "superjson";
import App from "./App";
import { getLoginUrl } from "./const";
import "./index.css";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30 * 1000, // 30초간 데이터를 신선하게 유지 (성능 최적화)
      gcTime: 5 * 60 * 1000, // 5분간 캐시 유지 (빠른 응답)
      refetchOnWindowFocus: false, // 윈도우 포커스 시 자동 refetch 비활성화 (성능 최적화)
      refetchOnMount: false, // 컴포넌트 마운트 시 자동 refetch 비활성화 (성능 최적화)
      refetchOnReconnect: true, // 네트워크 재연결 시 자동 refetch (필수)
      retry: 1, // 실패 시 1회만 재시도
    },
  },
});

const redirectToLoginIfUnauthorized = (error: unknown) => {
  if (!(error instanceof TRPCClientError)) return;
  if (typeof window === "undefined") return;

  const isUnauthorized = error.message === UNAUTHED_ERR_MSG;

  if (!isUnauthorized) return;

  window.location.href = getLoginUrl();
};

queryClient.getQueryCache().subscribe(event => {
  if (event.type === "updated" && event.action.type === "error") {
    const error = event.query.state.error;
    redirectToLoginIfUnauthorized(error);
    console.error("[API Query Error]", error);
  }
});

queryClient.getMutationCache().subscribe(event => {
  if (event.type === "updated" && event.action.type === "error") {
    const error = event.mutation.state.error;
    redirectToLoginIfUnauthorized(error);
    console.error("[API Mutation Error]", error);
  }
});

const trpcClient = trpc.createClient({
  links: [
    httpBatchLink({
      url: "/api/trpc",
      transformer: superjson,
      fetch(input, init) {
        // HeadersInit 타입을 안전하게 처리
        const headers: Record<string, string> = {};
        
        // 기존 headers를 객체로 변환
        if (init?.headers) {
          if (init.headers instanceof Headers) {
            init.headers.forEach((value, key) => {
              headers[key] = value;
            });
          } else if (Array.isArray(init.headers)) {
            init.headers.forEach(([key, value]) => {
              headers[key] = value;
            });
          } else {
            Object.assign(headers, init.headers);
          }
        }
        
        // Content-Type이 application/json인 경우 캐시 무효화
        if (headers['Content-Type']?.includes('application/json')) {
          headers['Cache-Control'] = 'no-cache';
        }
        
        // 요청 타임아웃 설정 (성능 최적화: 서버 응답 대기 시간 제한)
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 10000); // 10초 타임아웃
        
        return globalThis.fetch(input, {
          ...(init ?? {}),
          credentials: "include",
          headers,
          signal: controller.signal,
        }).finally(() => {
          clearTimeout(timeoutId);
        });
      },
    }),
  ],
});

// PWA 필수: 서비스 워커 등록 전략 최적화 (Immediately 전략)
if ('serviceWorker' in navigator) {
  // 페이지 로드 완료를 기다리지 않고 즉시 등록 (더 빠른 시작)
  const registerSW = () => {
    navigator.serviceWorker
      .register('/service-worker.js', {
        // 즉시 활성화 전략
        updateViaCache: 'none', // 캐시 무시하고 항상 최신 버전 사용
      })
      .then((registration) => {
        console.log('✅ [main.tsx] 서비스 워커 등록 성공:', registration.scope);
        
        // 등록 후 즉시 업데이트 확인 (백그라운드)
        registration.update().catch(() => {
          // 업데이트 실패는 조용히 처리 (앱 실행 방해 안 함)
        });
      })
      .catch((error) => {
        console.error('❌ [main.tsx] 서비스 워커 등록 실패:', error);
        // 등록 실패해도 앱은 계속 실행
      });
  };
  
  // DOMContentLoaded 이벤트에서 즉시 등록 (load 이벤트보다 빠름)
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', registerSW);
  } else {
    // 이미 로드된 경우 즉시 실행
    registerSW();
  }
}

createRoot(document.getElementById("root")!).render(
  <trpc.Provider client={trpcClient} queryClient={queryClient}>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </trpc.Provider>
);
