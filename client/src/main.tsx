// Version 2.1.0 - Capacitor release hardening
import { initClientSentry } from "@/lib/sentry";
import { trpc } from "@/lib/trpc";
import { UNAUTHED_ERR_MSG } from '@shared/const';
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { httpBatchLink, TRPCClientError } from "@trpc/client";
import { createRoot } from "react-dom/client";
import superjson from "superjson";
import App from "./App";
import { getLoginUrl } from "./const";
import { openGoogleLogin } from "./lib/capacitor";
import "./index.css";

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

// Sentry 초기화 (VITE_SENTRY_DSN 없으면 자동 skip)
initClientSentry();

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // 5분 stale — 세션/유저 데이터는 useAuth에서 staleTime:Infinity 별도 설정
      staleTime: 5 * 60 * 1000,
      // 15분 GC — 메모리에서 언마운트된 쿼리 보존 시간
      gcTime: 15 * 60 * 1000,
      refetchOnWindowFocus: false,
      refetchOnMount: false,
      refetchOnReconnect: true, // 네트워크 재연결 시 갱신
      retry: 1,                  // Railway cold start 대응 1회 retry
    },
  },
});

// 한 페이지 로드에서 SIGNUP_REQUIRED/UNAUTHORIZED 리다이렉트는 1회만 실행
// merchantProcedure 여러 쿼리가 동시에 실패하면 중복 리다이렉트 → auth.me 폭주 발생
let _authRedirectLock = false;
const redirectToLoginIfUnauthorized = (error: unknown) => {
  if (!(error instanceof TRPCClientError)) return;
  if (typeof window === "undefined") return;
  if (_authRedirectLock) return;

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
  openGoogleLogin(getLoginUrl());
};

queryClient.getQueryCache().subscribe(event => {
  if (event.type === "updated" && event.action.type === "error") {
    redirectToLoginIfUnauthorized(event.query.state.error);
  }
});

queryClient.getMutationCache().subscribe(event => {
  if (event.type === "updated" && event.action.type === "error") {
    redirectToLoginIfUnauthorized(event.mutation.state.error);
  }
});

const trpcClient = trpc.createClient({
  links: [
    httpBatchLink({
      url: "/api/trpc",
      transformer: superjson,
      maxURLLength: 2083,
      fetch(input, init) {
        return globalThis.fetch(input, {
          ...(init ?? {}),
          credentials: "include",
          headers: { ...(init?.headers ?? {}) },
        });
      },
    }),
  ],
});

// 서비스 워커 처리
// Capacitor 앱: SW 등록 금지 + 기존 SW 모두 해제
//   → server.url이 라이브 서버를 가리키므로 SW 캐시가 배포 반영을 막음
//   → useVersionCheck 훅이 buildSha 비교로 새 배포를 감지하고 reload함
const _isCapacitorApp =
  typeof (window as any).Capacitor !== 'undefined' &&
  (window as any).Capacitor.isNativePlatform?.() === true;

if ('serviceWorker' in navigator) {
  if (_isCapacitorApp) {
    // 기존 SW 전부 해제 (설치 직후 잔류 SW 포함)
    navigator.serviceWorker.getRegistrations().then(regs => {
      regs.forEach(reg => {
        reg.unregister();
        console.log('[SW] Capacitor 환경 — SW 해제:', reg.scope);
      });
    });
  } else {
    // SW 완전 비활성화 (emergency: Chrome 일반모드 reload 루프 장애)
    // index.html kill-switch와 동일 처리 — 기존 SW 해제, 신규 등록 없음
    navigator.serviceWorker.getRegistrations().then(regs => {
      regs.forEach(reg => {
        reg.unregister();
        console.log('[SW-KILL] main.tsx: unregistered:', reg.scope);
      });
      console.log('[SW-KILL] main.tsx: killed', regs.length, 'SW(s)');
    });
  }
}

createRoot(document.getElementById("root")!).render(
  <trpc.Provider client={trpcClient} queryClient={queryClient}>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </trpc.Provider>
);
