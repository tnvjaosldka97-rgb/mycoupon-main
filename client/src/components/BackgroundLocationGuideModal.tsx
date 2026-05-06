import { useBackgroundLocationGuide } from '@/hooks/useBackgroundLocationGuide';

/**
 * PR-68 / PR-91-C / PR-91-E — 백그라운드 위치 권한 안내 모달 (사장님 컨펌).
 *
 * PR-91-E 사장님 명시 — 정보성 팝업:
 *   - 액션 버튼 모두 제거 ([항상 허용 설정하러 가기] / [나중에 하기])
 *   - dismiss 2가지: 우측 상단 [×] 버튼 / 외부 영역 (modal backdrop) 터치
 *   - 본문 = 메리트 설명 + OS 직접 루트 안내
 *
 * 자동 닫힘:
 *   useBackgroundLocation 이 권한 변경 감지 후 'bg-location-perm-granted' 발화 시 자동 close.
 *   dismiss 후 그 세션 동안 재발화 차단 (hook dismissedRef).
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

        <div className="mb-5 space-y-3 rounded-lg bg-orange-50 p-4 text-sm text-gray-700">
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
            <p className="font-semibold text-orange-700">🔋 배터리 영향 최소화</p>
            <p className="mt-1 text-xs text-gray-600">
              50m 이상 이동 시에만 위치 확인 (사용량 미미)
            </p>
          </div>
        </div>

        <div className="rounded-lg bg-gray-50 p-3 text-xs text-gray-600">
          <p className="mb-2 font-semibold text-gray-700">설정 방법:</p>
          <p className="leading-relaxed">
            폰 [설정 ⚙️] → [애플리케이션] → [마이쿠폰] → [권한] → [위치] → [항상 허용]
          </p>
        </div>
      </div>
    </div>
  );
}
