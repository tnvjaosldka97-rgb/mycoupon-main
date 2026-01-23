import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { X, Share2, Home, ArrowRight } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";

export function IOSInstallGuide() {
  const [show, setShow] = useState(false);
  const [isIOS, setIsIOS] = useState(false);
  const [isStandalone, setIsStandalone] = useState(false);
  const [isDismissed, setIsDismissed] = useState(false);

  useEffect(() => {
    // iOS 감지
    const iOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
    setIsIOS(iOS);
    
    // PWA standalone 모드 감지
    const standalone = window.matchMedia('(display-mode: standalone)').matches || 
                      (window.navigator as any).standalone === true;
    setIsStandalone(standalone);
    
    // 이미 설치되어 있으면 표시 안 함
    if (standalone) {
      return;
    }
    
    // iOS이고 standalone 모드가 아니면 설치 가이드 표시
    if (iOS && !standalone) {
      // 이전에 닫았는지 확인
      const dismissed = localStorage.getItem('ios-install-guide-dismissed');
      if (!dismissed) {
        // 2초 후 표시 (페이지 로드 후 자연스럽게)
        const timer = setTimeout(() => {
          setShow(true);
        }, 2000);
        return () => clearTimeout(timer);
      }
    }
  }, []);

  const handleDismiss = () => {
    setShow(false);
    setIsDismissed(true);
    localStorage.setItem('ios-install-guide-dismissed', 'true');
  };

  const handleInstall = () => {
    // iOS 설치 가이드 표시 (사용자가 직접 공유 버튼을 눌러야 함)
    setShow(false);
    localStorage.setItem('ios-install-guide-dismissed', 'true');
  };

  if (!isIOS || isStandalone || isDismissed || !show) {
    return null;
  }

  return (
    <Dialog open={show} onOpenChange={setShow}>
      <DialogContent className="max-w-md mx-4 rounded-2xl p-6 bg-gradient-to-br from-orange-50 via-pink-50 to-purple-50 border-2 border-orange-200">
        <DialogHeader>
          <DialogTitle className="text-2xl font-bold text-center mb-2">
            앱으로 설치하시겠어요?
          </DialogTitle>
          <DialogDescription className="text-center text-gray-700">
            홈 화면에 추가하면 더 빠르고 편하게 이용할 수 있어요!
          </DialogDescription>
        </DialogHeader>
        
        <div className="space-y-4 mt-6">
          {/* 설치 가이드 스텝 */}
          <div className="bg-white/80 rounded-xl p-4 space-y-3">
            <div className="flex items-start gap-3">
              <div className="flex-shrink-0 w-8 h-8 bg-orange-500 text-white rounded-full flex items-center justify-center font-bold">
                1
              </div>
              <div className="flex-1">
                <p className="font-semibold text-gray-900">하단 공유 버튼 클릭</p>
                <p className="text-sm text-gray-600 mt-1">
                  화면 하단의 <Share2 className="w-4 h-4 inline mx-1" /> 공유 아이콘을 눌러주세요
                </p>
              </div>
            </div>
            
            <div className="flex items-start gap-3">
              <div className="flex-shrink-0 w-8 h-8 bg-pink-500 text-white rounded-full flex items-center justify-center font-bold">
                2
              </div>
              <div className="flex-1">
                <p className="font-semibold text-gray-900">홈 화면에 추가 선택</p>
                <p className="text-sm text-gray-600 mt-1">
                  <Home className="w-4 h-4 inline mx-1" /> "홈 화면에 추가" 메뉴를 선택해주세요
                </p>
              </div>
            </div>
            
            <div className="flex items-start gap-3">
              <div className="flex-shrink-0 w-8 h-8 bg-purple-500 text-white rounded-full flex items-center justify-center font-bold">
                3
              </div>
              <div className="flex-1">
                <p className="font-semibold text-gray-900">완료!</p>
                <p className="text-sm text-gray-600 mt-1">
                  홈 화면에서 앱 아이콘을 눌러 실행하세요
                </p>
              </div>
            </div>
          </div>
          
          {/* 액션 버튼 */}
          <div className="flex gap-2">
            <Button
              variant="outline"
              onClick={handleDismiss}
              className="flex-1"
            >
              나중에
            </Button>
            <Button
              onClick={handleInstall}
              className="flex-1 bg-gradient-to-r from-orange-400 to-pink-500 text-white hover:from-orange-500 hover:to-pink-600"
            >
              알겠어요
              <ArrowRight className="w-4 h-4 ml-2" />
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

