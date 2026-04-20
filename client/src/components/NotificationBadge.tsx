import { Bell } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { useEffect, useRef, useState } from "react";
import { useLocation } from "wouter";

/**
 * NotificationBadge — 종 모양 + 드롭다운.
 *
 * 동작:
 *   - 배지 숫자: notifications.getUnreadCount 기반 (role 무관, 본인 수신 알림 카운트)
 *   - 클릭 시 드롭다운: notifications.list 최신 30개 로드 → 타입별 태그/아이콘/문구로 렌더
 *   - 개별 항목 클릭 시 markOneAsRead + targetUrl 이동
 *   - 바깥 클릭 시 닫힘
 *
 * role 분리 정책:
 *   - 유저: user.newly_opened / user.nudge_activated / nearby_store / new_coupon 등
 *   - 사업주: general (nudgeDormant 수신), nudge_received 등 본인 수신 알림만
 *   - admin: 렌더 자체는 허용 (호출부에서 분기)
 */

type NotificationType =
  | 'nudge_activated'
  | 'newly_opened_nearby'
  | 'nearby_store'
  | 'new_coupon'
  | 'coupon_expiring'
  | 'mission_complete'
  | 'level_up'
  | 'general';

const TYPE_TAG: Record<NotificationType | 'default', { icon: string; bg: string; tagBg: string; tagText: string; label: string }> = {
  nudge_activated:     { icon: '🔔', bg: 'bg-rose-50',   tagBg: 'bg-rose-100',   tagText: 'text-rose-700',   label: '조르기 쿠폰' },
  newly_opened_nearby: { icon: '✨', bg: 'bg-amber-50',  tagBg: 'bg-amber-100',  tagText: 'text-amber-700',  label: '신규 오픈' },
  nearby_store:        { icon: '📍', bg: 'bg-blue-50',   tagBg: 'bg-blue-100',   tagText: 'text-blue-700',   label: '근처 매장' },
  new_coupon:          { icon: '🎁', bg: 'bg-pink-50',   tagBg: 'bg-pink-100',   tagText: 'text-pink-700',   label: '신규 쿠폰' },
  coupon_expiring:     { icon: '⏳', bg: 'bg-orange-50', tagBg: 'bg-orange-100', tagText: 'text-orange-700', label: '만료 임박' },
  mission_complete:    { icon: '🏆', bg: 'bg-yellow-50', tagBg: 'bg-yellow-100', tagText: 'text-yellow-700', label: '미션 완료' },
  level_up:            { icon: '⬆️', bg: 'bg-green-50',  tagBg: 'bg-green-100',  tagText: 'text-green-700',  label: '레벨업' },
  general:             { icon: '📣', bg: 'bg-gray-50',   tagBg: 'bg-gray-100',   tagText: 'text-gray-700',   label: '알림' },
  default:             { icon: '🔔', bg: 'bg-gray-50',   tagBg: 'bg-gray-100',   tagText: 'text-gray-700',   label: '알림' },
};

function formatRelative(d: string | Date): string {
  const date = typeof d === 'string' ? new Date(d) : d;
  const diff = Date.now() - date.getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return '방금 전';
  if (mins < 60) return `${mins}분 전`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}시간 전`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}일 전`;
  return date.toLocaleDateString('ko-KR');
}

export function NotificationBadge() {
  const [open, setOpen] = useState(false);
  const [, setLocation] = useLocation();
  const wrapRef = useRef<HTMLDivElement>(null);
  const utils = trpc.useUtils();

  const { data: unreadCount } = trpc.notifications.getUnreadCount.useQuery(undefined, {
    refetchInterval: 30000,
  });

  const { data: items = [] } = trpc.notifications.list.useQuery(
    { limit: 30 },
    { enabled: open, refetchOnWindowFocus: false }
  );

  const markOne = trpc.notifications.markOneAsRead.useMutation({
    onSuccess: () => {
      utils.notifications.getUnreadCount.invalidate();
      utils.notifications.list.invalidate();
      utils.finder.getUnreadCountByType.invalidate();
    },
  });

  // 바깥 클릭 감지 — 드롭다운 닫힘
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    const t = setTimeout(() => document.addEventListener('mousedown', onDown), 0);
    return () => { clearTimeout(t); document.removeEventListener('mousedown', onDown); };
  }, [open]);

  const handleItemClick = (item: any) => {
    if (!item.isRead) markOne.mutate({ id: item.id });
    setOpen(false);
    if (item.targetUrl) setLocation(item.targetUrl);
  };

  const badgeCount = unreadCount && unreadCount > 0 ? (unreadCount > 9 ? '9+' : String(unreadCount)) : null;

  return (
    <div ref={wrapRef} className="relative">
      <button
        onClick={() => setOpen(v => !v)}
        className="relative p-2 hover:bg-white/10 rounded-full transition-colors"
        aria-label="알림"
        aria-expanded={open}
      >
        <Bell className="w-5 h-5 text-white" />
        {badgeCount && (
          <span className="absolute top-1 right-1 min-w-[16px] h-4 px-1 flex items-center justify-center bg-red-500 rounded-full text-white text-[10px] font-bold">
            {badgeCount}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-2 w-80 max-w-[90vw] bg-white rounded-2xl shadow-xl border border-gray-100 z-50 overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
            <span className="text-sm font-bold text-gray-900">알림</span>
            <span className="text-xs text-gray-400">
              {items.length > 0 ? `최근 ${items.length}건` : ''}
            </span>
          </div>
          <div className="max-h-[60vh] overflow-y-auto">
            {items.length === 0 ? (
              <div className="px-4 py-8 text-center text-sm text-gray-400">
                아직 알림이 없어요
              </div>
            ) : (
              items.map((item: any) => {
                const tag = TYPE_TAG[(item.type as NotificationType) ?? 'default'] ?? TYPE_TAG.default;
                return (
                  <button
                    key={item.id}
                    onClick={() => handleItemClick(item)}
                    className={`w-full flex items-start gap-3 px-4 py-3 hover:bg-gray-50 border-b border-gray-50 text-left transition-colors ${!item.isRead ? 'bg-blue-50/30' : ''}`}
                  >
                    <div className={`w-9 h-9 rounded-full ${tag.bg} flex items-center justify-center text-base shrink-0`}>
                      {tag.icon}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5 mb-0.5">
                        <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${tag.tagBg} ${tag.tagText}`}>
                          {tag.label}
                        </span>
                        {!item.isRead && <span className="w-1.5 h-1.5 rounded-full bg-red-500" />}
                      </div>
                      {item.title && (
                        <div className="text-[13px] font-semibold text-gray-900 truncate">{item.title}</div>
                      )}
                      {item.message && (
                        <div className="text-[12px] text-gray-500 line-clamp-2 mt-0.5">{item.message}</div>
                      )}
                      <div className="text-[11px] text-gray-400 mt-1">{formatRelative(item.createdAt)}</div>
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}
