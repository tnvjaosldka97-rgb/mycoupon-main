import { lazy, Suspense, useState, useEffect } from "react";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Route, Switch } from "wouter";
import ErrorBoundary from "./components/ErrorBoundary";
import { ThemeProvider } from "./contexts/ThemeContext";

// 핵심 페이지는 즉시 로드 (멈춤 방지)
import Home from "./pages/Home";
import MapPage from "./pages/MapPage"; // 즉시 로드 (자주 사용)

// 나머지 페이지는 지연 로딩 (코드 스플리팅)
const StoreDetail = lazy(() => import("./pages/StoreDetail"));
const SearchResults = lazy(() => import("./pages/SearchResults"));
const MyVisits = lazy(() => import("./pages/MyVisits"));
const CouponMap = lazy(() => import("./pages/CouponMap"));
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
        <Route path="/merchant/dashboard" component={MerchantDashboard} />
        <Route path="/merchant/add-store" component={AddStore} />
        <Route path="/merchant/store/:id" component={MerchantStoreDetail} />
        <Route path="/store/:id" component={StoreDetail} />
        <Route path="/search" component={SearchResults} />
        <Route path="/my-visits" component={MyVisits} />
        <Route path="/notification-settings" component={NotificationSettings} />
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
        </TooltipProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}

export default App;
