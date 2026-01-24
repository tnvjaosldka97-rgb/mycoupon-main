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
      staleTime: 10 * 60 * 1000, // 10분간 데이터를 신선하게 유지 (캐시 활용 극대화)
      gcTime: 30 * 60 * 1000, // 30분간 캐시 유지 (메모리 효율성)
      refetchOnWindowFocus: false, // 윈도우 포커스 시 자동 refetch 비활성화
      refetchOnMount: false, // 컴포넌트 마운트 시 자동 refetch 비활성화 (속도 향상)
      refetchOnReconnect: false, // 네트워크 재연결 시에도 refetch 안 함 (속도 우선)
      retry: 0, // 재시도 없음 (빠른 응답)
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
      maxURLLength: 2083, // URL 길이 제한 (배치 최적화)
      fetch(input, init) {
        return globalThis.fetch(input, {
          ...(init ?? {}),
          credentials: "include",
          // 속도 최적화: 기본 브라우저 캐시 활용
          headers: {
            ...(init?.headers ?? {}),
          },
        });
      },
    }),
  ],
});

// PWA 필수: 서비스 워커 등록 (앱 설치를 위해 필수)
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('/service-worker.js')
      .then((registration) => {
        console.log('✅ [main.tsx] 서비스 워커 등록 성공:', registration.scope);
      })
      .catch((error) => {
        console.error('❌ [main.tsx] 서비스 워커 등록 실패:', error);
      });
  });
}

// 서버 Keep-alive: 30초 간격으로 서버 깨우기 (Railway sleep 방지)
const SERVER_PING_INTERVAL = 30 * 1000; // 30초 (Railway 15분 sleep 방지)
const HEALTH_CHECK_URL = '/api/health';
const PERFORMANCE_THRESHOLD = 500; // 500ms 초과 시 경고

const keepServerAlive = async () => {
  try {
    const startTime = performance.now();
    const response = await fetch(HEALTH_CHECK_URL, {
      method: 'GET',
      credentials: 'include',
      headers: {
        'Cache-Control': 'no-cache',
      },
    });
    const endTime = performance.now();
    const responseTime = endTime - startTime;
    
    if (response.ok) {
      // 성능 수치가 500ms 초과 시에만 경고 표시
      if (responseTime > PERFORMANCE_THRESHOLD) {
        console.warn(`[Keep-alive] ⚠️ Slow response: ${responseTime.toFixed(2)}ms (threshold: ${PERFORMANCE_THRESHOLD}ms)`);
      } else {
        console.log(`[Keep-alive] ✅ Healthcheck successful (${responseTime.toFixed(2)}ms)`);
      }
    } else {
      console.warn(`[Keep-alive] ⚠️ Status ${response.status} (${responseTime.toFixed(2)}ms)`);
    }
  } catch (error) {
    console.error('[Keep-alive] ❌ Failed:', error);
  }
};

// 초기 실행 (앱 로드 시 즉시!)
window.addEventListener('load', () => {
  // 즉시 첫 ping (서버 warm-up)
  keepServerAlive();
  // 이후 30초마다 반복 (Railway sleep 방지)
  setInterval(keepServerAlive, SERVER_PING_INTERVAL);
});

// OAuth 성능 측정: 로그인 시작 시간 저장
window.addEventListener('beforeunload', () => {
  // 로그인 페이지로 이동하는 경우 시작 시간 저장
  if (window.location.href.includes('/oauth/')) {
    sessionStorage.setItem('oauth-start-time', Date.now().toString());
  }
});

// OAuth 성능 측정: 로그인 완료 시간 계산
window.addEventListener('load', () => {
  const oauthStartTime = sessionStorage.getItem('oauth-start-time');
  if (oauthStartTime) {
    const startTime = parseInt(oauthStartTime, 10);
    const endTime = Date.now();
    const oauthDuration = endTime - startTime;
    
    console.log(`📊 [OAuth Performance] 로그인 완료 시간: ${oauthDuration}ms (${(oauthDuration / 1000).toFixed(2)}초)`);
    
    // 성능 데이터 저장 (분석용)
    if (oauthDuration < 500) {
      console.log('✅ [OAuth Performance] 우수 (0.5초 이하)');
    } else if (oauthDuration < 1000) {
      console.log('⚠️ [OAuth Performance] 양호 (0.5~1초)');
    } else {
      console.log('❌ [OAuth Performance] 개선 필요 (1초 이상)');
    }
    
    // 측정 완료 후 삭제
    sessionStorage.removeItem('oauth-start-time');
  }
});

createRoot(document.getElementById("root")!).render(
  <trpc.Provider client={trpcClient} queryClient={queryClient}>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </trpc.Provider>
);
