import { Bell } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { useEffect, useState } from "react";
import { useLocation } from "wouter";

export function NotificationBadge() {
  const [hasNewCoupons, setHasNewCoupons] = useState(false);
  const [, setLocation] = useLocation();

  // 기존 총 배지 카운트 — 하위호환 유지 (Number 반환).
  // Phase 3-1 에서도 빨간 점 on/off 판단은 이 값 그대로 사용.
  const { data: unreadCount } = trpc.notifications.getUnreadCount.useQuery(undefined, {
    refetchInterval: 30000, // 30초마다 자동 갱신
  });

  // Phase 3-1 additive — 타입별 카운트로 클릭 시 초기 탭 라우팅 결정.
  // 실패 시 undefined → fallback으로 /map (기존 동선) 유지.
  const { data: unreadByType } = trpc.finder.getUnreadCountByType.useQuery(undefined, {
    refetchInterval: 30000,
  });

  useEffect(() => {
    // 읽지 않은 알림이 있으면 뱃지 표시
    // 이전 "lastChecked" 조건은 버그(lastCheckedTime=0이면 항상 조건 실패)로 제거됨
    setHasNewCoupons(!!unreadCount && unreadCount > 0);
  }, [unreadCount]);

  const handleClick = () => {
    // 알림 클릭 시 localStorage에 현재 시간 저장 (시각적 보조 — 서버 읽음 처리 아님)
    localStorage.setItem('notification-last-checked', new Date().toISOString());
    setHasNewCoupons(false);

    // 유형별 카운트 기준으로 초기 탭 결정:
    //   - 조르기 활성화 알림 있음 → /map?tab=nudge (개인 관련성 우선, 설계 문서 정책)
    //   - 새로 오픈 알림만 있음 → /map?tab=newopen
    //   - 둘 다 0 또는 데이터 미로딩 → /map (기본 탭 'all', 기존 동선)
    //
    // 주의: 여기서 markAsRead/markTabSeen 절대 호출하지 않음.
    //       설계 원칙 — 실제 탭 클릭 시점에만 읽음 처리 (MapPage 에서 처리).
    const nudgeCnt = unreadByType?.nudgeActivated ?? 0;
    const newOpenCnt = unreadByType?.newlyOpenedNearby ?? 0;

    let target = '/map';
    if (nudgeCnt > 0) {
      target = '/map?tab=nudge';
    } else if (newOpenCnt > 0) {
      target = '/map?tab=newopen';
    }
    setLocation(target);
  };

  return (
    <button
      onClick={handleClick}
      className="relative p-2 hover:bg-white/10 rounded-full transition-colors"
      aria-label="알림"
    >
      <Bell className="w-5 h-5 text-white" />
      {hasNewCoupons && (
        <span className="absolute top-1 right-1 flex items-center justify-center w-4 h-4 bg-red-500 rounded-full text-white text-xs font-bold">
          !
        </span>
      )}
    </button>
  );
}
