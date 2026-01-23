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
    // localStorage에서 마지막 확인 시간 가져오기
    const lastCheckedAt = localStorage.getItem('notification-last-checked');
    const lastCheckedTime = lastCheckedAt ? new Date(lastCheckedAt).getTime() : 0;
    const currentTime = Date.now();
    
    // 24시간 이내에 신규 쿠폰이 있는지 확인
    if (unreadCount && unreadCount > 0 && currentTime - lastCheckedTime < 24 * 60 * 60 * 1000) {
      setHasNewCoupons(true);
    } else {
      setHasNewCoupons(false);
    }
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
