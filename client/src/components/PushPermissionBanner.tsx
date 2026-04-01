import { useState } from 'react';
import { Bell, BellOff, X } from 'lucide-react';
import { useNotificationPermission } from '@/hooks/useNotificationPermission';
import { isCapacitorNative } from '@/lib/capacitor';

/**
 * 푸시 알림 권한 요청 배너
 *
 * 표시 조건:
 *   - Capacitor 앱 환경에서만 표시 (웹 PWA는 별도 흐름)
 *   - 권한이 'default' (아직 요청 안 함) 상태일 때만 표시
 *   - 사용자가 "나중에" 선택 시 localStorage에 기록 → 7일간 미표시
 *
 * 권한 상태별 UX:
 *   default → "알림을 허용하시겠어요?" + [허용] [나중에]
 *   denied  → "알림이 차단됨" + 설정 경로 안내
 *   granted → 렌더링 없음
 */
export function PushPermissionBanner() {
  const { permission, isRequesting, requestPermission, getSettingsGuide, isDenied } =
    useNotificationPermission();
  const [dismissed, setDismissed] = useState(() => {
    try {
      const ts = localStorage.getItem('push-banner-dismissed-until');
      return ts ? Date.now() < parseInt(ts, 10) : false;
    } catch {
      return false;
    }
  });
  const [showDeniedGuide, setShowDeniedGuide] = useState(false);

  // Capacitor 앱 환경에서만 표시
  if (!isCapacitorNative()) return null;
  // 이미 dismissed 처리됐으면 숨김
  if (dismissed) return null;
  // granted 상태: 표시 불필요
  if (permission === 'granted' || permission === 'unsupported') return null;

  const handleAllow = async () => {
    const result = await requestPermission();
    if (result === 'denied') setShowDeniedGuide(true);
  };

  const handleLater = () => {
    try {
      // 7일간 미표시
      localStorage.setItem(
        'push-banner-dismissed-until',
        String(Date.now() + 7 * 24 * 60 * 60 * 1000)
      );
    } catch {}
    setDismissed(true);
  };

  // 영구 거부 → 설정 안내
  if (isDenied || showDeniedGuide) {
    return (
      <div className="mx-4 mt-3 rounded-xl border border-orange-200 bg-orange-50 p-4">
        <div className="flex items-start gap-3">
          <BellOff className="mt-0.5 h-5 w-5 shrink-0 text-orange-400" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-orange-800">알림이 차단되어 있어요</p>
            <p className="mt-1 text-xs text-orange-700 leading-relaxed">
              쿠폰 만료 알림을 받으려면 직접 허용해 주세요.
            </p>
            <p className="mt-1 text-xs text-orange-600 font-mono bg-orange-100 rounded px-2 py-1">
              {getSettingsGuide()}
            </p>
          </div>
          <button
            onClick={handleLater}
            className="shrink-0 rounded-lg p-1 text-orange-400 hover:bg-orange-100"
            aria-label="닫기"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>
    );
  }

  // default 상태 → 권한 요청 배너
  return (
    <div className="mx-4 mt-3 rounded-xl border border-orange-200 bg-orange-50 p-4">
      <div className="flex items-start gap-3">
        <Bell className="mt-0.5 h-5 w-5 shrink-0 text-orange-500" />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-orange-800">쿠폰 만료 알림 받기</p>
          <p className="mt-0.5 text-xs text-orange-600">
            받은 쿠폰이 만료되기 전에 알려드릴게요
          </p>
          <div className="mt-3 flex gap-2">
            <button
              onClick={handleAllow}
              disabled={isRequesting}
              className="rounded-lg bg-orange-500 px-4 py-1.5 text-xs font-semibold text-white hover:bg-orange-600 disabled:opacity-60 transition-colors"
            >
              {isRequesting ? '요청 중...' : '허용하기'}
            </button>
            <button
              onClick={handleLater}
              className="rounded-lg border border-orange-300 px-4 py-1.5 text-xs font-medium text-orange-600 hover:bg-orange-100 transition-colors"
            >
              나중에
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
