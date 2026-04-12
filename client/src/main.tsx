// Version 2.1.0 - Capacitor release hardening
import { initClientSentry } from "@/lib/sentry";
import { trpc } from "@/lib/trpc";
import { sweepStaleAuthState } from "@/lib/authRecovery";
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

// 부트 타임 오염 상태 정리 — Chrome 일반모드 누적 데이터 방어
sweepStaleAuthState();

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
          // 12s: Railway cold start 대응 (기존 7s는 cold start 10~20s보다 짧아 실패)
          timeoutId = setTimeout(() => timeoutController!.abort(), 12000);
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
// 모바일 크롬 웹: SW 해제 + 캐시 삭제 (stale auth 응답 캐싱 차단)
const _isCapacitorApp =
  typeof (window as any).Capacitor !== 'undefined' &&
  (window as any).Capacitor.isNativePlatform?.() === true;

// isMobileChromeWeb 인라인 (import 순서 의존성 없는 boot-time 판정)
const _isMobileChromeWeb = (() => {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') return false;
  if (_isCapacitorApp) return false;
  const ua = navigator.userAgent;
  if (/KAKAOTALK|NAVER|Instagram|FBAN|FBAV/i.test(ua)) return false;
  const mobile = /Android|iPhone|iPad|iPod/i.test(ua);
  const chrome = /Chrome|CriOS/i.test(ua) && !/Edg\/|SamsungBrowser|OPR\//i.test(ua);
  return mobile && chrome;
})();

