import { useAuth } from "@/hooks/useAuth";
import { useGeolocation } from "@/hooks/useGeolocation";
import { useLocationNotifications } from "@/hooks/useLocationNotifications";
import { LocationPermissionBanner } from "@/components/LocationPermissionBanner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { MapView } from "@/components/Map";
import { Navigation, Gift, Clock, X, User, LogOut, Menu, Phone, MapPin, Tag, ChevronDown, ChevronUp, Trash2, Store, CheckCircle, Search, SlidersHorizontal } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuSeparator } from "@/components/ui/dropdown-menu";
import { trpc } from "@/lib/trpc";
import { getTierColor, getCouponTierBadgeStyle } from "@/lib/tierColors";
import { useState, useEffect, useCallback, useRef, useMemo, memo } from "react";
import { Link, useLocation } from 'wouter';
import { getLoginUrl } from '@/lib/const';
import { openGoogleLogin } from '@/lib/capacitor';
import { DemographicModal } from '@/components/DemographicModal';
import { NotificationBadge } from '@/components/NotificationBadge';
import { toast } from "@/components/ui/sonner";
import { Spinner } from "@/components/ui/spinner";
import {
  USER_ALERT_DEFAULT_RADIUS_M,
  USER_ALERT_RADIUS_OPTIONS_M,
  USER_ALERT_RADAR_STYLE,
  type UserAlertRadiusM,
  type UserAlertTab,
} from "@shared/const";

/* ── 스와이프 다운으로 닫을 수 있는 바텀시트 ───────────────────
 * 드래그 핸들을 아래로 스와이프하면 자연스럽게 닫힘
 * ──────────────────────────────────────────────────────────── */
function SwipeableBottomSheet({
  children,
  onClose,
}: {
  children: React.ReactNode;
  onClose: () => void;
}) {
  const [dragY, setDragY] = useState(0);
  const startYRef = useRef<number | null>(null);
  const isDraggingRef = useRef(false);
  const sheetRef = useRef<HTMLDivElement>(null);

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    startYRef.current = e.touches[0].clientY;
    isDraggingRef.current = true;
    setDragY(0);
  }, []);

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    if (!isDraggingRef.current || startYRef.current === null) return;
    const dy = e.touches[0].clientY - startYRef.current;
    if (dy > 0) setDragY(dy); // 아래로만 허용
  }, []);

  const handleTouchEnd = useCallback(() => {
    isDraggingRef.current = false;
    if (dragY > 80) {
      onClose(); // 80px 이상 드래그하면 닫힘
    } else {
      setDragY(0); // 복귀
    }
    startYRef.current = null;
  }, [dragY, onClose]);

  return (
    <>
      {/* 투명 탭-아웃 닫기 배경 */}
      <div
        className="fixed inset-0 z-30"
        onClick={onClose}
      />
      {/* 바텀시트 패널 */}
      <div
        ref={sheetRef}
        className="fixed bottom-0 left-0 right-0 z-40 bg-white rounded-t-3xl shadow-[0_-4px_24px_rgba(0,0,0,0.15)] overflow-y-auto"
        style={{
          maxHeight: '45vh',
          paddingBottom: 'env(safe-area-inset-bottom, 0px)',
          transform: `translateY(${dragY}px)`,
          transition: isDraggingRef.current ? 'none' : 'transform 0.25s ease',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* 드래그 핸들 — 터치 다운 감지 */}
        <div
          className="flex justify-center pt-3 pb-1 sticky top-0 bg-white z-10 cursor-grab active:cursor-grabbing"
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
        >
          <div className="w-12 h-1.5 bg-gray-300 rounded-full" />
        </div>
        {children}
      </div>
    </>
  );
}

/* ── 할인 필터 타입 + 헬퍼 ───────────────────────────────────────
 * 유저가 원하는 할인 범위·카테고리로 매장·쿠폰을 좁힘.
 * null = 미지정(해당 조건 무시). 모두 null + freebie=false + categories=[] 면 필터 미적용.
 * ──────────────────────────────────────────────────────────── */
export interface DiscountFilter {
  percentMin: number | null;  // % 할인 최소치 (0~100)
  percentMax: number | null;  // % 할인 최대치
  amountMin: number | null;   // 원 할인 최소치
  amountMax: number | null;   // 원 할인 최대치
  freebie: boolean;           // 무료증정 포함
  categories: string[];       // 복수 카테고리 (cafe, restaurant, ...)
}

export const EMPTY_DISCOUNT_FILTER: DiscountFilter = {
  percentMin: null, percentMax: null,
  amountMin: null, amountMax: null,
  freebie: false, categories: [],
};

export function hasActiveDiscountFilter(f: DiscountFilter): boolean {
  return f.percentMin !== null || f.percentMax !== null ||
    f.amountMin !== null || f.amountMax !== null ||
    f.freebie || f.categories.length > 0;
}

/** 쿠폰 1건이 할인 필터 조건 중 하나라도 충족하는지 (OR 조합).
 *  percent/amount/freebie 중 활성화된 조건을 체크. */
export function couponMatchesDiscountFilter(
  coupon: { discountType: string; discountValue: number },
  f: DiscountFilter
): boolean {
  // freebie
  if (f.freebie && coupon.discountType === 'freebie') return true;
  // percent
  const hasPercent = f.percentMin !== null || f.percentMax !== null;
  if (hasPercent && coupon.discountType === 'percentage') {
    const min = f.percentMin ?? 0;
    const max = f.percentMax ?? 100;
    if (coupon.discountValue >= min && coupon.discountValue <= max) return true;
  }
  // amount (원)
  const hasAmount = f.amountMin !== null || f.amountMax !== null;
  if (hasAmount && coupon.discountType === 'fixed') {
    const min = f.amountMin ?? 0;
    const max = f.amountMax ?? Number.MAX_SAFE_INTEGER;
    if (coupon.discountValue >= min && coupon.discountValue <= max) return true;
  }
  // 활성 조건이 하나도 없으면 (카테고리만 있는 경우 등) 쿠폰 레벨 필터는 통과
  if (!f.freebie && !hasPercent && !hasAmount) return true;
  return false;
}

/* ── 주소 정규화 (동일 지번/도로명 그룹화용) ─────────────────────────
 * 같은 건물에 여러 층·호수로 분리 등록된 업장을 하나의 위치 그룹으로 묶기 위한 키.
 * "층/호/동" 단위 suffix 를 제거하고 공백 정규화. 영문 대소문자 무시.
 * ──────────────────────────────────────────────────────────── */
function normalizeAddress(addr: string | null | undefined): string {
  if (!addr) return '';
  return addr
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/\s*(지하|지상|옥상|루프탑)?\s*\d+\s*층.*$/, '')
    .replace(/\s*\d+\s*호.*$/, '')
    .replace(/\s*[A-Za-z가-힣]\s*동\s*\d+\s*호.*$/, '')
    .toLowerCase();
}

/* ── 랭킹 오버레이 ─────────────────────────────────────────────
 * 데이터 소스: stores 배열(mapStores 쿼리) → coupons.length 내림차순
 * 실데이터 연결 포인트: RankingOverlay의 items prop에 rankedStores 전달
 * ──────────────────────────────────────────────────────────── */
export interface RankingItem {
  id: number;
  rank: number;
  name: string;
  shortTag: string;      // 카테고리 또는 짧은 설명
  couponCount: number;   // 랭킹 기준: 쿠폰 다운로드 수 (현재는 coupons.length 대용)
  distance?: number;     // 미터 단위
}

interface RankingListItemProps {
  item: RankingItem;
  isSelected: boolean;
  onClick: (item: RankingItem) => void;
}

const RankingListItem = memo(function RankingListItem({ item, isSelected, onClick }: RankingListItemProps) {
  const rankColor =
    item.rank === 1 ? 'text-yellow-500' :
    item.rank === 2 ? 'text-gray-400' :
    item.rank === 3 ? 'text-amber-600' :
    'text-gray-400';

  return (
    <button
      onClick={() => onClick(item)}
      className={`w-full flex items-center gap-2 px-2.5 py-1.5 rounded-xl text-left transition-colors ${
        isSelected ? 'bg-orange-50 border border-orange-200' : 'hover:bg-gray-50'
      }`}
    >
      <span className={`text-sm font-bold w-5 shrink-0 text-center ${rankColor}`}>
        {item.rank === 1 ? '🥇' : item.rank === 2 ? '🥈' : item.rank === 3 ? '🥉' : item.rank}
      </span>
      <div className="flex-1 min-w-0">
        <p className="text-xs font-semibold text-gray-800 truncate leading-tight">{item.name}</p>
        <p className="text-[10px] text-gray-400 truncate leading-tight">{item.shortTag}</p>
      </div>
      <span className="shrink-0 text-[10px] font-bold text-orange-500 bg-orange-50 border border-orange-200 rounded-full px-1.5 py-0.5">
        ⬇{item.couponCount}
      </span>
    </button>
  );
});

interface RankingOverlayProps {
  items: RankingItem[];
  selectedId: number | null;
  onSelect: (item: RankingItem) => void;
}

