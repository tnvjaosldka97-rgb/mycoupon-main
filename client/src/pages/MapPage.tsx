import { useAuth } from "@/hooks/useAuth";
import { useGeolocation } from "@/hooks/useGeolocation";
import { useLocationNotifications } from "@/hooks/useLocationNotifications";
import { LocationPermissionBanner } from "@/components/LocationPermissionBanner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { MapView } from "@/components/Map";
import { Navigation, Gift, Clock, X, User, LogOut, Menu, Phone, MapPin, Tag, ChevronDown, ChevronUp, Trash2, Store, CheckCircle } from "lucide-react";
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
  // useRef로 변경 — useState는 비동기이므로 정리 타이밍에 stale값이 참조됨
  // → 이전 마커(이모지)와 새 마커(도트)가 동시에 보이는 버그 수정
  const markersRef = useRef<google.maps.Marker[]>([]);
  const [markers, setMarkers] = useState<google.maps.Marker[]>([]);
  const [infoWindows, setInfoWindows] = useState<google.maps.InfoWindow[]>([]);
  const [category, setCategory] = useState<string>("all");
  const [showMenu, setShowMenu] = useState(false);
  const [showUserMenu, setShowUserMenu] = useState(false);
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [searchResults, setSearchResults] = useState<StoreWithCoupons[]>([]);
  const [showSearchResults, setShowSearchResults] = useState(false);
  const [enlargedImage, setEnlargedImage] = useState<string | null>(null);
  const [showDemographicModal, setShowDemographicModal] = useState(false);
  const [downloadingCouponId, setDownloadingCouponId] = useState<number | null>(null);
  const [downloadedCouponIds, setDownloadedCouponIds] = useState<Set<number>>(new Set());

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
      const buildMarkerIcon = (
        emoji: string,
        isUsedStore: boolean,
        ownerTier: string,
        zoom: number,
        ownerIsDormant?: boolean
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
        return {
          url: `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(
            `<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 48 48">` +
            `<circle cx="24" cy="24" r="20" fill="${fillColor}" stroke="${tc.main}" stroke-width="3" opacity="${opacity}"/>` +
            `<text x="24" y="32" font-size="24" text-anchor="middle" opacity="${opacity}">${emoji}</text>` +
            `</svg>`
          )}`,
          scaledSize: new google.maps.Size(48, 48),
          anchor: new google.maps.Point(24, 24),
        };
      };

      // store-marker 쌍 — zoom_changed 리스너에서 아이콘 갱신에 사용
      const storeMarkerData: { marker: google.maps.Marker; emoji: string; isUsedStore: boolean; ownerTier: string; ownerIsDormant: boolean }[] = [];
      
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
        const icon = buildMarkerIcon(emoji, isUsedStore, ownerTier, initialZoom, ownerIsDormant);

        const marker = new google.maps.Marker({
          position: { lat, lng },
          map: mapInstance,
          title: store.name,
          icon,
          animation: initialZoom >= 13 ? window.google.maps.Animation.DROP : undefined,
        });

        storeMarkerData.push({ marker, emoji, isUsedStore, ownerTier, ownerIsDormant });

        // InfoWindow 생성 (호버 시 표시)
        const coupon = store.coupons?.[0]; // 휴면 매장은 undefined일 수 있음
        const badgeColors = ownerIsDormant
          ? { bg: '#FEF2F2', color: '#EF4444', border: '#FECACA', text: '쿠폰 없음' }
          : isUsedStore
            ? { bg: '#F3F4F6', color: '#9CA3AF', border: '#D1D5DB', text: '이용완료' }
            : { bg: tc.bg, color: tc.main, border: (tc as any).border ?? '#E5E7EB', text: (tc as any).label ?? '' };
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
              <span style="
                background: ${badgeColors.bg};
                color: ${badgeColors.color};
                border: 1px solid ${badgeColors.border};
                padding: 1px 7px;
                border-radius: 99px;
                font-size: 11px;
                font-weight: 700;
              ">${badgeColors.text}</span>
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
        storeMarkerData.forEach(({ marker, emoji, isUsedStore, ownerTier, ownerIsDormant }) => {
          marker.setIcon(buildMarkerIcon(emoji, isUsedStore, ownerTier, zoom, ownerIsDormant));
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
    [stores, userLocation, calculateDistance, category, searchQuery, user]
  );

  // 카테고리 변경 시 지도 업데이트
  useEffect(() => {
    if (map && stores && userLocation) {
      handleMapReady(map);
    }
  }, [category, stores, map, userLocation, handleMapReady]);

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
                <button className="hidden sm:flex items-center px-3 py-1.5 rounded-full text-xs font-semibold bg-white/20 hover:bg-white/35 text-white transition-colors border border-white/30 whitespace-nowrap">
                  🎟 내 쿠폰 찾기
                </button>
              </Link>
              <Link href="/my-coupons">
                <button className="hidden sm:flex items-center px-3 py-1.5 rounded-full text-xs font-semibold bg-white/20 hover:bg-white/35 text-white transition-colors border border-white/30 whitespace-nowrap">
                  📒 내 쿠폰북
                </button>
              </Link>
              <Link href="/gamification">
                <button className="hidden sm:flex items-center px-3 py-1.5 rounded-full text-xs font-semibold bg-white/20 hover:bg-white/35 text-white transition-colors border border-white/30 whitespace-nowrap">
                  ⭐ 활동
                </button>
              </Link>
              {(user.role === 'merchant' || user.role === 'admin') && (
                <Link href="/merchant/dashboard">
                  <button className="hidden sm:flex items-center px-3 py-1.5 rounded-full text-xs font-semibold bg-white/30 hover:bg-white/45 text-white transition-colors border border-white/40 whitespace-nowrap">
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
              
              {/* 일반 유저에게만 알림 배지 표시 (모바일/데스크톱 모두) */}
              {user.role === 'user' && <NotificationBadge />}
              
              <Button
                variant="ghost"
                size="sm"
                className="rounded-full sm:hidden text-white hover:bg-white/20"
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
          )}
        </div>

        {/* Mobile Menu */}
        {showMenu && user && (
          <div className="border-t bg-white px-4 py-2 sm:hidden">
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

      {/* Search Bar */}
      <div className="bg-white border-b px-4 py-3">
        <div className="max-w-2xl mx-auto relative">
          <input
            type="text"
            placeholder="근처 매장 검색..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full px-4 py-3 pl-10 pr-10 rounded-full bg-white shadow-md border-0 focus:ring-2 focus:ring-primary/30 focus:outline-none text-sm"
          />
          <svg className="w-5 h-5 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          {searchQuery && (
            <button
              onClick={() => {
                setSearchQuery('');
                setShowSearchResults(false);
              }}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
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

      {/* Category Filter — overflow-x-auto 국소 스크롤, 상위는 clip */}
      <div className="bg-white border-b overflow-hidden">
        <div className="px-4 py-2.5 overflow-x-auto scrollbar-hide">
        <div className="flex gap-2 min-w-max">
          {categories.map((cat) => (
            <button
              key={cat.id}
              onClick={() => setCategory(cat.id)}
              className={`flex items-center gap-1 px-3 py-1.5 rounded-full text-sm font-semibold transition-all active:scale-95 ${
                category === cat.id
                  ? 'bg-gradient-to-r from-primary to-accent text-white shadow-md'
                  : 'bg-white text-gray-600 shadow-sm border border-gray-100 hover:border-primary/30'
              }`}
            >
              <span>{cat.icon}</span>
              <span>{cat.name}</span>
            </button>
          ))}
        </div>
        </div>
      </div>

      {/* 벚꽃 낙화 애니메이션 — 지도 위에 포인터 이벤트 없이 표시 */}
      <CherryBlossoms />

      {/* Map Container */}
      <div className="flex-1 relative">
        {userLocation ? (
          <>
            {/* 랭킹 오버레이 — 지도 좌측 상단, z-25 (헤더=50, 바텀시트=40 아래) */}
            <RankingOverlay
              items={rankedStores}
              selectedId={selectedStore?.id ?? null}
              onSelect={(item) => {
                const store = stores?.find(s => s.id === item.id);
                if (store) {
                  setSelectedStore(store as StoreWithCoupons);
                  setShowDetailModal(true);
                  // 지도 중심 이동
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
                    const storeOwnerTier = (selectedStore as any).ownerTier ?? 'FREE';
                    const isStorePaid = storeOwnerTier !== 'FREE';
                    const cardBg = isStorePaid ? 'bg-amber-50 border border-amber-300' : 'bg-orange-50 border border-orange-300';
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

      {/* 연령/성별 수집 모달 */}
      <DemographicModal 
        open={showDemographicModal} 
        onClose={() => setShowDemographicModal(false)} 
      />
    </div>
  );
}