if ('serviceWorker' in navigator) {
  if (_isCapacitorApp) {
    // 기존 SW 전부 해제 (설치 직후 잔류 SW 포함)
    navigator.serviceWorker.getRegistrations().then(regs => {
      regs.forEach(reg => {
        reg.unregister();
        console.log('[SW] Capacitor 환경 — SW 해제:', reg.scope);
      });
    });
  } else if (_isMobileChromeWeb) {
    // 모바일 크롬 웹: SW + 모든 캐시 삭제
    // stale SW가 auth 쿠키/세션 응답을 캐싱해 로그인 후 상태 불일치 방지
    navigator.serviceWorker.getRegistrations().then(regs => {
      regs.forEach(reg => {
        reg.unregister();
        console.log('[SW] mobile Chrome web — SW 해제:', reg.scope);
      });
    });
    if ('caches' in window) {
      caches.keys().then(keys => {
        keys.forEach(k => {
          caches.delete(k);
          console.log('[SW] mobile Chrome web — cache 삭제:', k);
        });
      });
    }
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

// 입력 차단 진단 — 개발/스테이징 전용. 프로덕션 빌드에는 포함되지 않음.
if (import.meta.env.DEV) { (function _installInputDiag() {
  console.log('[INPUT-DIAG] installing capture listeners (pointerdown/touchstart/click)');

  const _mkHandler = (type: string) => (e: Event) => {
    const pe = e as PointerEvent;
    const te = e as TouchEvent;
    const x = pe.clientX ?? te.touches?.[0]?.clientX ?? 0;
    const y = pe.clientY ?? te.touches?.[0]?.clientY ?? 0;
    const fromPoint = document.elementFromPoint(x, y);
    const path = e.composedPath().slice(0, 6).map((n: EventTarget) => {
      if (n instanceof Element) return _describeEl(n);
      if (n === document) return 'document';
      if (n === window) return 'window';
      return String(n);
    });
    const closestBtn = (e.target instanceof Element)
      ? e.target.closest('button,a,[role=button]')
      : null;
    const overlays = _scanBlockingOverlays();
    console.log(`[INPUT-DIAG] ${type}`, {
      x, y,
      target: _describeEl(e.target as Element),
      fromPoint: _describeEl(fromPoint),
      closestInteractive: closestBtn
        ? `${(closestBtn as HTMLElement).tagName.toLowerCase()} disabled=${(closestBtn as HTMLButtonElement).disabled}`
        : 'null',
      path,
      blockingOverlays: overlays,
      t: Math.round(performance.now()),
    });
    if (overlays.length) {
      console.warn('[INPUT-DIAG] BLOCKING OVERLAY DETECTED', overlays);
    }
  };

  // document 레벨
  document.addEventListener('pointerdown', _mkHandler('doc-pointerdown'), { capture: true });
  document.addEventListener('touchstart', _mkHandler('doc-touchstart') as EventListener, { capture: true, passive: true });
  document.addEventListener('click', _mkHandler('doc-click'), { capture: true });

  // window 레벨 — window→document 사이에서 차단되는지 감지
  window.addEventListener('pointerdown', _mkHandler('win-pointerdown'), { capture: true });
  window.addEventListener('touchstart', _mkHandler('win-touchstart') as EventListener, { capture: true, passive: true });
  window.addEventListener('click', _mkHandler('win-click'), { capture: true });

  console.log('[INPUT-DIAG] all capture listeners installed (window + document)');

  // 2초마다 오버레이 스캔 (버튼 멈춤 재현 전후 비교용)
  let _prevOverlayCount = 0;
  setInterval(() => {
    const overlays = _scanBlockingOverlays();
    if (overlays.length !== _prevOverlayCount) {
      _prevOverlayCount = overlays.length;
      console.log('[OVERLAY-SCAN]', { count: overlays.length, overlays, t: Math.round(performance.now()) });
    }
  }, 2000);
})(); } // end if (import.meta.env.DEV)
// ────────────────────────────────────────────────────────────────────────────

// ── Mobile Chrome Web: hard reset migration ──────────────────────────────
// 목적: SW/Cache/Storage/IndexedDB 오염이 있어도 로그인 후 상호작용 보장
// 키 버전: v2 — 재오염 시 v3으로 bump하면 재실행됨
// 실행 순서: React render 전, SW 해제 직후
const _HARD_RESET_KEY = '__mc_hard_reset_v2';
const _needsHardReset = _isMobileChromeWeb && !localStorage.getItem(_HARD_RESET_KEY);

if (_needsHardReset) {
  // 최소 fallback UI — 빈 화면 방지 (React 미마운트 상태의 순수 DOM)
  const _rootEl = document.getElementById('root');
  if (_rootEl) {
    _rootEl.innerHTML =
      '<div style="min-height:100dvh;display:flex;align-items:center;justify-content:center;' +
      'background:#fff8f5;font-family:sans-serif;font-size:14px;color:#aaa;">' +
      '브라우저 상태 정리 중…</div>';
  }

  (async () => {
    try {
      // 1. SW 전부 해제
      if ('serviceWorker' in navigator) {
        const _regs = await navigator.serviceWorker.getRegistrations();
        await Promise.all(_regs.map(r => r.unregister()));
      }
      // 2. Cache Storage 전부 삭제
      if ('caches' in window) {
        const _cacheKeys = await caches.keys();
        await Promise.all(_cacheKeys.map(k => caches.delete(k)));
      }
      // 3. sessionStorage 전부 삭제
      sessionStorage.clear();
      // 4. localStorage — 실제 앱 prefix 기반 삭제 (reset 완료 키 제외)
      //    대상: pwa-* / mycoupon-* / sw-* / event_popup_*
      const _lsRemove: string[] = [];
      for (let _i = 0; _i < localStorage.length; _i++) {
        const _k = localStorage.key(_i);
        if (_k && _k !== _HARD_RESET_KEY &&
            /^pwa-|^mycoupon-|^sw-|^event_popup_/.test(_k)) {
          _lsRemove.push(_k);
        }
      }
      _lsRemove.forEach(k => localStorage.removeItem(k));
      // 5. IndexedDB 삭제 (databases() API 지원 브라우저만)
      if ('indexedDB' in window) {
        try {
          if (typeof (indexedDB as any).databases === 'function') {
            const _dbs: Array<{ name: string }> = await (indexedDB as any).databases();
            await Promise.all(_dbs.map(db => new Promise<void>(res => {
              const req = indexedDB.deleteDatabase(db.name);
              req.onsuccess = req.onerror = req.onblocked = () => res();
            })));
          }
        } catch (_) { /* databases() 미지원 브라우저 무시 */ }
      }
      // 모든 cleanup 완료 후에만 완료 표시 — 중간 실패 시 다음 로드에서 재시도 가능
      localStorage.setItem(_HARD_RESET_KEY, '1');
      console.log('[MC-RESET] hard reset complete → reloading');
      window.location.reload();
    } catch (_e) {
      // 완료 표시 안 함 → 다음 로드에서 재시도
      console.warn('[MC-RESET] cleanup error, will retry next load:', _e);
      window.location.reload();
    }
  })();

} else {
  createRoot(document.getElementById("root")!).render(
    <trpc.Provider client={trpcClient} queryClient={queryClient}>
      <QueryClientProvider client={queryClient}>
        <App />
      </QueryClientProvider>
    </trpc.Provider>
  );
}
