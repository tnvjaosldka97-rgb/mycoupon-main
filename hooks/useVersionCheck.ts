import { useEffect, useState } from "react";
import { trpc } from "@/lib/trpc";

const APP_VERSION = "1.0.0"; // manifest.json과 동기화

export function useVersionCheck() {
  const [needsForceUpdate, setNeedsForceUpdate] = useState(false);
  const [updateMessage, setUpdateMessage] = useState("");

  const { data: versionData } = trpc.version.check.useQuery(
    { clientVersion: APP_VERSION },
    {
      refetchInterval: false, // 자동 체크 비활성화
      refetchOnWindowFocus: false, // 포커스 시 체크 비활성화
      refetchOnMount: false, // 마운트 시 체크 비활성화
      staleTime: Infinity, // 데이터를 항상 신선하게 유지
    }
  );

  useEffect(() => {
    if (versionData?.needsForceUpdate) {
      setNeedsForceUpdate(true);
      setUpdateMessage(versionData.updateMessage);
    }
  }, [versionData]);

  const handleUpdate = () => {
    // 서비스 워커 강제 업데이트
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.getRegistration().then((registration) => {
        if (registration) {
          registration.update().then(() => {
            // 캐시 클리어 후 새로고침
            caches.keys().then((names) => {
              Promise.all(names.map((name) => caches.delete(name))).then(() => {
                window.location.reload();
              });
            });
          });
        } else {
          // 서비스 워커 없으면 바로 새로고침
          window.location.reload();
        }
      });
    } else {
      window.location.reload();
    }
  };

  return {
    needsForceUpdate,
    updateMessage,
    handleUpdate,
  };
}
