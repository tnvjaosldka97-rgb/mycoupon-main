import { useEffect, useState } from "react";
import { AlertDialog, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { AlertTriangle, RefreshCw } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { getDeviceInfo } from "@/lib/browserDetect";

// SSOT: window.APP_VERSION (index.html 주입) > import.meta.env > 폴백
const APP_VERSION = window.APP_VERSION || import.meta.env.VITE_APP_VERSION || "1.0.0";

// Soft Update 스킵 제한 상수
const SOFT_SKIP_DURATION_MS = 24 * 60 * 60 * 1000; // 24시간
const SOFT_SKIP_KEY = 'mycoupon_soft_update_skip_until';

interface ForceUpdateModalProps {
  onDismiss?: () => void;
}

/**
 * 강제 업데이트 모달
 * - Hard 모드: 사용 차단 (필수 업데이트)
 * - Soft 모드: 경고 표시 + "나중에" 허용
 */
export default function ForceUpdateModal({ onDismiss }: ForceUpdateModalProps) {
  const [open, setOpen] = useState(false);
  const [updateMode, setUpdateMode] = useState<"none" | "soft" | "hard">("none");
  const [updateMessage, setUpdateMessage] = useState<string>("");
  const [updateUrl, setUpdateUrl] = useState<string | null>(null);

  const deviceInfo = getDeviceInfo();

  // 버전 체크
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

    const mode = versionData.updateMode;
    setUpdateMode(mode);
    setUpdateMessage(versionData.updateMessage || "");
    setUpdateUrl(versionData.updateUrl || null);

    if (mode === "hard") {
      // 하드 블록: 무조건 모달 표시 (스킵 무시)
      setOpen(true);
    } else if (mode === "soft") {
      // Soft 스킵 제한 체크
      const skipUntilStr = localStorage.getItem(SOFT_SKIP_KEY);
      const skipUntil = skipUntilStr ? parseInt(skipUntilStr, 10) : 0;
      const now = Date.now();

      if (now < skipUntil) {
        // 스킵 기간 중: 모달 표시 안 함
        console.log('[Soft Update] 스킵 기간 중:', new Date(skipUntil).toLocaleString());
        setOpen(false);
        return;
      }

      // 스킵 기간 만료: 모달 표시
      console.log('[Soft Update] 스킵 기간 만료, 모달 표시');
      setOpen(true);
    }
  }, [versionData]);

  const handleUpdate = () => {
    if (updateUrl) {
      window.location.href = updateUrl;
    } else {
      // 기본 동작: 페이지 새로고침
      window.location.reload();
    }
  };

  const handleDismiss = () => {
    if (updateMode === "soft") {
      // 24시간 스킵 설정
      const skipUntil = Date.now() + SOFT_SKIP_DURATION_MS;
      localStorage.setItem(SOFT_SKIP_KEY, skipUntil.toString());
      console.log('[Soft Update] 24시간 스킵 설정:', new Date(skipUntil).toLocaleString());
      
      setOpen(false);
      onDismiss?.();
    }
  };

  if (updateMode === "none") {
    return null;
  }

  return (
    <AlertDialog open={open}>
      <AlertDialogContent className="max-w-md">
        <AlertDialogHeader>
          <div className="flex items-center gap-3 mb-2">
            <div className={`w-12 h-12 rounded-full flex items-center justify-center ${
              updateMode === "hard" ? "bg-red-100" : "bg-blue-100"
            }`}>
              {updateMode === "hard" ? (
                <AlertTriangle className="w-6 h-6 text-red-600" />
              ) : (
                <RefreshCw className="w-6 h-6 text-blue-600" />
              )}
            </div>
            <AlertDialogTitle className="text-xl">
              {updateMode === "hard" ? "필수 업데이트" : "업데이트 권장"}
            </AlertDialogTitle>
          </div>
          <AlertDialogDescription className="text-base">
            {updateMessage || (
              updateMode === "hard" 
                ? "필수 업데이트가 필요합니다. 앱을 업데이트해주세요." 
                : "새로운 버전이 있습니다. 업데이트를 권장합니다."
            )}
            {updateMode === "hard" && (
              <>
                <br /><br />
                <strong>앱을 계속 사용하려면 업데이트가 필요합니다.</strong>
              </>
            )}
          </AlertDialogDescription>
        </AlertDialogHeader>

        <AlertDialogFooter className="flex-col gap-2 sm:flex-col">
          <Button onClick={handleUpdate} className="w-full" size="lg">
            {updateMode === "hard" ? "지금 업데이트" : "업데이트"}
          </Button>

          {updateMode === "soft" && (
            <Button variant="outline" onClick={handleDismiss} className="w-full" size="lg">
              나중에 (24시간 후 재알림)
            </Button>
          )}
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
