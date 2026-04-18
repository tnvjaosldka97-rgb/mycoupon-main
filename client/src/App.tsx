import { lazy, Suspense, useState, useEffect, useLayoutEffect, useRef } from "react";
import { AuthTransitionContext } from "./contexts/AuthTransitionContext";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Route, Switch, useLocation } from "wouter";
import ErrorBoundary from "./components/ErrorBoundary";
import { ThemeProvider } from "./contexts/ThemeContext";
import { useAuth } from "./hooks/useAuth";
import { trpc } from "./lib/trpc";
import { UNAUTHED_ERR_MSG } from "@shared/const";
import EventPopupModal from "./components/EventPopupModal";
import PenaltyWarningModal from "./components/PenaltyWarningModal";
import { PushPermissionBanner } from "./components/PushPermissionBanner";

// 핵심 페이지는 즉시 로드 (멈춤 방지)
import Home from "./pages/Home";
import MapPage from "./pages/MapPage"; // 즉시 로드 (자주 사용)

// 나머지 페이지는 지연 로딩 (코드 스플리팅)
const StoreDetail = lazy(() => import("./pages/StoreDetail"));
const SearchResults = lazy(() => import("./pages/SearchResults"));
const MyVisits = lazy(() => import("./pages/MyVisits"));
const CouponMap = lazy(() => import("./pages/CouponMap").catch(() => ({ default: () => <div>쿠폰 지도를 불러올 수 없습니다</div> })));
const MyCoupons = lazy(() => import("./pages/MyCoupons"));
const AdminPage = lazy(() => import("./pages/AdminPage"));
const AdminDashboard = lazy(() => import("./pages/AdminDashboard"));
const Rewards = lazy(() => import("./pages/Rewards"));
const ActivityPage = lazy(() => import("./pages/ActivityPage"));
const MerchantAnalytics = lazy(() => import("./pages/MerchantAnalytics"));
const StoreDetails = lazy(() => import("./pages/StoreDetails"));
const NotificationSettings = lazy(() => import("./pages/NotificationSettings"));
const AddStore = lazy(() => import("./components/AddStore"));
const MerchantStoreDetail = lazy(() => import("./pages/MerchantStoreDetail"));
const MerchantDashboard = lazy(() => import("./pages/MerchantDashboard"));
const ConsentPage = lazy(() => import("./pages/ConsentPage"));
const AuthFinalize = lazy(() => import("./pages/AuthFinalize"));
const DistrictStamps = lazy(() => import("./pages/DistrictStamps")); // 🗺️ 도장판
const NotFound = lazy(() => import("@/pages/NotFound"));
const InstallGuide = lazy(() => import("./components/InstallGuide"));

// LocationTracker 제거 - GPS 알림 기능 비활성화
// PWA 업데이트 알림 제거 - 페이지 새로고침 시 자동 업데이트
import PWALoadingScreen from "./components/PWALoadingScreen";

// ForceUpdateGate: eager import — lazy 청크 hang → Suspense 무한 로딩 방지
import { ForceUpdateGate } from "./components/ForceUpdateGate";
// 비핵심 오버레이: lazy 유지 (fallback=null이라 로딩 차단 없음)
const EmergencyBanner = lazy(() => import("./components/EmergencyBanner").then(m => ({ default: m.EmergencyBanner })));
const InAppBrowserRedirectModal = lazy(() => import("./components/InAppBrowserRedirectModal").then(m => ({ default: m.InAppBrowserRedirectModal })));

import { useErrorLogger } from "./hooks/useErrorLogger";
import { useInstallFunnel } from "./hooks/useInstallFunnel";
import { useVersionCheck } from "./hooks/useVersionCheck";
import { isInAppBrowser, isMobileChromeWeb } from "./lib/browserDetect";
import { isCapacitorNative } from "./lib/capacitor";
import { sweepStaleAuthState } from "./lib/authRecovery";
import * as popupUtils from "./lib/popupUtils";
import { AndroidWebNotice } from "./components/AndroidWebNotice";
import { AppAuthDebug } from "./components/AppAuthDebug";
import { AuthDebugOverlay } from "./components/AuthDebugOverlay";

// 페이지 로딩 스피너 (빠른 전환용)
function PageLoader() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-orange-50 via-pink-50 to-purple-50">
      <div className="flex flex-col items-center gap-4">
        <div className="w-16 h-16 border-4 border-orange-300 border-t-orange-600 rounded-full animate-spin"></div>
        <p className="text-gray-700 text-base font-semibold">잠시만 기다려주세요...</p>
      </div>
    </div>
  );
}

