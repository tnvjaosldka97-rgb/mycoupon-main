import { useEffect } from "react";
import { trpc } from "@/lib/trpc";
import { getOrCreateSessionId, getDeviceInfo } from "@/lib/browserDetect";

const APP_VERSION = import.meta.env.VITE_APP_VERSION || "1.0.0";

/**
 * 클라이언트 에러 로깅 훅
 * - JS 에러 (window.onerror)
 * - Promise rejection (unhandledrejection)
 * - API 실패
 * - 네트워크 에러
 */
export function useErrorLogger() {
  const sessionId = getOrCreateSessionId();
  const deviceInfo = getDeviceInfo();

  const logErrorMutation = trpc.deployment.logError.useMutation();

  useEffect(() => {
    /**
     * JS 에러 핸들러
     */
    const handleError = (event: ErrorEvent) => {
      logErrorMutation.mutate({
        sessionId,
        appVersion: APP_VERSION,
        errorType: "js_error",
        errorMessage: event.message,
        errorStack: event.error?.stack,
        url: window.location.href,
        userAgent: navigator.userAgent,
        deviceType: deviceInfo.deviceType,
        browserType: deviceInfo.browserType,
        osVersion: deviceInfo.osVersion,
        metadata: {
          filename: event.filename,
          lineno: event.lineno,
          colno: event.colno,
          timestamp: new Date().toISOString(),
        },
      });
    };

    /**
     * Promise rejection 핸들러
     */
    const handleUnhandledRejection = (event: PromiseRejectionEvent) => {
      const reason = event.reason;
      const errorMessage = reason?.message || String(reason);
      const errorStack = reason?.stack || undefined;

      logErrorMutation.mutate({
        sessionId,
        appVersion: APP_VERSION,
        errorType: "promise_rejection",
        errorMessage,
        errorStack,
        url: window.location.href,
        userAgent: navigator.userAgent,
        deviceType: deviceInfo.deviceType,
        browserType: deviceInfo.browserType,
        osVersion: deviceInfo.osVersion,
        metadata: {
          timestamp: new Date().toISOString(),
        },
      });
    };

    // 이벤트 리스너 등록
    window.addEventListener("error", handleError);
    window.addEventListener("unhandledrejection", handleUnhandledRejection);

    // 클린업
    return () => {
      window.removeEventListener("error", handleError);
      window.removeEventListener("unhandledrejection", handleUnhandledRejection);
    };
  }, [sessionId, deviceInfo, logErrorMutation]);

  /**
   * API 실패 에러 로깅
   */
  const logApiError = (errorMessage: string, metadata?: Record<string, any>) => {
    logErrorMutation.mutate({
      sessionId,
      appVersion: APP_VERSION,
      errorType: "api_failure",
      errorMessage,
      url: window.location.href,
      userAgent: navigator.userAgent,
      deviceType: deviceInfo.deviceType,
      browserType: deviceInfo.browserType,
      osVersion: deviceInfo.osVersion,
      metadata: {
        ...metadata,
        timestamp: new Date().toISOString(),
      },
    });
  };

  /**
   * 네트워크 에러 로깅
   */
  const logNetworkError = (errorMessage: string, metadata?: Record<string, any>) => {
    logErrorMutation.mutate({
      sessionId,
      appVersion: APP_VERSION,
      errorType: "network_error",
      errorMessage,
      url: window.location.href,
      userAgent: navigator.userAgent,
      deviceType: deviceInfo.deviceType,
      browserType: deviceInfo.browserType,
      osVersion: deviceInfo.osVersion,
      metadata: {
        ...metadata,
        timestamp: new Date().toISOString(),
      },
    });
  };

  return {
    logApiError,
    logNetworkError,
  };
}
