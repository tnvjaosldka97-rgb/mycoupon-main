import { lazy, Suspense, useState, useEffect, useRef } from "react";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Route, Switch } from "wouter";
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

// 성능 최적화: 무거운 컴포넌트들 lazy load
const ForceUpdateGate = lazy(() => import("./components/ForceUpdateGate").then(m => ({ default: m.ForceUpdateGate })));
const EmergencyBanner = lazy(() => import("./components/EmergencyBanner").then(m => ({ default: m.EmergencyBanner })));
const InAppBrowserRedirectModal = lazy(() => import("./components/InAppBrowserRedirectModal").then(m => ({ default: m.InAppBrowserRedirectModal })));

import { useErrorLogger } from "./hooks/useErrorLogger";
import { useInstallFunnel } from "./hooks/useInstallFunnel";
import { useVersionCheck } from "./hooks/useVersionCheck";
import { isInAppBrowser } from "./lib/browserDetect";
import { isCapacitorNative } from "./lib/capacitor";

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
      // stale sw-force-reload-* 키 정리 (현재 버전 제외)
      const currentSwVersion = localStorage.getItem('sw-version') ?? '';
      const staleKeys: string[] = [];
      try {
        Object.keys(sessionStorage).forEach(k => {
          if (k.startsWith('sw-force-reload-') && !k.endsWith(currentSwVersion)) {
            staleKeys.push(k);
            sessionStorage.removeItem(k);
          }
        });
      } catch (_) {}

      // 오염된 localStorage user-info 정리
      let clearedUserInfo = false;
      try {
        const saved = localStorage.getItem('mycoupon-user-info');
        if (saved) {
          const parsed = JSON.parse(saved);
          if (!parsed || !parsed.id || !parsed.role) {
            localStorage.removeItem('mycoupon-user-info');
            clearedUserInfo = true;
          }
        }
        const popupKeys = Object.keys(localStorage).filter(k => k.startsWith('event_popup_seen_'));
        if (popupKeys.length > 20) popupKeys.forEach(k => localStorage.removeItem(k));
      } catch (_) {
        try { localStorage.removeItem('mycoupon-user-info'); clearedUserInfo = true; } catch (_2) {}
      }

      // [BOOT-TIMEOUT-RECOVERY]
      console.warn('[BOOT-TIMEOUT-RECOVERY]', {
        reason: 'meQuery pending > 10000ms',
        clearedKeys: [...staleKeys, ...(clearedUserInfo ? ['mycoupon-user-info'] : [])],
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

  // [BOOT-GATE] render — 모든 경로에서 현재 query 상태 출력
  const _gateState = { loading, sessionCheckTimeout, error: error?.message?.slice(0, 40) ?? null, t: Math.round(performance.now()), url: window.location.href.slice(0, 80) };
  console.log('[BOOT-GATE] render', _gateState);

  // 로딩 중이고 타임아웃 발생 시 → gate 강제 해제 (영구 로딩 방지)
  if (loading && sessionCheckTimeout) {
    console.warn('[BOOT-GATE-OPEN] TIMEOUT(10s) forced — anonymous fallback', _gateState);
    return <>{children}</>;
  }

  // 연결 오류 화면: loading보다 먼저 평가 — Fix A(8s escape valve)가 loading=true 중에도 탈출 가능하도록
  // auth 에러(UNAUTHED/SIGNUP_REQUIRED)는 showConnectionError가 세팅되지 않으므로 이 분기 불해당
  if (showConnectionError) {
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

// ── 디버그 HUD v2: 우상단 — 입력 차단 진단 ──────────────────────────────────
function DebugHUD() {
  const [tapInfo, setTapInfo] = useState('(none)');
  const [evType, setEvType] = useState('-');
  const [overlays, setOverlays] = useState<string[]>([]);
  const [disabledBtns, setDisabledBtns] = useState('');
  const [listenerOk, setListenerOk] = useState(false);
  const { loading } = useAuth();

  // 1) mount 로그 + 3종 이벤트 등록
  useEffect(() => {
    console.log('[DEBUG-HUD] mounted — attaching pointerdown/touchstart/click capture listeners');

    const mkHandler = (type: string) => (e: Event) => {
      const t = e.target as Element | null;
      const x = (e as PointerEvent | TouchEvent & { clientX?: number }).clientX
        ?? ((e as TouchEvent).touches?.[0]?.clientX ?? 0);
      const y = (e as PointerEvent | TouchEvent & { clientY?: number }).clientY
        ?? ((e as TouchEvent).touches?.[0]?.clientY ?? 0);
      const desc = t
        ? `${t.tagName.toLowerCase()}${t.id ? '#' + t.id : ''}`
        : '?';
      const closestBtn = t?.closest('button,a,[role=button]');
      const info = `${desc}(${Math.round(x as number)},${Math.round(y as number)}) closest=${closestBtn ? closestBtn.tagName.toLowerCase() : 'null'}`;
      setEvType(type);
      setTapInfo(info);
      console.log(`[INPUT-DIAG-v2] ${type}`, {
        target: desc,
        closestInteractive: closestBtn ? `${closestBtn.tagName.toLowerCase()} disabled=${(closestBtn as HTMLButtonElement | HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement).disabled ?? 'n/a'}` : 'null',
        x, y,
        fromPoint: (() => { try { const el = document.elementFromPoint(x as number, y as number); return el ? `${el.tagName.toLowerCase()}${el.id ? '#' + el.id : ''}` : 'null'; } catch(_){ return 'err'; } })(),
        t: Math.round(performance.now()),
      });
    };

    const pdH = mkHandler('pointerdown');
    const tsH = mkHandler('touchstart');
    const clH = mkHandler('click');

    document.addEventListener('pointerdown', pdH, { capture: true });
    document.addEventListener('touchstart', tsH, { capture: true, passive: true } as any);
    document.addEventListener('click', clH, { capture: true });

    setListenerOk(true);
    console.log('[DEBUG-HUD] listeners attached OK');

    return () => {
      document.removeEventListener('pointerdown', pdH, { capture: true } as any);
      document.removeEventListener('touchstart', tsH, { capture: true } as any);
      document.removeEventListener('click', clH, { capture: true } as any);
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
          found.push(`${el.tagName.toLowerCase()}${(el as HTMLElement).id ? '#' + (el as HTMLElement).id : ''} z=${s.zIndex}`);
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
      <div>EV:{evType} {tapInfo.slice(0, 40)}</div>
      <div>OVL({overlays.length}):{overlays[0]?.slice(0, 30) || 'none'}</div>
      <div>DIS:{disabledBtns.slice(0, 40)}</div>
    </div>
  );
}
// ────────────────────────────────────────────────────────────────────────────

function App() {
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

  // ── 어뷰저 패널티 경고 모달 ──────────────────────────────────────────────
  const [showPenaltyWarning, setShowPenaltyWarning] = useState(false);
  const penaltyWarningCheckedRef = useRef(false);
  const abuseStatusQuery = trpc.abuse.getMyStatus.useQuery(undefined, {
    enabled: !!user && !authLoading && user.role === 'user',
    staleTime: 5 * 60 * 1000,
  });
  const markWarningSeen = trpc.abuse.markWarningSeen.useMutation();
  useEffect(() => {
    if (penaltyWarningCheckedRef.current) return;
    if (!abuseStatusQuery.data) return;
    const s = abuseStatusQuery.data;
    if (s.status === 'PENALIZED' && !s.penaltyWarningShown) {
      penaltyWarningCheckedRef.current = true;
      setShowPenaltyWarning(true);
    }
  }, [abuseStatusQuery.data]);

  // [P2-4] 이벤트 팝업 — 비로그인 포함, 팝업당 1회 localStorage guard
  const [activeEventPopup, setActiveEventPopup] = useState<any>(null);
  const [popupCheckKey, setPopupCheckKey] = useState(0);
  const eventPopupsQuery = trpc.popup.getActive.useQuery(undefined, { staleTime: 60 * 1000 });
  // 어드민 테스트 버튼 클릭 시 window 이벤트로 즉시 재체크
  useEffect(() => {
    const handler = () => setPopupCheckKey(k => k + 1);
    window.addEventListener('popup-recheck', handler);
    return () => window.removeEventListener('popup-recheck', handler);
  }, []);
  useEffect(() => {
    if (!eventPopupsQuery.data) return;
    const popups: any[] = eventPopupsQuery.data as any[];
    const unseen = popups.find(p => !localStorage.getItem(`event_popup_seen_${p.id}`));
    if (unseen) setActiveEventPopup(unseen);
  }, [eventPopupsQuery.data, user?.id, popupCheckKey]);

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
    <ErrorBoundary>
      <ThemeProvider defaultTheme="light">
        <TooltipProvider>
          {/* 곰돌이 스플래시 — SessionLoadingGate 바깥에서 렌더 (앱 부팅 즉시 표시) */}
          <PWALoadingScreen />
          {/* 입력 차단 진단 HUD — 확정 후 제거 */}
          <DebugHUD />
          {/* 🔐 세션 로딩 게이트: 인증 상태 확인 완료 전까지 대기 */}
          <SessionLoadingGate>
            {/* fallback={null} → PageLoader 로 교체:
                ForceUpdateGate lazy import 완료 전 null 반환 → blank/검정화면 발생 방지 */}
            <Suspense fallback={<PageLoader />}>
              {/* 강제 업데이트 게이트 */}
              <ForceUpdateGate>
                {/* 비핵심 오버레이는 null 유지 (화면을 막으면 안 됨) */}
                <Suspense fallback={null}>
                  <EmergencyBanner />
                </Suspense>
                
                <Suspense fallback={null}>
                  <InAppBrowserRedirectModal 
                    isOpen={showInAppBrowserModal} 
                    onClose={() => setShowInAppBrowserModal(false)} 
                  />
                </Suspense>
                
                {/* [P2-4] 이벤트 팝업 (비로그인 포함, 팝업당 1회) */}
                <EventPopupModal
                  popup={activeEventPopup}
                  onClose={() => setActiveEventPopup(null)}
                />

                {/* 패널티 경고 모달 (PENALIZED 확정 후 1회) */}
                <PenaltyWarningModal
                  open={showPenaltyWarning}
                  onClose={() => {
                    setShowPenaltyWarning(false);
                    markWarningSeen.mutate();
                  }}
                />

                {/* 패널티 지속 배너 (PENALIZED 상태 내내 상단 고정) */}
                {user?.role === 'user' && abuseStatusQuery.data?.status === 'PENALIZED' && (
                  <div className="bg-red-600 text-white text-xs text-center py-1.5 px-4 font-medium">
                    ⚠️ 주의 조치 적용 계정 — 이번 주 참여 횟수 확인 후 이용해 주세요
                  </div>
                )}

                {/* 푸시 알림 권한 배너 (Capacitor 앱 + permission=default 상태에서만 표시) */}
                {user && <PushPermissionBanner />}

                {/* 메인 라우터 */}
                <Router />
                
                <Toaster position="top-center" richColors />
              </ForceUpdateGate>
            </Suspense>
          </SessionLoadingGate>
        </TooltipProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}

export default App;
