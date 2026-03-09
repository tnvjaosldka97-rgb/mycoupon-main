import { lazy, Suspense, useState, useEffect, useRef } from "react";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Route, Switch } from "wouter";
import ErrorBoundary from "./components/ErrorBoundary";
import { ThemeProvider } from "./contexts/ThemeContext";
import { useAuth } from "./hooks/useAuth";

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
const DistrictStamps = lazy(() => import("./pages/DistrictStamps")); // 🗺️ 도장판
const NotFound = lazy(() => import("@/pages/NotFound"));

// PWALoadingScreen 제거 - 무한 루프 문제 발생
// LocationTracker 제거 - GPS 알림 기능 비활성화
// PWA 업데이트 알림 제거 - 페이지 새로고침 시 자동 업데이트

// 성능 최적화: 무거운 컴포넌트들 lazy load
const ForceUpdateGate = lazy(() => import("./components/ForceUpdateGate").then(m => ({ default: m.ForceUpdateGate })));
const EmergencyBanner = lazy(() => import("./components/EmergencyBanner").then(m => ({ default: m.EmergencyBanner })));
const InAppBrowserRedirectModal = lazy(() => import("./components/InAppBrowserRedirectModal").then(m => ({ default: m.InAppBrowserRedirectModal })));

import { useErrorLogger } from "./hooks/useErrorLogger";
import { useInstallFunnel } from "./hooks/useInstallFunnel";
import { isInAppBrowser } from "./lib/browserDetect";

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
  const [sessionCheckTimeout, setSessionCheckTimeout] = useState(false);
  const [retryCount, setRetryCount] = useState(0);
  // 연결 오류를 즉시 표시하지 않기 위한 상태
  // 구조적 문제: retry:2 로 ~3초만에 오류 확정 → Railway cold start(5~30초)엔 너무 성급
  const [showConnectionError, setShowConnectionError] = useState(false);
  const autoRetryDoneRef = useRef(false);
  const mountLoggedRef = useRef(false);
  
  // 최초 1회 mount 로그
  useEffect(() => {
    if (mountLoggedRef.current) return;
    mountLoggedRef.current = true;
    console.log('[SESSION_GATE] 마운트 완료 - loading:', loading, 'error:', !!error);
  });

  // auth 상태 변화 추적
  useEffect(() => {
    console.log('[SESSION_GATE] auth 상태 변화 → loading:', loading, '| error:', error ? error.message?.slice(0, 60) : 'null');
  }, [loading, error]);

  // 세션 체크 타임아웃 (10초)
  useEffect(() => {
    if (!loading) {
      setSessionCheckTimeout(false);
      setRetryCount(0);
      return;
    }
    
    const timeoutId = setTimeout(() => {
      console.warn('[SessionLoadingGate] 세션 체크 타임아웃 (10초 초과)');
      setSessionCheckTimeout(true);
      setRetryCount(prev => prev + 1);
    }, 10000);
    
    return () => clearTimeout(timeoutId);
  }, [loading]);

  // 연결 오류 자동 재시도 — Railway cold start 대응
  // auth.me가 처음 실패해도 바로 "연결 오류" 확정하지 않고,
  // 4초 대기 후 1회 자동 재시도. 재시도도 실패하면 그때 오류 화면 표시.
  useEffect(() => {
    const isConnError = !!error && !error.message?.includes('UNAUTHORIZED');

    if (!isConnError) {
      // 오류 없음 또는 인증 오류 → 오류 화면 숨기고 카운터 초기화
      setShowConnectionError(false);
      autoRetryDoneRef.current = false;
      return;
    }

    if (autoRetryDoneRef.current) {
      // 이미 1회 자동 재시도했음 → 오류 화면 표시
      console.error('[SESSION_GATE] 자동 재시도 후에도 실패 → 연결 오류 화면 표시. error:', error?.message?.slice(0, 80));
      setShowConnectionError(true);
      return;
    }

    // 첫 실패 → 4초 대기 후 1회 자동 재시도 (Railway 서버 워밍업 대응)
    console.warn('[SESSION_GATE] 연결 오류 감지 → 4초 후 자동 재시도 예정. error:', error?.message?.slice(0, 80));
    const timer = setTimeout(() => {
      autoRetryDoneRef.current = true;
      console.log('[SESSION_GATE] 자동 재시도 실행 (refresh 호출)');
      refresh();
    }, 4000);

    return () => clearTimeout(timer);
  }, [error, refresh]);
  
  // 로딩 중이고 타임아웃 발생 시
  if (loading && sessionCheckTimeout) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-orange-50 via-pink-50 to-purple-50">
        <div className="flex flex-col items-center gap-4 max-w-md mx-auto px-4">
          <div className="w-16 h-16 border-4 border-orange-300 border-t-orange-600 rounded-full animate-spin"></div>
          <h2 className="text-gray-800 text-xl font-bold text-center">
            세션 확인 중...
          </h2>
          <p className="text-gray-600 text-sm text-center">
            로그인 상태를 확인하는 데 시간이 걸리고 있습니다.
            {retryCount > 0 && ` (재시도 ${retryCount}회)`}
          </p>
          <button
            onClick={() => {
              console.log('[SessionLoadingGate] 수동 새로고침');
              window.location.reload();
            }}
            className="mt-4 px-6 py-3 bg-orange-500 text-white rounded-lg font-semibold hover:bg-orange-600 transition-colors"
          >
            새로고침
          </button>
        </div>
      </div>
    );
  }
  
  // 로딩 중 (타임아웃 전)
  if (loading) {
    return <PageLoader />;
  }

  // 연결 오류: 자동 재시도 후에도 실패한 경우에만 표시 (즉시 표시 금지)
  if (showConnectionError) {
    console.error('[SESSION_GATE] ❌ 연결 오류 화면 렌더링:', error?.message?.slice(0, 80));
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
          <button
            onClick={() => window.location.reload()}
            className="mt-4 px-6 py-3 bg-orange-500 text-white rounded-lg font-semibold hover:bg-orange-600 transition-colors"
          >
            다시 시도
          </button>
        </div>
      </div>
    );
  }

  // 오류 발생했지만 자동 재시도 대기 중 → 로딩 스피너 유지
  if (error && !error.message?.includes('UNAUTHORIZED')) {
    return <PageLoader />;
  }
  
  // 세션 체크 완료 - 앱 렌더링
  console.log('[SESSION_GATE] ✅ 세션 체크 완료 → 앱 렌더링 시작');
  return <>{children}</>;
}

