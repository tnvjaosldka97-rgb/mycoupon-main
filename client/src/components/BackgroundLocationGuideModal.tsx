import { useBackgroundLocationGuide } from '@/hooks/useBackgroundLocationGuide';

/**
 * PR-93 — 백그라운드 위치 권한 안내 모달 (단순 정보성).
 *
 * 사장님 명시 — 이점 정도만 안내:
 *   - 액션 버튼 0개 (capacitor-native-settings 호출 영구 포기)
 *   - dismiss 2가지: X 버튼 (우측 상단) / 외부 영역 터치
 *   - useEffect 0개 (plugin warm-up X)
 *
 * 5중 안전망 적용. 결함 재발 시 즉시 영구 삭제 fallback 합의.
 */
export function BackgroundLocationGuideModal() {
  const { modalOpen, dismiss } = useBackgroundLocationGuide();

  if (!modalOpen) return null;

  return (
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60"
      onClick={(e) => {
        if (e.target === e.currentTarget) dismiss();
      }}
    >
      <div className="relative mx-4 w-full max-w-sm rounded-2xl bg-white p-6 shadow-xl">
        <button
          type="button"
          onClick={dismiss}
          aria-label="닫기"
          className="absolute right-3 top-3 flex h-8 w-8 items-center justify-center rounded-full text-gray-400 hover:bg-gray-100 hover:text-gray-700"
        >
          <span className="text-xl leading-none">×</span>
        </button>

        <h2 className="mb-4 pr-8 text-lg font-bold text-gray-900">
          위치 권한 '항상 허용' 으로 더 빠른 쿠폰을!
        </h2>

        <p className="mb-3 text-sm text-gray-700">
          '항상 허용' 으로 설정하면 이런 혜택을 받습니다:
        </p>

        <div className="space-y-3 rounded-lg bg-orange-50 p-4 text-sm text-gray-700">
          <div>
            <p className="font-semibold text-orange-700">✨ 빠른 쿠폰 선점</p>
            <p className="mt-1 text-xs text-gray-600">
              매장 근처 진입 즉시 알림 → 누구보다 먼저 쿠폰 확보
            </p>
          </div>
          <div>
            <p className="font-semibold text-orange-700">🎯 이동 중에도 자동 발견</p>
            <p className="mt-1 text-xs text-gray-600">
              폰 화면을 안 봐도 새 쿠폰 자동 알림
            </p>
          </div>
          <div>
            <p className="font-semibold text-orange-700">🔋 배터리 영향 미미</p>
            <p className="mt-1 text-xs text-gray-600">
              50m 이상 이동 시에만 위치 확인
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
