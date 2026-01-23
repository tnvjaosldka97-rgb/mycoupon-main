import { useEffect, useState } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { X, AlertTriangle, Info, AlertCircle } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { getOrCreateSessionId, getDeviceInfo } from "@/lib/browserDetect";

const APP_VERSION = import.meta.env.VITE_APP_VERSION || "1.0.0";

/**
 * 긴급 공지 배너 컴포넌트
 * - 서버에서 제어 가능한 긴급 공지/차단 배너
 * - 타겟팅: 특정 버전/브라우저/OS
 */
export function EmergencyBanner() {
  const [banners, setBanners] = useState<any[]>([]);
  const [dismissedBanners, setDismissedBanners] = useState<Set<number>>(new Set());

  const sessionId = getOrCreateSessionId();
  const deviceInfo = getDeviceInfo();

  // 활성 배너 조회
  const { data: activeBanners } = trpc.deployment.getActiveBanners.useQuery(
    {
      appVersion: APP_VERSION,
      browserType: deviceInfo.browserType,
      osType: deviceInfo.osType,
    },
    {
      refetchInterval: 60 * 1000, // 1분마다 체크
      refetchOnWindowFocus: true,
    }
  );

  // 배너 상호작용 로깅
  const logInteractionMutation = trpc.deployment.logBannerInteraction.useMutation();

  useEffect(() => {
    if (activeBanners && activeBanners.length > 0) {
      setBanners(activeBanners);

      // 배너 노출 이벤트 로깅
      activeBanners.forEach((banner) => {
        const hasViewed = sessionStorage.getItem(`banner_viewed_${banner.id}`);
        if (!hasViewed) {
          logInteractionMutation.mutate({
            bannerId: banner.id,
            sessionId,
            interactionType: "view",
          });
          sessionStorage.setItem(`banner_viewed_${banner.id}`, "true");
        }
      });
    }
  }, [activeBanners, sessionId, logInteractionMutation]);

  const handleDismiss = (bannerId: number) => {
    // 배너 닫기 이벤트 로깅
    logInteractionMutation.mutate({
      bannerId,
      sessionId,
      interactionType: "dismiss",
    });

    setDismissedBanners((prev) => new Set(prev).add(bannerId));
    localStorage.setItem(`banner_dismissed_${bannerId}`, "true");
  };

  const handleClick = (banner: any) => {
    if (banner.linkUrl) {
      // 배너 클릭 이벤트 로깅
      logInteractionMutation.mutate({
        bannerId: banner.id,
        sessionId,
        interactionType: "click",
      });

      window.open(banner.linkUrl, "_blank");
    }
  };

  const getIcon = (type: string) => {
    switch (type) {
      case "error":
        return <AlertTriangle className="h-5 w-5" />;
      case "warning":
        return <AlertCircle className="h-5 w-5" />;
      case "maintenance":
        return <AlertCircle className="h-5 w-5" />;
      default:
        return <Info className="h-5 w-5" />;
    }
  };

  const getVariant = (type: string) => {
    switch (type) {
      case "error":
        return "destructive";
      default:
        return "default";
    }
  };

  const visibleBanners = banners.filter(
    (banner) =>
      !dismissedBanners.has(banner.id) &&
      !localStorage.getItem(`banner_dismissed_${banner.id}`)
  );

  if (visibleBanners.length === 0) {
    return null;
  }

  return (
    <div className="fixed top-0 left-0 right-0 z-50 space-y-2 p-4">
      {visibleBanners.map((banner) => (
        <Alert key={banner.id} variant={getVariant(banner.type)} className="shadow-lg">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-start gap-3 flex-1">
              {getIcon(banner.type)}
              <div className="flex-1">
                <AlertTitle className="font-semibold">{banner.title}</AlertTitle>
                <AlertDescription className="mt-1">{banner.content}</AlertDescription>
                {banner.linkUrl && banner.linkText && (
                  <Button
                    onClick={() => handleClick(banner)}
                    variant="outline"
                    size="sm"
                    className="mt-3"
                  >
                    {banner.linkText}
                  </Button>
                )}
              </div>
            </div>
            <Button
              onClick={() => handleDismiss(banner.id)}
              variant="ghost"
              size="icon"
              className="flex-shrink-0"
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        </Alert>
      ))}
    </div>
  );
}