// 🔐 세션 로딩 게이트: 인증 세션 체크 완료 전까지 대기
// OAuth 콜백 후 세션 쿠키가 설정될 때까지 기다림 (무한 로딩 방지)
function SessionLoadingGate({ children }: { children: React.ReactNode }) {
  const { loading, error, refresh } = useAuth();
  const utils = trpc.useUtils();
  const [sessionCheckTimeout, setSessionCheckTimeout] = useState(false);
  const [retryCount, setRetryCount] = useState(0); // 내부 카운터 (로그용)
  const [showConnectionError, setShowConnectionError] = useState(false);
  const autoRetryDoneRef = useRef(false);
  // 탭 freeze 복구용: 실제 시계 기준 mount 시각 (performance.now은 freeze 중 정지함)
  const mountTimeRef = useRef(Date.now());
  // 진단 완료: React 렌더 정상 확인됨. 오버레이 제거.
  // 남은 문제는 Custom Tabs 쿠키 동기화 타이밍 → useAuth.ts retry 로직으로 처리

  // refresh 함수를 ref로 유지 — 의존성 배열에서 제외해 타이머 리셋 방지
  // 버그: [error, refresh] 의존성 → refresh가 매 렌더마다 새 참조 생성
  //       → effect가 매 렌더마다 재실행 → 4초 타이머가 매번 리셋 → 자동 재시도 영원히 발화 안 됨
  const refreshRef = useRef(refresh);
  useEffect(() => { refreshRef.current = refresh; }); // 최신 refresh 유지 (렌더마다 업데이트)

  // mount 로그 (1회) + 페이지 생명주기 추적
  useEffect(() => {
    console.log('[BOOT] gate=SessionLoadingGate mounted — loading:', loading, '| networkOnline:', navigator.onLine);

    // [PAGE-LIFECYCLE] window 이벤트 추적
    const logLC = (name: string) => (e?: Event) => {
      console.log('[PAGE-LIFECYCLE]', name, {
        persisted: (e as PageTransitionEvent)?.persisted ?? undefined,
        state: (e as unknown as { visibilityState?: string })?.visibilityState ?? document.visibilityState,
        url: window.location.href.slice(0, 80),
        t: Math.round(performance.now()),
      });
    };
    window.addEventListener('pageshow', logLC('pageshow'));
    window.addEventListener('pagehide', logLC('pagehide'));
    document.addEventListener('visibilitychange', logLC('visibilitychange'));
    window.addEventListener('beforeunload', logLC('beforeunload'));
    window.addEventListener('load', logLC('load'));
    document.addEventListener('DOMContentLoaded', logLC('DOMContentLoaded'));
    return () => {
      window.removeEventListener('pageshow', logLC('pageshow'));
      window.removeEventListener('pagehide', logLC('pagehide'));
      document.removeEventListener('visibilitychange', logLC('visibilitychange'));
      window.removeEventListener('beforeunload', logLC('beforeunload'));
      window.removeEventListener('load', logLC('load'));
      document.removeEventListener('DOMContentLoaded', logLC('DOMContentLoaded'));
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // auth 상태 변화 추적 (구조화 로그)
  useEffect(() => {
    console.log('[BOOT] gate=SessionLoadingGate state —', {
      loading,
      error: error ? error.message?.slice(0, 60) : null,
      sessionCheckTimeout,
      networkOnline: navigator.onLine,
    });
  }, [loading, error, sessionCheckTimeout]);

  // 세션 체크 타임아웃 (10초) + 오염 스토리지 자동 복구 + [BOOT-TIMEOUT-RECOVERY]
  useEffect(() => {
    if (!loading) {
      setSessionCheckTimeout(false);
      setRetryCount(0);
      return;
    }
    const timeoutId = setTimeout(() => {
      // 오염 상태 전체 정리 (authRecovery 유틸로 통합)
      const { cleared } = sweepStaleAuthState();

      // [BOOT-TIMEOUT-RECOVERY]
      console.warn('[BOOT-TIMEOUT-RECOVERY]', {
        reason: 'meQuery pending > 10000ms',
        clearedKeys: cleared,
        fallback: 'anonymous',
        t: Math.round(performance.now()),
      });

      // 핵심: timeout으로 gate를 열 때 meQuery를 강제로 resolved(null) 상태로 전환
      // 문제: loading=true인 채로 gate가 열리면 Home 버튼 전체가 disabled=true 유지 → CTA 전부 불능
      // 해결: setData(null) → meQuery.isPending=false → loading=false → 버튼 활성화
      // 리스크: 실제 auth.me 응답이 나중에 오면 정상적으로 덮어씀 (anonymous→authed 전환 가능)
      console.warn('[BOOT-TIMEOUT-RECOVERY] setData(null) → force loading=false so Home CTAs become enabled');
      utils.auth.me.setData(undefined, null);

      setSessionCheckTimeout(true);
      setRetryCount(prev => prev + 1);
    }, 10000);
    return () => clearTimeout(timeoutId);
  }, [loading]);

  // 연결 오류 자동 재시도 — Railway cold start 대응
  // 의존성: [error] 만 — refresh는 ref로 참조해 타이머 리셋 방지
  useEffect(() => {
    // auth 에러(UNAUTHED/SIGNUP_REQUIRED)는 연결 오류가 아님 — 재시도 불필요, main.tsx가 redirect 처리
    const isConnError = !!error && error.message !== UNAUTHED_ERR_MSG && error.message !== 'SIGNUP_REQUIRED';

    if (!isConnError) {
      setShowConnectionError(false);
      autoRetryDoneRef.current = false;
      return;
    }

    if (autoRetryDoneRef.current) {
      console.error('[SESSION_GATE] 자동 재시도 후에도 실패 → 연결 오류 화면 표시. error:', error?.message?.slice(0, 80));
      setShowConnectionError(true);
      return;
    }

    console.warn('[SESSION_GATE] 연결 오류 → 4초 후 자동 재시도. error:', error?.message?.slice(0, 80));
    const timer = setTimeout(() => {
      autoRetryDoneRef.current = true;
      console.log('[SESSION_GATE] 자동 재시도 실행');
      refreshRef.current(); // ref 사용 — 최신 refresh 참조, 타이머 리셋 없음
    }, 4000);
    return () => clearTimeout(timer);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [error]); // refresh 제외 — ref로 처리

  // Fix A: error 상태에서 refresh() 후 refetch가 hang하면
  //   error 값이 바뀌지 않아 useEffect([error])가 재실행되지 않음
  //   → showConnectionError 영구 미세팅 → PageLoader 무한 유지
  //   해결: error 상태 진입 후 8초 안에 미해소 시 강제로 showConnectionError=true
  useEffect(() => {
    const isConnErr = !!error && error.message !== UNAUTHED_ERR_MSG && error.message !== 'SIGNUP_REQUIRED';
    if (!isConnErr || showConnectionError) return;
    const t = setTimeout(() => {
      console.warn('[SESSION_GATE] error-state 8s escape valve → showConnectionError forced', { error: error?.message?.slice(0, 60) });
      setShowConnectionError(true);
    }, 8000);
    return () => clearTimeout(t);
  }, [error, showConnectionError]);

  // Fix B: 탭 freeze 복구 — Chrome이 백그라운드 탭을 동결하면 setTimeout이 멈춤
  //   탭 복귀 시 Date.now() 기준 실경과시간이 10s 초과이면 강제 복구
  useEffect(() => {
    const loadingRef = { current: loading };
    const errorRef = { current: error };
    const showErrRef = { current: showConnectionError };
    loadingRef.current = loading;
    errorRef.current = error;
    showErrRef.current = showConnectionError;

    const handleVisible = () => {
      if (document.visibilityState !== 'visible') return;
      const realElapsed = Date.now() - mountTimeRef.current;
      if (realElapsed < 10000) return;
      if (loadingRef.current) {
        console.warn('[SESSION_GATE] tab-freeze recovery: loading stuck', { realElapsed, t: Math.round(performance.now()) });
        setSessionCheckTimeout(true);
      }
      const isErrStuck = !!errorRef.current && errorRef.current.message !== UNAUTHED_ERR_MSG && errorRef.current.message !== 'SIGNUP_REQUIRED' && !showErrRef.current;
      if (isErrStuck) {
        console.warn('[SESSION_GATE] tab-freeze recovery: error stuck', { realElapsed, error: errorRef.current?.message?.slice(0, 60) });
        setShowConnectionError(true);
      }
    };
    document.addEventListener('visibilitychange', handleVisible);
    return () => document.removeEventListener('visibilitychange', handleVisible);
  }, [loading, error, showConnectionError]);

  // 공개 라우트: auth.me pending과 무관하게 즉시 렌더
  const _publicPaths = ['/', '/map', '/install', '/auth/finalize', '/store', '/search', '/signup/consent'];
  const _isPublicRoute = _publicPaths.some(p =>
    window.location.pathname === p || window.location.pathname.startsWith(p + '/')
  );

  // web Chrome: full-screen gate/blocker 완전 제거
  // showConnectionError(4~8s) / PageLoader 가 공개 라우트(/, /map)를 덮는 버그 방지
  // Capacitor 앱에서는 기존 gate 동작 유지
  if (!isCapacitorNative()) return <>{children}</>;

  const _gateState = { loading, sessionCheckTimeout, error: error?.message?.slice(0, 40) ?? null, t: Math.round(performance.now()), url: window.location.href.slice(0, 80) };

  // 로딩 중이고 타임아웃 발생 시 → gate 강제 해제 (영구 로딩 방지)
  // setData(null) 호출로 loading은 이미 false로 전환되므로 이 분기는 안전망용
  if (loading && sessionCheckTimeout) {
    console.warn('[BOOT-GATE-OPEN] TIMEOUT(10s) forced — anonymous fallback', _gateState);
    return <>{children}</>;
  }

  // 타임아웃 완료 후 anonymous 상태: 재로그인 배너 표시
  // setData(null) → loading=false → 이 분기에서 children을 렌더하면서 안내 배너 추가
  if (!loading && sessionCheckTimeout) {
    return (
      <>
        <div className="w-full bg-orange-50 border-b border-orange-200 px-4 py-2 flex items-center justify-between text-sm text-orange-700">
          <span>세션을 복구하지 못했습니다. 다시 로그인해주세요.</span>
          <button
            onClick={() => window.location.reload()}
            className="ml-4 text-orange-600 underline font-medium shrink-0"
          >
            다시 시도
          </button>
        </div>
        {children}
      </>
    );
  }

  // 연결 오류 화면: loading보다 먼저 평가 — Fix A(8s escape valve)가 loading=true 중에도 탈출 가능하도록
  // auth 에러(UNAUTHED/SIGNUP_REQUIRED)는 showConnectionError가 세팅되지 않으므로 이 분기 불해당
  // 공개 라우트(/, /map 등)에서는 연결 오류 full-screen 금지 → children 통과
  if (showConnectionError && !_isPublicRoute) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-orange-50 via-pink-50 to-purple-50">
        <div className="flex flex-col items-center gap-4 max-w-md mx-auto px-4">
          <div className="text-red-500 text-5xl">⚠️</div>
          <h2 className="text-gray-800 text-xl font-bold text-center">
            연결 오류
          </h2>
          <p className="text-gray-600 text-sm text-center">
            서버와 연결할 수 없습니다. 인터넷 연결을 확인해주세요.
          </p>
          {/* disabled 처리: 클릭 후 즉시 비활성화 → reload 중 연타 방지 */}
          <button
            onClick={(e) => {
              (e.currentTarget as HTMLButtonElement).disabled = true;
              console.log('[SESSION_GATE] 다시시도 버튼 클릭 → reload');
              window.location.reload();
            }}
            className="mt-4 px-6 py-3 bg-orange-500 text-white rounded-lg font-semibold hover:bg-orange-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            다시 시도
          </button>
        </div>
      </div>
    );
  }

  // 로딩 중 (타임아웃 전) — 공개 라우트는 즉시 렌더
  if (loading && !_isPublicRoute) {
    return <PageLoader />;
  }

  // 연결 오류 발생 + 자동 재시도 대기 중 → 공개 라우트는 즉시 렌더
  if (error && error.message !== UNAUTHED_ERR_MSG && error.message !== 'SIGNUP_REQUIRED' && !_isPublicRoute) {
    console.log('[APP] blank-screen branch blocked — connection error, PageLoader 표시');
    return <PageLoader />;
  }

  // 세션 체크 완료 - 앱 렌더링
  console.log('[BOOT-GATE-OPEN]', { ..._gateState, reason: 'loading=false' });
  console.log('[APP-AUTH-10] SessionLoadingGate released — loading:false | t=' + Math.round(performance.now()));
  return <>{children}</>;
}

function Router() {
  return (
    <Suspense fallback={<PageLoader />}>
      <Switch>
        <Route path="/auth/finalize" component={AuthFinalize} />
        <Route path="/" component={Home} />
        <Route path="/admin" component={AdminDashboard} />
        <Route path="/admin/old" component={AdminPage} />
        <Route path="/admin/store/:id" component={StoreDetails} />
        <Route path="/coupons" component={CouponMap} />
        <Route path="/map" component={MapPage} />
        <Route path="/my-coupons" component={MyCoupons} />
        <Route path="/rewards" component={Rewards} />
        <Route path="/gamification" component={ActivityPage} />
        <Route path="/activity" component={ActivityPage} />
        <Route path="/merchant/analytics" component={MerchantAnalytics} />
        <Route path="/signup/consent" component={ConsentPage} />
        <Route path="/merchant/dashboard" component={MerchantDashboard} />
        <Route path="/merchant/add-store" component={AddStore} />
        <Route path="/merchant/store/:id" component={MerchantStoreDetail} />
        <Route path="/store/:id" component={StoreDetail} />
        <Route path="/search" component={SearchResults} />
        <Route path="/my-visits" component={MyVisits} />
        <Route path="/notification-settings" component={NotificationSettings} />
        <Route path="/district-stamps" component={DistrictStamps} />
        <Route path="/install" component={InstallGuide} />
        <Route path="/404" component={NotFound} />
        <Route component={NotFound} />
      </Switch>
    </Suspense>
  );
}

// ── 인터랙션 lock 강제 해제 ──────────────────────────────────────────────────
// Radix Dialog/DropdownMenu 의 inertOthers() cleanup 누락 시 전체 화면 차단 방지.
// 웹 전체(PC Chrome 포함) 공통 보호.
function cleanupInteractionLocks() {
  const body = document.body;
  const html = document.documentElement;
  const root = document.getElementById('root');

  // body: lock/inert/aria-hidden 속성 + inline style 정리
  body.removeAttribute('data-scroll-locked');
  body.removeAttribute('inert');
  body.removeAttribute('aria-hidden');
  body.style.overflow = '';
  body.style.overflowY = '';
  body.style.paddingRight = '';
  body.style.pointerEvents = '';

  // html: 동일 정리
  html.removeAttribute('data-scroll-locked');
  html.removeAttribute('inert');
  html.removeAttribute('aria-hidden');
  html.style.overflow = '';
  html.style.overflowY = '';
  html.style.pointerEvents = '';

  // #root: Radix가 inertOthers로 설정한 잠금 해제
  if (root) {
    root.removeAttribute('aria-hidden');
    root.removeAttribute('inert');
    root.style.pointerEvents = '';
  }

  // 전체 DOM [inert] 일괄 제거 (Radix가 root 외 요소에 설정한 경우 포함)
  document.querySelectorAll('[inert]').forEach(el => el.removeAttribute('inert'));

  // Radix 잔존 overlay 중화: data-state="closed" 인 fixed/absolute 요소는
  // hidden 클래스가 떨어지지 않은 채 DOM에 남으면 클릭을 차단함 (alert-dialog 특히 취약).
  // → pointer-events 만 제거 (display 건드리면 Radix 렌더 트리와 충돌 가능).
  document.querySelectorAll<HTMLElement>('[data-state="closed"]').forEach(el => {
    const cs = getComputedStyle(el);
    if (cs.position === 'fixed' || cs.position === 'absolute') {
      el.style.pointerEvents = 'none';
    }
  });

  // 투명 fullscreen 클릭 차단기 중화: opacity < 0.05 + viewport 80%+ 덮음 + pointer-events:auto
  // → 의도된 visible overlay(backdrop 등)는 opacity 높아서 걸리지 않음.
  // body 직계 + 1단계 자식까지만 (포털 wrapper 커버).
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const candidates: HTMLElement[] = [];
  for (const c of Array.from(body.children)) {
    candidates.push(c as HTMLElement);
    for (const cc of Array.from(c.children)) candidates.push(cc as HTMLElement);
  }
  candidates.forEach(el => {
    if (!(el instanceof HTMLElement)) return;
    if (el.id === 'root') return; // root 본체 제외
    const cs = getComputedStyle(el);
    if (cs.pointerEvents === 'none') return;
    if (cs.display === 'none' || cs.visibility === 'hidden') return;
    if (cs.position !== 'fixed' && cs.position !== 'absolute') return;
    const r = el.getBoundingClientRect();
    if (r.width < vw * 0.8 || r.height < vh * 0.8) return;
    const op = parseFloat(cs.opacity);
    if (op > 0.05) return; // 실제로 보이는 overlay는 앱이 의도한 것 — 건드리지 않음
    el.style.pointerEvents = 'none';
  });
}
// ────────────────────────────────────────────────────────────────────────────

// ── 디버그 HUD v2: 우상단 — 입력 차단 진단 ──────────────────────────────────
function DebugHUD() {
  const [winEv, setWinEv] = useState('-');   // window 레벨 이벤트
  const [docEv, setDocEv] = useState('-');   // document 레벨 이벤트
  const [tapInfo, setTapInfo] = useState('(none)');
  const [overlays, setOverlays] = useState<string[]>([]);
  const [disabledBtns, setDisabledBtns] = useState('');
  const [listenerOk, setListenerOk] = useState(false);
  const { loading } = useAuth();

  // 1) mount 로그 + window/document 양쪽 이벤트 등록
  useEffect(() => {
    console.log('[DEBUG-HUD] mounted v3 — attaching window + document capture listeners');

    const mkHandler = (level: string) => (e: Event) => {
      const t = e.target as Element | null;
      const x = (e as PointerEvent).clientX ?? (e as TouchEvent).touches?.[0]?.clientX ?? 0;
      const y = (e as PointerEvent).clientY ?? (e as TouchEvent).touches?.[0]?.clientY ?? 0;
      const desc = t ? `${t.tagName.toLowerCase()}${t.id ? '#' + t.id : ''}` : '?';
      const info = `${e.type}:${desc}(${Math.round(x)},${Math.round(y)})`;
      if (level === 'win') setWinEv(info);
      else { setDocEv(info); setTapInfo(info); }
    };

    const wPd = mkHandler('win'), wTs = mkHandler('win') as EventListener, wCl = mkHandler('win');
    const dPd = mkHandler('doc'), dTs = mkHandler('doc') as EventListener, dCl = mkHandler('doc');

    window.addEventListener('pointerdown', wPd, { capture: true });
    window.addEventListener('touchstart', wTs, { capture: true, passive: true } as any);
    window.addEventListener('click', wCl, { capture: true });
    document.addEventListener('pointerdown', dPd, { capture: true });
    document.addEventListener('touchstart', dTs, { capture: true, passive: true } as any);
    document.addEventListener('click', dCl, { capture: true });

    setListenerOk(true);
    console.log('[DEBUG-HUD] window + document listeners attached OK');

    return () => {
      window.removeEventListener('pointerdown', wPd, { capture: true } as any);
      window.removeEventListener('touchstart', wTs, { capture: true } as any);
      window.removeEventListener('click', wCl, { capture: true } as any);
      document.removeEventListener('pointerdown', dPd, { capture: true } as any);
      document.removeEventListener('touchstart', dTs, { capture: true } as any);
      document.removeEventListener('click', dCl, { capture: true } as any);
      console.log('[DEBUG-HUD] listeners removed (unmount)');
    };
  }, []);

  // 2) overlay + disabled 버튼 스캔
  useEffect(() => {
    const scan = () => {
      const vw = window.innerWidth, vh = window.innerHeight;
      const found: string[] = [];
      document.querySelectorAll('*').forEach(el => {
        const s = window.getComputedStyle(el);
        if (s.pointerEvents === 'none' || s.display === 'none' || parseFloat(s.opacity) < 0.01) return;
        if (s.position !== 'fixed' && s.position !== 'absolute') return;
        const r = el.getBoundingClientRect();
        if (r.width >= vw * 0.8 && r.height >= vh * 0.8) {
          const id = (el as HTMLElement).id;
          const cls = typeof el.className === 'string' ? el.className.slice(0, 80) : '';
          const detail = {
            tag: el.tagName.toLowerCase(),
            id: id || '(none)',
            className: cls,
            position: s.position,
            zIndex: s.zIndex,
            pointerEvents: s.pointerEvents,
            opacity: s.opacity,
            visibility: s.visibility,
            display: s.display,
            rect: { top: Math.round(r.top), left: Math.round(r.left), w: Math.round(r.width), h: Math.round(r.height) },
          };
          console.warn('[OVL-DETAIL]', detail);
          found.push(`${el.tagName.toLowerCase()} z=${s.zIndex} pe=${s.pointerEvents} cls=${cls.slice(0, 30)}`);
        }
      });
      setOverlays(found);

      // disabled 버튼 목록
      const disabledList: string[] = [];
      document.querySelectorAll('button[disabled],a[disabled],[role=button][aria-disabled=true]').forEach(el => {
        const txt = (el as HTMLElement).textContent?.trim().slice(0, 12) || '?';
        disabledList.push(txt);
      });
      setDisabledBtns(disabledList.join(',') || 'none');
    };
    scan();
    const id = setInterval(scan, 1500);
    return () => clearInterval(id);
  }, []);

  return (
    <div
      style={{
        position: 'fixed', top: 8, right: 8, zIndex: 99999,
        background: 'rgba(0,0,0,0.82)', color: '#0f0', fontSize: 9,
        padding: '4px 6px', borderRadius: 4, maxWidth: 230,
        pointerEvents: 'none', fontFamily: 'monospace', lineHeight: 1.5,
      }}
    >
      <div>AUTH:{loading ? 'LOAD' : 'OK'} LSN:{listenerOk ? 'OK' : 'NO'}</div>
      <div>WIN:{winEv.slice(0, 38)}</div>
      <div>DOC:{docEv.slice(0, 38)}</div>
      <div>OVL({overlays.length}):{overlays[0]?.slice(0, 28) || 'none'}</div>
      <div>DIS:{disabledBtns.slice(0, 38)}</div>
    </div>
  );
}
// ────────────────────────────────────────────────────────────────────────────

function App() {
  // ── 최초 마운트 즉시 lock 해제 (OAuth 리다이렉트 복귀 직후 잔류 inert 방어) ──
  // 동기 + rAF + setTimeout(0/300) 다중 시점 커버 — bfcache·확장·Radix 타이밍 누수 모두 방어.
  useLayoutEffect(() => {
    cleanupInteractionLocks();
    const rAF = requestAnimationFrame(cleanupInteractionLocks);
    const t0 = setTimeout(cleanupInteractionLocks, 0);
    const t1 = setTimeout(cleanupInteractionLocks, 300);
    return () => { cancelAnimationFrame(rAF); clearTimeout(t0); clearTimeout(t1); };
  }, []);

  // [BOOT-1] app bootstrap start
  useEffect(() => {
    console.log('[BOOT-1] app bootstrap start — isNative:', isCapacitorNative(), '| url:', window.location.href.slice(0, 80), '| ts:', Date.now());
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Android 하드웨어 뒤로가기 처리 (Capacitor 전용) ──────────────────────────
  // 정책:
  //   1. history가 있으면: history.back() (SPA 라우팅 이전)
  //   2. history가 없고, 루트('/')가 아니면: 홈으로 이동
  //   3. history가 없고, 루트('/')면: double-back exit (2초 내 2회 → 앱 종료)
  //      - 1회 누름: "한 번 더 누르면 종료됩니다" toast
  //      - 2회 누름: exitApp()
  // ─────────────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!isCapacitorNative()) return;

    let lastBackPressTime = 0;
    let backHandler: { remove: () => void } | null = null;

    import('@capacitor/app').then(({ App: CapApp }) => {
      backHandler = CapApp.addListener('backButton', ({ canGoBack }) => {
        if (canGoBack) {
          window.history.back();
          return;
        }
        // history 없음
        if (window.location.pathname !== '/') {
          window.location.href = '/';
          return;
        }
        // 루트 화면 — double-back exit
        const now = Date.now();
        if (now - lastBackPressTime < 2000) {
          CapApp.exitApp();
        } else {
          lastBackPressTime = now;
          // sonner toast (App.tsx에 이미 Toaster 마운트됨)
          import('sonner').then(({ toast }) => {
            toast.info('한 번 더 누르면 종료됩니다', { duration: 2000 });
          }).catch(() => {});
        }
      }) as any;
    }).catch(() => {});

    return () => {
      backHandler?.remove();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 성능 최적화: 에러 로거와 설치 퍼널을 5초 후에 실행 (초기 로딩 방해 안 함)
  useEffect(() => {
    const timer = setTimeout(() => {
      // 5초 후 백그라운드에서 실행
      try {
        // 에러 로거와 설치 퍼널은 나중에 실행
      } catch (e) {
        console.error('Background tracking error:', e);
      }
    }, 5000);
    return () => clearTimeout(timer);
  }, []);
  
  // 버전 체크: 배포 후 앱 복귀 시 자동 reload (Capacitor 전용)
  useVersionCheck();

  const { user, loading: authLoading } = useAuth();
  const [pathname] = useLocation(); // SPA 라우트 변경 감지 (PenaltyWarningModal auto-close)

  // ── Auth Transition Stabilization (mobile chrome web 전용) ─────────────────
  // user identity (null→non-null, non-null→null, 계정 전환) 전환 후 ~250ms + 2rAF 동안 stabilizing=true.
  // 이 기간 동안 auth-only UI(DropdownMenu 등) 마운트를 지연시켜
  // React 렌더와 Android Chrome GPU 컴포지팅 레이어 재건 race를 방지한다.
  const [authTransitionStabilizing, setAuthTransitionStabilizing] = useState(false);
  // user.id + role 기반 identity string — null/non-null뿐 아니라 계정 전환도 감지
  const authIdentity = user ? `${user.id}:${user.role}` : '';
  const prevIdentityRef = useRef<string | undefined>(undefined);

  useLayoutEffect(() => {
    if (!isMobileChromeWeb()) return;
    // 첫 렌더: sentinel 초기화만 (전환 아님)
    if (prevIdentityRef.current === undefined) {
      prevIdentityRef.current = authIdentity;
      return;
    }
    // 변화 없음
    if (prevIdentityRef.current === authIdentity) return;
    prevIdentityRef.current = authIdentity;
    // identity 전환 감지 → 즉시 lock 해제 + stabilizing 시작
    cleanupInteractionLocks();
    setAuthTransitionStabilizing(true);
    let rAF1 = 0, rAF2 = 0;
    const timer = setTimeout(() => {
      rAF1 = requestAnimationFrame(() => {
        rAF2 = requestAnimationFrame(() => {
          cleanupInteractionLocks();
          setAuthTransitionStabilizing(false);
        });
      });
    }, 250);
    return () => {
      clearTimeout(timer);
      if (rAF1) cancelAnimationFrame(rAF1);
      if (rAF2) cancelAnimationFrame(rAF2);
    };
  }, [authIdentity]);

  // ── 로그인 후 inert/scroll-lock 강제 해제 (페인트 전 동기) ─────────────────
  // useLayoutEffect: user null→truthy 전환 시 첫 로그인 프레임 페인트 전에 lock 해제
  // (DropdownMenu 등 Radix 컴포넌트가 커밋 단계에서 body에 scroll-lock 적용 → 페인트 전 제거)
  useLayoutEffect(() => {
    if (!user) return;
    cleanupInteractionLocks();
  }, [user]);

  // useEffect: 로그인 후 추가 마운트 모달 정착까지 0/150/500/1000ms 커버
  useEffect(() => {
    if (!user) return;
    const t0 = setTimeout(cleanupInteractionLocks, 0);
    const t1 = setTimeout(cleanupInteractionLocks, 150);
    const t2 = setTimeout(cleanupInteractionLocks, 500);
    const t3 = setTimeout(cleanupInteractionLocks, 1000);
    return () => { clearTimeout(t0); clearTimeout(t1); clearTimeout(t2); clearTimeout(t3); };
  }, [user]);

  // ── 탭 복귀/bfcache/포커스 시 inert/scroll-lock 강제 해제 ──────────────────
  useEffect(() => {
    // pageshow: bfcache 복원 + 일반 로드 모두 커버 (persisted 제한 제거)
    const onPageShow = () => { cleanupInteractionLocks(); };
    // focus: 탭 전환 복귀 시
    const onFocus = () => { cleanupInteractionLocks(); };
    // visibilitychange: 백그라운드 → 포그라운드 전환 시
    const onVisibility = () => { if (document.visibilityState === 'visible') cleanupInteractionLocks(); };

    // popstate / hashchange: 브라우저 뒤로가기/앞으로가기 + 해시 이동 시 lock 잔존 방어
    const onPopState = () => { cleanupInteractionLocks(); };
    const onHashChange = () => { cleanupInteractionLocks(); };

    window.addEventListener('pageshow', onPageShow);
    window.addEventListener('focus', onFocus);
    window.addEventListener('popstate', onPopState);
    window.addEventListener('hashchange', onHashChange);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('pageshow', onPageShow);
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('popstate', onPopState);
      window.removeEventListener('hashchange', onHashChange);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, []);

  // ── MutationObserver: Radix scroll-lock/inert 즉시 해제 (웹 전체) ──
  // Dialog/AlertDialog/DropdownMenu 가 body[data-scroll-locked], [inert], #root[aria-hidden] 를
  // 설정하는 순간 즉시 cleanupInteractionLocks() 호출.
  // timer-based cleanup의 경쟁 조건을 원천 차단 — Home·MerchantDashboard 등 모든 페이지 공통 보호.
  // Capacitor 네이티브는 WebView 생명주기가 달라 제외.
  useEffect(() => {
    if (isCapacitorNative()) return;
    const targets: Element[] = [document.body, document.documentElement];
    const root = document.getElementById('root');
    if (root) targets.push(root);
    const observer = new MutationObserver((mutations) => {
      const shouldClean = mutations.some((m) => {
        if (m.type !== 'attributes') return false;
        const attr = m.attributeName;
        if (attr === 'data-scroll-locked' || attr === 'inert' || attr === 'aria-hidden') {
          return (m.target as Element).hasAttribute(attr);
        }
        if (attr === 'style') {
          const el = m.target as HTMLElement;
          return el.style.overflow === 'hidden'
              || el.style.overflowY === 'hidden'
              || el.style.pointerEvents === 'none';
        }
        return false;
      });
      if (shouldClean) cleanupInteractionLocks();
    });
    const opts: MutationObserverInit = {
      attributes: true,
      attributeFilter: ['data-scroll-locked', 'inert', 'aria-hidden', 'style'],
    };
    targets.forEach((t) => observer.observe(t, opts));
    return () => observer.disconnect();
  }, []);

  // ── 어뷰저 패널티 경고 모달 ──────────────────────────────────────────────
  const [showPenaltyWarning, setShowPenaltyWarning] = useState(false);
  const penaltyWarningCheckedRef = useRef(false);
  // pathnameRef: 항상 최신 pathname을 유지 (effect 의존성 없이 읽기 가능)
  const pathnameRef = useRef(pathname);
  useEffect(() => { pathnameRef.current = pathname; }, [pathname]);
  // query가 처음 활성화된 시점의 pathname 스냅샷 (race condition 방지)
  const penaltyQueryEnabledPathRef = useRef<string | null>(null);
  const _abuseQueryEnabled = !!user && !authLoading && user.role === 'user' && !isMobileChromeWeb();
  // query 활성화 시점에 pathname 캡처 (pathname을 의존성에서 제외 — enable 전환 시각만 기록)
  useEffect(() => {
    if (_abuseQueryEnabled) {
      if (penaltyQueryEnabledPathRef.current === null) {
        penaltyQueryEnabledPathRef.current = pathnameRef.current;
      }
    } else {
      penaltyQueryEnabledPathRef.current = null; // 로그아웃 등으로 비활성화 시 초기화
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [_abuseQueryEnabled]);

  const abuseStatusQuery = trpc.abuse.getMyStatus.useQuery(undefined, {
    enabled: _abuseQueryEnabled,
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
  });
  const markWarningSeen = trpc.abuse.markWarningSeen.useMutation();
  useEffect(() => {
    if (penaltyWarningCheckedRef.current) return;
    if (!abuseStatusQuery.data) return;
    const s = abuseStatusQuery.data;
    if (s.status === 'PENALIZED' && !s.penaltyWarningShown) {
      // 모바일 크롬 웹: Radix Dialog open → inertOthers() → 화면 차단 위험.
      // 이 환경에서는 Dialog 표시 skip (네이티브 앱 또는 데스크톱에서 경고 표시).
      if (isMobileChromeWeb()) return;
      // Race condition 방지: query 활성화 후 SPA 이동이 있었으면 모달 열지 않음.
      const enabledPath = penaltyQueryEnabledPathRef.current;
      if (!enabledPath || pathnameRef.current === enabledPath) {
        penaltyWarningCheckedRef.current = true;
        setShowPenaltyWarning(true);
      }
    }
  }, [abuseStatusQuery.data]);

  // ── PenaltyWarningModal: SPA 라우트 변경 시 자동 닫기 ────────────────────
  // 문제: App 최상위(Router 위)에서 렌더되므로 SPA 이동 후에도 Dialog가 open 유지됨.
  //       → #root[inert] 가 새 라우트에도 잔류 → 완전 프리즈.
  // 해결: pathname 변경 시 열려 있으면 닫아 Radix cleanup이 정상 실행되도록 한다.
  // 트레이드오프: 경고를 확인하지 않고 이동하면 이 세션에서는 재표시 안 됨.
  //              (penaltyWarningCheckedRef=true → next reload 시 재표시)
  useEffect(() => {
    cleanupInteractionLocks();
    if (showPenaltyWarning) setShowPenaltyWarning(false);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

  // ── PenaltyWarningModal close 시 방어적 cleanup ───────────────────────────
  // close animation(~300ms) 완료 이후까지 이중 커버
  useEffect(() => {
    if (showPenaltyWarning) return;
    cleanupInteractionLocks();
    const t = setTimeout(cleanupInteractionLocks, 350);
    return () => clearTimeout(t);
  }, [showPenaltyWarning]);

  // [P2-4] 이벤트 팝업 — 홈 라우트 전용 자동 노출
  const [activeEventPopup, setActiveEventPopup] = useState<any>(null);
  const [pendingPopup, setPendingPopup] = useState<any>(null);
  // X 닫기: 메모리(Set)로만 관리. 새로고침/새 탭 시 리셋 → 다시 노출.
  const xDismissedRef = useRef<Set<number>>(new Set());
  const isOnHome = popupUtils.isHomeRoute(pathname);
  // 레거시 키 1회 정리
  useEffect(() => { popupUtils.cleanupLegacyKeys(); }, []);
  const [popupCheckKey, setPopupCheckKey] = useState(0);
  // 홈 라우트에서만 쿼리 활성화
  const eventPopupsQuery = trpc.popup.getActive.useQuery(undefined, {
    staleTime: 60 * 1000,
    refetchOnWindowFocus: false,
    enabled: isOnHome,
  });
  // 어드민 테스트 버튼 클릭 시 window 이벤트로 즉시 재체크
  useEffect(() => {
    const handler = () => setPopupCheckKey(k => k + 1);
    window.addEventListener('popup-recheck', handler);
    return () => window.removeEventListener('popup-recheck', handler);
  }, []);
  // 홈 이탈 시 팝업 즉시 닫기
  useEffect(() => {
    if (!isOnHome) {
      setActiveEventPopup(null);
      setPendingPopup(null);
    }
  }, [isOnHome]);
  useEffect(() => {
    if (!isOnHome || !eventPopupsQuery.data) return;
    const popups: any[] = eventPopupsQuery.data as any[];
    const uid = user?.id ?? 'anon';
    const unseen = popups.find(p =>
      !xDismissedRef.current.has(p.id) && popupUtils.isPopupVisible(uid, p.id)
    );
    if (unseen && !activeEventPopup) {
      setActiveEventPopup(unseen);
    }
    setPendingPopup(unseen ?? null);
  }, [eventPopupsQuery.data, popupCheckKey, isOnHome]);

  // 카톡 인앱 브라우저 감지 시 모달 표시 (리다이렉트 대신)
  const [showInAppBrowserModal, setShowInAppBrowserModal] = useState(false);
  
  useEffect(() => {
    if (isInAppBrowser()) {
      console.log(`[App] 인앱 브라우저 감지, 안내 모달 표시`);
      
      // 리다이렉트 대신 모달 표시
      setShowInAppBrowserModal(true);
    }
  }, []);
  
  // PWA 설치 후 첫 실행 감지 (웹 PWA 전용)
  // Capacitor 앱: 이 로직은 네이티브 앱에 해당 없음 → 건너뜀
  // 주의: document.cookie로 httpOnly 쿠키(app_session_id)를 삭제할 수 없음.
  //       실제 세션 정리는 서버 /api/auth/logout 엔드포인트만 가능.
  useEffect(() => {
    if (isCapacitorNative()) return; // Capacitor 앱은 PWA 첫 실행 로직 해당 없음

    // PWA standalone 모드: 홈 화면에서 설치된 웹앱으로 실행된 경우
    // (display-mode: standalone) + iOS navigator.standalone 만 체크
    // document.referrer 'android-app://' 제거: Capacitor guard로 대체됨
    const isStandalone = window.matchMedia('(display-mode: standalone)').matches ||
                         (window.navigator as any).standalone === true;

    if (isStandalone) {
      const firstLaunchKey = 'pwa-first-launch-completed';
      const firstLaunch = !localStorage.getItem(firstLaunchKey);

      if (firstLaunch) {
        console.log('[PWA] 첫 실행 감지 — first launch 마킹');
        localStorage.setItem(firstLaunchKey, 'true');
        // 참고: httpOnly 쿠키(app_session_id)는 JS에서 삭제 불가.
        //       이전 document.cookie 삭제 코드는 wrong name + httpOnly 이중 방어로 무효였음 (제거됨).
      }
    }
  }, []);
  
  return (
    <AuthTransitionContext.Provider value={authTransitionStabilizing}>
    <ErrorBoundary>
      <ThemeProvider defaultTheme="light">
        <TooltipProvider>
          {/* 곰돌이 스플래시 — SessionLoadingGate 바깥에서 렌더 (앱 부팅 즉시 표시) */}
          <PWALoadingScreen />
          {/* 입력 차단 진단 HUD — 개발 전용 */}
          {import.meta.env.DEV && <DebugHUD />}
          {/* S25 Ultra Chrome 웹 안내 오버레이 — SessionLoadingGate 바깥 (최우선 렌더) */}
          <AndroidWebNotice />
          {/* 앱 OAuth 단계별 디버그 오버레이 — Capacitor 네이티브 전용, 로그인 시도 시 상단 표시 */}
          <AppAuthDebug />
          {/* 임시 로그인 진단 오버레이 — ?debugAuth=1 또는 localStorage debug_auth_overlay=1 시에만 표시 */}
          <AuthDebugOverlay />
          {/* 🔐 세션 로딩 게이트: 인증 상태 확인 완료 전까지 대기 */}
          <SessionLoadingGate>
            {/* ForceUpdateGate eager import됨 — outer Suspense 불필요 */}
            {/* 강제 업데이트 게이트 */}
            <ForceUpdateGate>
                {/* 비핵심 오버레이 — 모바일 크롬 웹: 오버레이/배너 전부 skip (레이아웃 차단 방지) */}
                {!isMobileChromeWeb() && (
                  <Suspense fallback={null}>
                    <EmergencyBanner />
                  </Suspense>
                )}
                
                {/* InAppBrowserRedirectModal: 인앱 브라우저에서만 표시 (mobile chrome web에서는 불해당) */}
                {!isMobileChromeWeb() && (
                  <Suspense fallback={null}>
                    <InAppBrowserRedirectModal
                      isOpen={showInAppBrowserModal}
                      onClose={() => setShowInAppBrowserModal(false)}
                    />
                  </Suspense>
                )}

                {/* [P2-4] 이벤트 팝업 — 홈 라우트 + 로그인 유저에서만 렌더 (anonymous 진입 차단 방지) */}
                {isOnHome && user && (
                  <EventPopupModal
                    popup={activeEventPopup}
                    userId={user?.id}
                    onClose={(type) => {
                      // X 닫기: 메모리에만 기록 (새로고침 시 리셋)
                      // 24h 닫기: EventPopupModal 내부에서 localStorage 저장 후 호출
                      if (type === 'x' && activeEventPopup?.id) {
                        xDismissedRef.current.add(activeEventPopup.id);
                      }
                      setActiveEventPopup(null);
                      setPendingPopup(null);
                    }}
                  />
                )}
                {/* 미열람 팝업 확성기 — 홈 라우트 + 로그인 유저에서만 */}
                {isOnHome && user && pendingPopup && !activeEventPopup && (
                  <button
                    onClick={() => setActiveEventPopup(pendingPopup)}
                    style={{
                      position: 'fixed', bottom: 'calc(76px + env(safe-area-inset-bottom, 0px))', right: '16px', zIndex: 40,
                      background: 'linear-gradient(135deg,#f97316,#ec4899)',
                      border: 'none', borderRadius: '50%', width: '44px', height: '44px',
                      cursor: 'pointer', boxShadow: '0 4px 14px rgba(249,115,22,.45)',
                      color: 'white', fontSize: '18px', display: 'flex',
                      alignItems: 'center', justifyContent: 'center',
                    }}
                    aria-label="공지 보기"
                  >
                    📢
                  </button>
                )}

                {/* 패널티 경고 모달 — 모바일 크롬 웹: Dialog skip (inertOthers 차단 방지) */}
                {!isMobileChromeWeb() && (
                  <PenaltyWarningModal
                    open={showPenaltyWarning}
                    onClose={() => {
                      setShowPenaltyWarning(false);
                      markWarningSeen.mutate();
                    }}
                  />
                )}

                {/* 패널티 지속 배너 — 모바일 크롬 웹: skip */}
                {!isMobileChromeWeb() && user?.role === 'user' && abuseStatusQuery.data?.status === 'PENALIZED' && (
                  <div className="bg-red-600 text-white text-xs text-center py-1.5 px-4 font-medium">
                    ⚠️ 주의 조치 적용 계정 — 이번 주 참여 횟수 확인 후 이용해 주세요
                  </div>
                )}

                {/* 푸시 알림 권한 배너 (Capacitor 앱 + permission=default 상태에서만 표시) */}
                {user && !isMobileChromeWeb() && <PushPermissionBanner />}

                {/* 메인 라우터 */}
                <Router />
                
                <Toaster position="top-center" richColors />
            </ForceUpdateGate>
          </SessionLoadingGate>
        </TooltipProvider>
      </ThemeProvider>
    </ErrorBoundary>
    </AuthTransitionContext.Provider>
  );
}

export default App;
