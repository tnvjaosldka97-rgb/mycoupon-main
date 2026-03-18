// Version 2.0.0 - Updated at 2025-12-21 (Force cache clear)
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/NotFound";
import { Route, Switch } from "wouter";
import ErrorBoundary from "./components/ErrorBoundary";
import { ThemeProvider } from "./contexts/ThemeContext";
import { lazy, Suspense, useState, useEffect } from "react";
import ForceUpdateModal from "./components/ForceUpdateModal";
import { ForceUpdateGate } from "./components/ForceUpdateGate";
import { EmergencyBanner } from "./components/EmergencyBanner";
import PWALoadingScreen from "./components/PWALoadingScreen";
import { IOSInstallGuide } from "./components/IOSInstallGuide";
import { InAppBrowserRedirectModal } from "./components/InAppBrowserRedirectModal";
import { useErrorLogger } from "./hooks/useErrorLogger";
import { useInstallFunnel } from "./hooks/useInstallFunnel";
import { isInAppBrowser } from "./lib/browserDetect";

// ─── Lazy-loaded pages ────────────────────────────────────────────────────────
// Vite(Rollup) 청크 네이밍 전략:
//   webpack의 webpackChunkName과 달리 Vite는 파일 경로를 청크 이름으로 자동 사용.
//   vite.config.ts의 chunkFileNames: 'assets/js/[name]-[hash].js' 설정과 결합되어
//   각 페이지가 독립 청크로 분리됨 (예: Home-[hash].js, AdminDashboard-[hash].js).
//   초기 번들에서 제외 → TTI 단축. 각 청크는 최초 방문 후 브라우저 캐시에 보존됨.
// ─────────────────────────────────────────────────────────────────────────────
// [일반 사용자 경로] chunk: Home, StoreDetail, SearchResults, MyVisits, MyCoupons
const Home                 = lazy(() => import("./pages/Home"));
const StoreDetail          = lazy(() => import("./pages/StoreDetail"));
const SearchResults        = lazy(() => import("./pages/SearchResults"));
const MyVisits             = lazy(() => import("./pages/MyVisits"));
const MyCoupons            = lazy(() => import("./pages/MyCoupons"));
// [지도/탐색 경로] chunk: CouponMap, MapPage
const CouponMap            = lazy(() => import("./pages/CouponMap"));
const MapPage              = lazy(() => import("./pages/MapPage"));
// [게임/리워드 경로] chunk: Gamification, Rewards
const Gamification         = lazy(() => import("./pages/Gamification"));
const Rewards              = lazy(() => import("./pages/Rewards"));
// [관리자 경로] chunk: AdminDashboard, AdminPage, StoreDetails
const AdminDashboard       = lazy(() => import("./pages/AdminDashboard"));
const AdminPage            = lazy(() => import("./pages/AdminPage"));
const StoreDetails         = lazy(() => import("./pages/StoreDetails"));
// [점주 경로] chunk: QRScanner, MerchantAnalytics
const QRScanner            = lazy(() => import("./pages/QRScanner"));
const MerchantAnalytics    = lazy(() => import("./pages/MerchantAnalytics"));
// [설정/설치 경로] chunk: NotificationSettings, InstallGuide
const NotificationSettings = lazy(() => import("./pages/NotificationSettings"));
const InstallGuide         = lazy(() => import("./pages/InstallGuide"));
// ─────────────────────────────────────────────────────────────────────────────

// 페이지 청크 로딩 중 표시할 최소 스피너 — 서비스 테마(#FFF5F0) 적용
function PageLoadingFallback() {
  return (
    <div className="flex items-center justify-center min-h-screen" style={{ backgroundColor: '#FFF5F0' }}>
      <div className="w-8 h-8 rounded-full border-2 border-orange-200 border-t-orange-500 animate-spin" />
    </div>
  );
}

