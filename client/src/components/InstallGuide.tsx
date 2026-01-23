import { useEffect, useState } from 'react';
import { useLocation } from 'wouter';
import { Button } from '@/components/ui/button';
import { ArrowLeft, Smartphone } from 'lucide-react';

export default function InstallGuide() {
  const [, setLocation] = useLocation();
  const [isDesktop, setIsDesktop] = useState(false);
  const [deferredPrompt, setDeferredPrompt] = useState<any>(null);

  useEffect(() => {
    // PC 브라우저 감지 (Windows, Mac, Linux)
    const desktop = /Windows|Macintosh|Linux/i.test(navigator.userAgent) && 
                    !/Android|iPhone|iPad|iPod/.test(navigator.userAgent);
    setIsDesktop(desktop);

    // PC인 경우 홈으로 리다이렉트
    if (desktop) {
      setLocation('/');
    }

    // beforeinstallprompt 이벤트 리스너 (Android PWA 설치용)
    const handleBeforeInstallPrompt = (e: any) => {
      e.preventDefault();
      setDeferredPrompt(e);
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    };
  }, [setLocation]);

  // PC인 경우 아무것도 렌더링하지 않음
  if (isDesktop) {
    return null;
  }

  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
  const isAndroid = /Android/.test(navigator.userAgent);

  // Android PWA 설치 프롬프트 실행
  const handleAndroidInstall = async () => {
    if (deferredPrompt) {
      deferredPrompt.prompt();
      const { outcome } = await deferredPrompt.userChoice;
      if (outcome === 'accepted') {
        console.log('PWA 설치 완료');
      }
      setDeferredPrompt(null);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-orange-50 via-pink-50 to-purple-50">
      {/* 헤더 */}
      <div className="bg-white/80 backdrop-blur-md sticky top-0 z-10 border-b shadow-sm">
        <div className="container mx-auto px-4 py-4 flex items-center gap-3">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setLocation('/')}
            className="p-2 hover:bg-orange-100"
          >
            <ArrowLeft className="w-5 h-5 text-orange-600" />
          </Button>
          <div className="flex items-center gap-2">
            <img 
              src="/logo-bear-nobg.png" 
              alt="마이쿠폰" 
              className="w-8 h-8"
            />
            <h1 className="text-xl font-bold bg-gradient-to-r from-orange-500 to-pink-500 bg-clip-text text-transparent">
              마이쿠폰
            </h1>
          </div>
        </div>
      </div>

      {/* 메인 컨텐츠 */}
      <div className="container mx-auto px-4 py-12 max-w-md">
        {/* 타이틀 */}
        <div className="text-center mb-12">
          <div className="flex justify-center mb-6">
            <img 
              src="/logo-bear-nobg.png" 
              alt="마이쿠폰" 
              className="w-24 h-24 animate-wave"
            />
          </div>
          <h2 className="text-4xl font-bold bg-gradient-to-r from-orange-500 to-pink-500 bg-clip-text text-transparent mb-4">
            마이쿠폰
          </h2>
          <p className="text-gray-700 text-base">
            홈 화면에 추가하여 앱처럼 사용하세요
          </p>
        </div>

        {/* Android 다운로드 버튼 */}
        <Button
          onClick={handleAndroidInstall}
          disabled={!isAndroid || !deferredPrompt}
          className="w-full h-14 mb-3 bg-gradient-to-r from-green-500 to-green-600 hover:from-green-600 hover:to-green-700 text-white text-base font-semibold rounded-xl shadow-lg disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <Smartphone className="w-5 h-5 mr-2" />
          Android - 다운로드
        </Button>

        {/* iOS 다운로드 버튼 */}
        <Button
          onClick={() => {
            // iOS는 아래 설치 방법 섹션으로 스크롤
            document.getElementById('ios-guide')?.scrollIntoView({ behavior: 'smooth' });
          }}
          disabled={!isIOS}
          className="w-full h-14 mb-12 bg-gradient-to-r from-blue-500 to-blue-600 hover:from-blue-600 hover:to-blue-700 text-white text-base font-semibold rounded-xl shadow-lg disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <Smartphone className="w-5 h-5 mr-2" />
          iOS - 다운로드
        </Button>

        {/* 설치 방법 */}
        <div className="mb-8">
          <h3 className="text-xl font-bold text-gray-800 mb-6 text-center">설치 방법</h3>

          {/* Android (Chrome) 설치 가이드 */}
          {isAndroid && (
            <div id="android-guide" className="bg-white/80 backdrop-blur-sm rounded-2xl p-6 mb-4 border border-orange-200 shadow-lg">
              <div className="flex items-center gap-3 mb-4">
                <div className="bg-green-100 rounded-lg p-2">
                  <Smartphone className="w-6 h-6 text-green-600" />
                </div>
                <h4 className="text-lg font-bold text-gray-800">Android (Chrome)</h4>
              </div>
              
              <ol className="space-y-3 text-gray-700 text-sm">
                <li className="flex gap-3">
                  <span className="flex-shrink-0 w-6 h-6 bg-gradient-to-r from-orange-500 to-pink-500 text-white rounded-full flex items-center justify-center text-xs font-bold">1</span>
                  <span>우측 상단 메뉴 (⋮) 클릭</span>
                </li>
                <li className="flex gap-3">
                  <span className="flex-shrink-0 w-6 h-6 bg-gradient-to-r from-orange-500 to-pink-500 text-white rounded-full flex items-center justify-center text-xs font-bold">2</span>
                  <span>'홈 화면에 추가' 선택</span>
                </li>
                <li className="flex gap-3">
                  <span className="flex-shrink-0 w-6 h-6 bg-gradient-to-r from-orange-500 to-pink-500 text-white rounded-full flex items-center justify-center text-xs font-bold">3</span>
                  <span>'설치' 클릭하여 완료</span>
                </li>
              </ol>
            </div>
          )}

          {/* iOS (Safari) 설치 가이드 */}
          {isIOS && (
            <div id="ios-guide" className="bg-white/80 backdrop-blur-sm rounded-2xl p-6 mb-4 border border-orange-200 shadow-lg">
              <div className="flex items-center gap-3 mb-4">
                <div className="bg-blue-100 rounded-lg p-2">
                  <Smartphone className="w-6 h-6 text-blue-600" />
                </div>
                <h4 className="text-lg font-bold text-gray-800">iOS (Safari)</h4>
              </div>
              
              <ol className="space-y-3 text-gray-700 text-sm">
                <li className="flex gap-3">
                  <span className="flex-shrink-0 w-6 h-6 bg-gradient-to-r from-orange-500 to-pink-500 text-white rounded-full flex items-center justify-center text-xs font-bold">1</span>
                  <span>Safari 브라우저에서 열기</span>
                </li>
                <li className="flex gap-3">
                  <span className="flex-shrink-0 w-6 h-6 bg-gradient-to-r from-orange-500 to-pink-500 text-white rounded-full flex items-center justify-center text-xs font-bold">2</span>
                  <span>하단 중앙 공유 버튼 (⭡) 클릭</span>
                </li>
                <li className="flex gap-3">
                  <span className="flex-shrink-0 w-6 h-6 bg-gradient-to-r from-orange-500 to-pink-500 text-white rounded-full flex items-center justify-center text-xs font-bold">3</span>
                  <span>'홈 화면에 추가' 선택</span>
                </li>
                <li className="flex gap-3">
                  <span className="flex-shrink-0 w-6 h-6 bg-gradient-to-r from-orange-500 to-pink-500 text-white rounded-full flex items-center justify-center text-xs font-bold">4</span>
                  <span>'설치' 클릭하여 완료</span>
                </li>
              </ol>
            </div>
          )}

          {/* 둘 다 아닌 경우 (일반 모바일 브라우저) */}
          {!isAndroid && !isIOS && (
            <div className="bg-white/80 backdrop-blur-sm rounded-2xl p-6 mb-4 border border-orange-200 shadow-lg">
              <div className="flex items-center gap-3 mb-4">
                <div className="bg-purple-100 rounded-lg p-2">
                  <Smartphone className="w-6 h-6 text-purple-600" />
                </div>
                <h4 className="text-lg font-bold text-gray-800">모바일 브라우저</h4>
              </div>
              
              <p className="text-gray-700 text-sm">
                브라우저 메뉴에서 "홈 화면에 추가" 또는 "바로가기 추가" 옵션을 찾아주세요.
              </p>
            </div>
          )}
        </div>

        {/* 설치 후 혜택 */}
        <div className="bg-white/80 backdrop-blur-sm rounded-2xl p-6 mb-8 border border-orange-200 shadow-lg">
          <h3 className="text-lg font-bold text-gray-800 mb-4 text-center">설치 후 혜택</h3>
          <ul className="space-y-3 text-gray-700 text-sm">
            <li className="flex items-center gap-3">
              <div className="w-8 h-8 bg-gradient-to-r from-orange-500 to-pink-500 rounded-full flex items-center justify-center flex-shrink-0">
                <Smartphone className="w-4 h-4 text-white" />
              </div>
              <span>홈 화면에서 빠른 접속</span>
            </li>
            <li className="flex items-center gap-3">
              <div className="w-8 h-8 bg-gradient-to-r from-orange-500 to-pink-500 rounded-full flex items-center justify-center flex-shrink-0">
                <Smartphone className="w-4 h-4 text-white" />
              </div>
              <span>실시간 쿠폰 알림</span>
            </li>
            <li className="flex items-center gap-3">
              <div className="w-8 h-8 bg-gradient-to-r from-orange-500 to-pink-500 rounded-full flex items-center justify-center flex-shrink-0">
                <Smartphone className="w-4 h-4 text-white" />
              </div>
              <span>내 주변 쿠폰 자동 추천</span>
            </li>
          </ul>
        </div>

        {/* 하단 버튼 */}
        <div className="text-center mt-12">
          <Button
            onClick={() => setLocation('/')}
            variant="outline"
            className="border-orange-300 text-orange-600 hover:bg-orange-50 px-8 rounded-xl"
          >
            홈으로 돌아가기
          </Button>
        </div>
      </div>
    </div>
  );
}
