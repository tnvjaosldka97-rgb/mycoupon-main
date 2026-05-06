import { useBackgroundLocationGuide } from '@/hooks/useBackgroundLocationGuide';

/**
 * PR-68 — 백그라운드 위치 권한 ("항상 허용") 안내 모달.
 *
 * 사장님 명시 강도 (모든 시점 강제):
 *   forceMode=true 시 dismiss 차단 ([설정으로 이동] 만 표시, 닫기 X)
 *
 * 자동 닫힘:
 *   useBackgroundLocation 이 권한 변경 감지 후 'bg-location-perm-granted' 발화 시
 *   hook 이 modalOpen=false 자동 set.
 */
export function BackgroundLocationGuideModal() {
  const { modalOpen, forceMode, openSettings, dismiss } = useBackgroundLocationGuide();

  if (!modalOpen) return null;

  return (
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60"
      onClick={(e) => {
        if (forceMode) return;
        if (e.target === e.currentTarget) dismiss();
      }}
    >
      <div className="mx-4 w-full max-w-sm rounded-2xl bg-white p-6 shadow-xl">
        <h2 className="mb-3 text-lg font-bold text-gray-900">
          {forceMode
            ? '지도 기능에는 위치 권한이 필요합니다'
            : "위치 권한을 '항상 허용' 으로 변경해 주세요"}
        </h2>
        <p className="mb-3 text-sm leading-relaxed text-gray-600">
          이동 중 새 쿠폰 알림을 받으려면 백그라운드 위치 권한이 필요합니다.
        </p>
        {/* PR-74 (사장님 명시): 단계별 명시 — 사용자 인지 가이드 강화 */}
        <div className="mb-4 rounded-lg bg-orange-50 p-3 text-sm text-gray-700">
          <p className="mb-2 font-semibold text-orange-700">설정 단계:</p>
          <ol className="space-y-1 pl-1">
            <li>1️⃣ [설정으로 이동] 클릭</li>
            <li>2️⃣ 화면에서 [권한] 항목 선택</li>
            <li>3️⃣ [위치] 선택</li>
            <li>4️⃣ [항상 허용] 라디오 선택</li>
          </ol>
        </div>

        <div className="flex flex-col gap-2">
          <button
            type="button"
            onClick={() => { void openSettings(); }}
            className="rounded-lg bg-orange-500 px-4 py-3 text-sm font-semibold text-white hover:bg-orange-600"
          >
            설정으로 이동
          </button>

          {!forceMode && (
            <button
              type="button"
              onClick={dismiss}
              className="rounded-lg bg-gray-100 px-4 py-3 text-sm font-medium text-gray-700 hover:bg-gray-200"
            >
              나중에
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