function Router() {
  return (
    // ErrorBoundary: ChunkLoadError 등 청크 로딩 실패 시 앱 전체 화이트아웃 방지
    // Suspense: 청크 다운로드 중 PageLoadingFallback 표시
    // ForceUpdateModal/EmergencyBanner 등 전역 컴포넌트는 Suspense 외부에 위치 → 로딩 중에도 유지
    <ErrorBoundary>
      <Suspense fallback={<PageLoadingFallback />}>
        <Switch>
          <Route path="/" component={Home} />
          <Route path="/admin" component={AdminDashboard} />
          <Route path="/admin/old" component={AdminPage} />

          <Route path="/admin/store/:id" component={StoreDetails} />
          <Route path="/coupons" component={CouponMap} />
          <Route path="/map" component={MapPage} />
          <Route path="/my-coupons" component={MyCoupons} />
          <Route path="/gamification" component={Gamification} />
          <Route path="/rewards" component={Rewards} />

          <Route path="/qr-scanner" component={QRScanner} />
          <Route path="/merchant/analytics" component={MerchantAnalytics} />
          <Route path="/store/:id" component={StoreDetail} />
          <Route path="/search" component={SearchResults} />

          <Route path="/my-visits" component={MyVisits} />
          <Route path="/notification-settings" component={NotificationSettings} />
          <Route path="/install" component={InstallGuide} />
          <Route path="/404" component={NotFound} />
          <Route component={NotFound} />
        </Switch>
      </Suspense>
    </ErrorBoundary>
  );
}

