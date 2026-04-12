import { useEffect, useState } from "react";
import { trpc } from "@/lib/trpc";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { AlertCircle } from "lucide-react";
import { getDeviceInfo, isMobileChromeWeb } from "@/lib/browserDetect";
import { isCapacitorNative } from "@/lib/capacitor";

// SSOT: window.APP_VERSION (index.html 주입) > import.meta.env > 폴백
const APP_VERSION = window.APP_VERSION || import.meta.env.VITE_APP_VERSION || "1.0.0";

// 실제 강제 업데이트 로직 — Capacitor 네이티브 전용
function ForceUpdateGateInner({ children }: { children: React.ReactNode }) {
  const [isBlocked, setIsBlocked] = useState(false);
  const deviceInfo = getDeviceInfo();

  const { data: versionData } = trpc.deployment.checkVersion.useQuery(
    {
      clientVersion: APP_VERSION,
      deviceType: deviceInfo.deviceType,
      browserType: deviceInfo.browserType,
    },
    {
      refetchInterval: 5 * 60 * 1000,
      refetchOnWindowFocus: false,
    }
  );

  useEffect(() => {
    if (!versionData) return;
    if (versionData.updateMode === 'hard') {
      setIsBlocked(true);
    } else {
      setIsBlocked(false);
    }
  }, [versionData]);

  const handleUpdate = async () => {
    try {
      const cacheNames = await caches.keys();
      await Promise.all(cacheNames.map(name => caches.delete(name)));
      const registrations = await navigator.serviceWorker.getRegistrations();
      await Promise.all(registrations.map(reg => reg.unregister()));
      window.location.reload();
    } catch (error) {
      console.error("Update failed:", error);
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

// 외부 게이트: 모바일 크롬 웹 / 비-Capacitor는 훅 없이 즉시 children 반환
export function ForceUpdateGate({ children }: { children: React.ReactNode }) {
  // 모바일 크롬 웹: 레이어·쿼리 영향 zero — 내부 컴포넌트 마운트 자체 skip
  if (isMobileChromeWeb()) return <>{children}</>;
  // 비-Capacitor 웹 (데스크톱 등): Dialog 절대 뜨지 않음, 쿼리 부하만 있음 → skip
  if (!isCapacitorNative()) return <>{children}</>;
  // Capacitor 네이티브: 강제 업데이트 로직 활성
  return <ForceUpdateGateInner>{children}</ForceUpdateGateInner>;
}
