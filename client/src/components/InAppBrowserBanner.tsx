import { useEffect, useState, useMemo } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Download, X } from "lucide-react";
import { isInAppBrowser } from "@/lib/browserDetect";

/**
 * 인앱 브라우저 감지 배너
 * - 오직 인앱 브라우저(카카오톡, 네이버, 인스타그램 등)에서만 표시
 * - 일반 브라우저(Chrome, Safari, Samsung Internet 등)에서는 표시하지 않음
 */
export function InAppBrowserBanner() {
  // 브라우저 감지 결과를 useMemo로 안정화 (새로고침 시에도 동일한 결과)
  const isInApp = useMemo(() => {
    if (typeof window === 'undefined') return false;
    return isInAppBrowser();
  }, []);

  const [show, setShow] = useState(false);
  const [isDismissed, setIsDismissed] = useState(false);

  useEffect(() => {
    // 오직 인앱 브라우저일 때만 배너 표시
    if (!isInApp) {
      setShow(false);
      return;
    }

    // 24시간 동안 배너를 닫았는지 확인
    const dismissedUntil = localStorage.getItem("inapp_banner_dismissed");
    if (dismissedUntil) {
      const dismissedTime = parseInt(dismissedUntil, 10);
      if (Date.now() < dismissedTime) {
        setIsDismissed(true);
        setShow(false);
        return;
      }
    }

    setShow(true);
  }, [isInApp]);

  const handleDownload = () => {
    // 현재 접속 중인 IP 주소 유지 (window.location.origin 사용)
    const installUrl = `${window.location.origin}/install`;
    window.location.href = installUrl;
  };

  const handleDismiss = () => {
    // 24시간 동안 배너 숨김
    const dismissUntil = Date.now() + 24 * 60 * 60 * 1000;
    localStorage.setItem("inapp_banner_dismissed", dismissUntil.toString());
    setIsDismissed(true);
    setShow(false);
  };

  // 인앱 브라우저가 아니거나 닫힌 경우 배너 표시하지 않음
  // 조건을 명확히 하여 일반 브라우저에서는 절대 렌더링되지 않도록 보장
  if (!isInApp || !show || isDismissed) {
    return null;
  }

  // 배너만 표시하고, 오버레이나 배경 어둡게 만드는 요소는 절대 포함하지 않음
  return (
    <div className="fixed top-0 left-0 right-0 z-50 p-4" style={{ pointerEvents: 'none' }}>
      <div style={{ pointerEvents: 'auto' }}>
        <Alert className="bg-gradient-to-r from-orange-400 to-pink-500 text-white border-none shadow-lg">
        <div className="flex items-start justify-between gap-3">
          {/* 아이콘 미리보기 */}
          <div className="flex-shrink-0">
            <img 
              src="/logo-bear.png" 
              alt="마이쿠폰 아이콘" 
              className="w-16 h-16 rounded-2xl shadow-md border-2 border-white/30"
            />
          </div>
          
          <div className="flex-1">
            <AlertDescription className="text-white font-bold text-base mb-1">
              마이쿠폰 앱 설치
            </AlertDescription>
            <AlertDescription className="text-white/90 text-sm">
              홈 화면에 추가하고 더 편하게 이용하세요!
            </AlertDescription>
            <Button
              onClick={handleDownload}
              variant="secondary"
              size="sm"
              className="mt-3 bg-white text-orange-600 hover:bg-gray-100 font-medium"
            >
              <Download className="w-4 h-4 mr-2" />
              설치하기
            </Button>
          </div>
          <Button
            onClick={handleDismiss}
            variant="ghost"
            size="icon"
            className="text-white hover:bg-white/20 flex-shrink-0"
          >
            <X className="w-5 h-5" />
          </Button>
        </div>
      </Alert>
      </div>
    </div>
  );
}
