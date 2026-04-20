import { useBuildVersionGuard } from '@/hooks/useBuildVersionGuard';

/**
 * BuildUpdateBanner — 새 빌드가 배포되면 상단 배너로 유저에게 리로드 유도.
 *
 * UX 원칙:
 *   - 유저 action 을 강제 reload 로 끊지 않음 (쿠폰 PIN 입력 중 등)
 *   - 명시적 "지금 업데이트" CTA 로 유저 선택권 보장
 *   - z-index 는 EmergencyBanner / 헤더 그라디언트 위에 오도록 높게
 *   - 닫기 버튼 없음 (옛 빌드로 이탈 방지 — reload 만 정답)
 */
export function BuildUpdateBanner() {
  const { updateAvailable, reload } = useBuildVersionGuard();
  if (!updateAvailable) return null;

  return (
    <div
      className="fixed top-0 left-0 right-0 z-[90] bg-amber-100 border-b border-amber-300 px-4 py-2 flex items-center justify-between gap-2"
      style={{ paddingTop: 'max(8px, env(safe-area-inset-top, 0px))' }}
      role="alert"
      aria-live="polite"
    >
      <span className="text-xs text-amber-900 font-semibold truncate">
        ✨ 마이쿠폰이 업데이트됐어요. 새로고침이 필요해요
      </span>
      <button
        onClick={reload}
        className="shrink-0 text-xs font-bold text-amber-900 bg-amber-300 hover:bg-amber-400 active:scale-95 transition-all px-3 py-1 rounded-full"
        aria-label="지금 업데이트 (페이지 새로고침)"
      >
        지금 업데이트
      </button>
    </div>
  );
}
