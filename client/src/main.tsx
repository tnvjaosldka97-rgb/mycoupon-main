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
        const url = typeof input === 'string' ? input : (input as Request).url;
        const isAuthMe = url.includes('auth.me') || url.includes('auth%2Cme') || url.includes('auth,me');
        const startT = performance.now();
        if (isAuthMe) {
          console.log('[AUTH-ME-START]', {
            url: window.location.href.slice(0, 80),
            visibility: document.visibilityState,
            hasSWController: !!navigator.serviceWorker?.controller,
            hasUserCache: !!localStorage.getItem('mycoupon-user-info'),
            swVersion: localStorage.getItem('sw-version'),
            swReloaded: sessionStorage.getItem('sw-reloaded'),
            t: Math.round(startT),
          });
        }
        // auth.me에 하드 타임아웃 적용 (7s) — pending 무한 방지
        let timeoutController: AbortController | undefined;
        let timeoutId: ReturnType<typeof setTimeout> | undefined;
        if (isAuthMe) {
          timeoutController = new AbortController();
          timeoutId = setTimeout(() => timeoutController!.abort(), 7000);
        }
        const fetchOptions: RequestInit = {
          ...(init ?? {}),
          credentials: "include",
          headers: { ...(init?.headers ?? {}) },
        };
        if (timeoutController) {
          fetchOptions.signal = timeoutController.signal;
        }
        return globalThis.fetch(input, fetchOptions).then(res => {
          if (timeoutId) clearTimeout(timeoutId);
          if (isAuthMe) {
            const elapsed = Math.round(performance.now() - startT);
            console.log('[AUTH-ME-SUCCESS]', { status: res.status, elapsedMs: elapsed, t: Math.round(performance.now()) });
          }
          return res;
        }).catch(err => {
          if (timeoutId) clearTimeout(timeoutId);
          if (isAuthMe) {
            const elapsed = Math.round(performance.now() - startT);
            console.log('[AUTH-ME-ERROR]', {
              name: (err as Error)?.name,
              message: (err as Error)?.message?.slice(0, 80),
              aborted: (err as Error)?.name === 'AbortError',
              elapsedMs: elapsed,
              t: Math.round(performance.now()),
            });
          }
          throw err;
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
    // 웹 PWA 전용 SW 등록
    window.addEventListener('load', () => {
      navigator.serviceWorker
        .register('/service-worker.js')
        .then((registration) => {
          registration.addEventListener('updatefound', () => {
            const newWorker = registration.installing;
            newWorker?.addEventListener('statechange', () => {
              if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
                console.log('[SW] main.tsx: new SW installed → SKIP_WAITING');
                newWorker.postMessage({ type: 'SKIP_WAITING' });
              }
            });
          });
          // controllerchange reload는 index.html에서 sw-reloaded guard 포함해 처리.
          // 여기에 중복 등록 시 guard 없는 reload가 controllerchange마다 발화 → 무한 reload.
          console.log('[SW] main.tsx: registration OK — controllerchange는 index.html 담당');
        })
        .catch((error) => {
          console.error('[SW] 서비스 워커 등록 실패:', error);
        });
    });
  }
}

// ── 입력 차단 진단 (document capture 레벨) ──────────────────────────────────
// 목적: 버튼이 안 눌릴 때 "누가 이벤트를 가로채는지" 확정
function _describeEl(el: Element | null) {
  if (!el) return 'null';
  const id = el.id ? `#${el.id}` : '';
  const cls = el.className && typeof el.className === 'string'
    ? `.${el.className.trim().replace(/\s+/g, '.')}`
    : '';
  return `${el.tagName.toLowerCase()}${id}${cls.slice(0, 60)}`;
}

function _scanBlockingOverlays() {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const suspects: string[] = [];
  document.querySelectorAll('*').forEach(el => {
    const s = window.getComputedStyle(el);
    if (s.pointerEvents === 'none') return;
    if (s.display === 'none' || s.visibility === 'hidden') return;
    if (parseFloat(s.opacity) < 0.01) return;
    const pos = s.position;
    if (pos !== 'fixed' && pos !== 'absolute') return;
    const r = el.getBoundingClientRect();
    if (r.width >= vw * 0.8 && r.height >= vh * 0.8) {
      const z = s.zIndex;
      suspects.push(`${_describeEl(el)} z=${z} opacity=${s.opacity} pe=${s.pointerEvents} ${Math.round(r.width)}x${Math.round(r.height)}`);
    }
  });
  return suspects;
}

(function _installInputDiag() {
  document.addEventListener('pointerdown', (e) => {
    const x = e.clientX, y = e.clientY;
    const fromPoint = document.elementFromPoint(x, y);
    const path = e.composedPath().slice(0, 6).map(n => {
      if (n instanceof Element) return _describeEl(n);
      if (n === document) return 'document';
      if (n === window) return 'window';
      return String(n);
    });
    const overlays = _scanBlockingOverlays();
    console.log('[INPUT-DIAG] pointerdown', {
      x, y,
      target: _describeEl(e.target as Element),
      fromPoint: _describeEl(fromPoint),
      path,
      blockingOverlays: overlays,
      t: Math.round(performance.now()),
    });
    if (overlays.length) {
      console.warn('[INPUT-DIAG] BLOCKING OVERLAY DETECTED', overlays);
    }
  }, { capture: true });

  // 2초마다 오버레이 스캔 (버튼 멈춤 재현 전후 비교용)
  let _prevOverlayCount = 0;
  setInterval(() => {
    const overlays = _scanBlockingOverlays();
    if (overlays.length !== _prevOverlayCount) {
      _prevOverlayCount = overlays.length;
      console.log('[OVERLAY-SCAN]', { count: overlays.length, overlays, t: Math.round(performance.now()) });
    }
  }, 2000);
})();
// ────────────────────────────────────────────────────────────────────────────

createRoot(document.getElementById("root")!).render(
  <trpc.Provider client={trpcClient} queryClient={queryClient}>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </trpc.Provider>
);
