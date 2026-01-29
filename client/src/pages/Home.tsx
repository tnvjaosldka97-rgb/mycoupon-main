import { useAuth } from '@/_core/hooks/useAuth';
import { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Gift, MapPin, Sparkles, TrendingUp, Users, Zap, Heart, Store, Ticket, Percent, Bell, Download, X, LogOut, User } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuSeparator } from "@/components/ui/dropdown-menu";
import { useLocation } from "wouter";
import { Link } from "wouter";
import { getLoginUrl } from "@/const";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { FloatingPromoWidget } from "@/components/FloatingPromoWidget";
import { InstallModal } from "@/components/InstallModal";
import { NotificationBadge } from "@/components/NotificationBadge";
import { isInAppBrowser, redirectToChrome, getInAppBrowserName } from "@/lib/browserDetect";

export default function Home() {
  const { user, loading } = useAuth();
  
  // 성능 최적화: 불필요한 초기 로직 제거
  // 멈춤 상태 체크는 5초 후 백그라운드에서 실행
  useEffect(() => {
    const timer = setTimeout(() => {
      const wasStuck = sessionStorage.getItem('pwa-was-stuck');
      if (wasStuck) {
        sessionStorage.removeItem('pwa-was-stuck');
      }
    }, 5000);
    return () => clearTimeout(timer);
  }, []);
  const [, setLocation] = useLocation();
  const [deferredPrompt, setDeferredPrompt] = useState<any>(null);
  const [showInstallBanner, setShowInstallBanner] = useState(false);
  const [showInstallModal, setShowInstallModal] = useState(false);
  const [isStandalone, setIsStandalone] = useState(false);
  const [isPWAInstalled, setIsPWAInstalled] = useState(false);
  const [isInstalling, setIsInstalling] = useState(false);
  const logoutMutation = trpc.auth.logout.useMutation({
    onSuccess: () => {
      // 로그아웃 후 PWA 설치 상태 다시 확인
      const standaloneMode = window.matchMedia('(display-mode: standalone)').matches || 
                            (window.navigator as any).standalone === true ||
                            document.referrer.includes('android-app://');
      
      // standalone 모드가 아니면 설치되지 않은 것으로 간주
      setIsPWAInstalled(standaloneMode);
      if (standaloneMode) {
        localStorage.setItem('pwa-installed', 'true');
      } else {
        // 앱 삭제 후 재접속 시 localStorage 완전 초기화
        localStorage.removeItem('pwa-installed');
        localStorage.removeItem('pwa-install-dismissed');
        localStorage.removeItem('pwa-install-timestamp');
        console.log('[PWA] 앱 삭제 감지, localStorage 초기화 완료');
      }
      
      // install 모드 해제
      sessionStorage.removeItem('install-mode');
      
      // 페이지 새로고침하여 상태 업데이트
      window.location.href = '/';
    },
  });

  useEffect(() => {
    // install 파라미터가 있으면 (Chrome으로 리다이렉트된 경우) 설치 모드 활성화
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.get('install') === 'true') {
      console.log('[Home] install 파라미터 감지, 설치 모드 활성화');
      const fromKakao = urlParams.get('from') === 'kakao';
      
      // 카톡에서 온 경우 설치 모드만 활성화 (로그아웃은 하지 않음 - 화면 멈춤 방지)
      if (fromKakao) {
        console.log('[Home] 카톡에서 Chrome으로 리다이렉트됨, 설치 모드 활성화');
        sessionStorage.setItem('install-mode', 'true');
        // 인증 관련 세션만 정리 (로그아웃은 하지 않음 - 화면 멈춤 방지)
        sessionStorage.removeItem('auth-refetched');
        // 로딩 화면 강제 해제 (버튼 클릭 가능하도록)
        localStorage.setItem('pwa-loading-shown', 'true');
        console.log('[Home] 설치 모드 활성화 완료, 버튼 클릭 가능');
      }
      
      // install 파라미터는 유지 (deferredPrompt 대기용)
      // 새로고침하지 않음 (Chrome에서 바로 설치 팝업이 뜨도록)
    }
    
    // 카톡 인앱 브라우저에서 자동으로 Chrome으로 리다이렉트
    if (isInAppBrowser()) {
      const browserName = getInAppBrowserName() || '인앱 브라우저';
      const isAndroidDevice = /Android/.test(navigator.userAgent);
      
      if (isAndroidDevice) {
        // Android 인앱 브라우저인 경우 Chrome으로 자동 리다이렉트
        toast.info(`${browserName}에서는 앱을 설치할 수 없습니다. Chrome으로 이동합니다...`, {
          duration: 3000,
        });
        
        setTimeout(() => {
          const currentUrl = new URL(window.location.href);
          currentUrl.searchParams.set('install', 'true');
          currentUrl.searchParams.set('from', 'kakao');
          redirectToChrome(currentUrl.toString());
        }, 1000);
        return;
      }
    }
    
    // PWA 설치 상태 정확한 확인
    const checkPWAInstallStatus = () => {
      // 1. standalone 모드 확인 (가장 정확한 방법)
      const standaloneMode = window.matchMedia('(display-mode: standalone)').matches || 
                            (window.navigator as any).standalone === true ||
                            document.referrer.includes('android-app://');
      
      // 2. beforeinstallprompt 이벤트가 발생하지 않으면 이미 설치된 것으로 간주
      // (이벤트는 아직 등록되지 않았으므로 나중에 확인)
      
      // 3. localStorage 확인 (보조 수단)
      const localStorageInstalled = localStorage.getItem('pwa-installed') === 'true';
      
      // standalone 모드가 가장 정확한 지표
      const isInstalled = standaloneMode || localStorageInstalled;
      
      setIsStandalone(standaloneMode);
      setIsPWAInstalled(isInstalled);
      
      // standalone 모드면 localStorage에도 저장
      if (standaloneMode) {
        localStorage.setItem('pwa-installed', 'true');
      } else {
        // standalone 모드가 아니면 localStorage도 제거 (정확성 보장)
        localStorage.removeItem('pwa-installed');
      }
      
      console.log('[PWA 설치 상태 확인]', {
        standaloneMode,
        localStorageInstalled,
        isInstalled,
        referrer: document.referrer
      });
    };
    
    // 초기 확인
    checkPWAInstallStatus();
    
    // 주기적으로 재확인 (5초마다)
    const checkInterval = setInterval(checkPWAInstallStatus, 5000);
    
    // PWA 설치 프롬프트 감지
    const handleBeforeInstallPrompt = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e);
      console.log('[PWA] beforeinstallprompt 이벤트 발생, deferredPrompt 설정됨');
      // beforeinstallprompt가 발생하면 아직 설치되지 않은 것
      setIsPWAInstalled(false);
      // 설치 관련 localStorage 전체 초기화
      localStorage.removeItem('pwa-installed');
      localStorage.removeItem('pwa-install-dismissed');
      localStorage.removeItem('pwa-install-timestamp');
      console.log('[PWA] 설치 가능 상태 감지, localStorage 초기화');
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);

    return () => {
      clearInterval(checkInterval);
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    };
  }, [user, logoutMutation]);

  // handleInstallClick 함수를 먼저 정의 (useEffect보다 앞에)
  const handleInstallClick = useCallback(async () => {
    console.log('[앱 다운로드] 설치 버튼 클릭됨', { hasDeferredPrompt: !!deferredPrompt, isInApp: isInAppBrowser() });

    // Android 기기인 경우
    const isAndroidDevice = /Android/.test(navigator.userAgent);
    if (isAndroidDevice) {
      // 인앱 브라우저인 경우 Chrome으로 리다이렉트
      if (isInAppBrowser()) {
        const browserName = getInAppBrowserName() || '인앱 브라우저';
        toast.info(`${browserName}에서는 앱을 설치할 수 없습니다. Chrome으로 이동합니다...`, {
          duration: 3000,
        });
        
        // Chrome으로 리다이렉트 (설치 모드 파라미터 추가)
        const currentUrl = new URL(window.location.href);
        currentUrl.searchParams.set('install', 'true');
        currentUrl.searchParams.set('from', 'kakao');
        redirectToChrome(currentUrl.toString());
        return;
      }
      
      // Chrome 브라우저인 경우 - 모달 띄우기
      const isChromeBrowser = /Chrome/.test(navigator.userAgent) && !isInAppBrowser();
      if (isChromeBrowser) {
        setShowInstallModal(true);
        return;
      }
      
      // Chrome이 아닌 경우 Chrome으로 리다이렉트
      toast.info('Chrome 브라우저가 필요합니다. Chrome으로 이동합니다...', {
        duration: 3000,
      });
      
      const currentUrl = new URL(window.location.href);
      currentUrl.searchParams.set('install', 'true');
      redirectToChrome(currentUrl.toString());
      return;
    }

    // iOS 기기인 경우
    const isIOSDevice = /iPad|iPhone|iPod/.test(navigator.userAgent);
    if (isIOSDevice) {
      // 인앱 브라우저인 경우 Safari로 안내
      if (isInAppBrowser()) {
        const browserName = getInAppBrowserName() || '인앱 브라우저';
        toast.warning(`${browserName}에서는 앱을 설치할 수 없습니다. Safari 브라우저로 열어주세요.`, {
          duration: 5000,
        });
        return;
      }
      
      // Safari가 아닌 경우 Safari로 열기 안내
      const isSafariBrowser = /^((?!chrome|android).)*safari/i.test(navigator.userAgent);
      if (!isSafariBrowser) {
        toast.warning("Safari 브라우저로 열어주세요. Safari에서만 앱을 설치할 수 있습니다.", {
          duration: 5000,
        });
        return;
      }
      
      // Safari인 경우 설치 가이드 모달 표시 (iOS는 항상 수동 설치)
      setShowInstallModal(true);
      return;
    }

    // 기타 기기 (데스크톱 등)
    toast.info('모바일 기기에서 접속해주세요.');
  }, [deferredPrompt]);

  // install 파라미터가 있을 때 자동 설치 시도 (별도 함수)
  const handleAutoInstall = useCallback(async () => {
    if (!deferredPrompt) return;
    
    try {
      await deferredPrompt.prompt();
      const { outcome } = await deferredPrompt.userChoice;
      
      if (outcome === 'accepted') {
        toast.success('앱이 설치되었습니다! 홈 화면에서 확인하세요.', {
          duration: 2000,
        });
        setShowInstallBanner(false);
        localStorage.setItem('pwa-installed', 'true');
        setIsPWAInstalled(true);
        
        // 브라우저 창 닫기 시도 (Android/iOS 모두)
        setTimeout(() => {
          console.log('[PWA] 앱 설치 완료, 브라우저 창 닫기 시도');
          
          // Android: window.close() 시도
          window.close();
          
          // iOS: 창 닫기가 안 되면 사용자에게 안내
          setTimeout(() => {
            if (!window.closed) {
              toast.info('이 창을 닫고 홈 화면에서 앱을 실행하세요.', {
                duration: 5000,
              });
            }
          }, 500);
        }, 2000);
      }
      
      setDeferredPrompt(null);
    } catch (error) {
      console.error('[PWA] 자동 설치 오류:', error);
    }
  }, [deferredPrompt, setShowInstallBanner, setIsPWAInstalled]);

  // deferredPrompt가 설정되면 install 파라미터가 있을 때 자동 설치 시도
  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const fromKakao = urlParams.get('from') === 'kakao';
    const isInstallMode = urlParams.get('install') === 'true';
    
    if (isInstallMode) {
      // 설치 모드에서는 로그인 상태를 일시적으로 무시
      if (fromKakao) {
        sessionStorage.setItem('install-mode', 'true');
      }
      
      if (deferredPrompt) {
        console.log('[PWA] install 파라미터와 deferredPrompt 모두 감지, 자동 설치 시도');
        setTimeout(() => {
          handleAutoInstall();
        }, 1000); // Chrome 로드 대기 시간 증가
      } else if (fromKakao) {
        // 카톡에서 온 경우 deferredPrompt를 기다림
        console.log('[PWA] 카톡에서 Chrome으로 리다이렉트됨, deferredPrompt 대기');
        // 3초 후에도 deferredPrompt가 없으면 모달 표시
        const timeout = setTimeout(() => {
          if (!deferredPrompt) {
            console.log('[PWA] deferredPrompt 없음, 설치 모달 표시');
            setShowInstallModal(true);
            // install 모드 해제 (설치 완료 또는 실패)
            sessionStorage.removeItem('install-mode');
          }
        }, 3000);
        
        return () => clearTimeout(timeout);
      }
    } else {
      // install 모드가 아니면 install-mode 플래그 제거
      sessionStorage.removeItem('install-mode');
    }
  }, [deferredPrompt, handleAutoInstall]);
  
  // 설치 완료 후 install 모드 해제
  useEffect(() => {
    if (isPWAInstalled) {
      sessionStorage.removeItem('install-mode');
    }
  }, [isPWAInstalled]);

  // URL에 install 파라미터가 있으면 (크롬으로 리다이렉트된 경우) 자동 설치 시도
  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.get('install') === 'true') {
      console.log('[PWA] install 파라미터 감지, 설치 프로세스 시작');
      
      // beforeinstallprompt 이벤트를 기다림 (최대 3초)
      let promptReceived = false;
      const checkPrompt = setTimeout(() => {
        if (!promptReceived) {
          console.log('[PWA] beforeinstallprompt 이벤트가 발생하지 않음, 수동 설치 안내 표시');
          // 3초 후에도 프롬프트가 없으면 수동 설치 안내
          setShowInstallModal(true);
          // URL에서 install 파라미터 제거
          urlParams.delete('install');
          window.history.replaceState({}, '', window.location.pathname + (urlParams.toString() ? '?' + urlParams.toString() : ''));
        }
      }, 3000);

      // deferredPrompt가 설정되면 자동으로 설치 시도
      if (deferredPrompt) {
        promptReceived = true;
        clearTimeout(checkPrompt);
        console.log('[PWA] deferredPrompt 발견, 자동 설치 시도');
        setTimeout(() => {
          handleAutoInstall();
        }, 500);
      } else {
        // deferredPrompt를 기다리는 리스너
        const checkDeferredPrompt = setInterval(() => {
          if (deferredPrompt) {
            promptReceived = true;
            clearTimeout(checkPrompt);
            clearInterval(checkDeferredPrompt);
            console.log('[PWA] deferredPrompt 설정됨, 자동 설치 시도');
            setTimeout(() => {
              handleAutoInstall();
            }, 500);
          }
        }, 100);

        // 3초 후 체크 중단
        setTimeout(() => {
          clearInterval(checkDeferredPrompt);
        }, 3000);
      }

      return () => {
        clearTimeout(checkPrompt);
      };
    }
  }, [deferredPrompt, handleInstallClick]);

  return (
    <div className="min-h-screen bg-gradient-to-br from-orange-50 via-pink-50 to-purple-50">
      {/* 플로팅 프로모션 위젯 */}
      <FloatingPromoWidget landingUrl="#" />
      {/* Header */}
      <header className="border-b bg-white/80 backdrop-blur-md sticky top-0 z-50 shadow-sm">
        <div className="container mx-auto px-3 py-2 sm:px-4 sm:py-4">
          <div className="flex items-center justify-between">
            <Link href="/">
              <div className="flex items-center gap-2 cursor-pointer">
                <img 
                  src="/logo-bear-nobg.png" 
                  alt="마이쿠폰" 
                  className="w-10 h-10 sm:w-12 sm:h-12 animate-wave"
                />
                <span className="text-xl sm:text-2xl font-bold bg-gradient-to-r from-primary to-accent bg-clip-text text-transparent whitespace-nowrap">
                  마이쿠폰
                </span>
              </div>
            </Link>

          <div className="flex items-center gap-3">
            {/* 🎯 NEW: 팀 쿠폰/도장판 메뉴는 항상 표시 (로그인 여부 무관) */}
            <div className="hidden sm:flex items-center gap-4 text-sm">
              <Link href="/map">
                <span className="cursor-pointer hover:text-primary transition-colors">내 쿠폰 찾기</span>
              </Link>
              <span className="text-gray-300">|</span>
              <Link href="/district-stamps">
                <span className="cursor-pointer hover:text-primary transition-colors">도장판</span>
              </Link>
            </div>
            
            {/* install 모드에서는 로그인 상태를 일시적으로 무시 (설치에 집중) */}
            {user && !sessionStorage.getItem('install-mode') && !loading ? (
              <>
                {/* 일반 유저에게만 추가 메뉴 표시 */}
                {user.role === 'user' && !loading && (
                  <div className="hidden lg:flex items-center gap-4 text-sm">
                    <span className="text-gray-300">|</span>
                    <Link href="/my-coupons">
                      <span className="cursor-pointer hover:text-primary transition-colors">내 쿠폰북</span>
                    </Link>
                    <span className="text-gray-300">|</span>
                    <Link href="/gamification">
                      <span className="cursor-pointer hover:text-primary transition-colors">활동</span>
                    </Link>
                  </div>
                )}
                
                {/* 일반 유저에게만 알림 배지 표시 */}
                {user.role === 'user' && <NotificationBadge />}
                
                {/* 관리자/사장님에게는 관리자 버튼만 */}
                {(user.role === 'admin' || user.role === 'merchant') && (
                  <Link href="/admin">
                    <Button variant="outline" className="rounded-xl">
                      관리자
                    </Button>
                  </Link>
                )}
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="sm" className="rounded-full p-0 h-auto">
                      <div className="w-10 h-10 bg-gradient-to-br from-pink-400 to-purple-400 rounded-full flex items-center justify-center text-white font-bold shadow-lg cursor-pointer hover:opacity-80 transition-opacity">
                        {user.name?.[0] || 'U'}
                      </div>
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-48">
                    <div className="px-2 py-1.5 text-sm font-medium">{user.name}</div>
                    <div className="px-2 py-1 text-xs text-muted-foreground">{user.email}</div>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onClick={() => setLocation('/my-coupons')}>
                      <Gift className="w-4 h-4 mr-2" />
                      내 쿠폰북
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => setLocation('/gamification')}>
                      <User className="w-4 h-4 mr-2" />
                      마이쿠폰 활동
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => setLocation('/notification-settings')}>
                      <Bell className="w-4 h-4 mr-2" />
                      알림 설정
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem 
                      onClick={() => logoutMutation.mutate()}
                      className="text-red-600"
                    >
                      <LogOut className="w-4 h-4 mr-2" />
                      로그아웃
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </>
            ) : (
              <>
                {/* PWA가 설치되지 않았을 때만 앱 다운로드 버튼 표시 */}
                {/* Standalone 모드(홈화면에 추가됨)에서는 절대 표시 안 함 */}
                {!isStandalone && !isPWAInstalled && (
                  <div className="relative group">
                    <Button 
                      variant="outline" 
                      className="rounded-xl bg-gradient-to-r from-orange-400 via-pink-400 to-pink-500 text-white border-0 shadow-md hover:shadow-lg transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                      onClick={handleInstallClick}
                      disabled={isInstalling || loading}
                      style={{ pointerEvents: (isInstalling || loading) ? 'none' : 'auto', zIndex: 100 }}
                    >
                      {isInstalling ? (
                        <>
                          <div className="w-4 h-4 mr-2 border-2 border-white border-t-transparent rounded-full animate-spin" />
                          설치 중...
                        </>
                      ) : (
                        <>
                          <Download className="w-4 h-4 mr-2" />
                          앱 다운로드
                        </>
                      )}
                    </Button>
                    {/* 호버 시 툴팁 표시 */}
                    <div className="absolute top-full left-1/2 -translate-x-1/2 mt-2 px-4 py-2 bg-gray-900 text-white text-sm rounded-lg shadow-xl opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none whitespace-nowrap z-50">
                      <div className="flex items-center gap-2">
                        <Bell className="w-4 h-4" />
                        <span>30% 할인쿠폰 알림받기</span>
                      </div>
                      {/* 툴팁 화살표 */}
                      <div className="absolute -top-1 left-1/2 -translate-x-1/2 w-2 h-2 bg-gray-900 rotate-45"></div>
                    </div>
                  </div>
                )}
                <Button
                  onClick={() => {
                    // 🚨 CRITICAL FIX: 직접 하드코딩 (Railway 배포 확인용)
                    console.log('[Login] Button clicked - redirecting to Google OAuth');
                    window.location.href = '/api/oauth/google/login?redirect=' + encodeURIComponent(window.location.href);
                  }}
                  className="rounded-xl bg-gradient-to-r from-primary to-accent shadow-lg hover:shadow-xl transition-all"
                  disabled={loading}
                  style={{ pointerEvents: loading ? 'none' : 'auto' }}
                >
                  로그인
                </Button>
              </>
            )}
          </div>
        </div>
        </div>
      </header>



      {/* Hero Section */}
      <section className="relative w-full px-4 py-12 sm:py-20 text-center overflow-hidden">
        {/* Background Image */}
        <div className="absolute inset-0 z-0">
          <img
            src="/hero-background.png"
            alt="Hero Background"
            loading="lazy"
            className="w-full h-full object-cover opacity-30"
          />
        </div>
        <div className="max-w-4xl mx-auto space-y-8 relative z-10">
          <div className="inline-flex items-center gap-2 px-4 py-2 bg-white/80 rounded-full shadow-md backdrop-blur-sm">
            <Sparkles className="w-4 h-4 text-primary" />
            <span className="text-sm font-medium text-primary">20-40대가 가장 많이 사용하는 쿠폰 앱</span>
          </div>

          <h1 className="text-5xl sm:text-6xl font-bold leading-tight">
            <span className="bg-gradient-to-r from-primary via-accent to-pink-500 bg-clip-text text-transparent">
              우연히 만나는
            </span>
            <br />
            <span className="text-foreground">할인의 즐거움</span>
          </h1>

          <p className="text-xl text-muted-foreground max-w-2xl mx-auto">
            <strong className="text-gray-800">내 주변 100m부터 시작되는 특별한 할인</strong>
            <br />
            <span className="text-lg">GPS 기반으로 최대할인 쿠폰을 찾아드려요.</span>
          </p>

          <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
            <Link href="/map">
              <Button
                size="lg"
                className="rounded-2xl bg-gradient-to-r from-primary to-accent text-white px-8 py-6 text-lg font-bold shadow-2xl hover:shadow-3xl hover:scale-105 transition-all"
                disabled={loading}
              >
                <MapPin className="w-6 h-6 mr-2" />
                내 주변 쿠폰 찾기
              </Button>
            </Link>
          </div>

          {/* Stats - 네모 박스로 강조 */}
          <div className="grid grid-cols-3 gap-4 max-w-3xl mx-auto pt-12">
            <Card className="bg-white/90 backdrop-blur-sm border-2 border-primary/20 shadow-lg">
              <CardContent className="p-6 text-center space-y-2">
                <Store className="w-8 h-8 text-primary mx-auto" />
                <div className="text-3xl font-bold text-primary">8+</div>
                <div className="text-sm text-muted-foreground font-medium">제휴 매장</div>
              </CardContent>
            </Card>
            <Card className="bg-white/90 backdrop-blur-sm border-2 border-accent/20 shadow-lg">
              <CardContent className="p-6 text-center space-y-2">
                <Ticket className="w-8 h-8 text-accent mx-auto" />
                <div className="text-3xl font-bold text-accent">100+</div>
                <div className="text-sm text-muted-foreground font-medium">발행 쿠폰</div>
              </CardContent>
            </Card>
            <Card className="bg-white/90 backdrop-blur-sm border-2 border-pink-500/20 shadow-lg">
              <CardContent className="p-6 text-center space-y-2">
                <Percent className="w-8 h-8 text-pink-500 mx-auto" />
                <div className="text-3xl font-bold text-pink-500">50%</div>
                <div className="text-sm text-muted-foreground font-medium">평균 할인율</div>
              </CardContent>
            </Card>
          </div>
        </div>
      </section>

      {/* Features Section - 간소화 */}
      <section className="w-full px-4 py-20">
        <div className="text-center mb-16">
          <h2 className="text-4xl font-bold mb-4">
            <span className="bg-gradient-to-r from-primary to-accent bg-clip-text text-transparent">
              왜 마이쿠폰일까요?
            </span>
          </h2>
          <p className="text-lg text-muted-foreground">
            GPS 기반 실시간 거리 표시로 가장 가까운 쿠폰을 찾아드려요
          </p>
        </div>

        <div className="grid md:grid-cols-3 gap-8 max-w-6xl mx-auto">
          <Card className="border-2 border-primary/20 hover:border-primary/40 transition-all hover:shadow-xl rounded-3xl overflow-hidden group relative">
            <CardContent className="p-8 space-y-4">
              {/* Card Background Image */}
              <div className="absolute inset-0 z-0 opacity-10">
                <img src="/gps-card.png" alt="GPS" className="w-full h-full object-contain" loading="lazy" />
              </div>
              <div className="relative z-10 w-16 h-16 bg-gradient-to-br from-primary to-accent rounded-2xl flex items-center justify-center group-hover:scale-110 transition-transform">
                <MapPin className="w-8 h-8 text-white" />
              </div>
              <h3 className="text-2xl font-bold relative z-10">GPS 거리 정보</h3>
              <p className="text-muted-foreground relative z-10">
                "50m 앞", "200m 앞" 실시간 거리 표시로 가까운 쿠폰을 바로 찾아요
              </p>
            </CardContent>
          </Card>

          <Card className="border-2 border-accent/20 hover:border-accent/40 transition-all hover:shadow-xl rounded-3xl overflow-hidden group relative">
            <CardContent className="p-8 space-y-4">
              {/* Card Background Image */}
              <div className="absolute inset-0 z-0 opacity-10">
                <img src="/ai-card.png" alt="AI" className="w-full h-full object-contain" loading="lazy" />
              </div>
              <div className="relative z-10 w-16 h-16 bg-gradient-to-br from-accent to-pink-500 rounded-2xl flex items-center justify-center group-hover:scale-110 transition-transform">
                <Sparkles className="w-8 h-8 text-white" />
              </div>
              <h3 className="text-2xl font-bold relative z-10">AI 개인화 추천</h3>
              <p className="text-muted-foreground relative z-10">
                내가 자주 가는 카페, 좋아하는 음식점 쿠폰을 우선 추천해드려요
              </p>
            </CardContent>
          </Card>

        </div>
      </section>

      {/* For Merchants Section - 개선된 레이아웃 */}
      <section className="w-full px-4 py-20">
        <div className="max-w-5xl mx-auto">
          <div className="bg-gradient-to-br from-orange-100 to-pink-100 rounded-3xl p-12 space-y-8 relative overflow-hidden">
            {/* Background Image */}
            <div className="absolute inset-0 z-0">
              <img src="/merchant-section-bg.png" alt="Merchant" className="w-full h-full object-cover opacity-30" loading="lazy" />
            </div>
            
            <div className="text-center space-y-4 relative z-10">
              <h2 className="text-4xl font-bold">사장님을 위한 특별한 혜택</h2>
              <p className="text-xl text-muted-foreground">
                저희는 <span className="font-bold text-primary">손님을 먼저 만들어드립니다</span>
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 md:gap-6 relative z-10">
              <Card className="bg-white/90 backdrop-blur-sm border-2 rounded-2xl hover:shadow-lg transition-shadow">
                <CardContent className="p-6 md:p-8 space-y-3 md:space-y-4">
                  <div className="flex items-center gap-3">
                    <img src="/icon-performance-pay-nobg.png" alt="성과형 과금" className="w-12 h-12 md:w-14 md:h-14" loading="lazy" />
                    <h3 className="text-lg md:text-xl font-bold">성과형 과금</h3>
                  </div>
                  <p className="text-muted-foreground text-sm md:text-base">
                    쿠폰 사용 1건당 1,000원
                    <br />
                    <span className="font-bold text-primary">방문 없으면 0원!</span>
                  </p>
                </CardContent>
              </Card>

              <Card className="bg-white/90 backdrop-blur-sm border-2 rounded-2xl hover:shadow-lg transition-shadow">
                <CardContent className="p-6 md:p-8 space-y-3 md:space-y-4">
                  <div className="flex items-center gap-3">
                    <img src="/icon-free-start-nobg.png" alt="초기 비용 무료" className="w-12 h-12 md:w-14 md:h-14" loading="lazy" />
                    <h3 className="text-lg md:text-xl font-bold">초기 비용 무료</h3>
                  </div>
                  <p className="text-muted-foreground text-sm md:text-base">
                    가입비 0원
                    <br />
                    <span className="font-bold text-green-600">월 관리비도 0원!</span>
                  </p>
                </CardContent>
              </Card>

              <Card className="bg-white/90 backdrop-blur-sm border-2 rounded-2xl hover:shadow-lg transition-shadow">
                <CardContent className="p-6 md:p-8 space-y-3 md:space-y-4">
                  <div className="flex items-center gap-3">
                    <img src="/icon-analytics-nobg.png" alt="실시간 분석" className="w-12 h-12 md:w-14 md:h-14" loading="lazy" />
                    <h3 className="text-lg md:text-xl font-bold">실시간 분석</h3>
                  </div>
                  <p className="text-muted-foreground text-sm md:text-base">
                    쿠폰 발행/사용 현황
                    <br />
                    <span className="font-bold text-pink-600">ROI 한눈에 확인!</span>
                  </p>
                </CardContent>
              </Card>

              <Card className="bg-white/90 backdrop-blur-sm border-2 rounded-2xl hover:shadow-lg transition-shadow">
                <CardContent className="p-6 md:p-8 space-y-3 md:space-y-4">
                  <div className="flex items-center gap-3">
                    <img src="/icon-gps-targeting-nobg.png" alt="GPS 타겟팅" className="w-12 h-12 md:w-14 md:h-14" loading="lazy" />
                    <h3 className="text-lg md:text-xl font-bold">GPS 타겟팅</h3>
                  </div>
                  <p className="text-muted-foreground text-sm md:text-base">
                    근처 고객에게
                    <br />
                    <span className="font-bold text-purple-600">자동 쿠폰 노출!</span>
                  </p>
                </CardContent>
              </Card>
            </div>

            <div className="text-center relative z-10">
              <Button
                size="lg"
                className="rounded-2xl bg-gradient-to-r from-primary to-accent text-white px-10 py-7 text-xl font-bold shadow-xl hover:shadow-2xl hover:scale-105 transition-all"
                onClick={() => {
                  if (!user) {
                    // 비로그인 상태 - 직접 하드코딩
                    console.log('[사장님 버튼] Redirecting to Google OAuth');
                    window.location.href = '/api/oauth/google/login?redirect=' + encodeURIComponent(window.location.href);
                  } else if (user.role === 'merchant' || user.role === 'admin') {
                    // 사장님 또는 관리자 권한
                    setLocation('/merchant/dashboard');
                  } else {
                    // 일반 사용자
                    toast.info('사장님 서비스는 별도 신청이 필요합니다', {
                      description: '관리자에게 문의해주세요.',
                      duration: 4000,
                    });
                  }
                }}
              >
                사장님 시작하기
              </Button>
            </div>
          </div>
        </div>
      </section>

      {/* CTA Section - 개선된 레이아웃 */}
      <section className="w-full px-4 py-20 relative overflow-hidden">
        {/* Background Image */}
        <div className="absolute inset-0 z-0">
          <img src="/cta-section-bg.png" alt="CTA" className="w-full h-full object-cover opacity-40" loading="lazy" />
        </div>
        <div className="max-w-4xl mx-auto relative z-10">
          <Card className="bg-white/90 backdrop-blur-sm border-2 border-primary/20 shadow-2xl" style={{borderRadius: '1.5rem'}}>
            <CardContent className="p-8 md:p-12 text-center space-y-6 md:space-y-8">
              <h2 className="text-3xl md:text-5xl font-bold leading-tight">
                지금 우리동네 쿠폰을
                <br />
                다운로드하세요
              </h2>
              <div className="space-y-3">
                <p className="text-xl md:text-2xl font-bold text-primary">
                  가입 무료 · 앱 다운로드 필요 없음
                </p>
                <p className="text-lg md:text-xl text-muted-foreground">
                  웹브라우저에서 지금 바로 사용 가능해요
                </p>
              </div>
              <Link href="/map">
                <Button
                  size="lg"
                  className="rounded-2xl bg-gradient-to-r from-primary to-accent text-white px-10 md:px-14 py-6 md:py-8 text-lg md:text-2xl font-bold shadow-2xl hover:shadow-3xl hover:scale-105 transition-all w-full md:w-auto"
                  disabled={loading}
                  style={{ pointerEvents: loading ? 'none' : 'auto' }}
                >
                  <Heart className="w-6 h-6 md:w-7 md:h-7 mr-2 md:mr-3 fill-white" />
                  내 주변 쿠폰 찾기
                </Button>
              </Link>
            </CardContent>
          </Card>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t bg-white/80 backdrop-blur-md mt-20">
        <div className="container mx-auto px-4 py-8 text-center text-sm text-muted-foreground">
          <p>© 2024 마이쿠폰. All rights reserved.</p>
          <p className="mt-2">걷다가 만나는 할인의 즐거움</p>
        </div>
      </footer>

      {/* 설치 안내 모달 (iOS Safari 전용) */}
      <InstallModal 
        open={showInstallModal} 
        onOpenChange={setShowInstallModal}
        landingUrl={window.location.origin}
      />
    </div>
  );
}
