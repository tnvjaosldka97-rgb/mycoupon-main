import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { AlertCircle, ExternalLink, X } from "lucide-react";
import { isAndroid, isIOS, redirectToChrome, redirectToSafari, getInAppBrowserName } from "@/lib/browserDetect";

interface InAppBrowserRedirectModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * 카톡 인앱 브라우저에서 접속 시 표시되는 모달
 * Chrome/Safari로 이동하여 앱을 설치하도록 안내
 */
export function InAppBrowserRedirectModal({ open, onOpenChange }: InAppBrowserRedirectModalProps) {
  const [browserName, setBrowserName] = useState<string>("인앱 브라우저");
  const isAndroidDevice = isAndroid();
  const isIOSDevice = isIOS();

  useEffect(() => {
    const name = getInAppBrowserName() || "인앱 브라우저";
    setBrowserName(name);
  }, []);

  const handleRedirect = () => {
    const currentUrl = new URL(window.location.href);
    currentUrl.searchParams.set('install', 'true');
    currentUrl.searchParams.set('from', 'kakao');
    
    if (isAndroidDevice) {
      // Android: Chrome으로 리다이렉트
      redirectToChrome(currentUrl.toString());
    } else if (isIOSDevice) {
      // iOS: Safari로 리다이렉트
      redirectToSafari(currentUrl.toString());
    }
    
    // 리다이렉트 후 모달 닫기
    onOpenChange(false);
  };

  const handleClose = () => {
    // 모달 닫기
    onOpenChange(false);
    // 창 닫기 시도 (일부 브라우저에서는 작동하지 않을 수 있음)
    try {
      window.close();
    } catch (e) {
      console.log('[InAppBrowserRedirectModal] 창 닫기 실패 (일부 브라우저에서는 지원하지 않음)');
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md rounded-2xl p-6 text-center" showCloseButton={false}>
        <DialogHeader>
          <div className="flex justify-center mb-4">
            <div className="w-20 h-20 rounded-full bg-gradient-to-br from-orange-100 to-pink-100 flex items-center justify-center">
              <AlertCircle className="w-10 h-10 text-orange-600" />
            </div>
          </div>
          <DialogTitle className="text-2xl font-bold text-primary">
            외부 브라우저로 이동 필요
          </DialogTitle>
          <DialogDescription className="text-muted-foreground mt-3 text-base leading-relaxed">
            <span className="font-semibold text-orange-600">{browserName}</span>에서는 앱을 설치할 수 없습니다.
            <br />
            <br />
            <span className="font-bold text-primary">
              {isAndroidDevice ? 'Chrome' : isIOSDevice ? 'Safari' : '외부 브라우저'}로 이동하여
              <br />
              앱을 설치해주세요.
            </span>
          </DialogDescription>
        </DialogHeader>

        <div className="mt-6 space-y-4">
          <div className="bg-gradient-to-br from-orange-50 to-pink-50 rounded-lg p-4 text-sm text-left border border-orange-200">
            <p className="text-orange-800 font-medium mb-2 flex items-center gap-2">
              <ExternalLink className="w-4 h-4" />
              설치 방법:
            </p>
            <ol className="list-decimal list-inside space-y-2 text-orange-700">
              {isAndroidDevice ? (
                <>
                  <li>아래 버튼을 눌러 Chrome으로 이동</li>
                  <li>Chrome에서 자동으로 설치 팝업이 표시됩니다</li>
                  <li>"설치" 버튼을 눌러 앱을 설치하세요</li>
                </>
              ) : isIOSDevice ? (
                <>
                  <li>아래 버튼을 눌러 Safari로 이동</li>
                  <li>Safari에서 공유 버튼 → "홈 화면에 추가" 선택</li>
                  <li>홈 화면의 앱 아이콘을 눌러 실행하세요</li>
                </>
              ) : (
                <>
                  <li>아래 버튼을 눌러 외부 브라우저로 이동</li>
                  <li>브라우저에서 앱 설치 안내를 따라주세요</li>
                </>
              )}
            </ol>
          </div>
        </div>

        <div className="mt-6 space-y-2">
          <Button 
            onClick={handleRedirect}
            className="w-full rounded-xl bg-gradient-to-r from-primary to-accent text-white text-lg font-bold py-6"
            size="lg"
          >
            <ExternalLink className="w-5 h-5 mr-2" />
            {isAndroidDevice ? 'Chrome으로 이동' : isIOSDevice ? 'Safari로 이동' : '외부 브라우저로 이동'}
          </Button>
          <Button
            variant="outline"
            onClick={handleClose}
            className="w-full rounded-xl"
          >
            <X className="w-4 h-4 mr-2" />
            닫기
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

