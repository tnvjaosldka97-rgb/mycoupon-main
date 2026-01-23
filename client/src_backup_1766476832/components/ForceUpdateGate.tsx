import { useEffect, useState } from "react";
import { trpc } from "@/lib/trpc";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { AlertCircle } from "lucide-react";
import { getDeviceInfo } from "@/lib/browserDetect";

// SSOT: window.APP_VERSION (index.html 주입) > import.meta.env > 폴백
const APP_VERSION = window.APP_VERSION || import.meta.env.VITE_APP_VERSION || "1.0.0";

export function ForceUpdateGate({ children }: { children: React.ReactNode }) {
  const [isBlocked, setIsBlocked] = useState(false);
  const deviceInfo = getDeviceInfo();

  // 서버 판정 신뢰: deployment.checkVersion의 updateMode만 사용
  const { data: versionData } = trpc.deployment.checkVersion.useQuery(
    {
      clientVersion: APP_VERSION,
      deviceType: deviceInfo.deviceType,
      browserType: deviceInfo.browserType,
    },
    {
      refetchInterval: 5 * 60 * 1000, // 5분마다 체크
      refetchOnWindowFocus: true,
    }
  );

  useEffect(() => {
    if (!versionData) return;
    
    // 옵션 B: 서버가 반환한 updateMode만 신뢰
    // updateMode === 'hard' → 앱 사용 완전 차단
    // updateMode === 'soft' → 차단 없음 (Modal에서 안내/스킵 처리)
    // updateMode === 'none' → 정상 진입
    if (versionData.updateMode === 'hard') {
      setIsBlocked(true);
    } else {
      setIsBlocked(false);
    }
  }, [versionData]);

  const handleUpdate = async () => {
    try {
      // 캐시 삭제
      const cacheNames = await caches.keys();
      await Promise.all(cacheNames.map(name => caches.delete(name)));
      
      // Service Worker 등록 해제
      const registrations = await navigator.serviceWorker.getRegistrations();
      await Promise.all(registrations.map(reg => reg.unregister()));
      
      // 하드 리로드
      window.location.reload();
    } catch (error) {
      console.error("Update failed:", error);
      // 실패해도 새로고침 시도
      window.location.reload();
    }
  };

  if (isBlocked) {
    return (
      <Dialog open={true}>
        <DialogContent className="sm:max-w-md" onPointerDownOutside={(e) => e.preventDefault()} onEscapeKeyDown={(e) => e.preventDefault()}>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertCircle className="h-5 w-5 text-destructive" />
              필수 업데이트
            </DialogTitle>
            <DialogDescription>
              {versionData?.updateMessage || "필수 업데이트가 필요합니다. 앱을 계속 사용하려면 업데이트해 주세요."}
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-2">
            <Button onClick={handleUpdate} className="w-full">
              지금 업데이트
            </Button>
            <p className="text-xs text-muted-foreground text-center">
              현재 버전: {APP_VERSION}
            </p>
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  return <>{children}</>;
}
