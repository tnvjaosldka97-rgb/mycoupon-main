import { Bell } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { useEffect, useRef, useState } from "react";
import { useLocation } from "wouter";
import { isCapacitorNative } from "@/lib/capacitor";

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
  // server timezone 버그 우회 — ISO 8601 의 "Z" (UTC) 를 KST (+09:00) 로 재해석.
  // 원인: drizzle 의 timestamp() = "timestamp without time zone" + Railway TZ=UTC env
  //       에도 불구하고 INSERT 시 9시간 오프셋 적용 → "Z" 로 표시되지만 실제는 KST 시간.
  // 임시 hack: ISO Z 를 +09:00 로 재해석하여 정확한 epoch 계산.
  // (정공법: drizzle column type → timestamptz 마이그레이션, 별도 작업)
  let date: Date;
  if (typeof d === 'string') {
    const fixed = d.endsWith('Z') ? d.slice(0, -1) + '+09:00' : d;
    date = new Date(fixed);
  } else {
    date = d;
  }
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
  // 드롭다운 열릴 때의 unread 스냅샷 — 헤더 카테고리 요약용.
  // 열자마자 markAsRead 가 실행되어 items 는 이후 read=true 가 되므로,
  // 요약은 "열기 직전 어느 카테고리에서 신규가 몇 건 왔는지" 를 유지해서 사용자가 인지 가능하게 한다.
  const [snapshotCounts, setSnapshotCounts] = useState<Record<string, number>>({});

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

  // 전체 읽음 — 드롭다운 열기 시점에 자동 호출 (배지 즉시 0)
  const markAll = trpc.notifications.markAsRead.useMutation({
    onSuccess: async () => {
      utils.notifications.getUnreadCount.invalidate();
      utils.finder.getUnreadCountByType.invalidate();
      // list 는 invalidate 하지 않음 — 드롭다운 안의 항목 표시는 그대로 유지
      // OS 측 push notification + 앱 아이콘 배지 자동 dismiss (Capacitor 네이티브)
      // → 폰 status bar 의 옛 push 알림 사라지고 앱 아이콘 빨간 배지 clear
      if (isCapacitorNative()) {
        try {
          const { PushNotifications } = await import('@capacitor/push-notifications');
          await PushNotifications.removeAllDeliveredNotifications();
        } catch { /* graceful */ }
        // PR-77: OS 앱 아이콘 배지 카운트 clear (Samsung One UI 등 BADGE_COUNT_UPDATE)
        try {
          const { registerPlugin } = await import('@capacitor/core');
          const BadgeClear = registerPlugin<{ clear: () => Promise<void> }>('BadgeClear');
          await BadgeClear.clear();
        } catch { /* graceful — Pixel/Stock 미지원 */ }
      }
    },
  });

  // 드롭다운 열림 시: 카테고리 스냅샷 저장 + 전체 읽음 처리
  // 사장님 결함 fix: items 가 비어있어도 unreadCount>0 이면 markAll 호출 (배지 안 사라지는 결함 차단)
  useEffect(() => {
    if (!open) return;
    // 1) unread count 가 있으면 무조건 markAll → server unread=0 + OS badge clear
    if (unreadCount && unreadCount > 0) {
      markAll.mutate();
    }
    // 2) items 가 있고 unread 가 있으면 카테고리 스냅샷 저장
    if (items && items.length > 0) {
      const unread = items.filter((it: any) => !it.isRead);
      if (unread.length > 0) {
        const counts: Record<string, number> = {};
        for (const it of unread) {
          counts[it.type] = (counts[it.type] ?? 0) + 1;
        }
        setSnapshotCounts(counts);
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, items.length, unreadCount]);

  // 드롭다운 닫힐 때 스냅샷 초기화 (다음 열 때 새로 계산)
  useEffect(() => {
    if (!open) setSnapshotCounts({});
  }, [open]);

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
    if (item.targetUrl) {
      // PR-81 (사장님 결함 보고 fix): 옛 알림 (/store/${id} 형식 — PR-70-A 이전) 도 panTo 적용.
      //   매장 상세 페이지 진입 절대 X — 항상 map panTo.
      let finalUrl = item.targetUrl as string;
      let storeIdToPan: string | null = null;

      const oldStoreMatch = finalUrl.match(/^\/store\/(\d+)/);
      if (oldStoreMatch) {
        // 옛 알림 강제 변환 — 매장 상세 X, map panTo
        storeIdToPan = oldStoreMatch[1];
        finalUrl = `/map?store=${storeIdToPan}`;
      } else {
        const newStoreMatch = finalUrl.match(/[?&]store=(\d+)/);
        if (newStoreMatch) storeIdToPan = newStoreMatch[1];
      }

      // PR-78 (mount race 100% 차단): sessionStorage pendingMapStoreId 저장
      if (storeIdToPan) {
        try { sessionStorage.setItem('pendingMapStoreId', storeIdToPan); } catch { /* graceful */ }
      }

      setLocation(finalUrl);
      // PR-76 customEvent 도 유지 — 이미 /map 에 있는 경우 즉시 panTo
      try {
        window.dispatchEvent(new CustomEvent('map-pan-to-store-from-notification', {
          detail: { targetUrl: finalUrl },
        }));
      } catch { /* graceful */ }
    }
  };

  const badgeCount = unreadCount && unreadCount > 0 ? (unreadCount > 9 ? '9+' : String(unreadCount)) : null;
  const snapshotEntries = Object.entries(snapshotCounts).filter(([, n]) => n > 0);

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
          {/* 카테고리별 신규 요약 — 어느 쪽에서 신규 이벤트가 발생했는지 한눈에 */}
          {snapshotEntries.length > 0 && (
            <div className="px-4 py-2 bg-gradient-to-r from-rose-50 via-amber-50 to-pink-50 border-b border-gray-100 flex items-center gap-1.5 flex-wrap">
              <span className="text-[10px] font-semibold text-gray-500 mr-1">신규</span>
              {snapshotEntries.map(([type, cnt]) => {
                const tag = TYPE_TAG[(type as NotificationType)] ?? TYPE_TAG.default;
                return (
                  <span
                    key={type}
                    className={`inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full ${tag.tagBg} ${tag.tagText}`}
                  >
                    <span>{tag.icon}</span>
                    <span>{tag.label}</span>
                    <span className="ml-0.5 inline-flex min-w-[14px] h-3.5 px-1 items-center justify-center rounded-full bg-red-500 text-white text-[9px] font-bold">
                      {cnt}
                    </span>
                  </span>
                );
              })}
            </div>
          )}
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