function Router() {
  return (
    <Suspense fallback={<PageLoader />}>
      <Switch>
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
        <Route path="/404" component={NotFound} />
        <Route component={NotFound} />
      </Switch>
    </Suspense>
  );
}

function App() {
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
  
  // 카톡 인앱 브라우저 감지 시 모달 표시 (리다이렉트 대신)
  const [showInAppBrowserModal, setShowInAppBrowserModal] = useState(false);
  
  useEffect(() => {
    if (isInAppBrowser()) {
      console.log(`[App] 인앱 브라우저 감지, 안내 모달 표시`);
      
      // 리다이렉트 대신 모달 표시
      setShowInAppBrowserModal(true);
    }
  }, []);
  
  // PWA 설치 후 첫 실행 감지 및 세션 초기화 (보안 강화)
  useEffect(() => {
    // PWA standalone 모드인지 확인
    const isStandalone = window.matchMedia('(display-mode: standalone)').matches || 
                        (window.navigator as any).standalone || 
                        document.referrer.includes('android-app://');
    
    if (isStandalone) {
      // PWA 설치 후 첫 실행인지 확인
      const firstLaunchKey = 'pwa-first-launch-completed';
      const userManuallyLoggedInKey = 'user-manually-logged-in'; // 사용자가 직접 로그인했는지 추적
      const firstLaunch = !localStorage.getItem(firstLaunchKey);
      
      if (firstLaunch) {
        console.log('[PWA Security] 첫 실행 감지 - 세션 초기화');
        
        // 세션 쿠키 삭제 (이전 브라우저 세션 제거)
        document.cookie = 'session=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT';
        
        // 첫 실행 완료 표시
        localStorage.setItem(firstLaunchKey, 'true');
        
        // 사용자가 직접 로그인하지 않았음을 표시
        localStorage.removeItem(userManuallyLoggedInKey);
      }
    }
  }, []);
  
  return (
    <ErrorBoundary>
      <ThemeProvider defaultTheme="light">
        <TooltipProvider>
          {/* 🔐 세션 로딩 게이트: 인증 상태 확인 완료 전까지 대기 */}
          <SessionLoadingGate>
            <Suspense fallback={null}>
              {/* 강제 업데이트 게이트 */}
              <ForceUpdateGate>
                <Suspense fallback={null}>
                  {/* 긴급 공지 배너 */}
                  <EmergencyBanner />
                </Suspense>
                
                <Suspense fallback={null}>
                  {/* 인앱 브라우저 안내 모달 */}
                  <InAppBrowserRedirectModal 
                    isOpen={showInAppBrowserModal} 
                    onClose={() => setShowInAppBrowserModal(false)} 
                  />
                </Suspense>
                
                {/* 메인 라우터 - 즉시 로드 */}
                <Router />
                
                {/* 토스트 알림 */}
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
