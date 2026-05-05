import { useBackgroundLocationGuide } from '@/hooks/useBackgroundLocationGuide';

/**
 * PR-68: 백그라운드 위치 권한 ("항상 허용") 안내 모달.
 *
 * 강도:
 *   - forceMode=false: [설정으로 이동] [나중에] (부드러운, 시점 1/2)
 *   - forceMode=true:  [설정으로 이동] 만 (강제, 시점 3 — Map 차단)
 *
 * 자동 닫힘:
 *   useBackgroundLocation 이 권한 변경 감지 후 'bg-location-perm-granted' 발화 시
 *   hook 이 modalOpen=false 로 자동 set.
 */
export function BackgroundLocationGuideModal() {
  const { modalOpen, forceMode, openSettings, dismiss } = useBackgroundLocationGuide();

  if (!modalOpen) return null;

  return (
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60"
      onClick={(e) => {
        // 강제 모드에서는 배경 클릭으로도 닫히지 않음
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
        <p className="mb-5 text-sm leading-relaxed text-gray-600">
          {forceMode
            ? "지도 기능은 백그라운드 위치 권한이 필요합니다.\n'설정으로 이동' 후 '항상 허용' 으로 변경해 주세요."
            : '이동 중 새 쿠폰 알림을 받으려면 백그라운드 위치 권한이 필요합니다.\n카톡, 네이버지도와 동일한 권한입니다.'}
        </p>

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