const RankingOverlay = memo(function RankingOverlay({ items, selectedId, onSelect }: RankingOverlayProps) {
  const [expanded, setExpanded] = useState(true);

  if (items.length === 0) return null;

  return (
    <div
      className="absolute top-3 left-3 z-[25] w-44 sm:w-48"
      style={{ pointerEvents: 'auto' }}
    >
      <div className="bg-white/90 backdrop-blur-sm rounded-2xl shadow-lg border border-white/60 overflow-hidden">
        {/* 헤더 */}
        <button
          onClick={() => setExpanded(prev => !prev)}
          className="w-full flex items-center justify-between px-3 py-2 hover:bg-orange-50/50 transition-colors"
        >
          <div className="flex items-center gap-1.5">
            <span className="text-sm">🏆</span>
            <span className="text-xs font-bold text-gray-800">다운로드 랭킹</span>
          </div>
          {expanded
            ? <ChevronUp className="w-3.5 h-3.5 text-gray-400" />
            : <ChevronDown className="w-3.5 h-3.5 text-gray-400" />
          }
        </button>

        {/* 리스트 — 아코디언 */}
        {expanded && (
          <div className="pb-1 px-1 space-y-0.5 border-t border-gray-100">
            {items.slice(0, 5).map(item => (
              <RankingListItem
                key={item.id}
                item={item}
                isSelected={selectedId === item.id}
                onClick={onSelect}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
});

/* ── 벚꽃 낙화 애니메이션 ─────────────────────────────────────── */
const PETAL_COUNT = 18;
const PETALS = Array.from({ length: PETAL_COUNT }, (_, i) => ({
  id: i,
  left: `${Math.random() * 100}%`,
  delay: `${Math.random() * 8}s`,
  duration: `${6 + Math.random() * 6}s`,
  size: `${10 + Math.random() * 10}px`,
  rotate: Math.random() * 360,
}));

function CherryBlossoms() {
  return (
    <div className="pointer-events-none fixed inset-0 z-[35] overflow-hidden">
      <style>{`
        @keyframes sakura-fall {
          0%   { transform: translateY(-20px) rotate(0deg) translateX(0px); opacity: 0.9; }
          25%  { transform: translateY(25vh) rotate(120deg) translateX(20px); }
          50%  { transform: translateY(50vh) rotate(240deg) translateX(-15px); }
          75%  { transform: translateY(75vh) rotate(320deg) translateX(10px); }
          100% { transform: translateY(110vh) rotate(480deg) translateX(-5px); opacity: 0; }
        }
        .sakura-petal {
          position: absolute;
          top: -20px;
          animation: sakura-fall linear infinite;
          user-select: none;
          filter: drop-shadow(0 1px 2px rgba(255,150,150,0.3));
        }
      `}</style>
      {PETALS.map((p) => (
        <span
          key={p.id}
          className="sakura-petal"
          style={{
            left: p.left,
            animationDelay: p.delay,
            animationDuration: p.duration,
            fontSize: p.size,
            transform: `rotate(${p.rotate}deg)`,
          }}
        >
          🌸
        </span>
      ))}
    </div>
  );
}

/* ── 보는 중 카운트 (스토어 ID 기반 결정론적 난수) ────────────── */
function getViewerCount(storeId: number): number {
  // 실제 실시간 연결 없이 store ID + 현재 시간(10분 단위) 기반으로 일관된 수 생성
  const seed = storeId * 31 + Math.floor(Date.now() / 600000);
  return (seed % 23) + 3; // 3~25명 범위
}

interface StoreWithCoupons {
  id: number;
  name: string;
  category: string;
  description?: string | null;
  address: string;
  latitude?: string | null;
  longitude?: string | null;
  phone?: string | null;
  imageUrl?: string | null;
  rating?: string | null;
  ratingCount?: number | null;
  adminComment?: string | null;
  adminCommentAuthor?: string | null;
  hasAvailableCoupons?: boolean; // 사용 가능한 쿠폰 여부 (UX 개선)
  distance?: number; // 거리 (미터)
  coupons: Array<{
    id: number;
    title: string;
    description?: string | null;
    discountType: string;
    discountValue: number;
    endDate: Date | string;
  }>;
}

export default function Home() {
  const { user } = useAuth();
  const [, setLocation] = useLocation();
  const [map, setMap] = useState<google.maps.Map | null>(null);
  const mapMountLoggedRef = useRef(false);
  const zoomListenerRef = useRef<google.maps.MapsEventListener | null>(null);
  useEffect(() => {
    if (mapMountLoggedRef.current) return;
    mapMountLoggedRef.current = true;
    console.log('[MAP] MapPage 마운트 완료');
  });
  
  // 위치 기반 근처 가게 알림 (opt-in, 포그라운드 only, localStorage dedup)
  useLocationNotifications();
  
  // 새로운 위치 권한 훅 사용 (페이지 로드 시 즉시 권한 요청하지 않음)
  const {
    location: geoLocation,
    permissionStatus,
    isLoading: isLocationLoading,
    error: locationError,
    isUsingDefaultLocation,
    locationName,
    requestLocation,
    retryLocation,
  } = useGeolocation();
  
  // 기존 코드와의 호환성을 위해 userLocation 유지
  const userLocation = geoLocation;

  useEffect(() => {
    console.log('[MAP] 위치 상태 변화 → permissionStatus:', permissionStatus, '| location:', userLocation ? `${userLocation.lat.toFixed(4)},${userLocation.lng.toFixed(4)}` : 'null', '| loading:', isLocationLoading);
  }, [permissionStatus, userLocation, isLocationLoading]);
  const logoutMutation = trpc.auth.logout.useMutation({
    onSuccess: () => {
      window.location.href = '/';
    },
  });
  const [selectedStore, setSelectedStore] = useState<StoreWithCoupons | null>(null);
  const [showDetailModal, setShowDetailModal] = useState(false);
  // 동일 주소(지번/도로명) 에 여러 업장이 등록된 경우 리스트 모달로 노출
  const [selectedStoreGroup, setSelectedStoreGroup] = useState<StoreWithCoupons[] | null>(null);
  const [showStoreGroupModal, setShowStoreGroupModal] = useState(false);
  // useRef로 변경 — useState는 비동기이므로 정리 타이밍에 stale값이 참조됨
  // → 이전 마커(이모지)와 새 마커(도트)가 동시에 보이는 버그 수정
  const markersRef = useRef<google.maps.Marker[]>([]);
  const [markers, setMarkers] = useState<google.maps.Marker[]>([]);
  const [infoWindows, setInfoWindows] = useState<google.maps.InfoWindow[]>([]);
  const [category, setCategory] = useState<string>("all");
  const [showAllCategories, setShowAllCategories] = useState(false);
  const [showMenu, setShowMenu] = useState(false);
  const [showUserMenu, setShowUserMenu] = useState(false);
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [searchResults, setSearchResults] = useState<StoreWithCoupons[]>([]);
  const [showSearchResults, setShowSearchResults] = useState(false);
  // 상단 검색바 노출 토글 — 기본은 숨김, 헤더 🔍 아이콘으로 열고 닫음 (세로 공간 회수)
  const [showSearchBar, setShowSearchBar] = useState(false);
  // Phase B — 할인 필터 패널 + state
  const [showFilterPanel, setShowFilterPanel] = useState(false);
  const [discountFilter, setDiscountFilter] = useState<DiscountFilter>(EMPTY_DISCOUNT_FILTER);
  // 할인 필터 적용 시 반경 자동 "전체(null)" 전환. 해제 시 이전 반경 복원을 위한 보존값.
  const [previousRadius, setPreviousRadius] = useState<UserAlertRadiusM | null>(USER_ALERT_DEFAULT_RADIUS_M);
  const discountFilterActive = hasActiveDiscountFilter(discountFilter);
  // 할인 필터 on/off 전이 시 반경 자동 조작 — 이미 전환 상태라면 no-op (무한 루프 방지)
  useEffect(() => {
    if (discountFilterActive) {
      // 활성화 전이: 현재 반경을 백업하고 전체(null)로 확장
      if (selectedRadius !== null) {
        setPreviousRadius(selectedRadius);
        setSelectedRadius(null);
      }
    } else {
      // 해제 전이: 이전 반경으로 복원 (직전에 null이었을 수도 있음 — 그 경우 복원 없음)
      if (selectedRadius === null && previousRadius !== null) {
        setSelectedRadius(previousRadius);
      }
    }
    // selectedRadius / previousRadius 의존성 포함 시 유저 수동 반경 변경 때마다 재실행되어
    // 필터 미활성 상태에서 불필요한 복원 루프 발생 → deps 는 discountFilterActive 만.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [discountFilterActive]);
  const [enlargedImage, setEnlargedImage] = useState<string | null>(null);
  const [showDemographicModal, setShowDemographicModal] = useState(false);
  const [downloadingCouponId, setDownloadingCouponId] = useState<number | null>(null);
  const [downloadedCouponIds, setDownloadedCouponIds] = useState<Set<number>>(new Set());

  // ── 유저 알림 맥락화: 쿠폰찾기 필터 탭 (Phase 3-2) ────────────────────────
  // 탭 종류: 'all' (기본 — 기존 쿠폰찾기 동선) / 'nudge' / 'newopen'
  // URL ?tab= 값으로 초기 진입 시점 자동 선택 (NotificationBadge 에서 전달)
  const [activeTab, setActiveTab] = useState<UserAlertTab>('all');

  // Phase 3-3 — GPS 반경 선택 (지도 레이더 overlay + newopen 쿼리에 연동)
  //   기본값: USER_ALERT_DEFAULT_RADIUS_M (200m) — users.notification_radius 기본값과 일치
  //   옵션: 100/200/500 (users.notification_radius 허용값과 1:1)
  // null = 반경 해제(전체 보기). Radar/Circle 은 null 시 미표시, 클라 필터 bypass, 서버에도 null 전달.
  const [selectedRadius, setSelectedRadius] = useState<UserAlertRadiusM | null>(USER_ALERT_DEFAULT_RADIUS_M);
  // notification-settings 와 양방향 동기화:
  //   - 첫 진입 시 DB 값(users.notification_radius) 으로 초기화 (didInitRadiusRef 로 1회만)
  //   - map 에서 100/200/500 선택 시 → DB 저장 (양 화면 일관)
  //   - "전체"(null) 는 세션 탐색용이라 DB 저장하지 않음
  const didInitRadiusRef = useRef(false);
  const { data: notifSettingsForRadius } = trpc.users.getNotificationSettings.useQuery(undefined, {
    enabled: !!user,
  });
  const radiusSyncUtils = trpc.useUtils();
  const saveRadiusMutation = trpc.users.updateNotificationSettings.useMutation({
    onSuccess: () => {
      radiusSyncUtils.users.getNotificationSettings.invalidate();
    },
  });
  useEffect(() => {
    if (didInitRadiusRef.current) return;
    const dbRadius = notifSettingsForRadius?.notificationRadius;
    if (dbRadius === 100 || dbRadius === 200 || dbRadius === 500) {
      setSelectedRadius(dbRadius as UserAlertRadiusM);
      didInitRadiusRef.current = true;
    }
  }, [notifSettingsForRadius?.notificationRadius]);
  const handleRadiusChange = useCallback((r: UserAlertRadiusM | null) => {
    setSelectedRadius(r);
    // 이후엔 유저 명시적 선택으로 간주 — DB 재로드로 덮어쓰지 않음
    didInitRadiusRef.current = true;
    if (r !== null && user) {
      saveRadiusMutation.mutate({ notificationRadius: r });
    }
  }, [user, saveRadiusMutation]);
  const radiusCircleRef = useRef<google.maps.Circle | null>(null);
  // 게임 레이더 sweep overlay — userLocation 중심 회전 팬 애니메이션
  const radarOverlayRef = useRef<any>(null);

  // 반경 레이더 표시 가능 조건: map 준비 + userLocation 존재 + 위치 권한 정상
  //   - permissionStatus 'denied'/'unavailable' → overlay 미노출 (권한 요청 안내 banner 별도)
  //   - IP fallback 위치(isUsingDefaultLocation=true)에서는 부정확하므로 표시하지 않음
  const canShowRadar = !!map
    && !!userLocation
    && permissionStatus !== 'denied'
    && permissionStatus !== 'unavailable'
    && !isUsingDefaultLocation;

  // Circle 생성 / 갱신 / 정리
  useEffect(() => {
    // selectedRadius === null → 반경 해제 상태 → Circle 미표시
    if (!canShowRadar || !map || !userLocation || selectedRadius === null) {
      // 조건 미충족 시 기존 Circle 제거
      if (radiusCircleRef.current) {
        radiusCircleRef.current.setMap(null);
        radiusCircleRef.current = null;
      }
      return;
    }

    if (!radiusCircleRef.current) {
      // 최초 생성 — 브랜드 톤 스타일 (rose 계열 은은한 반투명)
      try {
        radiusCircleRef.current = new google.maps.Circle({
          ...USER_ALERT_RADAR_STYLE,
          map,
          center: { lat: userLocation.lat, lng: userLocation.lng },
          radius: selectedRadius,
          clickable: false,  // 마커/지도 클릭 방해 금지
          zIndex: 1,          // 마커(기본 z) 아래로
        });
      } catch (e) {
        // google.maps.Circle 생성 실패 — 레이더만 포기, 지도 전체는 정상 유지
        console.error('[MapPage] radar Circle create failed (non-critical):', e);
        return;
      }
    } else {
      radiusCircleRef.current.setCenter({ lat: userLocation.lat, lng: userLocation.lng });
      radiusCircleRef.current.setRadius(selectedRadius);
      if (radiusCircleRef.current.getMap() !== map) radiusCircleRef.current.setMap(map);
    }
  }, [canShowRadar, map, userLocation, selectedRadius]);

  // 언마운트 시 확실한 정리
  useEffect(() => {
    return () => {
      if (radiusCircleRef.current) {
        radiusCircleRef.current.setMap(null);
        radiusCircleRef.current = null;
      }
      if (radarOverlayRef.current) {
        try { radarOverlayRef.current.setMap(null); } catch {}
        radarOverlayRef.current = null;
      }
    };
  }, []);

  // 게임 레이더 sweep overlay — 4초 주기 360도 회전 팬 + ping 확산
  useEffect(() => {
    // selectedRadius === null → 반경 해제 상태 → Radar sweep 미표시
    if (!canShowRadar || !map || !userLocation || selectedRadius === null) {
      if (radarOverlayRef.current) {
        try { radarOverlayRef.current.setMap(null); } catch {}
        radarOverlayRef.current = null;
      }
      return;
    }
    const g = (window as any).google;
    if (!g?.maps?.OverlayView) return;

    if (!radarOverlayRef.current) {
      class RadarSweep extends g.maps.OverlayView {
        private div: HTMLDivElement | null = null;
        public center: google.maps.LatLng;
        public radius: number;
        constructor(center: google.maps.LatLng, radius: number) {
          super();
          this.center = center;
          this.radius = radius;
        }
        onAdd() {
          const div = document.createElement('div');
          div.style.position = 'absolute';
          div.style.pointerEvents = 'none';
          div.innerHTML = `
            <style>
              @keyframes mc-radar-ping { 0% { transform: scale(0.25); opacity: .75; } 100% { transform: scale(1); opacity: 0; } }
              .mc-radar-ping  { animation: mc-radar-ping 2.6s ease-out infinite; transform-origin: 50% 50%; transform-box: view-box; }
            </style>
            <svg xmlns="http://www.w3.org/2000/svg" width="100%" height="100%" viewBox="-100 -100 200 200" style="overflow:visible;">
              <defs>
                <radialGradient id="mc-rdr-bg" cx="50%" cy="50%" r="50%">
                  <stop offset="0%"   stop-color="#fda4af" stop-opacity="0.22"/>
                  <stop offset="100%" stop-color="#fda4af" stop-opacity="0.05"/>
                </radialGradient>
                <linearGradient id="mc-rdr-fan" x1="0%" y1="0%" x2="100%" y2="0%">
                  <stop offset="0%"   stop-color="#f43f5e" stop-opacity="0"/>
                  <stop offset="100%" stop-color="#f43f5e" stop-opacity="0.55"/>
                </linearGradient>
              </defs>
              <circle cx="0" cy="0" r="99" fill="url(#mc-rdr-bg)" stroke="#fb7185" stroke-width="1.2" stroke-opacity="0.55"/>
              <circle cx="0" cy="0" r="66" fill="none" stroke="#fb7185" stroke-width="0.6" stroke-opacity="0.35"/>
              <circle cx="0" cy="0" r="33" fill="none" stroke="#fb7185" stroke-width="0.6" stroke-opacity="0.35"/>
              <line x1="-99" y1="0" x2="99" y2="0" stroke="#fb7185" stroke-width="0.4" stroke-opacity="0.3"/>
              <line x1="0" y1="-99" x2="0" y2="99" stroke="#fb7185" stroke-width="0.4" stroke-opacity="0.3"/>
              <circle class="mc-radar-ping" cx="0" cy="0" r="99" fill="none" stroke="#f43f5e" stroke-width="1.5" stroke-opacity="0.7"/>
              <g>
                <path d="M 0 0 L 99 0 A 99 99 0 0 1 70 70 Z" fill="url(#mc-rdr-fan)">
                  <animateTransform attributeName="transform" type="rotate" from="0 0 0" to="360 0 0" dur="4s" repeatCount="indefinite"/>
                </path>
              </g>
              <circle cx="0" cy="0" r="3.5" fill="#f43f5e"/>
            </svg>
          `;
          this.div = div;
          const panes = this.getPanes();
          panes?.overlayLayer.appendChild(div);
        }
        draw() {
          const proj = this.getProjection();
          if (!proj || !this.div) return;
          const centerPx = proj.fromLatLngToDivPixel(this.center);
          if (!centerPx) return;
          // meters → pixels: 위도 1도 ≈ 111139m
          const nlat = this.center.lat() + this.radius / 111139;
          const edge = new g.maps.LatLng(nlat, this.center.lng());
          const edgePx = proj.fromLatLngToDivPixel(edge);
          if (!edgePx) return;
          const radiusPx = Math.abs(edgePx.y - centerPx.y) || 1;
          this.div.style.left = `${centerPx.x - radiusPx}px`;
          this.div.style.top = `${centerPx.y - radiusPx}px`;
          this.div.style.width = `${radiusPx * 2}px`;
          this.div.style.height = `${radiusPx * 2}px`;
        }
        onRemove() {
          if (this.div?.parentNode) this.div.parentNode.removeChild(this.div);
          this.div = null;
        }
        updateState(center: google.maps.LatLng, radius: number) {
          this.center = center;
          this.radius = radius;
          this.draw();
        }
      }
      try {
        const overlay = new RadarSweep(
          new g.maps.LatLng(userLocation.lat, userLocation.lng),
          selectedRadius
        );
        overlay.setMap(map);
        radarOverlayRef.current = overlay;
      } catch (e) {
        console.error('[MapPage] radar overlay create failed (non-critical):', e);
      }
    } else {
      try {
        radarOverlayRef.current.updateState(
          new g.maps.LatLng(userLocation.lat, userLocation.lng),
          selectedRadius
        );
      } catch {}
    }
  }, [canShowRadar, map, userLocation, selectedRadius]);

  // URL ?tab= 파라미터 1회 읽어서 초기 탭 적용
  useEffect(() => {
    try {
      const params = new URLSearchParams(window.location.search);
      const t = params.get('tab');
      if (t === 'nudge' || t === 'newopen') {
        setActiveTab(t);
      }
    } catch { /* graceful */ }
  }, []);

  // 탭별 데이터 쿼리 — enabled 조건으로 비활성 탭에서 호출 차단 (네트워크 절약)
  const nudgeActivatedQuery = trpc.finder.listNudgeActivated.useQuery(undefined, {
    enabled: activeTab === 'nudge',
  });
  const newlyOpenedQuery = trpc.finder.listNewlyOpened.useQuery(
    {
      lat: userLocation?.lat ?? 0,
      lng: userLocation?.lng ?? 0,
      radiusM: selectedRadius,
    },
    {
      enabled: activeTab === 'newopen' && !!userLocation,
    },
  );

  // 배지 세분화 카운트 (탭 뱃지 표시용) — refetch는 NotificationBadge 와 독립
  const { data: unreadByType } = trpc.finder.getUnreadCountByType.useQuery(undefined, {
    refetchInterval: 30000,
  });

  // 탭 클릭 시에만 markTabSeen 호출 (설계 원칙: 페이지 진입만으로 읽음 처리 금지)
  const finderUtils = trpc.useUtils();
  const markTabSeenMutation = trpc.finder.markTabSeen.useMutation({
    onSuccess: () => {
      finderUtils.notifications.getUnreadCount.invalidate();
      finderUtils.finder.getUnreadCountByType.invalidate();
      finderUtils.finder.listNudgeActivated.invalidate();
    },
  });

  const handleTabClick = (tab: UserAlertTab) => {
    if (tab === activeTab) return; // 동일 탭 재클릭 시 중복 mutation 차단
    setActiveTab(tab);
    // 'all' 탭 전환은 서버 읽음 처리 없음 (유저 체감 이벤트 아님)
    if (tab === 'nudge') {
      markTabSeenMutation.mutate({ type: 'nudge_activated' });
    } else if (tab === 'newopen') {
      markTabSeenMutation.mutate({ type: 'newly_opened_nearby' });
    }
    // URL 동기화 (history replace) — 새로고침 시 탭 상태 보존
    try {
      const url = tab === 'all' ? '/map' : `/map?tab=${tab}`;
      window.history.replaceState({}, '', url);
    } catch { /* graceful */ }
  };

  // stores.mapStores: 공개 지도 전용 endpoint
  const storesQuery = trpc.stores.mapStores.useQuery({
    userLat: userLocation?.lat,
    userLon: userLocation?.lng,
  });
  const { data: stores, isLoading } = storesQuery;

  // ── 랭킹: 실제 downloadCount 내림차순 TOP 5 ────────────────────
  // 서버 mapStores 응답의 downloadCount 필드 사용 (user_coupons 집계값)
  const rankedStores = useMemo<RankingItem[]>(() => {
    if (!stores || stores.length === 0) return [];
    return [...stores]
      .filter(s => ((s as any).downloadCount ?? 0) > 0)
      .sort((a, b) => ((b as any).downloadCount ?? 0) - ((a as any).downloadCount ?? 0))
      .slice(0, 5)
      .map((s, idx) => ({
        id: s.id,
        rank: idx + 1,
        name: s.name,
        shortTag: s.category ?? '기타',
        couponCount: (s as any).downloadCount ?? 0,
        distance: s.distance,
      }));
  }, [stores]);
  
  // 디버그: 스토어 데이터 확인
  useEffect(() => {
    if (stores) {
      console.log('🏪 스토어 데이터:', stores);
      console.log('🏪 스토어 개수:', stores.length);
      stores.forEach(store => {
        console.log(`가게: ${store.name}, 쿠폰: ${store.coupons?.length || 0}개, 위치: ${store.latitude}, ${store.longitude}`);
      });
    }
  }, [stores]);
  const utils = trpc.useUtils();

  const handleMerchantShortcut = () => setLocation('/merchant/dashboard');

  const downloadCoupon = trpc.coupons.download.useMutation({
    onSuccess: async () => {
      // ✅ 즉시 refetch (invalidate보다 빠름) + mapStores 갱신 (hasAvailableCoupons 재계산)
      await utils.coupons.myCoupons.refetch();
      utils.stores.mapStores.invalidate();
      console.log('[Download] ⚡ Coupon downloaded, my coupons list refreshed immediately');
    },
    onError: (error: any) => {
      console.error('[Download] ❌ 쿠폰 다운로드 실패:', error.message);
    },
  });
  // 조르기 — 로그인한 모든 유저 사용 가능 (휴면 매장에 쿠폰 더 달라고 요청)
  // nudgeMutateRef: handleMapReady deps 오염 방지용 ref 패턴
  const nudgeMutation = trpc.stores.nudgeDormant.useMutation({
    onSuccess: (data) => {
      const msg = `조르기 완료! 현재 ${data.nudgeCount}명이 쿠폰을 기다리고 있어요 🙏`;
      toast.success(msg);
    },
    onError: (e: any) => toast.error(e.message || '조르기에 실패했습니다.'),
  });
  const nudgeMutateRef = useRef(nudgeMutation.mutate);
  nudgeMutateRef.current = nudgeMutation.mutate;

  // admin 전용 이메일 발송 조르기 (어드민 패널용)
  const adminNudgeMutation = trpc.admin.nudgeMerchant.useMutation({
    onSuccess: (data) => {
      const msg = data.mailSent ? '조르기 완료! 이메일을 발송했습니다.' : '조르기 완료 (이메일 미설정)';
      toast.success(msg);
    },
    onError: (e: any) => toast.error(e.message || '조르기에 실패했습니다.'),
  });

  const deleteCouponMutation = trpc.admin.deleteCoupon.useMutation({
    onSuccess: () => {
      alert('쿠폰이 삭제되었습니다.');
      setShowDetailModal(false);
      // 가게 목록 재로드
      storesQuery.refetch();
    },
    onError: (error) => {
      alert(error.message || '쿠폰 삭제에 실패했습니다.');
    },
  });

  // 위치 권한 허용 후 자동으로 지도 이동
  useEffect(() => {
    console.log('[MapPage] 위치 상태:', {
      hasMap: !!map,
      userLocation,
      isUsingDefaultLocation,
      permissionStatus,
    });
    
    if (map && userLocation) {
      // 기본 위치가 아닌 실제 사용자 위치로 업데이트되었을 때만 이동
      if (!isUsingDefaultLocation && permissionStatus === 'granted') {
        console.log('[MapPage] ✅ 실제 사용자 위치로 지도 이동:', userLocation);
        map.setCenter(userLocation);
        map.setZoom(16);
      }
    }
  }, [map, userLocation, isUsingDefaultLocation, permissionStatus]);

  // 모달 열릴 때 히스토리에 상태 추가 (뒤로가기 지원)
  useEffect(() => {
    if (showDetailModal) {
      // 모달이 열릴 때 히스토리에 상태 추가
      window.history.pushState({ modalOpen: true }, '');
      
      // 뒤로가기 감지
      const handlePopState = (event: PopStateEvent) => {
        if (showDetailModal) {
          setShowDetailModal(false);
          event.preventDefault();
        }
      };
      
      window.addEventListener('popstate', handlePopState);
      
      return () => {
        window.removeEventListener('popstate', handlePopState);
      };
    }
  }, [showDetailModal]);

  // history.back() 제거: 지도 밖으로 이탈하는 버그 방지
  // 모달 닫힐 때 별도 히스토리 조작 없이 state만 리셋

  // 거리 계산 함수
  const calculateDistance = useCallback((lat1: number, lon1: number, lat2: number, lon2: number): number => {
    const R = 6371e3;
    const φ1 = (lat1 * Math.PI) / 180;
    const φ2 = (lat2 * Math.PI) / 180;
    const Δφ = ((lat2 - lat1) * Math.PI) / 180;
    const Δλ = ((lon2 - lon1) * Math.PI) / 180;

    const a =
      Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
      Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

    return R * c;
  }, []);

  // 거리 포맷팅
  const formatDistance = (meters: number): string => {
    if (meters < 1000) {
      return `${Math.round(meters)}m`;
    }
    return `${(meters / 1000).toFixed(1)}km`;
  };

  // 할인 표시 포맷
  const formatDiscount = (discountType: string, discountValue: number): string => {
    if (discountType === 'percentage') {
      return `${discountValue}% OFF`;
    } else if (discountType === 'fixed') {
      return `${discountValue.toLocaleString()}원 할인`;
    } else {
      return '증정';
    }
  };

  // 관리자 쿠폰 삭제 핸들러
  const handleDeleteCoupon = async (couponId: number, couponTitle: string) => {
    if (!confirm(`"${couponTitle}" 쿠폰을 삭제하시겠습니까?\n\n사용자가 다운로드한 쿠폰도 모두 삭제됩니다.`)) {
      return;
    }
    await deleteCouponMutation.mutateAsync({ id: couponId });
  };

  // 쿠폰 다운로드 핸들러 (비로그인 접근 허용, 다운로드 시 로그인 인터셉터)
  const handleDownloadCoupon = async (couponId: number) => {
    // 비로그인 상태에서 쿠폰 다운로드 시도 시 로그인 페이지로 유도
    if (!user) {
      toast.info('쿠폰을 다운로드하려면 로그인이 필요합니다.', {
        description: '로그인 페이지로 이동합니다.',
        duration: 3000,
      });
      
      // 현재 URL을 저장하여 로그인 후 돌아올 수 있도록
      const currentUrl = window.location.href;
      const redirectUrl = encodeURIComponent(currentUrl);
      // 수정: getLoginUrl()은 이미 ?redirect=... 포함하므로 직접 조합 (중복 방지)
      const targetLoginUrl = `/api/oauth/google/login?redirect=${redirectUrl}`;

      setTimeout(() => {
        console.log('[AUTH-URL] login triggered from coupon handler →', targetLoginUrl.slice(0, 120));
        openGoogleLogin(targetLoginUrl).catch(() => {});
      }, 500);
      
      return;
    }

    // 중복 다운로드 방지
    if (downloadingCouponId === couponId) {
      return;
    }

    setDownloadingCouponId(couponId);

    try {
      const { getDeviceId } = await import('@/lib/deviceId');
      const deviceId = getDeviceId();
      
      const result = await downloadCoupon.mutateAsync({ 
        couponId,
        deviceId 
      });
      
      toast.success('쿠폰이 다운로드되었습니다!', {
        description: `PIN 코드: ${result.pinCode}\n내 쿠폰북에서 확인하세요.`,
        duration: 5000,
      });

      // 세션 내 다운로드 완료 표시 (mapStores 재로드 전 즉각 UI 반영)
      setDownloadedCouponIds(prev => new Set(prev).add(couponId));

      setShowDetailModal(false);
      
      // 첫 다운로드 시 프로필 정보가 없으면 모달 표시
      if (user && !user.ageGroup && !user.gender) {
        setShowDemographicModal(true);
      }
    } catch (error: any) {
      toast.error('쿠폰 다운로드 실패', {
        description: error.message || '쿠폰 다운로드에 실패했습니다. 다시 시도해주세요.',
        duration: 5000,
      });
    } finally {
      setDownloadingCouponId(null);
    }
  };

  // 지도 초기화
  const handleMapReady = useCallback(
    (mapInstance: google.maps.Map) => {
      console.log('[MAP] ✅ 지도 인스턴스 준비 완료 (onMapReady)');
      setMap(mapInstance);

      if (!stores || !userLocation) return;

      // 기존 마커 및 InfoWindow 제거 (ref로 동기 정리 — stale 클로저 방지)
      markersRef.current.forEach((marker) => marker.setMap(null));
      markersRef.current = [];
      infoWindows.forEach((infoWindow) => infoWindow.close());
      const newMarkers: google.maps.Marker[] = [];
      const newInfoWindows: google.maps.InfoWindow[] = [];

      // 카테고리 및 검색 필터 ('coupon' = 할인중 = 쿠폰 있는 매장만)
      let filteredStores = category === 'all'
        ? stores
        : category === 'coupon'
          ? stores.filter(s => s.coupons && s.coupons.length > 0)
          : stores.filter(s => s.category === category);

      // 할인 필터 — 상단 카테고리 pill 과 AND 조합 (둘 다 만족해야 노출).
      // 매장 레벨: categories 배열이 비어있지 않으면 해당 카테고리만 통과.
      // 쿠폰 레벨: percent/amount/freebie 조건 중 하나라도 충족하는 쿠폰이 있어야 매장 통과.
      if (discountFilterActive) {
        const df = discountFilter;
        filteredStores = filteredStores.filter((s) => {
          if (df.categories.length > 0 && !df.categories.includes(s.category)) return false;
          // percent/amount/freebie 조건 중 하나라도 활성이면 쿠폰 레벨 필터 적용.
          const hasCouponCondition = df.percentMin !== null || df.percentMax !== null
            || df.amountMin !== null || df.amountMax !== null || df.freebie;
          if (hasCouponCondition) {
            if (!s.coupons || s.coupons.length === 0) return false;
            return s.coupons.some(c => couponMatchesDiscountFilter(c as any, df));
          }
          // 카테고리 필터만 활성인 경우 매장 카테고리 통과 = pass
          return true;
        });
      }

      // 반경 필터: 레이더 표시 가능할 때만 selectedRadius 이내 매장만 노출
      // - IP fallback / 권한 거부 상태에서는 기존 UX 보존 (전체 표시)
      // - selectedRadius === null (반경 해제, 또는 할인 필터 활성으로 자동 전환) 시 필터 bypass
      // - 좌표 없는 매장은 통과 (필터 기준 판정 불가)
      if (canShowRadar && userLocation && selectedRadius !== null) {
        const radiusLimit = selectedRadius;
        filteredStores = filteredStores.filter((s) => {
          if (!s.latitude || !s.longitude) return true;
          const d = calculateDistance(
            userLocation.lat, userLocation.lng,
            parseFloat(s.latitude), parseFloat(s.longitude)
          );
          return d <= radiusLimit;
        });
      }

      // 검색어 필터링
      if (searchQuery.trim()) {
        const query = searchQuery.toLowerCase();
        filteredStores = filteredStores.filter(s => 
          s.name.toLowerCase().includes(query) || 
          s.category.toLowerCase().includes(query) ||
          s.address.toLowerCase().includes(query)
        );
        
        // 검색 결과 저장
        setSearchResults(filteredStores);
        setShowSearchResults(filteredStores.length > 0);
        
        // 검색 결과가 1개면 자동으로 해당 위치로 이동
        if (filteredStores.length === 1 && filteredStores[0].latitude && filteredStores[0].longitude) {
          const firstStore = filteredStores[0];
          mapInstance.setCenter({
            lat: parseFloat(firstStore.latitude!),
            lng: parseFloat(firstStore.longitude!),
          });
          mapInstance.setZoom(17);
        }
      } else {
        setSearchResults([]);
        setShowSearchResults(false);
      }

      console.log('📍 필터링된 스토어:', filteredStores.length);

      // 줌 레벨 기반 아이콘 빌더 — zoom<13: 작은 도트, zoom>=13: 이모지 마커
      // 마커 색상 규칙: 휴면(dormant) OR 무료(FREE) = RED, 유료(PAID) = GOLD
      // stackCount: 동일 주소 그룹 크기 (2 이상이면 우상단 "+N" 배지)
      const buildMarkerIcon = (
        emoji: string,
        isUsedStore: boolean,
        ownerTier: string,
        zoom: number,
        ownerIsDormant?: boolean,
        stackCount?: number
      ) => {
        const isPaid = ownerTier && ownerTier !== 'FREE';
        const markerColor = (ownerIsDormant || !isPaid)
          ? '#EF4444'   // RED: 휴면 또는 무료
          : '#EAB308';  // GOLD: 유료
        const tc = isUsedStore ? { main: '#9CA3AF' } : { main: markerColor };
        const opacity = isUsedStore ? '0.5' : '1';

        if (zoom < 13) {
          // 도트 모드: 작은 원
          const r = zoom < 10 ? 5 : 7;
          const d = (r + 2) * 2;
          return {
            url: `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(
              `<svg xmlns="http://www.w3.org/2000/svg" width="${d}" height="${d}" viewBox="0 0 ${d} ${d}">` +
              `<circle cx="${r+2}" cy="${r+2}" r="${r}" fill="${tc.main}" opacity="${opacity}"/>` +
              `</svg>`
            )}`,
            scaledSize: new google.maps.Size(d, d),
            anchor: new google.maps.Point(r + 2, r + 2),
          };
        }
        // 이모지 마커 모드
        const fillColor = isUsedStore ? '#F3F4F6' : 'white';
        const stackBadge = stackCount && stackCount > 1
          ? `<circle cx="40" cy="9" r="9" fill="#E11D48" stroke="white" stroke-width="2"/>` +
            `<text x="40" y="13" font-size="11" font-weight="700" fill="white" text-anchor="middle">+${stackCount - 1}</text>`
          : '';
        return {
          url: `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(
            `<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 48 48">` +
            `<circle cx="24" cy="24" r="20" fill="${fillColor}" stroke="${tc.main}" stroke-width="3" opacity="${opacity}"/>` +
            `<text x="24" y="32" font-size="24" text-anchor="middle" opacity="${opacity}">${emoji}</text>` +
            stackBadge +
            `</svg>`
          )}`,
          scaledSize: new google.maps.Size(48, 48),
          anchor: new google.maps.Point(24, 24),
        };
      };

      // store-marker 쌍 — zoom_changed 리스너에서 아이콘 갱신에 사용
      const storeMarkerData: { marker: google.maps.Marker; emoji: string; isUsedStore: boolean; ownerTier: string; ownerIsDormant: boolean; stackCount: number }[] = [];

      // ── 동일 주소(지번/도로명) 그룹화 ─────────────────────────────
      // 같은 건물의 여러 층/호수 업장을 하나의 대표 마커로 묶고,
      // 클릭 시 그룹 리스트 바텀시트로 전체 업장을 선택 가능하게 한다.
      // 그룹 내 대표는 filteredStores 의 기존 순서 기준 "첫번째 마커 생성 후보" 1건.
      const addressGroups = new Map<string, StoreWithCoupons[]>();
      for (const s of filteredStores) {
        if (!s.latitude || !s.longitude) continue;
        const isDormant = (s as any).ownerIsDormant === true;
        if ((!s.coupons || s.coupons.length === 0) && !isDormant) continue;
        const norm = normalizeAddress(s.address);
        const key = norm || `__solo_${s.id}`;
        const bucket = addressGroups.get(key);
        if (bucket) bucket.push(s); else addressGroups.set(key, [s]);
      }
      const representativeIds = new Set<number>();
      addressGroups.forEach((arr) => { if (arr[0]) representativeIds.add(arr[0].id); });

      filteredStores.forEach((store) => {
        console.log(`마커 생성 시도: ${store.name}`);

        if (!store.latitude || !store.longitude) {
          console.log(`❌ ${store.name}: 위치 정보 없음`);
          return;
        }

        const ownerIsDormant = (store as any).ownerIsDormant === true;

        if (!store.coupons || store.coupons.length === 0) {
          if (!ownerIsDormant) {
            console.log(`❌ ${store.name}: 쿠폰 없음`);
            return;
          }
          console.log(`🔴 ${store.name}: 휴면 매장 — 조르기 마커로 표시`);
        }

        // 동일 주소 그룹 내 대표가 아니면 마커 생성 skip (중복 표시 방지)
        if (!representativeIds.has(store.id)) {
          console.log(`↪️ ${store.name}: 동일 주소 대표 아님 — 그룹 모달에서 표시`);
          return;
        }
        const addrKey = normalizeAddress(store.address) || `__solo_${store.id}`;
        const addrGroup = addressGroups.get(addrKey) ?? [store];
        const isStacked = addrGroup.length > 1;

        const lat = parseFloat(store.latitude);
        const lng = parseFloat(store.longitude);
        const distance = calculateDistance(userLocation.lat, userLocation.lng, lat, lng);

        const emoji = store.category === 'cafe' ? '☕' :
                      store.category === 'restaurant' ? '🍽️' :
                      store.category === 'beauty' ? '💅' :
                      store.category === 'hospital' ? '🏥' :
                      store.category === 'fitness' ? '💪' : '🎁';

        // 휴면 가게는 gray 아닌 빨간색 — isUsedStore라도 dormant면 RED 강제
        const isUsedStore = store.hasAvailableCoupons === false && !ownerIsDormant;
        const ownerTier = (store as any).ownerTier ?? 'FREE';
        const tc = isUsedStore ? { main: '#9CA3AF', bg: '#F3F4F6' } : getTierColor(ownerTier);

        const initialZoom = mapInstance.getZoom() ?? 13;
        const icon = buildMarkerIcon(emoji, isUsedStore, ownerTier, initialZoom, ownerIsDormant, addrGroup.length);

        const marker = new google.maps.Marker({
          position: { lat, lng },
          map: mapInstance,
          title: isStacked ? `${store.name} 외 ${addrGroup.length - 1}곳` : store.name,
          icon,
          animation: initialZoom >= 13 ? window.google.maps.Animation.DROP : undefined,
        });

        storeMarkerData.push({ marker, emoji, isUsedStore, ownerTier, ownerIsDormant, stackCount: addrGroup.length });

        // InfoWindow 생성 (호버 시 표시)
        const coupon = store.coupons?.[0]; // 휴면 매장은 undefined일 수 있음
        // badge: 휴면/이용완료 상태만 표시. 일반 상태는 null → badge 생략.
        // 사장의 플랜 tier(손님마중/단골손님/북적북적/무료) 를 유저에게 노출하지 않기 위함.
        const badgeColors: { bg: string; color: string; border: string; text: string } | null =
          ownerIsDormant
            ? { bg: '#FEF2F2', color: '#EF4444', border: '#FECACA', text: '쿠폰 없음' }
            : isUsedStore
              ? { bg: '#F3F4F6', color: '#9CA3AF', border: '#D1D5DB', text: '이용완료' }
              : null;
        const infoWindowContent = `
          <div style="padding: 12px; min-width: 200px; font-family: 'Pretendard Variable', sans-serif;">
            <div style="display:flex; align-items:center; gap:6px; margin-bottom: 4px;">
              <span style="font-size: 12px; color: ${ownerIsDormant ? '#EF4444' : tc.main}; font-weight: 600;">
                ${store.category === 'cafe' ? '☕ 카페쿠폰' :
                  store.category === 'restaurant' ? '🍽️ 음식점쿠폰' :
                  store.category === 'beauty' ? '💅 뷰티쿠폰' :
                  store.category === 'hospital' ? '🏥 병원쿠폰' :
                  store.category === 'fitness' ? '💪 헬스장쿠폰' : '🎁 쿠폰'}
              </span>
              ${badgeColors ? `<span style="
                background: ${badgeColors.bg};
                color: ${badgeColors.color};
                border: 1px solid ${badgeColors.border};
                padding: 1px 7px;
                border-radius: 99px;
                font-size: 11px;
                font-weight: 700;
              ">${badgeColors.text}</span>` : ''}
            </div>
            <div style="font-size: 16px; font-weight: 700; margin-bottom: 8px; color: #1a1a1a;">
              ${store.name}
            </div>
            <div style="font-size: 13px; color: #666; margin-bottom: 4px;">
              📞 ${store.phone || '연락처 없음'}
            </div>
            <div style="font-size: 13px; color: #666; margin-bottom: 8px;">
              📍 ${formatDistance(distance)}
            </div>
            ${coupon ? `
            <div style="font-size: 14px; font-weight: 600; color: #E91E63; margin-bottom: 8px;">
              🎁 ${coupon.title}
            </div>
            ` : ownerIsDormant ? `
            <div style="font-size: 13px; color: #9CA3AF; margin-bottom: 8px; font-style: italic;">
              현재 쿠폰이 없습니다. 사장님께 요청해보세요!
            </div>
            ` : ''}
            <div style="display:flex; gap:6px; align-items:center;">
              ${ownerIsDormant ? `
              <button
                onclick="window.nudgeMerchant(${(store as any).ownerId}, '${store.name.replace(/'/g, "\\'")}', event)"
                style="
                  flex:1;
                  padding: 8px 16px;
                  background: linear-gradient(135deg, #F59E0B, #EF4444);
                  color: white;
                  border: none;
                  border-radius: 8px;
                  font-size: 14px;
                  font-weight: 700;
                  cursor: pointer;
                "
              >
                🎁 조르기
              </button>
              ` : `
              <button
                onclick="window.showStoreDetail(${store.id})"
                style="
                  flex:1;
                  padding: 8px 16px;
                  background: ${tc.main};
                  color: white;
                  border: none;
                  border-radius: 8px;
                  font-size: 14px;
                  font-weight: 600;
                  cursor: pointer;
                "
              >
                상세보기 →
              </button>
              `}
              <button
                onclick="window.nudgeMerchant(${(store as any).ownerId}, '${store.name.replace(/'/g, "\\'")}', event)"
                style="
                  padding: 8px 12px;
                  background: #fef3c7;
                  color: #92400e;
                  border: 1px solid #f59e0b;
                  border-radius: 8px;
                  font-size: 12px;
                  font-weight: 700;
                  cursor: pointer;
                  white-space: nowrap;
                "
                title="더 많은 쿠폰 요청하기"
              >🎁</button>
            </div>
          </div>
        `;

        const infoWindow = new google.maps.InfoWindow({
          content: infoWindowContent,
        });

        let isInfoWindowHovered = false;
        let isMarkerHovered = false;

        // 마커 호버 이벤트
        marker.addListener('mouseover', () => {
          isMarkerHovered = true;
          // 모든 InfoWindow 닫기
          newInfoWindows.forEach(iw => iw.close());
          infoWindow.open(mapInstance, marker);
          
          // InfoWindow가 열린 후 이벤트 리스너 추가
          setTimeout(() => {
            const infoWindowElement = document.querySelector('.gm-style-iw-c');
            if (infoWindowElement) {
              infoWindowElement.addEventListener('mouseenter', () => {
                isInfoWindowHovered = true;
              });
              infoWindowElement.addEventListener('mouseleave', () => {
                isInfoWindowHovered = false;
                // InfoWindow에서 마우스가 벗어나면 닫기
                setTimeout(() => {
                  if (!isMarkerHovered && !isInfoWindowHovered) {
                    infoWindow.close();
                  }
                }, 100);
              });
            }
          }, 100);
        });

        marker.addListener('mouseout', () => {
          isMarkerHovered = false;
          // InfoWindow나 마커에 마우스가 없으면 닫기
          setTimeout(() => {
            if (!isMarkerHovered && !isInfoWindowHovered) {
              infoWindow.close();
            }
          }, 100);
        });

        // 마커 클릭 이벤트
        // 모바일은 mouseover 이벤트가 없으므로 click 시 InfoWindow를 먼저 표시
        // InfoWindow가 이미 열려 있으면 상세보기로 이동
        marker.addListener('click', () => {
          // 동일 주소 다중 업장 — 단일 상세 대신 리스트 모달 오픈
          if (isStacked) {
            newInfoWindows.forEach(iw => iw.close());
            setSelectedStoreGroup(addrGroup);
            setShowStoreGroupModal(true);
            return;
          }

          // InfoWindow가 닫혀 있으면 열기 (모바일 첫 탭)
          const isOpen = newInfoWindows.some((iw) => {
            try { return (iw as any).map != null; } catch { return false; }
          });

          // 현재 InfoWindow 열려있는지 간접 판단: anchor로 확인
          let thisWindowOpen = false;
          try {
            // @ts-ignore — internal property check
            thisWindowOpen = !!(infoWindow as any).anchor;
          } catch { thisWindowOpen = false; }

          if (thisWindowOpen) {
            // 이미 열린 상태 → 상세보기로 이동
            setSelectedStore(store);
            setShowDetailModal(true);
          } else {
            // 닫힌 상태 → InfoWindow 열기 (조르기/상세보기 버튼 표시)
            newInfoWindows.forEach(iw => iw.close());
            infoWindow.open(mapInstance, marker);
          }
        });

        newMarkers.push(marker);
        newInfoWindows.push(infoWindow);
      });

      markersRef.current = newMarkers; // 동기 업데이트 — 다음 정리 사이클에서 즉시 참조
      setMarkers(newMarkers);
      setInfoWindows(newInfoWindows);

      // 지도 드래그/이동 시 모든 InfoWindow 닫기 (모바일 조르기버튼 잔류 방지)
      mapInstance.addListener('dragstart', () => {
        newInfoWindows.forEach(iw => iw.close());
      });

      // 줌 변경 시 도트 ↔ 이모지 마커 전환 (기존 리스너 제거 후 재등록 - 메모리 리크 방지)
      if (zoomListenerRef.current) {
        google.maps.event.removeListener(zoomListenerRef.current);
      }
      zoomListenerRef.current = mapInstance.addListener('zoom_changed', () => {
        const zoom = mapInstance.getZoom() ?? 13;
        storeMarkerData.forEach(({ marker, emoji, isUsedStore, ownerTier, ownerIsDormant, stackCount }) => {
          marker.setIcon(buildMarkerIcon(emoji, isUsedStore, ownerTier, zoom, ownerIsDormant, stackCount));
        });
      });

      // 전역 함수로 상세보기 핸들러 등록
      (window as any).showStoreDetail = (storeId: number) => {
        const store = filteredStores.find(s => s.id === storeId);
        if (store) {
          setSelectedStore(store);
          setShowDetailModal(true);
        }
      };

      // 조르기 전역 핸들러 — 로그인 유저 누구나 가능 (stores.nudgeDormant)
      (window as any).nudgeMerchant = (ownerId: number, storeName: string, e: Event) => {
        e.stopPropagation();
        if (!user) {
          toast.error('로그인 후 이용할 수 있습니다.');
          return;
        }
        if (!confirm(`'${storeName}' 사장님께 쿠폰을 더 달라고 조르시겠습니까?`)) return;
        nudgeMutateRef.current({ ownerId, storeName });
      };
    },
    [stores, userLocation, calculateDistance, category, searchQuery, user, selectedRadius, canShowRadar, discountFilter, discountFilterActive]
  );

  // 카테고리/반경 변경 시 지도 업데이트
  useEffect(() => {
    if (map && stores && userLocation) {
      handleMapReady(map);
    }
  }, [category, stores, map, userLocation, selectedRadius, handleMapReady]);

  const categories = [
    { id: 'all', name: '전체', icon: '🎁' },
    { id: 'coupon', name: '할인중', icon: '🏷️' },
    { id: 'cafe', name: '카페', icon: '☕' },
    { id: 'restaurant', name: '음식점', icon: '🍽️' },
    { id: 'beauty', name: '뷰티', icon: '💅' },
    { id: 'hospital', name: '병원', icon: '🏥' },
    { id: 'fitness', name: '헬스장', icon: '💪' },
    { id: 'other', name: '기타', icon: '🎁' },
  ];

  // 기본 노출 5개 + "더보기"로 나머지 펼침. 선택된 카테고리가 숨김 목록이면 자동 펼침.
  const BASE_CATEGORY_COUNT = 5;
  useEffect(() => {
    const baseIds = categories.slice(0, BASE_CATEGORY_COUNT).map(c => c.id);
    if (!baseIds.includes(category)) {
      setShowAllCategories(true);
    }
  }, [category]);
  const visibleCategories = showAllCategories ? categories : categories.slice(0, BASE_CATEGORY_COUNT);

  return (
    <div className="flex flex-col" style={{ height: '100dvh', paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}>
      {/* Compact Header — 그라디언트 배경: 모바일 상태바(시간/배터리) 가시성 확보 */}
      <header className="bg-gradient-to-r from-primary to-accent z-50 shadow-md" style={{ paddingTop: 'env(safe-area-inset-top, 0px)' }}>
        <div className="container mx-auto px-4 py-3 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2">
            <div className="w-8 h-8 bg-white/25 rounded-xl flex items-center justify-center">
              <Gift className="w-5 h-5 text-white" />
            </div>
            <span className="text-xl font-bold text-white drop-shadow-sm">
              마이쿠폰
            </span>
          </Link>

          {user ? (
            <div className="flex items-center gap-1.5">
              {/* 그라디언트 배경 위에서 잘 보이는 반투명 흰색 pill 버튼 */}
              <Link href="/">
                <button className="hidden items-center px-3 py-1.5 rounded-full text-xs font-semibold bg-white/20 hover:bg-white/35 text-white transition-colors border border-white/30 whitespace-nowrap">
                  🎟 내 쿠폰 찾기
                </button>
              </Link>
              <Link href="/my-coupons">
                <button className="hidden items-center px-3 py-1.5 rounded-full text-xs font-semibold bg-white/20 hover:bg-white/35 text-white transition-colors border border-white/30 whitespace-nowrap">
                  📒 내 쿠폰북
                </button>
              </Link>
              <Link href="/gamification">
                <button className="hidden items-center px-3 py-1.5 rounded-full text-xs font-semibold bg-white/20 hover:bg-white/35 text-white transition-colors border border-white/30 whitespace-nowrap">
                  ⭐ 활동
                </button>
              </Link>
              {(user.role === 'merchant' || user.role === 'admin') && (
                <Link href="/merchant/dashboard">
                  <button className="hidden items-center px-3 py-1.5 rounded-full text-xs font-semibold bg-white/30 hover:bg-white/45 text-white transition-colors border border-white/40 whitespace-nowrap">
                    🏪 사장님
                  </button>
                </Link>
              )}
              {user.role === 'admin' && (
                <Link href="/admin">
                  <button className="hidden sm:flex items-center px-3 py-1.5 rounded-full text-xs font-bold bg-white/40 hover:bg-white/55 text-white transition-colors border border-white/50 whitespace-nowrap">
                    🛡 관리자
                  </button>
                </Link>
              )}
              
              {/* 검색 토글 — 🔍 ↔ ✕. 상단 검색바 세로 공간 회수를 위한 아이콘 접근.
                  닫을 때 검색어/드롭다운 잔류 방지를 위해 searchQuery/showSearchResults 클리어. */}
              <Button
                variant="ghost"
                size="sm"
                className={`rounded-full text-white hover:bg-white/20 ${showSearchBar ? 'bg-white/20' : ''}`}
                onClick={() => {
                  if (showSearchBar) {
                    setSearchQuery('');
                    setShowSearchResults(false);
                  }
                  setShowSearchBar(!showSearchBar);
                }}
                aria-label={showSearchBar ? '검색 닫기' : '검색 열기'}
                aria-expanded={showSearchBar}
              >
                {showSearchBar
                  ? <X className="w-5 h-5 text-white" />
                  : <Search className="w-5 h-5 text-white" />}
              </Button>

              {/* 할인 필터 패널 토글 — 필터 활성 시 점(dot) 배지 표시 */}
              <Button
                variant="ghost"
                size="sm"
                className={`relative rounded-full text-white hover:bg-white/20 ${showFilterPanel ? 'bg-white/20' : ''}`}
                onClick={() => setShowFilterPanel(v => !v)}
                aria-label="할인 필터 열기"
                aria-expanded={showFilterPanel}
              >
                <SlidersHorizontal className="w-5 h-5 text-white" />
                {discountFilterActive && (
                  <span className="absolute top-1 right-1 w-2 h-2 rounded-full bg-red-400 border border-white" />
                )}
              </Button>

              {/* 알림 종 — 유저/사업주 모두 노출 (본인 수신 알림만 보임). admin 제외.
                  사업주는 nudgeDormant 수신 알림(조르기 받음)을, 유저는 nudge_activated/newly_opened 등을 확인 */}
              {user.role !== 'admin' && <NotificationBadge />}

              <Button
                variant="ghost"
                size="sm"
                className="rounded-full text-white hover:bg-white/20"
                onClick={() => setShowMenu(!showMenu)}
              >
                <Menu className="w-5 h-5 text-white" />
              </Button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="sm" className="rounded-full p-0 h-auto">
                    <div className="w-8 h-8 bg-white/30 rounded-full flex items-center justify-center text-white text-sm font-bold cursor-pointer hover:bg-white/40 transition-colors">
                      {user.name?.[0] || 'U'}
                    </div>
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-52">
                  <div className="px-2 py-1.5 text-sm font-medium">{user.name}</div>
                  <div className="px-2 py-1 text-xs text-muted-foreground">{user.email}</div>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={handleMerchantShortcut}>
                    <Store className="w-4 h-4 mr-2 text-amber-500" />
                    <span className="flex-1">사장님 바로가기</span>
                    <span className="ml-1.5 text-[10px] font-bold px-1 py-0.5 rounded bg-orange-100 text-orange-600 leading-none">
                      HOT
                    </span>
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => setLocation('/my-coupons')}>
                    <Gift className="w-4 h-4 mr-2" />
                    내 쿠폰북
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => setLocation('/gamification')}>
                    <User className="w-4 h-4 mr-2" />
                    마이쿠폰 활동
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    onClick={() => logoutMutation.mutate()}
                    className="text-red-600"
                  >
                    <LogOut className="w-4 h-4 mr-2" />
                    로그아웃
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          ) : (
            <div className="flex items-center gap-1.5">
              {/* 비로그인 유저도 매장 검색은 가능해야 함 — 검색 토글 노출 */}
              <Button
                variant="ghost"
                size="sm"
                className={`rounded-full text-white hover:bg-white/20 ${showSearchBar ? 'bg-white/20' : ''}`}
                onClick={() => {
                  if (showSearchBar) {
                    setSearchQuery('');
                    setShowSearchResults(false);
                  }
                  setShowSearchBar(!showSearchBar);
                }}
                aria-label={showSearchBar ? '검색 닫기' : '검색 열기'}
                aria-expanded={showSearchBar}
              >
                {showSearchBar
                  ? <X className="w-5 h-5 text-white" />
                  : <Search className="w-5 h-5 text-white" />}
              </Button>
              {/* 비로그인도 할인 필터 사용 가능 */}
              <Button
                variant="ghost"
                size="sm"
                className={`relative rounded-full text-white hover:bg-white/20 ${showFilterPanel ? 'bg-white/20' : ''}`}
                onClick={() => setShowFilterPanel(v => !v)}
                aria-label="할인 필터 열기"
                aria-expanded={showFilterPanel}
              >
                <SlidersHorizontal className="w-5 h-5 text-white" />
                {discountFilterActive && (
                  <span className="absolute top-1 right-1 w-2 h-2 rounded-full bg-red-400 border border-white" />
                )}
              </Button>
              <Button
                onClick={() => {
                  console.log('[OAUTH] login button clicked (MapPage header)');
                  openGoogleLogin(getLoginUrl()).catch(() => {});
                }}
                className="rounded-xl bg-gradient-to-r from-primary to-accent"
                size="sm"
              >
                로그인
              </Button>
            </div>
          )}
        </div>

        {/* Mobile Menu */}
        {showMenu && user && (
          <div className="border-t bg-white px-4 py-2">
            <div className="flex flex-col gap-2">
              <Link href="/">
                <Button variant="ghost" size="sm" className="w-full justify-start rounded-xl">
                  내 쿠폰 찾기
                </Button>
              </Link>
              <Button
                variant="ghost"
                size="sm"
                className="w-full justify-start rounded-xl text-amber-700"
                onClick={() => { setShowMenu(false); handleMerchantShortcut(); }}
              >
                <Store className="w-4 h-4 mr-2 text-amber-500" />
                사장님 바로가기
                <span className="ml-1.5 text-[10px] font-bold px-1 py-0.5 rounded bg-orange-100 text-orange-600 leading-none">
                  HOT
                </span>
              </Button>
              <Link href="/my-coupons">
                <Button variant="ghost" size="sm" className="w-full justify-start rounded-xl">
                  내 쿠폰북
                </Button>
              </Link>
              <Link href="/gamification">
                <Button variant="ghost" size="sm" className="w-full justify-start rounded-xl">
                  마이쿠폰 활동
                </Button>
              </Link>
              {user.role === 'admin' && (
                <Link href="/admin">
                  <Button variant="ghost" size="sm" className="w-full justify-start rounded-xl">
                    관리자
                  </Button>
                </Link>
              )}
              <div className="border-t my-2" />
              <Button
                variant="ghost"
                size="sm"
                className="w-full justify-start"
                onClick={() => logoutMutation.mutate()}
              >
                <LogOut className="w-4 h-4 mr-2" />
                로그아웃
              </Button>
            </div>
          </div>
        )}
      </header>

      {/* 위치 권한 배너 */}
      <LocationPermissionBanner
        permissionStatus={permissionStatus}
        error={locationError}
        isUsingDefaultLocation={isUsingDefaultLocation}
        isLoading={isLocationLoading}
        locationName={locationName}
        onRequestLocation={requestLocation}
        onRetry={retryLocation}
      />

      {/* 할인 필터 적용 중 배지 — 유저에게 현 탐색 범위 상태 명시 (반경 전체 확장 + 해제 단축 버튼) */}
      {discountFilterActive && (
        <div className="bg-accent/10 border-b border-accent/20 px-4 py-1.5 flex items-center justify-between gap-2">
          <span className="text-[11px] text-accent font-semibold truncate">
            🔍 할인 필터 적용 중 · 반경 전체 검색
          </span>
          <button
            onClick={() => setDiscountFilter(EMPTY_DISCOUNT_FILTER)}
            className="shrink-0 text-[11px] font-semibold text-accent hover:underline px-2 py-0.5 rounded"
          >
            필터 해제
          </button>
        </div>
      )}

      {/* Search Bar — 헤더 🔍 토글(showSearchBar)로만 펼침. 기본은 접힘(세로 공간 회수).
          기존 searchQuery/searchResults/showSearchResults state 와 드롭다운 동작 그대로 보존. */}
      {showSearchBar && (
        <div className="bg-white border-b px-4 pt-2 pb-2.5">
          <div className="max-w-2xl mx-auto relative">
            <input
              type="text"
              placeholder="근처 매장 검색..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              autoFocus
              className="w-full h-12 pl-11 pr-10 rounded-[24px] bg-white border border-gray-200 shadow-sm focus:ring-2 focus:ring-primary/30 focus:outline-none text-[14px]"
            />
          <svg className="w-[18px] h-[18px] absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          {searchQuery && (
            <button
              onClick={() => {
                setSearchQuery('');
                setShowSearchResults(false);
              }}
              className="absolute right-3.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
            >
              <X className="w-4 h-4" />
            </button>
          )}
          
          {/* 검색 결과 목록 */}
          {showSearchResults && searchResults.length > 1 && (
            <div className="absolute top-full left-0 right-0 mt-2 bg-white border-2 border-primary/20 rounded-xl shadow-lg max-h-80 overflow-y-auto z-50">
              <div className="p-2 space-y-1">
                {searchResults.map((store) => (
                  <button
                    key={store.id}
                    onClick={() => {
                      if (map && store.latitude && store.longitude) {
                        map.setCenter({
                          lat: parseFloat(store.latitude),
                          lng: parseFloat(store.longitude),
                        });
                        map.setZoom(17);
                        setSelectedStore(store);
                        setShowDetailModal(true);
                        setShowSearchResults(false);
                      }
                    }}
                    className="w-full text-left p-3 hover:bg-gray-50 rounded-lg transition-colors"
                  >
                    <div className="font-medium text-sm">{store.name}</div>
                    <div className="text-xs text-gray-500 flex items-center gap-1 mt-1">
                      <MapPin className="w-3 h-3" />
                      {store.address}
                    </div>
                    {store.distance && (
                      <div className="text-xs text-primary mt-1">
                        📍 {formatDistance(store.distance)}
                      </div>
                    )}
                  </button>
                ))}
              </div>
            </div>
          )}
          </div>
        </div>
      )}

      {/* Phase 3-2 — 유저 알림 맥락 필터 탭 (전체 / 조르기 확인하기 / 새로 오픈했어요)
          알림 벨에서 ?tab= 으로 진입 시 자동 선택. 페이지 진입만으로 읽음 처리 금지 — 탭 클릭 시에만 markTabSeen.
          role 분리 정책은 서버 side(getUnreadCountByType / listNudgeActivated / listNewlyOpened) 에서 유지되므로
          비유저 role(비로그인·merchant·admin) 은 count=0 + 빈 리스트를 받는다.
          상단 탐색영역 레이아웃 고정을 위해 UI 탭 자체는 모든 role 에 노출한다. */}
      <div className="bg-white border-b overflow-hidden">
        <div className="px-4 pt-2 pb-1.5 overflow-x-auto scrollbar-hide">
          <div className="flex gap-2 min-w-max">
            {([
              { id: 'all' as UserAlertTab, label: '전체', icon: '🗺️', count: 0 },
              { id: 'nudge' as UserAlertTab, label: '조르기 확인하기', icon: '🔔', count: unreadByType?.nudgeActivated ?? 0 },
              { id: 'newopen' as UserAlertTab, label: '새로 오픈했어요', icon: '✨', count: unreadByType?.newlyOpenedNearby ?? 0 },
            ]).map((tab) => (
              <button
                key={tab.id}
                onClick={() => handleTabClick(tab.id)}
                className={`relative flex items-center gap-1.5 h-8 px-3 rounded-2xl text-[13px] font-semibold transition-colors active:scale-95 ${
                  activeTab === tab.id
                    ? 'bg-accent text-white'
                    : 'bg-white text-gray-700 border border-gray-200 hover:border-accent/40'
                }`}
                aria-pressed={activeTab === tab.id}
              >
                <span className="text-[12px]">{tab.icon}</span>
                <span>{tab.label}</span>
                {tab.count > 0 && activeTab !== tab.id && (
                  <span className="ml-0.5 inline-flex min-w-[16px] h-4 px-1 items-center justify-center rounded-full bg-red-500 text-white text-[10px] font-bold">
                    {tab.count}
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>

        {/* Phase 3-3 — 반경 선택 pill (GPS 권한/좌표 준비 시에만 표시).
            권한 거부 또는 IP-fallback 위치일 경우 대신 안내 banner 노출. */}
        {canShowRadar ? (
          <div className="px-4 pb-2 flex items-center gap-2 overflow-x-auto scrollbar-hide">
            <span className="text-[11px] text-gray-500 shrink-0">반경</span>
            <div className="flex gap-1.5">
              <button
                onClick={() => handleRadiusChange(null)}
                className={`px-2.5 py-1 rounded-full text-[11px] font-semibold transition-colors active:scale-95 ${
                  selectedRadius === null
                    ? 'bg-rose-500 text-white shadow-sm'
                    : 'bg-white text-gray-600 border border-gray-200 hover:border-rose-300'
                }`}
                aria-pressed={selectedRadius === null}
                aria-label="반경 필터 해제 (전체 보기)"
              >
                전체
              </button>
              {USER_ALERT_RADIUS_OPTIONS_M.map((r) => (
                <button
                  key={r}
                  onClick={() => handleRadiusChange(r)}
                  className={`px-2.5 py-1 rounded-full text-[11px] font-semibold transition-colors active:scale-95 ${
                    selectedRadius === r
                      ? 'bg-rose-500 text-white shadow-sm'
                      : 'bg-white text-gray-600 border border-gray-200 hover:border-rose-300'
                  }`}
                  aria-pressed={selectedRadius === r}
                >
                  {r}m
                </button>
              ))}
            </div>
          </div>
        ) : (permissionStatus === 'denied' || permissionStatus === 'unavailable') ? (
          <div className="px-4 pb-2">
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-amber-50 border border-amber-200 text-[11px] text-amber-800">
              <span>📍</span>
              <span>반경 보기는 위치 권한이 필요합니다. 브라우저 설정에서 위치 접근을 허용해 주세요.</span>
            </div>
          </div>
        ) : null}
      </div>

      {/* Category Filter — overflow-x-auto 국소 스크롤, 상위는 clip */}
      <div className="bg-white border-b overflow-hidden">
        <div className="px-4 pt-1.5 pb-2 overflow-x-auto scrollbar-hide">
        <div className="flex gap-2 min-w-max">
          {visibleCategories.map((cat) => (
            <button
              key={cat.id}
              onClick={() => setCategory(cat.id)}
              className={`flex items-center gap-1.5 h-[34px] px-3 rounded-[17px] text-[13px] font-semibold transition-colors active:scale-95 ${
                category === cat.id
                  ? 'bg-accent/10 text-accent'
                  : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
              }`}
            >
              <span className="text-[14px]">{cat.icon}</span>
              <span>{cat.name}</span>
            </button>
          ))}
          {!showAllCategories && categories.length > BASE_CATEGORY_COUNT && (
            <button
              onClick={() => setShowAllCategories(true)}
              className="flex items-center gap-1.5 h-[34px] px-3 rounded-[17px] text-[13px] font-semibold bg-gray-100 text-gray-700 hover:bg-gray-200 transition-colors active:scale-95"
              aria-label="카테고리 더보기"
            >
              <span className="text-[14px]">⋯</span>
              <span>더보기</span>
            </button>
          )}
        </div>
        </div>
      </div>

      {/* 벚꽃 낙화 애니메이션 — 지도 위에 포인터 이벤트 없이 표시 */}
      <CherryBlossoms />

      {/* Map Container */}
      <div className="flex-1 relative">
        {userLocation ? (
          <>
            {/* Phase 3-2 — 탭 결과 오버레이 (nudge/newopen 탭일 때만 노출).
                RankingOverlay 와 동일 영역을 차지하므로 동시 노출되지 않음. */}
            {activeTab === 'all' ? (
              <RankingOverlay
                items={rankedStores}
                selectedId={selectedStore?.id ?? null}
                onSelect={(item) => {
                  const store = stores?.find(s => s.id === item.id);
                  if (store) {
                    setSelectedStore(store as StoreWithCoupons);
                    setShowDetailModal(true);
                    if (map && store.latitude && store.longitude) {
                      map.panTo({
                        lat: parseFloat(store.latitude),
                        lng: parseFloat(store.longitude),
                      });
                      map.setZoom(16);
                    }
                  }
                }}
              />
            ) : (
              <div className="absolute top-3 left-3 z-25 w-[min(320px,calc(100%-24px))] bg-white/95 backdrop-blur rounded-2xl shadow-lg border border-gray-100 overflow-hidden">
                <div className="px-4 py-2.5 border-b border-gray-100 flex items-center gap-2">
                  <span className="text-base">
                    {activeTab === 'nudge' ? '🔔' : '✨'}
                  </span>
                  <span className="font-semibold text-sm text-gray-800">
                    {activeTab === 'nudge' ? '조르기 확인하기' : '새로 오픈했어요'}
                  </span>
                </div>
                <div className="max-h-[55vh] overflow-y-auto">
                  {(() => {
                    const isLoading =
                      activeTab === 'nudge'
                        ? nudgeActivatedQuery.isLoading
                        : newlyOpenedQuery.isLoading;
                    const items: any[] =
                      activeTab === 'nudge'
                        ? (nudgeActivatedQuery.data ?? [])
                        : (newlyOpenedQuery.data ?? []);
                    if (isLoading) {
                      return (
                        <div className="px-4 py-8 text-center text-xs text-gray-400">
                          불러오는 중...
                        </div>
                      );
                    }
                    if (items.length === 0) {
                      return (
                        <div className="px-4 py-8 text-center text-xs text-gray-500 leading-relaxed">
                          {activeTab === 'nudge'
                            ? '조르기한 업장 중 새로 열린\n쿠폰이 아직 없어요'
                            : '설정 반경 내 새로 오픈한\n업장이 아직 없어요'}
                        </div>
                      );
                    }
                    return (
                      <ul className="divide-y divide-gray-50">
                        {items.map((it: any) => {
                          const storeId: number = it.storeId;
                          const name: string = it.storeName ?? '가게정보 없음';
                          const img: string | null = (() => {
                            const raw = it.imageUrl;
                            if (!raw || typeof raw !== 'string') return null;
                            try {
                              const parsed = JSON.parse(raw);
                              return Array.isArray(parsed) ? parsed[0] ?? null : raw;
                            } catch { return raw; }
                          })();
                          const rawLat = it.latitude ?? it.lat;
                          const rawLng = it.longitude ?? it.lng;
                          const lat = rawLat != null ? parseFloat(String(rawLat)) : null;
                          const lng = rawLng != null ? parseFloat(String(rawLng)) : null;
                          const subMeta =
                            activeTab === 'nudge'
                              ? it.couponTitle
                                ? `쿠폰: ${it.couponTitle}`
                                : '쿠폰 활성화'
                              : typeof it.distanceM === 'number'
                                ? `${Math.round(it.distanceM)}m`
                                : '';
                          return (
                            <li key={storeId}>
                              <button
                                type="button"
                                onClick={() => {
                                  const store = stores?.find(s => s.id === storeId);
                                  if (store) {
                                    setSelectedStore(store as StoreWithCoupons);
                                    setShowDetailModal(true);
                                  }
                                  if (map && Number.isFinite(lat) && Number.isFinite(lng)) {
                                    map.panTo({ lat: lat as number, lng: lng as number });
                                    map.setZoom(16);
                                  }
                                }}
                                className="w-full flex items-center gap-2 px-3 py-2 hover:bg-gray-50 active:bg-gray-100 text-left"
                              >
                                {img ? (
                                  <img src={img} alt="" className="w-10 h-10 rounded-lg object-cover shrink-0 border" />
                                ) : (
                                  <div className="w-10 h-10 rounded-lg bg-gray-50 flex items-center justify-center shrink-0 border">
                                    <Store className="w-4 h-4 text-gray-300" />
                                  </div>
                                )}
                                <div className="min-w-0 flex-1">
                                  <p className="text-sm font-medium text-gray-900 truncate">{name}</p>
                                  <p className="text-[11px] text-gray-500 truncate">{subMeta}</p>
                                </div>
                              </button>
                            </li>
                          );
                        })}
                      </ul>
                    );
                  })()}
                </div>
              </div>
            )}

            <MapView
              onMapReady={handleMapReady}
              initialCenter={userLocation}
              initialZoom={15}
              className="w-full h-full"
            />

          </>
        ) : (
          <div className="w-full h-full flex items-center justify-center bg-muted">
            <div className="text-center">
              <Navigation className="w-12 h-12 mx-auto mb-4 text-muted-foreground animate-pulse" />
              <p className="text-muted-foreground">위치 정보를 가져오는 중...</p>
            </div>
          </div>
        )}

        {/* My Location Button — 작은 원형 아이콘 버튼 */}
        {userLocation && map && (
          <div className="absolute bottom-16 right-3">
            <Button
              size="icon"
              className="w-9 h-9 rounded-full shadow-md bg-white hover:bg-gray-50 text-foreground border border-gray-200"
              onClick={async () => {
                console.log('[MyLocation] 내 위치 버튼 클릭');
                
                // 항상 최신 위치 정보를 가져옴
                if (navigator.geolocation) {
                  navigator.geolocation.getCurrentPosition(
                    (position) => {
                      const newLocation = {
                        lat: position.coords.latitude,
                        lng: position.coords.longitude,
                      };
                      console.log('[MyLocation] ✅ 실제 사용자 위치:', newLocation);

                      // 즉시 지도 이동
                      if (map) {
                        map.setCenter(newLocation);
                        map.setZoom(16);
                        console.log('[MyLocation] 지도 중심 이동 완료');
                      }
                    },
                    (error) => {
                      console.error('[MyLocation] ❌ 위치 정보 가져오기 실패:', error);
                      // PC에서 GPS 없는 경우 enableHighAccuracy:false로 재시도
                      navigator.geolocation.getCurrentPosition(
                        (position) => {
                          const newLocation = {
                            lat: position.coords.latitude,
                            lng: position.coords.longitude,
                          };
                          console.log('[MyLocation] ✅ 저정밀도 위치 성공:', newLocation);
                          if (map) {
                            map.setCenter(newLocation);
                            map.setZoom(15);
                          }
                        },
                        () => {
                          toast.error('PC에서 위치를 찾지 못했습니다. Windows 설정에서 위치 서비스를 켜거나 모바일을 이용해주세요.');
                        },
                        { enableHighAccuracy: false, timeout: 12000, maximumAge: 60000 }
                      );
                    },
                    {
                      enableHighAccuracy: true,
                      timeout: 8000,
                      maximumAge: 0,
                    }
                  );
                } else {
                  toast.error('이 브라우저는 위치 정보를 지원하지 않습니다.');
                }
              }}
              disabled={isLocationLoading}
            >
              <Navigation className={`w-4 h-4 ${isLocationLoading ? 'animate-pulse' : ''}`} />
            </Button>
          </div>
        )}
      </div>

      {/* FloatingPromoWidget 제거 — 지저분하다는 사용자 피드백 반영 */}

      {/* 상세 바텀시트 — 오버레이 없음: 지도 + 마커가 위에 그대로 보임 */}
      {showDetailModal && (
        <SwipeableBottomSheet onClose={() => setShowDetailModal(false)}>
          {selectedStore && (
            <div className="px-5 pb-6 space-y-4">
              {/* 헤더: 매장명 + 보는중 뱃지 + 닫기 */}
              <div className="flex items-start justify-between gap-3 pt-1">
                <div className="flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h2 className="text-xl font-bold text-gray-900 leading-tight">{selectedStore.name}</h2>
                    {/* 관심 뱃지 */}
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-orange-100 text-orange-600 text-xs font-semibold">
                      <span className="w-1.5 h-1.5 rounded-full bg-orange-500 animate-pulse inline-block" />
                      {getViewerCount(selectedStore.id)}명이 보는중
                    </span>
                  </div>
                  <p className="text-xs text-gray-400 mt-0.5">{selectedStore.address}</p>
                </div>
                <button
                  onClick={() => setShowDetailModal(false)}
                  className="w-8 h-8 rounded-full bg-gray-100 flex items-center justify-center flex-shrink-0 hover:bg-gray-200 transition-colors mt-1"
                >
                  <X className="w-4 h-4 text-gray-600" />
                </button>
              </div>

              {/* 소셜 증거 뱃지 */}
              <div className="flex flex-wrap gap-2">
                {selectedStore.distance && (
                  <span className="px-2.5 py-1 rounded-full text-xs font-medium bg-gray-100 text-gray-700">
                    📍 {formatDistance(selectedStore.distance)}
                  </span>
                )}
                {selectedStore.rating && (
                  <span className="px-2.5 py-1 rounded-full text-xs font-medium bg-yellow-50 text-yellow-700">
                    ⭐️ {selectedStore.rating}
                  </span>
                )}
                {selectedStore.ratingCount && selectedStore.ratingCount > 0 && (
                  <span className="px-2.5 py-1 rounded-full text-xs font-medium bg-orange-50 text-orange-600">
                    단골 {selectedStore.ratingCount}명
                  </span>
                )}
                {selectedStore.coupons.length > 0 && (
                  <span className="px-2.5 py-1 rounded-full text-xs font-medium bg-pink-50 text-pink-600">
                    🎁 쿠폰 {selectedStore.coupons.length}개
                  </span>
                )}
                {selectedStore.phone && (
                  <a href={`tel:${selectedStore.phone}`} className="px-2.5 py-1 rounded-full text-xs font-medium bg-blue-50 text-blue-600">
                    📞 {selectedStore.phone}
                  </a>
                )}
              </div>

              {/* 한줄평 */}
              {selectedStore.adminComment && (
                  <div className="flex items-center gap-2 bg-orange-50 rounded-xl px-3 py-2.5">
                    <div className="w-6 h-6 rounded-full bg-primary/20 flex items-center justify-center text-xs font-bold text-primary flex-shrink-0">
                      {selectedStore.adminCommentAuthor?.charAt(0) || '관'}
                    </div>
                    <span className="text-sm text-gray-700">"{selectedStore.adminComment}"</span>
                  </div>
                )}

                {/* 이미지 갤러리 (3장 가로 배치) */}
                {selectedStore.imageUrl && (() => {
                  try {
                    const images = JSON.parse(selectedStore.imageUrl);
                    if (Array.isArray(images) && images.length > 0) {
                      return (
                        <div className="grid grid-cols-3 gap-2">
                          {images.slice(0, 3).map((img: string, idx: number) => (
                            <div 
                              key={idx} 
                              className="aspect-square rounded-lg overflow-hidden cursor-pointer hover:opacity-80 transition-opacity shadow-sm"
                              onClick={() => setEnlargedImage(img)}
                            >
                              <img 
                                src={img} 
                                alt={`${selectedStore.name} 이미지 ${idx + 1}`}
                                className="w-full h-full object-cover"
                              />
                            </div>
                          ))}
                        </div>
                      );
                    }
                  } catch {
                    return (
                      <div 
                        className="aspect-square rounded-lg overflow-hidden cursor-pointer hover:opacity-80 transition-opacity shadow-sm"
                        onClick={() => setEnlargedImage(selectedStore.imageUrl!)}
                      >
                        <img 
                          src={selectedStore.imageUrl} 
                          alt={selectedStore.name}
                          className="w-full h-full object-cover"
                        />
                      </div>
                    );
                  }
                  return null;
                })()}

                {/* 관리자 한마디 말풍선 */}
                {selectedStore.description && (
                  <div className="relative bg-orange-50 border border-orange-200 rounded-2xl px-4 py-3">
                    <p className="text-[10px] font-bold text-orange-400 uppercase tracking-wide mb-1">관리자 한마디</p>
                    <p className="text-sm text-gray-700 leading-relaxed">"{selectedStore.description}"</p>
                    {/* 말풍선 꼬리 */}
                    <span className="absolute -bottom-2 left-6 w-3 h-3 bg-orange-50 border-r border-b border-orange-200 rotate-45" />
                  </div>
                )}

                {/* 쿠폰 목록 — 컴팩트 카드 */}
                <div className="space-y-2 pt-1">
                  <h3 className="text-sm font-bold text-gray-900 flex items-center gap-1.5">
                    <span className="text-orange-500">🎁</span>
                    사용 가능한 쿠폰
                  </h3>
                  {selectedStore.coupons.map((coupon) => {
                    // 쿠폰 카드 배경은 tier 무관 단일 — 사장 플랜 상태(유료/무료) 유저 노출 방지.
                    const cardBg = 'bg-orange-50 border border-orange-300';
                    return (
                    <div key={coupon.id} className={`rounded-xl px-3 py-2.5 ${cardBg}`}>
                      <div className="flex items-center gap-2">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-baseline gap-2 flex-wrap">
                            <span className="font-bold text-sm text-gray-900 truncate">{coupon.title}</span>
                            <span className="text-sm font-extrabold text-orange-500 shrink-0">
                              {formatDiscount(coupon.discountType, coupon.discountValue)}
                            </span>
                          </div>
                          <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                            <span className="text-[11px] font-semibold text-orange-600">
                              {new Date(coupon.endDate).toLocaleDateString('ko-KR')}까지
                            </span>
                            <span className="text-[11px] text-gray-400">
                              남은 수량 {(coupon as any).remainingQuantity || 0}개
                            </span>
                          </div>
                        </div>
                        <div className="flex items-center gap-1 flex-shrink-0">
                          <button
                            onClick={(e) => { e.stopPropagation(); handleDownloadCoupon(coupon.id); }}
                            disabled={downloadingCouponId === coupon.id || downloadedCouponIds.has(coupon.id)}
                            className={`w-9 h-9 rounded-xl active:scale-95 transition-all flex items-center justify-center shadow-sm disabled:opacity-50 ${
                              downloadedCouponIds.has(coupon.id)
                                ? 'bg-green-500 cursor-default'
                                : 'bg-orange-500 hover:bg-orange-600'
                            }`}
                          >
                            {downloadingCouponId === coupon.id ? (
                              <Spinner className="w-4 h-4 text-white" />
                            ) : downloadedCouponIds.has(coupon.id) ? (
                              <CheckCircle className="w-4 h-4 text-white" />
                            ) : (
                              <Gift className="w-4 h-4 text-white" />
                            )}
                          </button>
                          {user?.role === 'admin' && (
                            <button
                              onClick={() => handleDeleteCoupon(coupon.id, coupon.title)}
                              disabled={deleteCouponMutation.isPending}
                              className="w-9 h-9 rounded-xl bg-red-100 hover:bg-red-200 active:scale-95 transition-all flex items-center justify-center"
                            >
                              <Trash2 className="w-3.5 h-3.5 text-red-500" />
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                    );
                  })}
                </div>
            </div>
          )}
        </SwipeableBottomSheet>
      )}

      {/* 동일 주소 다중 업장 리스트 바텀시트 — 그룹 마커(+N 배지) 클릭 시 열림 */}
      {showStoreGroupModal && selectedStoreGroup && selectedStoreGroup.length > 0 && (
        <SwipeableBottomSheet onClose={() => setShowStoreGroupModal(false)}>
          <div className="px-5 pb-6 space-y-3">
            <div className="pt-1 pb-2 flex items-start justify-between gap-3 border-b border-gray-100">
              <div className="flex-1">
                <h2 className="text-lg font-bold text-gray-900">
                  이 주소의 업장 {selectedStoreGroup.length}곳
                </h2>
                <p className="text-xs text-gray-400 mt-0.5 truncate">
                  📍 {selectedStoreGroup[0]?.address ?? ''}
                </p>
              </div>
              <button
                onClick={() => setShowStoreGroupModal(false)}
                className="w-8 h-8 rounded-full bg-gray-100 flex items-center justify-center flex-shrink-0 hover:bg-gray-200"
              >
                <X className="w-4 h-4 text-gray-600" />
              </button>
            </div>
            <div className="space-y-2">
              {selectedStoreGroup.map((s) => {
                const couponCnt = s.coupons?.length ?? 0;
                const emoji = s.category === 'cafe' ? '☕' :
                              s.category === 'restaurant' ? '🍽️' :
                              s.category === 'beauty' ? '💅' :
                              s.category === 'hospital' ? '🏥' :
                              s.category === 'fitness' ? '💪' : '🎁';
                return (
                  <button
                    key={s.id}
                    onClick={() => {
                      setShowStoreGroupModal(false);
                      setSelectedStore(s);
                      setShowDetailModal(true);
                    }}
                    className="w-full flex items-center gap-3 px-3 py-3 rounded-xl hover:bg-gray-50 active:bg-gray-100 border border-gray-100 text-left transition-colors"
                  >
                    <div className="w-11 h-11 rounded-full bg-pink-50 flex items-center justify-center text-xl flex-shrink-0">
                      {emoji}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-semibold text-gray-900 truncate">{s.name}</div>
                      <div className="text-xs text-gray-500 mt-0.5">
                        {couponCnt > 0 ? `🎁 쿠폰 ${couponCnt}개 보유` : '현재 쿠폰 없음'}
                      </div>
                    </div>
                    <span className="text-gray-400 text-lg flex-shrink-0">›</span>
                  </button>
                );
              })}
            </div>
          </div>
        </SwipeableBottomSheet>
      )}

      {/* 이미지 확대 모달 */}
      {enlargedImage && (
        <div 
          className="fixed inset-0 bg-black/80 z-[100] flex items-center justify-center p-4"
          onClick={() => setEnlargedImage(null)}
        >
          <button
            className="absolute top-4 right-4 text-white hover:text-gray-300 z-[101]"
            onClick={() => setEnlargedImage(null)}
          >
            <X className="w-8 h-8" />
          </button>
          <img 
            src={enlargedImage} 
            alt="확대 이미지"
            className="max-w-full max-h-full object-contain rounded-lg cursor-pointer"
            onClick={() => setEnlargedImage(null)}
          />
        </div>
      )}

      {/* 할인 필터 패널 — 프리셋 + 상세 범위 + 카테고리 복수 선택.
          적용하면 반경 자동 "전체" 확장 (useEffect), 해제 시 이전 반경 복원. */}
      {showFilterPanel && (
        <SwipeableBottomSheet onClose={() => setShowFilterPanel(false)}>
          <div className="px-5 pb-6 space-y-4">
            <div className="pt-1 pb-2 flex items-center justify-between border-b border-gray-100">
              <h2 className="text-lg font-bold text-gray-900">할인 필터</h2>
              <button
                onClick={() => setShowFilterPanel(false)}
                className="w-8 h-8 rounded-full bg-gray-100 flex items-center justify-center hover:bg-gray-200"
              >
                <X className="w-4 h-4 text-gray-600" />
              </button>
            </div>

            {/* 빠른 선택 프리셋 */}
            <div>
              <h3 className="text-xs font-semibold text-gray-600 mb-2">빠른 선택</h3>
              <div className="flex flex-wrap gap-2">
                <button
                  onClick={() => setDiscountFilter(f => ({ ...f, percentMin: 20, percentMax: 100 }))}
                  className={`px-3 py-1.5 rounded-full text-xs font-semibold border transition-colors ${
                    discountFilter.percentMin === 20 && discountFilter.percentMax === 100
                      ? 'bg-accent text-white border-accent'
                      : 'bg-white text-gray-700 border-gray-200 hover:border-accent/40'
                  }`}
                >
                  ⚡ 20%↑ 할인
                </button>
                <button
                  onClick={() => setDiscountFilter(f => ({ ...f, percentMin: 30, percentMax: 100 }))}
                  className={`px-3 py-1.5 rounded-full text-xs font-semibold border transition-colors ${
                    discountFilter.percentMin === 30 && discountFilter.percentMax === 100
                      ? 'bg-accent text-white border-accent'
                      : 'bg-white text-gray-700 border-gray-200 hover:border-accent/40'
                  }`}
                >
                  🔥 30%↑ 할인
                </button>
                <button
                  onClick={() => setDiscountFilter(f => ({ ...f, amountMin: 1000, amountMax: null }))}
                  className={`px-3 py-1.5 rounded-full text-xs font-semibold border transition-colors ${
                    discountFilter.amountMin === 1000 && discountFilter.amountMax === null
                      ? 'bg-accent text-white border-accent'
                      : 'bg-white text-gray-700 border-gray-200 hover:border-accent/40'
                  }`}
                >
                  💸 1,000원↑
                </button>
                <button
                  onClick={() => setDiscountFilter(f => ({ ...f, amountMin: 2000, amountMax: null }))}
                  className={`px-3 py-1.5 rounded-full text-xs font-semibold border transition-colors ${
                    discountFilter.amountMin === 2000 && discountFilter.amountMax === null
                      ? 'bg-accent text-white border-accent'
                      : 'bg-white text-gray-700 border-gray-200 hover:border-accent/40'
                  }`}
                >
                  💸 2,000원↑
                </button>
                <button
                  onClick={() => setDiscountFilter(f => ({ ...f, amountMin: 3000, amountMax: null }))}
                  className={`px-3 py-1.5 rounded-full text-xs font-semibold border transition-colors ${
                    discountFilter.amountMin === 3000 && discountFilter.amountMax === null
                      ? 'bg-accent text-white border-accent'
                      : 'bg-white text-gray-700 border-gray-200 hover:border-accent/40'
                  }`}
                >
                  💸 3,000원↑
                </button>
                <button
                  onClick={() => setDiscountFilter(f => ({ ...f, freebie: !f.freebie }))}
                  className={`px-3 py-1.5 rounded-full text-xs font-semibold border transition-colors ${
                    discountFilter.freebie
                      ? 'bg-accent text-white border-accent'
                      : 'bg-white text-gray-700 border-gray-200 hover:border-accent/40'
                  }`}
                >
                  🎁 무료 증정
                </button>
              </div>
            </div>

            {/* 상세 설정 — 직접 입력 (슬라이더 대신 MVP 단계 input number 2개) */}
            <div>
              <h3 className="text-xs font-semibold text-gray-600 mb-2">상세 설정</h3>
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <span className="w-14 text-xs text-gray-500">할인율</span>
                  <input
                    type="number"
                    min={0}
                    max={100}
                    placeholder="최소%"
                    value={discountFilter.percentMin ?? ''}
                    onChange={(e) => setDiscountFilter(f => ({
                      ...f,
                      percentMin: e.target.value === '' ? null : Math.max(0, Math.min(100, Number(e.target.value))),
                    }))}
                    className="flex-1 min-w-0 h-9 px-2.5 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-accent/30"
                  />
                  <span className="text-gray-400 text-sm">~</span>
                  <input
                    type="number"
                    min={0}
                    max={100}
                    placeholder="최대%"
                    value={discountFilter.percentMax ?? ''}
                    onChange={(e) => setDiscountFilter(f => ({
                      ...f,
                      percentMax: e.target.value === '' ? null : Math.max(0, Math.min(100, Number(e.target.value))),
                    }))}
                    className="flex-1 min-w-0 h-9 px-2.5 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-accent/30"
                  />
                </div>
                <div className="flex items-center gap-2">
                  <span className="w-14 text-xs text-gray-500">할인액</span>
                  <input
                    type="number"
                    min={0}
                    placeholder="최소원"
                    value={discountFilter.amountMin ?? ''}
                    onChange={(e) => setDiscountFilter(f => ({
                      ...f,
                      amountMin: e.target.value === '' ? null : Math.max(0, Number(e.target.value)),
                    }))}
                    className="flex-1 min-w-0 h-9 px-2.5 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-accent/30"
                  />
                  <span className="text-gray-400 text-sm">~</span>
                  <input
                    type="number"
                    min={0}
                    placeholder="최대원"
                    value={discountFilter.amountMax ?? ''}
                    onChange={(e) => setDiscountFilter(f => ({
                      ...f,
                      amountMax: e.target.value === '' ? null : Math.max(0, Number(e.target.value)),
                    }))}
                    className="flex-1 min-w-0 h-9 px-2.5 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-accent/30"
                  />
                </div>
              </div>
            </div>

            {/* 카테고리 복수 선택 — all/coupon 제외 실제 업종 6종 */}
            <div>
              <h3 className="text-xs font-semibold text-gray-600 mb-2">카테고리 (복수 선택 가능)</h3>
              <div className="grid grid-cols-3 gap-2">
                {categories.filter(c => c.id !== 'all' && c.id !== 'coupon').map(c => {
                  const checked = discountFilter.categories.includes(c.id);
                  return (
                    <label
                      key={c.id}
                      className={`flex items-center gap-1.5 px-2.5 py-2 rounded-lg border cursor-pointer transition-colors text-sm ${
                        checked
                          ? 'bg-accent/10 border-accent/40 text-accent'
                          : 'bg-white border-gray-200 text-gray-700 hover:border-accent/30'
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={(e) => {
                          setDiscountFilter(f => ({
                            ...f,
                            categories: e.target.checked
                              ? [...f.categories, c.id]
                              : f.categories.filter(x => x !== c.id),
                          }));
                        }}
                        className="w-3.5 h-3.5 accent-accent cursor-pointer"
                      />
                      <span className="text-[14px]">{c.icon}</span>
                      <span className="text-xs font-semibold truncate">{c.name}</span>
                    </label>
                  );
                })}
              </div>
            </div>

            <p className="text-[11px] text-gray-400 leading-relaxed">
              필터 적용 시 반경이 자동으로 "전체"로 확장됩니다 (반경 밖 매장까지 검색).
              필터 해제 시 이전 반경 설정이 복원됩니다.
            </p>

            <div className="flex gap-2 pt-1">
              <button
                onClick={() => setDiscountFilter(EMPTY_DISCOUNT_FILTER)}
                className="flex-1 py-2.5 rounded-xl border border-gray-200 text-gray-600 text-sm font-semibold hover:bg-gray-50"
              >
                초기화
              </button>
              <button
                onClick={() => setShowFilterPanel(false)}
                className="flex-1 py-2.5 rounded-xl bg-accent text-white text-sm font-semibold hover:bg-accent/90"
              >
                적용 보기
              </button>
            </div>
          </div>
        </SwipeableBottomSheet>
      )}

      {/* 연령/성별 수집 모달 */}
      <DemographicModal
        open={showDemographicModal}
        onClose={() => setShowDemographicModal(false)} 
      />
    </div>
  );
}
