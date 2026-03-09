// Version 2.0.0 - Updated at 2025-12-21 (Force cache clear)
// import { initClientSentry } from "@/lib/sentry";
import { trpc } from "@/lib/trpc";

// Capacitor 네이티브 환경 감지 — React 렌더 전에 동기 실행
// cap-native 클래스가 <html>에 붙어 있으면 CSS에서 안전 영역 보정 적용
try {
  if (
    typeof (window as any).Capacitor !== 'undefined' &&
    (window as any).Capacitor.isNativePlatform?.() === true
  ) {
    document.documentElement.classList.add('cap-native');
  }
} catch (_) {}

// ─── 진단 로그 ───────────────────────────────────────────────────────────────
console.log('[APP_BOOT] main.tsx 실행 시작');
console.log('[APP_BOOT] userAgent:', navigator.userAgent.slice(0, 120));
console.log('[APP_BOOT] online:', navigator.onLine);
console.log('[APP_BOOT] Capacitor 네이티브:', typeof (window as any).Capacitor !== 'undefined' &&
  (window as any).Capacitor?.isNativePlatform?.() === true);
// ──────────────────────────────────────────────────────────────────────────────

// 🚨 Sentry 임시 비활성화 (초기화 에러 방지)
// initClientSentry();
import { UNAUTHED_ERR_MSG } from '@shared/const';
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { httpBatchLink, TRPCClientError } from "@trpc/client";
import { createRoot } from "react-dom/client";
import superjson from "superjson";
import App from "./App";
import { getLoginUrl } from "./const";
import { openGoogleLogin } from "./lib/capacitor";
import "./index.css";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: Infinity, // 캐시 무한 유지 (최대 속도)
      gcTime: Infinity, // 메모리에 영구 보존
      refetchOnWindowFocus: false,
      refetchOnMount: false,
      refetchOnReconnect: false,
      retry: 0, // 즉시 응답
      suspense: false, // Suspense 비활성화 (더 빠른 렌더링)
    },
  },
});

// 한 페이지 로드에서 SIGNUP_REQUIRED/UNAUTHORIZED 리다이렉트는 1회만 실행
// merchantProcedure 여러 쿼리가 동시에 실패하면 중복 리다이렉트 → auth.me 폭주 발생
let _authRedirectLock = false;
const redirectToLoginIfUnauthorized = (error: unknown) => {
  if (!(error instanceof TRPCClientError)) return;
  if (typeof window === "undefined") return;
  if (_authRedirectLock) return; // 이미 리다이렉트 대기 중이면 무시

  // 동의 미완료 → consent 페이지로 이동
  if (error.message === 'SIGNUP_REQUIRED') {
    if (!window.location.pathname.startsWith('/signup')) {
      _authRedirectLock = true;
      window.location.href = '/signup/consent';
    }
    return;
  }

  const isUnauthorized = error.message === UNAUTHED_ERR_MSG;
  if (!isUnauthorized) return;

  _authRedirectLock = true;
  // openGoogleLogin: 웹=window.location.href, 앱=Chrome Custom Tabs
  openGoogleLogin(getLoginUrl());
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
        
        // 🔄 Service Worker 업데이트 감지
        registration.addEventListener('updatefound', () => {
          const newWorker = registration.installing;
          console.log('[SW] 새로운 버전 발견, 설치 중...');
          
          newWorker?.addEventListener('statechange', () => {
            if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
              console.log('[SW] 새 버전 설치 완료, 즉시 활성화 요청');
              // 즉시 활성화 요청
              newWorker.postMessage({ type: 'SKIP_WAITING' });
            }
          });
        });
      })
      .catch((error) => {
        console.error('❌ [main.tsx] 서비스 워커 등록 실패:', error);
      });
    
    // 🚀 Service Worker 메시지 리스너 (업데이트 알림)
    navigator.serviceWorker.addEventListener('message', (event) => {
      if (event.data && event.data.type === 'SW_UPDATED') {
        console.log(`[SW] 업데이트 완료: ${event.data.version}`);
        console.log(`[SW] 메시지: ${event.data.message}`);
        // 자동으로 페이지 새로고침 (controllerchange 이벤트에서 처리)
      }
    });
  });
}

// 서버 Keep-alive: 30초 간격으로 서버 깨우기 (Railway sleep 방지)
const SERVER_PING_INTERVAL = 30 * 1000;
const HEALTH_CHECK_URL = '/api/health';
const PERFORMANCE_THRESHOLD = 500;

// 연속 실패 시 pause 처리 — 서버 완전 다운 시 30초마다 불필요한 요청 차단
let _keepAliveConsecFailures = 0;
const MAX_KEEP_ALIVE_FAILURES = 3;        // 3회 연속 실패 시 2분 pause
let _keepAlivePauseUntil = 0;

const keepServerAlive = async () => {
  // 실패 누적으로 pause 중이면 건너뜀
  if (Date.now() < _keepAlivePauseUntil) return;

  try {
    const startTime = performance.now();
    const response = await fetch(HEALTH_CHECK_URL, {
      method: 'GET',
      credentials: 'include',
      headers: { 'Cache-Control': 'no-cache' },
    });
    const responseTime = performance.now() - startTime;

    if (response.ok) {
      _keepAliveConsecFailures = 0; // 성공 시 카운터 초기화
      if (responseTime > PERFORMANCE_THRESHOLD) {
        console.warn(`[Keep-alive] ⚠️ Slow: ${responseTime.toFixed(0)}ms`);
      }
    } else {
      console.warn(`[Keep-alive] ⚠️ Status ${response.status}`);
    }
  } catch {
    _keepAliveConsecFailures++;
    if (_keepAliveConsecFailures >= MAX_KEEP_ALIVE_FAILURES) {
      _keepAlivePauseUntil = Date.now() + 120_000; // 2분 pause
      console.warn(`[Keep-alive] ❌ ${MAX_KEEP_ALIVE_FAILURES}회 연속 실패 → 2분 pause`);
      _keepAliveConsecFailures = 0;
    }
  }
};

// 초기 실행: 앱 로드 즉시 + 30초 간격
window.addEventListener('load', () => {
  keepServerAlive();
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
