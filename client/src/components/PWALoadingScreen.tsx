import { useEffect, useState } from "react";

export default function PWALoadingScreen() {
  const [isLoading, setIsLoading] = useState(() => {
    // install 모드일 때는 로딩 화면 표시 안 함 (버튼 클릭 가능하도록)
    if (sessionStorage.getItem('install-mode')) {
      console.log('[PWA Loading] install 모드 감지, 로딩 화면 표시 안 함');
      return false;
    }
    
    // 멈춤 상태 감지: 이전에 멈춘 적이 있는지 확인
    const wasStuck = sessionStorage.getItem('pwa-was-stuck');
    if (wasStuck) {
      // 이전에 멈춘 적이 있으면 로딩 화면 표시 안 함
      sessionStorage.removeItem('pwa-was-stuck');
      return false;
    }
    
    // PWA standalone 모드인지 확인
    const isStandalone = window.matchMedia('(display-mode: standalone)').matches || 
                        (window.navigator as any).standalone || 
                        document.referrer.includes('android-app://');
    
    // standalone 모드가 아니면 로딩 화면 표시 안 함
    if (!isStandalone) {
      return false;
    }
    
    // 첫 실행 여부 확인 (PWA 설치 후 첫 실행 시에만 표시)
    const hasShownBefore = localStorage.getItem('pwa-loading-shown');
    return !hasShownBefore;
  });
  
  // 크롬에서 바로 들어갔을 때 멈춤 방지: 최대 3초 후 강제 해제
  const [forceHide, setForceHide] = useState(false);

  useEffect(() => {
    if (!isLoading) return;

    // 이미지 preload (하지만 로딩 화면은 최소 시간 동안 표시)
    const img = new Image();
    img.src = '/logo-bear-nobg.png';

    let imageLoaded = false;
    img.onload = () => {
      imageLoaded = true;
    };
    img.onerror = () => {
      imageLoaded = true; // 에러여도 로드 완료로 간주
    };

    // 최소 2초는 표시 (곰돌이 애니메이션을 볼 수 있도록)
    const minDisplayTime = 2000;
    const startTime = Date.now();

    const checkAndHide = () => {
      const elapsed = Date.now() - startTime;
      if (imageLoaded && elapsed >= minDisplayTime) {
        setIsLoading(false);
        localStorage.setItem('pwa-loading-shown', 'true');
      } else if (elapsed >= minDisplayTime) {
        // 이미지가 로드되지 않아도 최소 시간이 지나면 숨기기
        setIsLoading(false);
        localStorage.setItem('pwa-loading-shown', 'true');
      } else {
        // 아직 최소 시간이 안 지났으면 다시 확인
        setTimeout(checkAndHide, 100);
      }
    };

    // 이미지 로드 완료 후 최소 시간 확인
    const checkTimer = setInterval(() => {
      if (imageLoaded) {
        clearInterval(checkTimer);
        checkAndHide();
      }
    }, 100);

    // 3초 타임아웃 안전장치: 로딩이 끝나지 않으면 강제 해제
    const timeoutTimer = setTimeout(() => {
      console.warn('[PWA Loading] 3초 타임아웃 발생, 강제 해제 및 멈춤 상태 기록');
      clearInterval(checkTimer);
      setForceHide(true);
      setIsLoading(false);
      localStorage.setItem('pwa-loading-shown', 'true');
      // 멈춤 상태 기록 (재접속 시 로딩 화면 표시 안 함)
      sessionStorage.setItem('pwa-was-stuck', 'true');
    }, 3000);

    return () => {
      clearInterval(checkTimer);
      clearTimeout(timeoutTimer);
    };
  }, [isLoading]);

  // forceHide가 true면 즉시 숨기기
  useEffect(() => {
    if (forceHide) {
      setIsLoading(false);
    }
  }, [forceHide]);

  if (!isLoading || forceHide) return null;

  return (
    <div className="fixed inset-0 z-[9999] bg-gradient-to-br from-orange-50 via-pink-50 to-purple-50 flex items-center justify-center" style={{ pointerEvents: isLoading ? 'auto' : 'none' }}>
      <div className="text-center space-y-6">
        {/* 곰돌이 로고 with 애니메이션 */}
        <img
          src="/logo-bear-nobg.png"
          alt="마이쿠폰"
          className="w-64 h-64 mx-auto animate-bounce"
        />
        
        {/* 브랜드명 */}
        <h1 className="text-5xl font-bold bg-gradient-to-r from-primary to-accent bg-clip-text text-transparent animate-pulse">
          마이쿠폰
        </h1>
        
        {/* 핑크색 로딩 스피너 */}
        <div className="flex justify-center">
          <div className="w-12 h-12 border-4 border-pink-200 border-t-pink-500 rounded-full animate-spin shadow-lg"></div>
        </div>
      </div>
    </div>
  );
}
