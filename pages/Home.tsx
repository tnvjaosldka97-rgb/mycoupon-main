import { useAuth } from '@/_core/hooks/useAuth';
import { useState, useEffect, useCallback, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
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
import { InstallModeRestartModal } from "@/components/InstallModeRestartModal";
import { isInAppBrowser, redirectToChrome, getInAppBrowserName } from "@/lib/browserDetect";

export default function Home() {
  const { user, loading } = useAuth();
  const [location, setLocation] = useLocation();
  const loginClickRef = useRef(false);
  const searchClickRef = useRef(false);
  const [isReady, setIsReady] = useState(false);
  
  // PWA standalone 모드 감지 및 초기화 - 버튼이 즉시 작동하도록 보장 (강화된 안정화 체크)
  useEffect(() => {
    // install 모드일 때는 즉시 ready 설정 (버튼이 바로 작동하도록)
    const installMode = sessionStorage.getItem('install-mode');
    if (installMode) {
      console.log('[Home] install 모드 감지, 즉시 ready 설정');
      setIsReady(true);
      return;
    }
    
    const isStandalone = window.matchMedia('(display-mode: standalone)').matches || 
                        (window.navigator as any).standalone || 
                        document.referrer.includes('android-app://');
    
    // 안정화 상태 체크 함수
    const checkStability = () => {
      // 1. DOM이 완전히 로드되었는지 확인
      const domReady = document.readyState === 'complete' || document.readyState === 'interactive';
      
      // 2. React가 마운트되었는지 확인
      const reactMounted = document.getElementById('root')?.hasChildNodes() || false;
      
      // 3. Service Worker 상태 확인
      const swReady = !('serviceWorker' in navigator) || 
                     navigator.serviceWorker.controller !== null ||
                     navigator.serviceWorker.ready !== undefined;
      
      // 4. 이벤트 리스너가 등록될 수 있는지 확인
      const canAttachEvents = typeof window.addEventListener === 'function';
      
      return domReady && reactMounted && swReady && canAttachEvents;
    };
    
    if (isStandalone) {
      console.log('[Home] PWA standalone 모드 감지, 초기화 시작 (강화된 안정화 체크)');
      
      // 즉시 안정화 상태 체크
      if (checkStability()) {
        console.log('[Home] 즉시 안정화 상태 확인, ready 설정');
        setIsReady(true);
        return;
      }
      
      // Service Worker가 ready 상태가 될 때까지 기다림
      if ('serviceWorker' in navigator) {
        const swReadyPromise = navigator.serviceWorker.ready.then(() => {
          console.log('[Home] Service Worker ready');
          return true;
        }).catch(() => {
          console.log('[Home] Service Worker ready 실패, 그래도 진행');
          return true;
        });
        
        // DOMContentLoaded 이벤트 대기
        const domReadyPromise = new Promise<boolean>((resolve) => {
          if (document.readyState === 'complete' || document.readyState === 'interactive') {
            resolve(true);
          } else {
            document.addEventListener('DOMContentLoaded', () => resolve(true), { once: true });
          }
        });
        
        // 모든 조건이 만족되면 ready 설정
        Promise.all([swReadyPromise, domReadyPromise]).then(() => {
          if (checkStability()) {
            console.log('[Home] 모든 안정화 조건 만족, ready 설정');
            setIsReady(true);
          }
        });
      } else {
        // Service Worker가 없어도 DOM만 준비되면 진행
        if (document.readyState === 'complete' || document.readyState === 'interactive') {
          setIsReady(true);
        } else {
          document.addEventListener('DOMContentLoaded', () => setIsReady(true), { once: true });
        }
      }
      
      // 최대 500ms 후에는 무조건 ready로 설정 (타임아웃 안전장치 - 더 빠르게)
      setTimeout(() => {
        setIsReady(true);
      }, 500);
    } else {
      // 일반 브라우저 모드에서는 즉시 ready (성능 최적화)
      setIsReady(true);
    }
  }, []);
  
  // 버튼 즉시 활성화 보장 (추가 안전장치)
  useEffect(() => {
    // DOM이 준비되면 즉시 ready
    if (document.readyState !== 'loading') {
      setIsReady(true);
    }
  }, []);
  
  // 전역 상태 및 경로 동기화: 페이지 로드 직후 인증 상태 즉시 반영
  useEffect(() => {
    // 서비스 워커나 이전 캐시 때문에 씹히지 않도록 강제로 인증 상태 확인
    if (!loading) {
      console.log('[Home] 페이지 로드 완료, 인증 상태:', user ? '로그인됨' : '로그인 안 됨');
    }
  }, [user, loading]);
  
  // 멈춤 상태 초기화: 페이지 로드 시 이전 상태 정리
  useEffect(() => {
    // 이전 세션의 멈춤 상태 제거
    const wasStuck = sessionStorage.getItem('pwa-was-stuck');
    if (wasStuck) {
      console.log('[Home] 이전 멈춤 상태 감지, 상태 초기화');
      sessionStorage.removeItem('pwa-was-stuck');
      // 인증 상태도 강제로 다시 확인
      if (!loading && !user) {
        // 사용자 정보가 없으면 즉시 refetch
        setTimeout(() => {
          window.location.reload();
        }, 500);
      }
    }
  }, [user, loading]);
  const [deferredPrompt, setDeferredPrompt] = useState<any>(null);
  const [showInstallBanner, setShowInstallBanner] = useState(false);
  const [showInstallModal, setShowInstallModal] = useState(false);
  const [showInstallModeRestartModal, setShowInstallModeRestartModal] = useState(false);
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
        localStorage.removeItem('pwa-installed');
      }
      
      // install 모드 해제
      sessionStorage.removeItem('install-mode');
      
      // 페이지 새로고침 없이 상태만 업데이트 (성능 최적화)
      // React가 자동으로 UI를 업데이트하므로 새로고침 불필요
      console.log('[Home] 로그아웃 완료, 상태 업데이트 (새로고침 없이)');
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
        
        // install 모드일 때는 즉시 ready 설정 (버튼이 바로 작동하도록)
        setIsReady(true);
        console.log('[Home] install 모드: 즉시 ready 설정 완료');
        
        // install 모드에서 일정 시간 후 버튼이 작동하지 않으면 안내 모달 표시
        const installModeCheckTimer = setTimeout(() => {
          // 10초 후에도 install 모드이고 PWA가 설치되지 않았으면 안내 모달 표시
          const stillInInstallMode = sessionStorage.getItem('install-mode');
          const isStandaloneMode = window.matchMedia('(display-mode: standalone)').matches;
          
          if (stillInInstallMode && !isStandaloneMode) {
            console.log('[Home] install 모드 타임아웃, 안내 모달 표시');
            setShowInstallModeRestartModal(true);
          }
        }, 10000); // 10초 후 체크
        
        // deferredPrompt를 더 적극적으로 확인 (즉시 체크 + 주기적 체크)
        const checkDeferredPrompt = () => {
          // 이미 설정되어 있으면 바로 사용
          if (deferredPrompt) {
            console.log('[Home] deferredPrompt 이미 설정됨');
            clearTimeout(installModeCheckTimer);
            return;
          }
          
          // beforeinstallprompt 이벤트가 아직 발생하지 않았을 수 있으므로
          // 최대 3초간 기다리면서 주기적으로 확인
          let checkCount = 0;
          const maxChecks = 30; // 3초간 100ms마다 체크
          
          const interval = setInterval(() => {
            checkCount++;
            // deferredPrompt는 useEffect에서 설정되므로 여기서는 로그만
            console.log(`[Home] deferredPrompt 확인 중... (${checkCount}/${maxChecks})`);
            
            if (checkCount >= maxChecks) {
              clearInterval(interval);
              console.log('[Home] deferredPrompt 확인 완료 (타임아웃 또는 설정됨)');
            }
          }, 100);
          
          // cleanup 함수에서 타이머 정리
          return () => {
            clearTimeout(installModeCheckTimer);
          };
        };
        
        // 즉시 체크 시작
        setTimeout(checkDeferredPrompt, 100);
        
        console.log('[Home] 설치 모드 활성화 완료, 버튼 클릭 가능');
      }
      
      // install 파라미터는 유지 (deferredPrompt 대기용)
      // 새로고침하지 않음 (Chrome에서 바로 설치 팝업이 뜨도록)
    }
    
    // 카톡 인앱 브라우저는 App.tsx에서 모달로 처리하므로 여기서는 리다이렉트하지 않음
    
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
    
    // PWA 설치 프롬프트 감지 (더 빠르게 감지하도록 개선)
    const handleBeforeInstallPrompt = (e: Event) => {
      e.preventDefault();
      const promptEvent = e as any;
      setDeferredPrompt(promptEvent);
      console.log('[PWA] ✅ beforeinstallprompt 이벤트 발생, deferredPrompt 설정됨');
      // beforeinstallprompt가 발생하면 아직 설치되지 않은 것
      setIsPWAInstalled(false);
      localStorage.removeItem('pwa-installed');
      
      // install 모드이고 카톡에서 온 경우 즉시 자동 설치 프롬프트 표시
      const urlParams = new URLSearchParams(window.location.search);
      const fromKakao = urlParams.get('from') === 'kakao';
      const isInstallMode = sessionStorage.getItem('install-mode') || urlParams.get('install') === 'true';
      
      if (isInstallMode && fromKakao) {
        console.log('[PWA] 🚀 카톡→크롬 리다이렉트: deferredPrompt 설정 완료, 즉시 자동 설치 프롬프트 표시');
        
        // 즉시 설치 프롬프트 표시 (requestAnimationFrame으로 최대한 빠르게, 브라우저 렌더링 사이클과 동기화)
        requestAnimationFrame(async () => {
          try {
            console.log('[PWA] 설치 프롬프트 표시 시작');
            setIsInstalling(true);
            
            await promptEvent.prompt();
            const { outcome } = await promptEvent.userChoice;
            
            console.log('[PWA] 사용자 선택:', outcome);
            
            if (outcome === 'accepted') {
              toast.success('앱이 설치되었습니다! 홈 화면에서 확인하세요.');
              setShowInstallBanner(false);
              localStorage.setItem('pwa-installed', 'true');
              setIsPWAInstalled(true);
              sessionStorage.removeItem('install-mode');
              
              setTimeout(() => {
                document.documentElement.classList.remove('dark');
                document.body.classList.remove('dark');
                document.body.style.backgroundColor = '#FFF5F0';
                document.body.style.color = '#000000';
              }, 100);
            } else {
              console.log('[PWA] 사용자가 설치를 취소했습니다.');
              toast.info('앱 설치를 취소하셨습니다. 나중에 다시 시도해주세요.');
            }
            
            setDeferredPrompt(null);
            setIsInstalling(false);
          } catch (error) {
            console.error('[PWA] 자동 설치 프롬프트 오류:', error);
            toast.error('앱 설치 중 오류가 발생했습니다. 페이지를 새로고침한 후 다시 시도해주세요.');
            setIsInstalling(false);
          }
        }); // requestAnimationFrame 사용 - 브라우저 렌더링 사이클과 동기화하여 최대한 빠르게
      } else if (isInstallMode) {
        console.log('[PWA] ✅ install 모드에서 deferredPrompt 설정 완료! 앱 다운로드 버튼 활성화');
        toast.success('앱을 설치할 준비가 되었습니다!');
      }
    };

    // 이벤트 리스너를 즉시 등록 (페이지 로드 전에도 감지 가능하도록)
    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    
    // install 모드일 때는 deferredPrompt를 더 적극적으로 확인
    if (sessionStorage.getItem('install-mode')) {
      console.log('[PWA] install 모드 감지, deferredPrompt 확인 시작');
      // 이미 발생한 이벤트가 있을 수 있으므로 즉시 확인
      setTimeout(() => {
        // deferredPrompt는 비동기로 설정되므로 여기서는 로그만
        console.log('[PWA] install 모드: deferredPrompt 확인 중...');
      }, 500);
    }

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
      
      // Chrome 브라우저인 경우
      const isChromeBrowser = /Chrome/.test(navigator.userAgent) && !isInAppBrowser();
      if (isChromeBrowser) {
        // deferredPrompt가 있으면 즉시 설치 프롬프트 표시
        if (deferredPrompt) {
          console.log('[앱 다운로드] deferredPrompt 발견, 즉시 설치 프롬프트 표시');
          setIsInstalling(true);
          
          try {
            // 설치 프롬프트 표시
            await deferredPrompt.prompt();
            const { outcome } = await deferredPrompt.userChoice;
            
            console.log('[앱 다운로드] 사용자 선택:', outcome);
            
            if (outcome === 'accepted') {
              toast.success('앱이 설치되었습니다! 홈 화면에서 확인하세요.');
              setShowInstallBanner(false);
              localStorage.setItem('pwa-installed', 'true');
              setIsPWAInstalled(true);
              sessionStorage.removeItem('install-mode');
              
              // 설치 완료 후 상태 업데이트
              setTimeout(() => {
                document.documentElement.classList.remove('dark');
                document.body.classList.remove('dark');
                document.body.style.backgroundColor = '#FFF5F0';
                document.body.style.color = '#000000';
              }, 100);
            } else {
              console.log('[앱 다운로드] 사용자가 설치를 취소했습니다.');
              toast.info('앱 설치를 취소하셨습니다. 나중에 다시 시도해주세요.');
            }
            
            // deferredPrompt는 한 번만 사용 가능하므로 null로 설정
            setDeferredPrompt(null);
            setIsInstalling(false);
          } catch (error) {
            console.error('[앱 다운로드] 설치 프롬프트 오류:', error);
            toast.error('앱 설치 중 오류가 발생했습니다. 페이지를 새로고침한 후 다시 시도해주세요.');
            setIsInstalling(false);
            
            // 오류 발생 시 모달 표시 (수동 설치 가이드)
            setTimeout(() => {
              setShowInstallModal(true);
            }, 1000);
          }
          return;
        } else {
          // deferredPrompt가 없으면 모달 표시 (수동 설치 가이드)
          console.log('[앱 다운로드] deferredPrompt 없음, 설치 모달 표시');
          setShowInstallModal(true);
          return;
        }
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
  }, [deferredPrompt, setIsInstalling, setShowInstallBanner, setIsPWAInstalled]);

  // install 파라미터가 있을 때 자동 설치 시도 (별도 함수)
  const handleAutoInstall = useCallback(async () => {
    if (!deferredPrompt) {
      console.log('[PWA] handleAutoInstall: deferredPrompt 없음');
      return;
    }
    
    console.log('[PWA] 🚀 handleAutoInstall: 자동 설치 프롬프트 표시 시작');
    setIsInstalling(true);
    
    try {
      // 설치 프롬프트 표시
      await deferredPrompt.prompt();
      const { outcome } = await deferredPrompt.userChoice;
      
      console.log('[PWA] handleAutoInstall: 사용자 선택:', outcome);
      
      if (outcome === 'accepted') {
        toast.success('앱이 설치되었습니다! 홈 화면에서 확인하세요.');
        setShowInstallBanner(false);
        localStorage.setItem('pwa-installed', 'true');
        setIsPWAInstalled(true);
        sessionStorage.removeItem('install-mode');
        
        setTimeout(() => {
          document.documentElement.classList.remove('dark');
          document.body.classList.remove('dark');
          document.body.style.backgroundColor = '#FFF5F0';
          document.body.style.color = '#000000';
        }, 100);
      } else {
        console.log('[PWA] handleAutoInstall: 사용자가 설치를 취소했습니다.');
        toast.info('앱 설치를 취소하셨습니다. 나중에 다시 시도해주세요.');
      }
      
      // deferredPrompt는 한 번만 사용 가능하므로 null로 설정
      setDeferredPrompt(null);
      setIsInstalling(false);
    } catch (error) {
      console.error('[PWA] handleAutoInstall: 자동 설치 오류:', error);
      toast.error('앱 설치 중 오류가 발생했습니다. 페이지를 새로고침한 후 다시 시도해주세요.');
      setIsInstalling(false);
      
      // 오류 발생 시 모달 표시 (수동 설치 가이드)
      setTimeout(() => {
        setShowInstallModal(true);
      }, 1000);
    }
  }, [deferredPrompt, setIsInstalling, setShowInstallBanner, setIsPWAInstalled]);

  // deferredPrompt가 설정되면 install 파라미터가 있을 때 자동 설치 시도 (카톡→크롬 리다이렉트 시)
  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const fromKakao = urlParams.get('from') === 'kakao';
    const isInstallMode = urlParams.get('install') === 'true';
    
    if (isInstallMode && fromKakao) {
      // 카톡에서 온 경우 install-mode 플래그 설정
      sessionStorage.setItem('install-mode', 'true');
      
      // deferredPrompt가 이미 설정되어 있으면 즉시 자동 설치 시도
      if (deferredPrompt) {
        console.log('[PWA] 🚀 카톡→크롬: deferredPrompt 이미 설정됨, 즉시 자동 설치 시도');
        // requestAnimationFrame으로 최대한 빠르게 실행 (브라우저 렌더링 사이클과 동기화)
        requestAnimationFrame(() => {
          handleAutoInstall();
        });
      } else {
        // deferredPrompt가 아직 설정되지 않았으면 주기적으로 체크 (매우 빠르게)
        console.log('[PWA] 카톡→크롬: deferredPrompt 대기 중...');
        
        let checkCount = 0;
        const maxChecks = 100; // 최대 5초간 체크 (50ms * 100)
        
        const checkInterval = setInterval(() => {
          checkCount++;
          
          if (deferredPrompt) {
            console.log('[PWA] 🚀 카톡→크롬: deferredPrompt 감지 완료! 즉시 자동 설치 시도');
            clearInterval(checkInterval);
            // requestAnimationFrame으로 최대한 빠르게 실행 (브라우저 렌더링 사이클과 동기화)
            requestAnimationFrame(() => {
              handleAutoInstall();
            });
          } else if (checkCount >= maxChecks) {
            // 2초 후에도 deferredPrompt가 없으면 모달 표시
            console.log('[PWA] deferredPrompt 타임아웃 (2초), 설치 모달 표시');
            clearInterval(checkInterval);
            setShowInstallModal(true);
            sessionStorage.removeItem('install-mode');
          }
        }, 10); // 10ms마다 체크 (최대한 빠르게)
        
        return () => clearInterval(checkInterval);
      }
    } else if (isInstallMode) {
      // 일반 install 모드 (카톡이 아닌 경우)
      if (deferredPrompt) {
        console.log('[PWA] install 파라미터와 deferredPrompt 모두 감지, 자동 설치 시도');
        setTimeout(() => {
          handleAutoInstall();
        }, 500);
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
        // deferredPrompt를 기다리는 리스너 (더 적극적으로)
        const checkDeferredPrompt = setInterval(() => {
          if (deferredPrompt) {
            promptReceived = true;
            clearTimeout(checkPrompt);
            clearInterval(checkDeferredPrompt);
            console.log('[PWA] deferredPrompt 설정됨, 자동 설치 시도');
            
            // install 모드일 때는 즉시 설치 시도
            if (sessionStorage.getItem('install-mode')) {
              console.log('[PWA] install 모드에서 즉시 설치 시도');
              setTimeout(() => {
                handleAutoInstall();
              }, 300); // 더 빠르게 실행
            } else {
              setTimeout(() => {
                handleAutoInstall();
              }, 500);
            }
          }
        }, 50); // 100ms -> 50ms로 더 빠르게 체크

        // 5초 후 체크 중단 (3초 -> 5초로 연장)
        setTimeout(() => {
          clearInterval(checkDeferredPrompt);
          if (!promptReceived) {
            console.log('[PWA] deferredPrompt 타임아웃, 수동 설치 안내');
            // install 모드일 때는 모달 표시
            if (sessionStorage.getItem('install-mode')) {
              setShowInstallModal(true);
            }
          }
        }, 5000);
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
            <div 
              onClick={(e) => {
                e.preventDefault();
                if (location !== '/') {
                  setLocation('/');
                }
                // 이미 "/" 경로에 있으면 아무것도 하지 않음 (프리징 방지)
              }}
              className="flex items-center gap-2 cursor-pointer"
            >
              <img 
                src="/logo-bear-nobg.png" 
                alt="마이쿠폰" 
                className="w-10 h-10 sm:w-12 sm:h-12 animate-wave"
              />
              <span className="text-xl sm:text-2xl font-bold bg-gradient-to-r from-primary to-accent bg-clip-text text-transparent whitespace-nowrap">
                마이쿠폰
              </span>
            </div>

          <div className="flex items-center gap-3">
            {/* install 모드에서는 로그인 상태를 일시적으로 무시 (설치에 집중) */}
            {user && !sessionStorage.getItem('install-mode') && !loading ? (
              <>
                {/* 일반 유저에게만 메뉴 3개 표시 */}
                {user.role === 'user' && !loading && (
                  <div className="hidden sm:flex items-center gap-4 text-sm">
                    <Link href="/map">
                      <span className="cursor-pointer hover:text-primary transition-colors">내 쿠폰 찾기</span>
                    </Link>
                    <span className="text-gray-300">|</span>
                    <Link href="/my-coupons">
                      <span className="cursor-pointer hover:text-primary transition-colors">내 쿠폰북</span>
                    </Link>
                    <span className="text-gray-300">|</span>
                    <Link href="/gamification">
                      <span className="cursor-pointer hover:text-primary transition-colors">마이쿠폰 활동</span>
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
                {/* install 모드일 때도 버튼 표시 (설치에 집중) */}
                {(!isPWAInstalled || sessionStorage.getItem('install-mode')) && (
                  <Button 
                    variant="outline" 
                    className="rounded-xl bg-gradient-to-r from-orange-400 via-pink-400 to-pink-500 text-white border-0 shadow-md hover:shadow-lg transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      console.log('[Home] 앱 다운로드 버튼 클릭됨', { isInstalling, loading, deferredPrompt: !!deferredPrompt, installMode: sessionStorage.getItem('install-mode') });
                      
                      // install 모드일 때는 모든 체크 건너뛰고 즉시 실행
                      const installMode = sessionStorage.getItem('install-mode');
                      if (installMode) {
                        console.log('[Home] install 모드: 즉시 설치 시도');
                        if (isInstalling) {
                          console.log('[Home] 이미 설치 중');
                          return;
                        }
                        
                        // install 모드에서 버튼 클릭 실패 시 안내 모달 표시를 위한 타이머
                        const installClickTimer = setTimeout(() => {
                          // 5초 후에도 설치가 진행되지 않으면 안내 모달 표시
                          const stillInInstallMode = sessionStorage.getItem('install-mode');
                          const isStandaloneMode = window.matchMedia('(display-mode: standalone)').matches;
                          const isInstallingNow = isInstalling;
                          
                          if (stillInInstallMode && !isStandaloneMode && !isInstallingNow) {
                            console.log('[Home] install 모드 버튼 클릭 타임아웃, 안내 모달 표시');
                            setShowInstallModeRestartModal(true);
                          }
                        }, 5000); // 5초 후 체크 (더 여유있게)
                        
                        // handleInstallClick 실행
                        handleInstallClick().finally(() => {
                          clearTimeout(installClickTimer);
                        });
                        return;
                      }
                      
                      if (!isReady) {
                        console.log('[Home] PWA 아직 준비 중');
                        toast.info('앱을 준비하는 중입니다... 잠시 후 다시 시도해주세요.');
                        return;
                      }
                      
                      if (isInstalling || loading) {
                        console.log('[Home] 이미 설치 중이거나 로딩 중');
                        return;
                      }
                      
                      handleInstallClick();
                    }}
                    disabled={false}
                    style={{ 
                      pointerEvents: 'auto', 
                      zIndex: 1000,
                      cursor: 'pointer',
                      position: 'relative'
                    }}
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
                )}
                <Button
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    
                    // 중복 클릭 방지 (즉시 체크)
                    if (loginClickRef.current) {
                      return;
                    }
                    loginClickRef.current = true;
                    
                    // 즉시 리다이렉트 (모든 체크 제거, 성능 최적화)
                    const loginUrl = getLoginUrl();
                    window.location.href = loginUrl;
                    
                    // 1초 후 플래그 리셋 (리다이렉트 실패 대비)
                    setTimeout(() => {
                      loginClickRef.current = false;
                    }, 1000);
                  }}
                  className="rounded-xl bg-gradient-to-r from-primary to-accent shadow-lg hover:shadow-xl transition-all"
                  disabled={false}
                  style={{ 
                    cursor: 'pointer', 
                    pointerEvents: 'auto',
                    zIndex: 1000,
                    position: 'relative'
                  }}
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
            내 주변 50m부터 시작되는 특별한 할인!
            <br />
            GPS 기반으로 가까운 쿠폰을 자동으로 찾아드려요.
          </p>

          <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
            <Button
              size="lg"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                
                // PWA 준비 상태 확인
                if (!isReady) {
                  console.log('[Home] PWA 아직 준비 중, 잠시 후 다시 시도');
                  toast.info('앱을 준비하는 중입니다... 잠시 후 다시 시도해주세요.');
                  return;
                }
                
                // 중복 클릭 방지
                if (searchClickRef.current) {
                  console.log('[Home] 내 주변 쿠폰 찾기 버튼 중복 클릭 방지');
                  return;
                }
                searchClickRef.current = true;
                
                console.log('[Home] 내 주변 쿠폰 찾기 버튼 클릭');
                try {
                  setLocation('/map');
                } catch (error) {
                  console.error('[Home] 경로 이동 실패:', error);
                  searchClickRef.current = false;
                  toast.error('페이지 이동에 실패했습니다. 다시 시도해주세요.');
                  return;
                }
                
                // 1초 후 플래그 리셋
                setTimeout(() => {
                  searchClickRef.current = false;
                }, 1000);
              }}
              className="rounded-2xl bg-gradient-to-r from-primary to-accent text-white px-8 py-6 text-lg font-bold shadow-2xl hover:shadow-3xl hover:scale-105 transition-all"
              disabled={false}
              style={{ 
                cursor: 'pointer', 
                pointerEvents: 'auto',
                zIndex: 1000,
                position: 'relative'
              }}
            >
              <MapPin className="w-6 h-6 mr-2" />
              내 주변 쿠폰 찾기
            </Button>
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

          <Card className="border-2 border-pink-500/20 hover:border-pink-500/40 transition-all hover:shadow-xl rounded-3xl overflow-hidden group relative">
            <CardContent className="p-8 space-y-4">
              {/* Card Background Image */}
              <div className="absolute inset-0 z-0 opacity-10">
                <img src="/notification-card.png" alt="Notification" className="w-full h-full object-contain" loading="lazy" />
              </div>
              <div className="relative z-10 w-16 h-16 bg-gradient-to-br from-pink-500 to-purple-500 rounded-2xl flex items-center justify-center group-hover:scale-110 transition-transform">
                <Zap className="w-8 h-8 text-white" />
              </div>
              <h3 className="text-2xl font-bold relative z-10">실시간 알림</h3>
              <p className="text-muted-foreground relative z-10">
                지금 근처에 있는 쿠폰을 푸시 알림으로 바로 알려드려요
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
              <Link href="/merchant/dashboard">
                <Button
                  size="lg"
                  className="rounded-2xl bg-gradient-to-r from-primary to-accent text-white px-10 py-7 text-xl font-bold shadow-xl hover:shadow-2xl hover:scale-105 transition-all"
                >
                  사장님 시작하기
                </Button>
              </Link>
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
              <Button
                size="lg"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  
                  // PWA 준비 상태 확인
                  if (!isReady) {
                    console.log('[Home] PWA 아직 준비 중, 잠시 후 다시 시도');
                    toast.info('앱을 준비하는 중입니다... 잠시 후 다시 시도해주세요.');
                    return;
                  }
                  
                  // 중복 클릭 방지
                  if (searchClickRef.current) {
                    console.log('[Home] 내 주변 쿠폰 찾기 버튼 중복 클릭 방지 (CTA)');
                    return;
                  }
                  searchClickRef.current = true;
                  
                  console.log('[Home] 내 주변 쿠폰 찾기 버튼 클릭 (CTA 섹션)');
                  try {
                    setLocation('/map');
                  } catch (error) {
                    console.error('[Home] 경로 이동 실패:', error);
                    searchClickRef.current = false;
                    toast.error('페이지 이동에 실패했습니다. 다시 시도해주세요.');
                    return;
                  }
                  
                  // 1초 후 플래그 리셋
                  setTimeout(() => {
                    searchClickRef.current = false;
                  }, 1000);
                }}
                className="rounded-2xl bg-gradient-to-r from-primary to-accent text-white px-10 md:px-14 py-6 md:py-8 text-lg md:text-2xl font-bold shadow-2xl hover:shadow-3xl hover:scale-105 transition-all w-full md:w-auto"
                disabled={false}
                style={{ 
                  cursor: 'pointer', 
                  pointerEvents: 'auto',
                  zIndex: 1000,
                  position: 'relative'
                }}
              >
                <Heart className="w-6 h-6 md:w-7 md:h-7 mr-2 md:mr-3 fill-white" />
                내 주변 쿠폰 찾기
              </Button>
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
      
      {/* Install 모드 재시작 안내 모달 */}
      <InstallModeRestartModal
        open={showInstallModeRestartModal}
        onOpenChange={setShowInstallModeRestartModal}
      />
    </div>
  );
}
