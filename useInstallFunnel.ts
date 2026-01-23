import { useEffect, useCallback } from "react";
import { trpc } from "@/lib/trpc";
import { getOrCreateSessionId, getDeviceInfo } from "@/lib/browserDetect";

const APP_VERSION = import.meta.env.VITE_APP_VERSION || "1.0.0";

/**
 * 설치 퍼널 이벤트 추적 훅
 * - landing_view: 랜딩 페이지 조회
 * - install_cta_view: 설치 안내 노출
 * - install_cta_click: 설치 버튼 클릭
 * - appinstalled: PWA 설치 완료
 * - first_open_standalone: PWA 첫 실행
 * - login_complete: 로그인 완료
 */
export function useInstallFunnel() {
  const sessionId = getOrCreateSessionId();
  const deviceInfo = getDeviceInfo();

  const logEventMutation = trpc.deployment.logInstallEvent.useMutation();

  /**
   * 이벤트 로깅 함수
   */
  const logEvent = useCallback(
    (
      eventType:
        | "landing_view"
        | "install_cta_view"
        | "install_cta_click"
        | "appinstalled"
        | "first_open_standalone"
        | "login_complete",
      metadata?: Record<string, any>
    ) => {
      logEventMutation.mutate({
        sessionId,
        eventType,
        deviceType: deviceInfo.deviceType,
        browserType: deviceInfo.browserType,
        osVersion: deviceInfo.osVersion,
        appVersion: APP_VERSION,
        referrer: document.referrer || undefined,
        metadata,
      });
    },
    [sessionId, deviceInfo, logEventMutation]
  );

  /**
   * 랜딩 페이지 조회 이벤트 (페이지 로드 시 자동)
   */
  useEffect(() => {
    const hasLogged = sessionStorage.getItem("funnel_landing_view");
    if (!hasLogged) {
      logEvent("landing_view", {
        url: window.location.href,
        timestamp: new Date().toISOString(),
      });
      sessionStorage.setItem("funnel_landing_view", "true");
    }
  }, [logEvent]);

  /**
   * PWA 설치 완료 이벤트 (beforeinstallprompt 이후)
   */
  useEffect(() => {
    const handleAppInstalled = () => {
      logEvent("appinstalled", {
        timestamp: new Date().toISOString(),
      });
    };

    window.addEventListener("appinstalled", handleAppInstalled);
    return () => window.removeEventListener("appinstalled", handleAppInstalled);
  }, [logEvent]);

  /**
   * PWA 첫 실행 이벤트 (standalone 모드)
   */
  useEffect(() => {
    if (deviceInfo.isPWA) {
      const hasLogged = localStorage.getItem("funnel_first_open_standalone");
      if (!hasLogged) {
        logEvent("first_open_standalone", {
          timestamp: new Date().toISOString(),
        });
        localStorage.setItem("funnel_first_open_standalone", "true");
      }
    }
  }, [deviceInfo.isPWA, logEvent]);

  return {
    logEvent,
    /**
     * 설치 안내 노출 이벤트
     */
    logInstallCtaView: (metadata?: Record<string, any>) => {
      logEvent("install_cta_view", metadata);
    },
    /**
     * 설치 버튼 클릭 이벤트
     */
    logInstallCtaClick: (metadata?: Record<string, any>) => {
      logEvent("install_cta_click", metadata);
    },
    /**
     * 로그인 완료 이벤트
     */
    logLoginComplete: (metadata?: Record<string, any>) => {
      logEvent("login_complete", metadata);
    },
  };
}
