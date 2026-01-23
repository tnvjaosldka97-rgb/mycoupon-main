import { useState, useEffect, useMemo, useCallback, memo } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Smartphone, AlertCircle, Share2, Home } from 'lucide-react';
import { isInAppBrowser, getInAppBrowserName, isSafari, isChrome } from '@/lib/browserDetect';

interface InstallModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  landingUrl?: string;
}

// 디바이스 정보를 한 번만 계산 (성능 최적화)
const deviceInfo = {
  isIOS: /iPad|iPhone|iPod/.test(navigator.userAgent),
  isAndroid: /Android/.test(navigator.userAgent),
  isIOSInApp: /iPad|iPhone|iPod/.test(navigator.userAgent) && isInAppBrowser(),
  isAndroidInApp: /Android/.test(navigator.userAgent) && isInAppBrowser(),
  isIOSSafari: /iPad|iPhone|iPod/.test(navigator.userAgent) && isSafari(),
  isAndroidChrome: /Android/.test(navigator.userAgent) && isChrome(),
};

function InstallModalComponent({ open, onOpenChange }: InstallModalProps) {
  const [deferredPrompt, setDeferredPrompt] = useState<any>(null);

  const { isIOS, isAndroid, isIOSInApp, isAndroidInApp } = deviceInfo;

  // beforeinstallprompt 이벤트 리스너 (한 번만 등록)
  useEffect(() => {
    const handleBeforeInstallPrompt = (e: any) => {
      e.preventDefault();
      setDeferredPrompt(e);
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    };
  }, []);

  // body 스크롤 잠금
  useEffect(() => {
    if (open) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => {
      document.body.style.overflow = '';
    };
  }, [open]);

  // Android PWA 설치 핸들러 (메모이제이션)
  const handleAndroidInstall = useCallback(async () => {
    if (deferredPrompt) {
      try {
        await deferredPrompt.prompt();
        const { outcome } = await deferredPrompt.userChoice;
        
        if (outcome === 'accepted') {
          onOpenChange(false);
        }
        
        setDeferredPrompt(null);
      } catch (error) {
        console.error('PWA 설치 프롬프트 오류:', error);
      }
    }
  }, [deferredPrompt, onOpenChange]);

  // 모달이 닫혀있으면 렌더링하지 않음 (성능 최적화)
  if (!open) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto bg-gradient-to-br from-orange-50 via-pink-50 to-purple-50 border-orange-200">
        <DialogHeader>
          <DialogTitle className="text-center">
            <div className="flex justify-center mb-4">
              <img 
                src="/logo-bear-nobg.png" 
                alt="마이쿠폰" 
                className="w-16 h-16"
                loading="eager"
              />
            </div>
            <h2 className="text-2xl font-bold bg-gradient-to-r from-orange-500 to-pink-500 bg-clip-text text-transparent">
              앱 설치하기
            </h2>
            <p className="text-sm text-gray-600 font-normal mt-2">
              홈 화면에 추가하여 앱처럼 사용하세요
            </p>
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 mt-4">
          {/* 인앱 브라우저 경고 */}
          {isIOSInApp && (
            <div className="bg-yellow-50 border-2 border-yellow-400 rounded-xl p-4">
              <div className="flex items-start gap-3">
                <AlertCircle className="w-5 h-5 text-yellow-600 flex-shrink-0 mt-0.5" />
                <div className="flex-1">
                  <h4 className="font-bold text-yellow-800 mb-1">Safari 브라우저가 필요합니다</h4>
                  <p className="text-sm text-yellow-700">
                    {getInAppBrowserName() || '인앱 브라우저'}에서는 앱을 설치할 수 없습니다. 
                    Safari 브라우저로 열어주세요.
                  </p>
                </div>
              </div>
            </div>
          )}

          {isAndroidInApp && (
            <div className="bg-yellow-50 border-2 border-yellow-400 rounded-xl p-4">
              <div className="flex items-start gap-3">
                <AlertCircle className="w-5 h-5 text-yellow-600 flex-shrink-0 mt-0.5" />
                <div className="flex-1">
                  <h4 className="font-bold text-yellow-800 mb-1">Chrome 브라우저가 필요합니다</h4>
                  <p className="text-sm text-yellow-700">
                    {getInAppBrowserName() || '인앱 브라우저'}에서는 앱을 설치할 수 없습니다. 
                    Chrome 브라우저로 열어주세요.
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* Android 설치 버튼 */}
          {isAndroid && !isAndroidInApp && (
            <Button
              onClick={handleAndroidInstall}
              disabled={!deferredPrompt}
              className="w-full h-12 bg-gradient-to-r from-green-500 to-green-600 hover:from-green-600 hover:to-green-700 text-white text-base font-semibold rounded-xl shadow-lg disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Smartphone className="w-5 h-5 mr-2" />
              {deferredPrompt ? '앱 설치하기' : '수동 설치 가이드 보기'}
            </Button>
          )}

          {/* iOS 설치 버튼 */}
          {isIOS && !isIOSInApp && (
            <Button
              className="w-full h-12 bg-gradient-to-r from-blue-500 to-blue-600 hover:from-blue-600 hover:to-blue-700 text-white text-base font-semibold rounded-xl shadow-lg"
            >
              <Smartphone className="w-5 h-5 mr-2" />
              설치 가이드 보기
            </Button>
          )}

          {/* 설치 방법 */}
          <div className="mt-6">
            <h3 className="text-lg font-bold text-gray-800 mb-4 text-center">설치 방법</h3>

            {/* Android (Chrome) 설치 가이드 */}
            {isAndroid && !isAndroidInApp && (
              <div className="bg-white/80 backdrop-blur-sm rounded-2xl p-5 mb-4 border border-orange-200 shadow-md">
                <div className="flex items-center gap-3 mb-3">
                  <div className="bg-green-100 rounded-lg p-2">
                    <Smartphone className="w-5 h-5 text-green-600" />
                  </div>
                  <h4 className="font-bold text-gray-800">Android (Chrome)</h4>
                </div>
                <ol className="space-y-2 text-sm text-gray-700 ml-2">
                  <li className="flex items-start gap-2">
                    <span className="font-bold text-orange-500">1.</span>
                    <span>Chrome 브라우저에서 이 페이지 열기</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="font-bold text-orange-500">2.</span>
                    <span>우측 상단 <strong>⋮</strong> 메뉴 터치</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="font-bold text-orange-500">3.</span>
                    <span><strong>"홈 화면에 추가"</strong> 선택</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="font-bold text-orange-500">4.</span>
                    <span><strong>"추가"</strong> 버튼 터치</span>
                  </li>
                </ol>
              </div>
            )}

            {/* iOS (Safari) 설치 가이드 */}
            {isIOS && !isIOSInApp && (
              <div className="bg-white/80 backdrop-blur-sm rounded-2xl p-5 border border-orange-200 shadow-md">
                <div className="flex items-center gap-3 mb-3">
                  <div className="bg-blue-100 rounded-lg p-2">
                    <Smartphone className="w-5 h-5 text-blue-600" />
                  </div>
                  <h4 className="font-bold text-gray-800">iPhone/iPad (Safari)</h4>
                </div>
                <ol className="space-y-2 text-sm text-gray-700 ml-2">
                  <li className="flex items-start gap-2">
                    <span className="font-bold text-blue-500">1.</span>
                    <span>Safari 브라우저에서 이 페이지 열기</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="font-bold text-blue-500">2.</span>
                    <span>하단 <Share2 className="w-4 h-4 inline text-blue-500" /> 공유 버튼 터치</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="font-bold text-blue-500">3.</span>
                    <span><Home className="w-4 h-4 inline text-blue-500" /> <strong>"홈 화면에 추가"</strong> 선택</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="font-bold text-blue-500">4.</span>
                    <span>우측 상단 <strong>"추가"</strong> 터치</span>
                  </li>
                </ol>
              </div>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// memo로 불필요한 리렌더링 방지
export const InstallModal = memo(InstallModalComponent);