function App() {
  // 에러 로거 활성화
  useErrorLogger();
  
  // 설치 퍼널 추적 활성화
  useInstallFunnel();
  
  // 카톡 인앱 브라우저 감지 시 모달 표시 (리다이렉트 대신)
  const [showInAppBrowserModal, setShowInAppBrowserModal] = useState(false);
  
  useEffect(() => {
    if (isInAppBrowser()) {
      console.log(`[App] 인앱 브라우저 감지, 안내 모달 표시`);
      
      // 리다이렉트 대신 모달 표시
      setShowInAppBrowserModal(true);
    }
  }, []);
  
  // PWA 설치 후 첫 실행 감지 및 자동 로그인 처리
  useEffect(() => {
    // PWA standalone 모드인지 확인
    const isStandalone = window.matchMedia('(display-mode: standalone)').matches || 
                        (window.navigator as any).standalone || 
                        document.referrer.includes('android-app://');
    
    if (isStandalone) {
      // PWA 설치 후 첫 실행인지 확인
      const firstLaunch = !localStorage.getItem('pwa-first-launch-completed');
      
      if (firstLaunch) {
        console.log('[App] PWA 첫 실행 감지, 자동 로그인 처리 시작');
        localStorage.setItem('pwa-first-launch-completed', 'true');
        
        // URL에 로그인 관련 파라미터가 없으면 로그인 상태 확인
        const urlParams = new URLSearchParams(window.location.search);
        const hasOAuthParams = urlParams.has('code') || urlParams.has('state');
        
        if (!hasOAuthParams) {
          // 로그인 상태를 확인하고 필요하면 로그인 페이지로 리다이렉트
          // (실제 로그인은 사용자가 버튼을 눌러야 하므로 여기서는 상태만 확인)
          console.log('[App] PWA 첫 실행: 로그인 상태 확인 중...');
        }
      }
    }
  }, []);
  
  // 멈춤 상태 초기화: 앱 시작 시 이전 세션 상태 정리
  useEffect(() => {
    // 이전에 멈춘 적이 있는지 확인
    const wasStuck = sessionStorage.getItem('pwa-was-stuck');
    if (wasStuck) {
      console.log('[App] 이전 멈춤 상태 감지, 세션 상태 초기화');
      // 멈춤 상태 제거
      sessionStorage.removeItem('pwa-was-stuck');
      // 인증 관련 세션 상태도 정리
      sessionStorage.removeItem('auth-refetched');
      // OAuth 콜백 관련 상태 정리
      const urlParams = new URLSearchParams(window.location.search);
      if (urlParams.has('code') || urlParams.has('state')) {
        // OAuth 콜백 파라미터는 유지 (로그인 처리 필요)
        console.log('[App] OAuth 콜백 감지, 파라미터 유지');
      } else {
        // 일반 재접속인 경우 URL 정리
        if (window.location.search) {
          const cleanUrl = window.location.pathname;
          window.history.replaceState({}, '', cleanUrl);
        }
      }
    }
  }, []);
  
  // 다크 모드 강제 비활성화 (App 컴포넌트 마운트 시)
  useEffect(() => {
    // 즉시 다크 모드 클래스 제거
    const removeDarkMode = () => {
      document.documentElement.classList.remove('dark');
      document.body.classList.remove('dark');
      const root = document.getElementById('root');
      if (root) {
        root.classList.remove('dark');
      }
      
      // 스타일 강제 설정
      document.documentElement.style.setProperty('background-color', '#FFF5F0', 'important');
      document.documentElement.style.setProperty('color', '#000000', 'important');
      document.body.style.setProperty('background-color', '#FFF5F0', 'important');
      document.body.style.setProperty('color', '#000000', 'important');
      if (root) {
        root.style.setProperty('background-color', '#FFF5F0', 'important');
        root.style.setProperty('color', '#000000', 'important');
      }
    };
    
    removeDarkMode();
    
    // localStorage에서 다크 모드 설정 삭제
    if (localStorage.getItem('theme') === 'dark') {
      localStorage.removeItem('theme');
      localStorage.setItem('theme', 'light');
    }
    
    // MutationObserver로 다크 모드 클래스 추가 방지
    // - subtree 제거: React 리렌더 시 하위 DOM class 변화에 과반응하던 문제 해소
    //   (<html> 과 <body> 자신의 class 변경만 감지)
    // - 조건 가드: 실제 'dark' class가 삽입된 경우에만 removeDarkMode() 호출
    //   (무관한 class 변경에서는 콜백 즉시 종료 → DOM 조작 0회)
    // - setInterval 폐기: 이벤트 기반 전환 → idle CPU 0%
    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if ((mutation.target as HTMLElement).classList.contains('dark')) {
          removeDarkMode();
          break;
        }
      }
    });

    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class'],
    });

    observer.observe(document.body, {
      attributes: true,
      attributeFilter: ['class'],
    });

    return () => {
      observer.disconnect();
    };
  }, []);
  
  // 서비스 워커 등록 및 강제 새로고침 리스너
  useEffect(() => {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker
        .register('/service-worker.js')
        .then((registration) => {
          console.log('✅ 서비스 워커 등록 성공:', registration);
          
          // Service Worker에서 FORCE_RELOAD 메시지 수신 시 자동 새로고침
          navigator.serviceWorker.addEventListener('message', (event) => {
            if (event.data && event.data.type === 'FORCE_RELOAD') {
              console.log('🔄 강제 새로고침 요청:', event.data.version);
              window.location.reload();
            }
          });
        })
        .catch((error) => {
          console.error('❌ 서비스 워커 등록 실패:', error);
        });
    }
  }, []);

  return (
    <ErrorBoundary>
      <ForceUpdateGate>
        <PWALoadingScreen />
        <ThemeProvider defaultTheme="light">
          <TooltipProvider>
            <Toaster />
            {/* 배포/운영 안정성 컴포넌트 */}
            <ForceUpdateModal />
            <EmergencyBanner />
            <IOSInstallGuide />
            {/* 카톡 인앱 브라우저 안내 모달 */}
            <InAppBrowserRedirectModal 
              open={showInAppBrowserModal} 
              onOpenChange={setShowInAppBrowserModal} 
            />
            <Router />
          </TooltipProvider>
        </ThemeProvider>
      </ForceUpdateGate>
    </ErrorBoundary>
  );
}

export default App;
