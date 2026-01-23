import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Smartphone, AlertCircle, ExternalLink, Share2, Home, Settings } from 'lucide-react';
import { isInAppBrowser, getInAppBrowserName, isSafari, isChrome } from '@/lib/browserDetect';

interface InstallModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  landingUrl?: string;
}

export function InstallModal({ open, onOpenChange, landingUrl = window.location.href }: InstallModalProps) {
  const [deferredPrompt, setDeferredPrompt] = useState<any>(null);
  const [showHttpWarning, setShowHttpWarning] = useState(false);

  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
  const isAndroid = /Android/.test(navigator.userAgent);
  const isIOSInApp = isIOS && isInAppBrowser();
  const isAndroidInApp = isAndroid && isInAppBrowser();
  const isIOSSafari = isIOS && isSafari();
  const isAndroidChrome = isAndroid && isChrome();

  useEffect(() => {
    // beforeinstallprompt 이벤트 리스너 (Android PWA 설치용)
    const handleBeforeInstallPrompt = (e: any) => {
      e.preventDefault();
      setDeferredPrompt(e);
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);

    // HTTP 환경 감지
    const isHttp = window.location.protocol === 'http:';
    const isLocalhost = window.location.hostname === 'localhost' || 
                       window.location.hostname === '127.0.0.1' ||
                       /^172\.|^192\.168\.|^10\./.test(window.location.hostname);
    
    if (isHttp && isLocalhost && isAndroid && isAndroidChrome) {
      setShowHttpWarning(true);
    }

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    };
  }, [isAndroid, isAndroidChrome]);

  // Android - PWA 설치 프롬프트 실행
  const handleAndroidInstall = async () => {
    if (deferredPrompt) {
      try {
        // PWA 설치 프롬프트 실행
        await deferredPrompt.prompt();
        const { outcome } = await deferredPrompt.userChoice;
        
        if (outcome === 'accepted') {
          console.log('사용자가 PWA 설치를 수락했습니다.');
          onOpenChange(false);
        }
        
        setDeferredPrompt(null);
      } catch (error) {
        console.error('PWA 설치 프롬프트 오류:', error);
        // 오류 발생 시에도 모달은 유지 (수동 설치 가이드 표시)
      }
    } else {
      // PWA 프롬프트가 없는 경우 - 모달에 이미 가이드가 표시되므로 추가 작업 불필요
      // HTTP 환경 경고가 표시되면 그것을 참고하도록 함
    }
  };

  // iOS - Safari 설치 안내 표시 (모달이 이미 열려있으므로 안내만 표시)
  const handleIOSInstall = () => {
    // 모달이 이미 열려있고 설치 가이드가 표시되므로 추가 안내 불필요
    // 사용자가 가이드를 따라 설치할 수 있도록 모달 유지
  };

  // 디버깅: 모달 상태 로그
  useEffect(() => {
    console.log('[InstallModal] 모달 상태 변경:', { open, isIOS, isAndroid });
    if (open) {
      console.log('[InstallModal] ✅ 모달이 열렸습니다!');
      // 모달이 열리면 body 스크롤 잠금
      document.body.style.overflow = 'hidden';
    } else {
      console.log('[InstallModal] 모달이 닫혔습니다.');
      document.body.style.overflow = '';
    }
    return () => {
      document.body.style.overflow = '';
    };
  }, [open, isIOS, isAndroid]);

  // 모달이 열려야 하는데 안 열리는 경우 강제 체크
  useEffect(() => {
    if (open) {
      const dialogElement = document.querySelector('[role="dialog"]');
      if (!dialogElement) {
        console.warn('[InstallModal] ⚠️ 모달이 열려야 하는데 DOM에 없습니다!');
      } else {
        console.log('[InstallModal] ✅ 모달 DOM 요소 확인됨');
      }
    }
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={(newOpen) => {
      console.log('[InstallModal] Dialog onOpenChange 호출:', newOpen);
      onOpenChange(newOpen);
    }}>
      <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto bg-gradient-to-br from-orange-50 via-pink-50 to-purple-50 border-orange-200">
        <DialogHeader>
          <DialogTitle className="text-center">
            <div className="flex justify-center mb-4">
              <img 
                src="/logo-bear-nobg.png" 
                alt="마이쿠폰" 
                className="w-16 h-16 animate-wave"
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

          {/* HTTP 환경 경고 제거 - HTTPS 환경에서는 불필요 */}
          {false && showHttpWarning && isAndroidChrome && (
            <div className="bg-red-50 border-2 border-red-400 rounded-xl p-4">
              <div className="flex items-start gap-3">
                <AlertCircle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
                <div className="flex-1">
                  <h4 className="font-bold text-red-800 mb-2">⚠️ "연결이 안전하지 않음" 경고 해결 방법</h4>
                  <p className="text-sm text-red-700 mb-3">
                    HTTP 환경에서는 Chrome이 "연결이 안전하지 않음" 경고를 표시합니다. 
                    아래 방법 중 하나를 선택하여 해결하세요.
                  </p>
                  
                  {/* 방법 1: 고급 버튼 클릭 */}
                  <div className="bg-white rounded-lg p-3 mb-3 border border-red-200">
                    <h5 className="font-bold text-sm text-gray-800 mb-2">방법 1: 경고 무시하고 진행 (빠른 방법)</h5>
                    <ol className="space-y-1.5 text-xs text-gray-700 ml-2">
                      <li className="flex items-start gap-2">
                        <span className="font-bold text-red-600">1.</span>
                        <span>Chrome에서 "연결이 안전하지 않음" 경고 화면에서 <strong>"고급"</strong> 버튼 클릭</span>
                      </li>
                      <li className="flex items-start gap-2">
                        <span className="font-bold text-red-600">2.</span>
                        <span>하단에 나타나는 <strong>"172.30.1.46(안전하지 않음)으로 이동"</strong> 링크 클릭</span>
                      </li>
                      <li className="flex items-start gap-2">
                        <span className="font-bold text-red-600">3.</span>
                        <span>페이지가 정상적으로 로드됩니다</span>
                      </li>
                    </ol>
                  </div>

                  {/* 방법 2: chrome://flags 설정 */}
                  <div className="bg-white rounded-lg p-3 border border-red-200">
                    <h5 className="font-bold text-sm text-gray-800 mb-2">방법 2: Chrome 설정 변경 (영구 해결)</h5>
                    <ol className="space-y-1.5 text-xs text-gray-700 ml-2">
                      <li className="flex items-start gap-2">
                        <span className="font-bold text-red-600">1.</span>
                        <span>Chrome 주소창에 <code className="bg-gray-100 px-1.5 py-0.5 rounded font-mono">chrome://flags</code> 입력 후 엔터</span>
                      </li>
                      <li className="flex items-start gap-2">
                        <span className="font-bold text-red-600">2.</span>
                        <span>검색창에 <code className="bg-gray-100 px-1.5 py-0.5 rounded font-mono">Insecure origins</code> 입력</span>
                      </li>
                      <li className="flex items-start gap-2">
                        <span className="font-bold text-red-600">3.</span>
                        <span><strong>"Insecure origins treated as secure"</strong> 옵션을 <strong>"Enabled"</strong>로 변경</span>
                      </li>
                      <li className="flex items-start gap-2">
                        <span className="font-bold text-red-600">4.</span>
                        <span>아래 입력창에 <code className="bg-gray-100 px-1.5 py-0.5 rounded font-mono">http://172.30.1.46:3000</code> 입력</span>
                      </li>
                      <li className="flex items-start gap-2">
                        <span className="font-bold text-red-600">5.</span>
                        <span>Chrome 재시작 (화면 하단 "Relaunch" 버튼 클릭)</span>
                      </li>
                    </ol>
                    <div className="mt-2 p-2 bg-blue-50 rounded border border-blue-200">
                      <p className="text-xs text-blue-800">
                        💡 이 설정을 하면 이후부터 경고 없이 접속할 수 있습니다.
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Android 설치 버튼 */}
          {isAndroid && !isAndroidInApp && (
            <Button
              onClick={handleAndroidInstall}
              disabled={!deferredPrompt && !showHttpWarning}
              className="w-full h-12 bg-gradient-to-r from-green-500 to-green-600 hover:from-green-600 hover:to-green-700 text-white text-base font-semibold rounded-xl shadow-lg disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Smartphone className="w-5 h-5 mr-2" />
              {deferredPrompt ? '앱 설치하기' : '수동 설치 가이드 보기'}
            </Button>
          )}

          {/* iOS 설치 버튼 */}
          {isIOS && !isIOSInApp && (
            <Button
              onClick={handleIOSInstall}
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
              <div id="android-guide" className="bg-white/80 backdrop-blur-sm rounded-2xl p-5 mb-4 border border-orange-200 shadow-md">
                <div className="flex items-center gap-3 mb-3">
                  <div className="bg-green-100 rounded-lg p-2">
                    <Smartphone className="w-5 h-5 text-green-600" />
                  </div>
                  <h4 className="text-base font-bold text-gray-800">Android (Chrome)</h4>
                </div>
                
                {!deferredPrompt && (
                  <div className="mb-4 p-3 bg-yellow-50 border border-yellow-200 rounded-lg">
                    <p className="text-xs text-yellow-800">
                      💡 자동 설치가 작동하지 않는 경우, 아래 수동 방법을 따라주세요.
                    </p>
                  </div>
                )}
                
                <ol className="space-y-3 text-gray-700 text-sm">
                  <li className="flex gap-3 items-start">
                    <span className="flex-shrink-0 w-6 h-6 bg-gradient-to-r from-orange-500 to-pink-500 text-white rounded-full flex items-center justify-center text-xs font-bold mt-0.5">1</span>
                    <div className="flex-1">
                      <span className="block mb-1">Chrome 브라우저 우측 상단의 <strong>메뉴 아이콘 (⋮)</strong> 클릭</span>
                      <div className="text-xs text-gray-500 mt-1">☰ 또는 ⋮ 아이콘을 찾아주세요</div>
                    </div>
                  </li>
                  <li className="flex gap-3 items-start">
                    <span className="flex-shrink-0 w-6 h-6 bg-gradient-to-r from-orange-500 to-pink-500 text-white rounded-full flex items-center justify-center text-xs font-bold mt-0.5">2</span>
                    <div className="flex-1">
                      <span className="block mb-1">메뉴에서 <strong>"홈 화면에 추가"</strong> 또는 <strong>"앱 설치"</strong> 선택</span>
                      <div className="text-xs text-gray-500 mt-1">"Add to Home screen" 또는 "Install app" 옵션</div>
                    </div>
                  </li>
                  <li className="flex gap-3 items-start">
                    <span className="flex-shrink-0 w-6 h-6 bg-gradient-to-r from-orange-500 to-pink-500 text-white rounded-full flex items-center justify-center text-xs font-bold mt-0.5">3</span>
                    <div className="flex-1">
                      <span className="block mb-1">확인 팝업에서 <strong>"추가"</strong> 또는 <strong>"설치"</strong> 클릭</span>
                      <div className="text-xs text-gray-500 mt-1">홈 화면에 앱 아이콘이 생성됩니다</div>
                    </div>
                  </li>
                </ol>
              </div>
            )}

            {/* iOS (Safari) 설치 가이드 */}
            {isIOS && !isIOSInApp && (
              <div id="ios-guide" className="bg-white/80 backdrop-blur-sm rounded-2xl p-5 mb-4 border border-orange-200 shadow-md">
                <div className="flex items-center gap-3 mb-3">
                  <div className="bg-blue-100 rounded-lg p-2">
                    <Smartphone className="w-5 h-5 text-blue-600" />
                  </div>
                  <h4 className="text-base font-bold text-gray-800">iOS (Safari)</h4>
                </div>
                
                {!isIOSSafari && (
                  <div className="mb-4 p-3 bg-yellow-50 border border-yellow-200 rounded-lg">
                    <p className="text-xs text-yellow-800">
                      ⚠️ Safari 브라우저에서만 앱을 설치할 수 있습니다. Safari로 열어주세요.
                    </p>
                  </div>
                )}
                
                <ol className="space-y-3 text-gray-700 text-sm">
                  <li className="flex gap-3 items-start">
                    <span className="flex-shrink-0 w-6 h-6 bg-gradient-to-r from-orange-500 to-pink-500 text-white rounded-full flex items-center justify-center text-xs font-bold mt-0.5">1</span>
                    <div className="flex-1">
                      <span className="block mb-1">Safari 브라우저 하단 중앙의 <strong>공유 버튼</strong> 클릭</span>
                      <div className="mt-2 flex items-center gap-2 text-xs text-gray-500">
                        <div className="bg-gray-100 px-2 py-1 rounded border border-gray-300">
                          <Share2 className="w-4 h-4 inline mr-1" />
                          <span>공유</span>
                        </div>
                        <span>또는</span>
                        <div className="bg-gray-100 px-2 py-1 rounded border border-gray-300">
                          <span>□↑</span>
                        </div>
                        <span>아이콘</span>
                      </div>
                    </div>
                  </li>
                  <li className="flex gap-3 items-start">
                    <span className="flex-shrink-0 w-6 h-6 bg-gradient-to-r from-orange-500 to-pink-500 text-white rounded-full flex items-center justify-center text-xs font-bold mt-0.5">2</span>
                    <div className="flex-1">
                      <span className="block mb-1">공유 메뉴에서 <strong>"홈 화면에 추가"</strong> 선택</span>
                      <div className="text-xs text-gray-500 mt-1">"Add to Home Screen" 옵션을 찾아주세요</div>
                    </div>
                  </li>
                  <li className="flex gap-3 items-start">
                    <span className="flex-shrink-0 w-6 h-6 bg-gradient-to-r from-orange-500 to-pink-500 text-white rounded-full flex items-center justify-center text-xs font-bold mt-0.5">3</span>
                    <div className="flex-1">
                      <span className="block mb-1">앱 이름 확인 후 <strong>"추가"</strong> 버튼 클릭</span>
                      <div className="text-xs text-gray-500 mt-1">홈 화면에 앱 아이콘이 생성됩니다</div>
                    </div>
                  </li>
                </ol>
                
                <div className="mt-4 p-3 bg-blue-50 rounded-lg border border-blue-200">
                  <div className="flex items-start gap-2">
                    <Home className="w-4 h-4 text-blue-600 flex-shrink-0 mt-0.5" />
                    <p className="text-xs text-blue-800">
                      설치 후 홈 화면에서 앱 아이콘을 탭하면 앱처럼 실행됩니다.
                    </p>
                  </div>
                </div>
              </div>
            )}

            {/* 둘 다 아닌 경우 (일반 모바일 브라우저) */}
            {!isAndroid && !isIOS && (
              <div className="bg-white/80 backdrop-blur-sm rounded-2xl p-5 mb-4 border border-orange-200 shadow-md">
                <div className="flex items-center gap-3 mb-3">
                  <div className="bg-purple-100 rounded-lg p-2">
                    <Smartphone className="w-5 h-5 text-purple-600" />
                  </div>
                  <h4 className="text-base font-bold text-gray-800">모바일 브라우저</h4>
                </div>
                
                <p className="text-gray-700 text-sm">
                  브라우저 메뉴에서 "홈 화면에 추가" 또는 "바로가기 추가" 옵션을 찾아주세요.
                </p>
              </div>
            )}
          </div>

          {/* 설치 후 혜택 */}
          <div className="bg-white/80 backdrop-blur-sm rounded-2xl p-5 border border-orange-200 shadow-md">
            <h3 className="text-base font-bold text-gray-800 mb-3 text-center">설치 후 혜택</h3>
            <ul className="space-y-2 text-gray-700 text-sm">
              <li className="flex items-center gap-2">
                <div className="w-6 h-6 bg-gradient-to-r from-orange-500 to-pink-500 rounded-full flex items-center justify-center flex-shrink-0">
                  <Smartphone className="w-3 h-3 text-white" />
                </div>
                <span>홈 화면에서 빠른 접속</span>
              </li>
              <li className="flex items-center gap-2">
                <div className="w-6 h-6 bg-gradient-to-r from-orange-500 to-pink-500 rounded-full flex items-center justify-center flex-shrink-0">
                  <Smartphone className="w-3 h-3 text-white" />
                </div>
                <span>실시간 쿠폰 알림</span>
              </li>
              <li className="flex items-center gap-2">
                <div className="w-6 h-6 bg-gradient-to-r from-orange-500 to-pink-500 rounded-full flex items-center justify-center flex-shrink-0">
                  <Smartphone className="w-3 h-3 text-white" />
                </div>
                <span>내 주변 쿠폰 자동 추천</span>
              </li>
            </ul>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
