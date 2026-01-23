import { useEffect, useState } from 'react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { AlertCircle, X, ExternalLink } from 'lucide-react';
import { isAndroid, isChrome } from '@/lib/browserDetect';

/**
 * HTTP 환경 보안 경고 배너
 * - 로컬 HTTP 환경에서 Chrome 접속 시 "연결이 안전하지 않음" 경고 해결 방법 안내
 */
export function HttpSecurityWarning() {
  const [show, setShow] = useState(false);
  const [isDismissed, setIsDismissed] = useState(false);

  useEffect(() => {
    // HTTP 환경 감지
    const isHttp = window.location.protocol === 'http:';
    const isLocalhost = window.location.hostname === 'localhost' || 
                       window.location.hostname === '127.0.0.1' ||
                       /^172\.|^192\.168\.|^10\./.test(window.location.hostname);
    
    // Android Chrome에서 HTTP 로컬 환경일 때만 표시
    if (isHttp && isLocalhost && isAndroid() && isChrome()) {
      // 24시간 동안 닫았는지 확인
      const dismissedUntil = localStorage.getItem('http_security_warning_dismissed');
      if (dismissedUntil) {
        const dismissedTime = parseInt(dismissedUntil, 10);
        if (Date.now() < dismissedTime) {
          setIsDismissed(true);
          return;
        }
      }
      setShow(true);
    }
  }, []);

  const handleDismiss = () => {
    // 24시간 동안 배너 숨김
    const dismissUntil = Date.now() + 24 * 60 * 60 * 1000;
    localStorage.setItem('http_security_warning_dismissed', dismissUntil.toString());
    setIsDismissed(true);
    setShow(false);
  };

  if (!show || isDismissed) {
    return null;
  }

  return (
    <div className="fixed top-0 left-0 right-0 z-50 p-4">
      <Alert variant="destructive" className="shadow-lg border-2 border-red-400">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-3 flex-1">
            <AlertCircle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
            <div className="flex-1">
              <AlertTitle className="font-bold text-red-800 mb-2">
                ⚠️ "연결이 안전하지 않음" 경고 해결 방법
              </AlertTitle>
              <AlertDescription className="text-sm text-red-700 space-y-2">
                <p>
                  HTTP 환경에서는 Chrome이 보안 경고를 표시합니다. 아래 방법 중 하나를 선택하세요.
                </p>
                
                {/* 방법 1: 고급 버튼 클릭 */}
                <div className="bg-white/90 rounded-lg p-3 border border-red-200">
                  <h5 className="font-bold text-xs text-gray-800 mb-1.5">방법 1: 경고 무시하고 진행 (빠른 방법)</h5>
                  <ol className="space-y-1 text-xs text-gray-700 ml-2">
                    <li className="flex items-start gap-1.5">
                      <span className="font-bold text-red-600">1.</span>
                      <span>Chrome 경고 화면에서 <strong>"고급"</strong> 버튼 클릭</span>
                    </li>
                    <li className="flex items-start gap-1.5">
                      <span className="font-bold text-red-600">2.</span>
                      <span>하단 <strong>"{window.location.hostname}(안전하지 않음)으로 이동"</strong> 링크 클릭</span>
                    </li>
                  </ol>
                </div>

                {/* 방법 2: chrome://flags 설정 */}
                <div className="bg-white/90 rounded-lg p-3 border border-red-200">
                  <h5 className="font-bold text-xs text-gray-800 mb-1.5">방법 2: Chrome 설정 변경 (영구 해결)</h5>
                  <ol className="space-y-1 text-xs text-gray-700 ml-2">
                    <li className="flex items-start gap-1.5">
                      <span className="font-bold text-red-600">1.</span>
                      <span>주소창에 <code className="bg-gray-100 px-1 py-0.5 rounded font-mono text-xs">chrome://flags</code> 입력</span>
                    </li>
                    <li className="flex items-start gap-1.5">
                      <span className="font-bold text-red-600">2.</span>
                      <span><code className="bg-gray-100 px-1 py-0.5 rounded font-mono text-xs">Insecure origins</code> 검색</span>
                    </li>
                    <li className="flex items-start gap-1.5">
                      <span className="font-bold text-red-600">3.</span>
                      <span><strong>"Insecure origins treated as secure"</strong>를 <strong>"Enabled"</strong>로 변경</span>
                    </li>
                    <li className="flex items-start gap-1.5">
                      <span className="font-bold text-red-600">4.</span>
                      <span>입력창에 <code className="bg-gray-100 px-1 py-0.5 rounded font-mono text-xs">{window.location.origin}</code> 입력</span>
                    </li>
                    <li className="flex items-start gap-1.5">
                      <span className="font-bold text-red-600">5.</span>
                      <span>Chrome 재시작</span>
                    </li>
                  </ol>
                </div>
              </AlertDescription>
            </div>
          </div>
          <Button
            onClick={handleDismiss}
            variant="ghost"
            size="icon"
            className="flex-shrink-0 h-6 w-6"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
      </Alert>
    </div>
  );
}

