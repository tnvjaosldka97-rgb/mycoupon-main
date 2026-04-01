import { Bell } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { useEffect, useState } from "react";
import { useLocation } from "wouter";

export function NotificationBadge() {
  const [hasNewCoupons, setHasNewCoupons] = useState(false);
  const [, setLocation] = useLocation();
  const { data: unreadCount } = trpc.notifications.getUnreadCount.useQuery(undefined, {
    refetchInterval: 30000, // 30초마다 자동 갱신
  });

  useEffect(() => {
    // 읽지 않은 알림이 있으면 뱃지 표시
    // 이전 "lastChecked" 조건은 버그(lastCheckedTime=0이면 항상 조건 실패)로 제거됨
    setHasNewCoupons(!!unreadCount && unreadCount > 0);
  }, [unreadCount]);

  const handleClick = () => {
    // 알림 클릭 시 localStorage에 현재 시간 저장
    localStorage.setItem('notification-last-checked', new Date().toISOString());
    setHasNewCoupons(false);
    
    // 쿠폰 찾기 페이지로 이동
    setLocation('/map');
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
