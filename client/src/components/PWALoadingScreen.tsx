import { useEffect, useState } from "react";
import { isCapacitorNative } from "@/lib/capacitor";

export default function PWALoadingScreen() {
  const [isLoading, setIsLoading] = useState(() => {
    // install 모드일 때는 표시 안 함
    if (sessionStorage.getItem('install-mode')) return false;

    // Capacitor 앱: 매 세션(앱 재실행)마다 표시
    // sessionStorage는 앱 종료 후 재실행 시 초기화됨
    if (isCapacitorNative()) {
      const shownThisSession = sessionStorage.getItem('splash-shown-this-session');
      return !shownThisSession;
    }

    // 웹 PWA: standalone 모드에서 첫 실행 1회만 표시
    const isStandalone =
      window.matchMedia('(display-mode: standalone)').matches ||
      (window.navigator as any).standalone;
    if (!isStandalone) return false;

    const wasStuck = sessionStorage.getItem('pwa-was-stuck');
    if (wasStuck) {
      sessionStorage.removeItem('pwa-was-stuck');
      return false;
    }

    return !localStorage.getItem('pwa-loading-shown');
  });

  useEffect(() => {
    if (!isLoading) return;

    const img = new Image();
    img.src = '/logo-bear-nobg.png';
    let imageLoaded = false;
    img.onload = () => { imageLoaded = true; };
    img.onerror = () => { imageLoaded = true; };

    const MIN_MS = isCapacitorNative() ? 1800 : 2000;
    const start = Date.now();

    const hide = () => {
      setIsLoading(false);
      if (isCapacitorNative()) {
        sessionStorage.setItem('splash-shown-this-session', 'true');
      } else {
        localStorage.setItem('pwa-loading-shown', 'true');
      }
    };

    const check = () => {
      const elapsed = Date.now() - start;
      if (elapsed >= MIN_MS) {
        hide();
      } else {
        setTimeout(check, 100);
      }
    };

    const checkTimer = setInterval(() => {
      if (imageLoaded) { clearInterval(checkTimer); check(); }
    }, 100);

    // 3.5초 안전망
    const timeout = setTimeout(() => {
      clearInterval(checkTimer);
      sessionStorage.setItem('pwa-was-stuck', 'true');
      hide();
    }, 3500);

    return () => { clearInterval(checkTimer); clearTimeout(timeout); };
  }, [isLoading]);

  if (!isLoading) return null;

  return (
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center"
      style={{ background: 'linear-gradient(135deg, #FFF0F5 0%, #FFE4EE 50%, #FFF5F0 100%)' }}
    >
      <div className="text-center space-y-6">
        {/* 곰돌이 로고 — 위아래 바운스 */}
        <img
          src="/logo-bear-nobg.png"
          alt="마이쿠폰"
          className="w-48 h-48 mx-auto animate-bounce"
          style={{ animationDuration: '0.9s' }}
        />

        {/* 브랜드명 */}
        <h1
          className="text-4xl font-bold animate-pulse"
          style={{ color: '#FF6B9D' }}
        >
          마이쿠폰
        </h1>

        {/* 핑크 스피너 */}
        <div className="flex justify-center">
          <div
            className="w-10 h-10 border-4 rounded-full animate-spin"
            style={{ borderColor: '#FFB3C6', borderTopColor: '#FF6B9D' }}
          />
        </div>
      </div>
    </div>
  );
}
