import { Button } from "@/components/ui/button";
import { MapPin, RefreshCw, Settings, X } from "lucide-react";
import { PermissionStatus, getPermissionDeniedMessage } from "@/hooks/useGeolocation";

interface LocationPermissionBannerProps {
  permissionStatus: PermissionStatus;
  error: string | null;
  isUsingDefaultLocation: boolean;
  isLoading: boolean;
  locationName?: string | null;
  onRequestLocation: () => void;
  onRetry: () => void;
  onDismiss?: () => void;
}

export function LocationPermissionBanner({
  permissionStatus,
  error,
  isUsingDefaultLocation,
  isLoading,
  locationName,
  onRequestLocation,
  onRetry,
  onDismiss,
}: LocationPermissionBannerProps) {
  // 위치 권한이 허용되었고 실제 위치를 사용 중이면 배너 숨김
  if (permissionStatus === 'granted' && !isUsingDefaultLocation) {
    return null;
  }

  // 권한 거부 상태
  if (permissionStatus === 'denied') {
    return (
      <div className="bg-amber-50 border-b border-amber-200 px-4 py-3">
        <div className="max-w-4xl mx-auto flex items-start gap-3">
          <div className="flex-shrink-0 mt-0.5">
            <Settings className="w-5 h-5 text-amber-600" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-amber-800">
              위치 권한이 거부되어 있습니다
            </p>
            <p className="text-xs text-amber-700 mt-1">
              {getPermissionDeniedMessage()}
            </p>
            <p className="text-xs text-amber-600 mt-1">
              현재 {locationName ? `${locationName} 지역` : '기본 위치(서울 명동)'}을 기준으로 표시됩니다.
            </p>
          </div>
          <div className="flex-shrink-0 flex items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              className="text-amber-700 border-amber-300 hover:bg-amber-100"
              onClick={onRetry}
              disabled={isLoading}
            >
              <RefreshCw className={`w-4 h-4 mr-1 ${isLoading ? 'animate-spin' : ''}`} />
              다시 시도
            </Button>
            {onDismiss && (
              <button
                onClick={onDismiss}
                className="text-amber-500 hover:text-amber-700"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }

  // 기본 위치 사용 중 (권한 요청 전 또는 오류 발생)
  if (isUsingDefaultLocation) {
    return (
      <div className="bg-blue-50 border-b border-blue-200 px-4 py-3">
        <div className="max-w-4xl mx-auto flex items-center gap-3">
          <div className="flex-shrink-0">
            <MapPin className="w-5 h-5 text-blue-600" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm text-blue-800">
              {error ? (
                <span className="font-medium">{error}</span>
              ) : (
                <>
                  현재 <span className="font-medium">{locationName ? `${locationName} 지역` : '기본 위치(서울 명동)'}</span>을 기준으로 표시됩니다.
                </>
              )}
            </p>
            <p className="text-xs text-blue-600 mt-0.5">
              정확한 위치 기반 쿠폰을 보려면 위치 권한을 허용해주세요.
            </p>
          </div>
          <div className="flex-shrink-0">
            <Button
              size="sm"
              className="bg-blue-600 hover:bg-blue-700 text-white"
              onClick={onRequestLocation}
              disabled={isLoading}
            >
              {isLoading ? (
                <>
                  <RefreshCw className="w-4 h-4 mr-1 animate-spin" />
                  확인 중...
                </>
              ) : (
                <>
                  <MapPin className="w-4 h-4 mr-1" />
                  내 위치 사용
                </>
              )}
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return null;
}
