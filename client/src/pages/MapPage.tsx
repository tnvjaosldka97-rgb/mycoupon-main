import { useAuth } from "@/hooks/useAuth";
import { useGeolocation } from "@/hooks/useGeolocation";
import { useLocationNotifications } from "@/hooks/useLocationNotifications";
import { LocationPermissionBanner } from "@/components/LocationPermissionBanner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { MapView } from "@/components/Map";
import { Navigation, Gift, Clock, X, User, LogOut, Menu, Phone, MapPin, Tag, ChevronDown, Trash2 } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuSeparator } from "@/components/ui/dropdown-menu";
import { trpc } from "@/lib/trpc";
import { useState, useEffect, useCallback } from "react";
import { Link, useLocation } from 'wouter';
import { getLoginUrl } from '@/lib/const';
import { FloatingPromoWidget } from '@/components/FloatingPromoWidget';
import { DemographicModal } from '@/components/DemographicModal';
import { NotificationBadge } from '@/components/NotificationBadge';
import { toast } from "@/components/ui/sonner";
import { Spinner } from "@/components/ui/spinner";

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
  
  // 위치 기반 알림 시스템 활성화
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
  const logoutMutation = trpc.auth.logout.useMutation({
    onSuccess: () => {
      window.location.href = '/';
    },
  });
  const [selectedStore, setSelectedStore] = useState<StoreWithCoupons | null>(null);
  const [showDetailModal, setShowDetailModal] = useState(false);
  const [markers, setMarkers] = useState<google.maps.Marker[]>([]);
  const [infoWindows, setInfoWindows] = useState<google.maps.InfoWindow[]>([]);
  const [category, setCategory] = useState<string>("all");
  const [showMenu, setShowMenu] = useState(false);
  const [showUserMenu, setShowUserMenu] = useState(false);
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [enlargedImage, setEnlargedImage] = useState<string | null>(null);
  const [showDemographicModal, setShowDemographicModal] = useState(false);
  const [downloadingCouponId, setDownloadingCouponId] = useState<number | null>(null);

  const storesQuery = trpc.stores.list.useQuery({ 
    limit: 50,
    userLat: userLocation?.lat,
    userLon: userLocation?.lng,
  });
  const { data: stores, isLoading } = storesQuery;
  
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
  const downloadCoupon = trpc.coupons.download.useMutation();
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

  // 위치 권한 요청은 사용자가 버튼을 클릭할 때만 수행됨 (useGeolocation 훅에서 관리)
  // 페이지 로드 시에는 기본 위치(서울 명동)가 자동으로 설정됨

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
      const loginUrl = getLoginUrl();
      const redirectUrl = encodeURIComponent(currentUrl);
      
      // 로그인 후 원래 페이지로 돌아오도록 state에 저장
      setTimeout(() => {
        window.location.href = `${loginUrl}?redirect=${redirectUrl}`;
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
      setMap(mapInstance);

      if (!stores || !userLocation) return;

      // 기존 마커 및 InfoWindow 제거
      markers.forEach((marker) => marker.setMap(null));
      infoWindows.forEach((infoWindow) => infoWindow.close());
      const newMarkers: google.maps.Marker[] = [];
      const newInfoWindows: google.maps.InfoWindow[] = [];

      // 카테고리 및 검색 필터
      let filteredStores = category === 'all' 
        ? stores 
        : stores.filter(s => s.category === category);
      
      // 검색어 필터링
      if (searchQuery.trim()) {
        const query = searchQuery.toLowerCase();
        filteredStores = filteredStores.filter(s => 
          s.name.toLowerCase().includes(query) || 
          s.category.toLowerCase().includes(query) ||
          s.address.toLowerCase().includes(query)
        );
      }

      console.log('📍 필터링된 스토어:', filteredStores.length);
      
      filteredStores.forEach((store) => {
        console.log(`마커 생성 시도: ${store.name}`);
        
        if (!store.latitude || !store.longitude) {
          console.log(`❌ ${store.name}: 위치 정보 없음`);
          return;
        }
        
        if (!store.coupons || store.coupons.length === 0) {
          console.log(`❌ ${store.name}: 쿠폰 없음`);
          return;
        }

        const lat = parseFloat(store.latitude);
        const lng = parseFloat(store.longitude);
        const distance = calculateDistance(userLocation.lat, userLocation.lng, lat, lng);

        // 이모지 마커 사용 (추후 커스텀 아이콘으로 교체 예정)
        const emoji = store.category === 'cafe' ? '☕' : 
                      store.category === 'restaurant' ? '🍽️' : 
                      store.category === 'beauty' ? '💅' : 
                      store.category === 'hospital' ? '🏥' :
                      store.category === 'fitness' ? '💪' : '🎁';
        
        const icon = {
          url: `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(`
            <svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 48 48">
              <circle cx="24" cy="24" r="20" fill="white" stroke="#FF9800" stroke-width="3"/>
              <text x="24" y="32" font-size="24" text-anchor="middle">${emoji}</text>
            </svg>
          `)}`,
          scaledSize: new google.maps.Size(48, 48),
          anchor: new google.maps.Point(24, 24),
        };

        const marker = new google.maps.Marker({
          position: { lat, lng },
          map: mapInstance,
          title: store.name,
          icon,
          animation: window.google.maps.Animation.DROP,
        });

        // InfoWindow 생성 (호버 시 표시)
        const coupon = store.coupons[0]; // 첫 번째 쿠폰
        const infoWindowContent = `
          <div style="padding: 12px; min-width: 200px; font-family: 'Pretendard Variable', sans-serif;">
            <div style="font-size: 12px; color: #FF9800; font-weight: 600; margin-bottom: 4px;">
              ${store.category === 'cafe' ? '☕ 카페쿠폰' : 
                store.category === 'restaurant' ? '🍽️ 음식점쿠폰' : 
                store.category === 'beauty' ? '💅 뷰티쿠폰' : 
                store.category === 'hospital' ? '🏥 병원쿠폰' :
                store.category === 'fitness' ? '💪 헬스장쿠폰' : '🎁 쿠폰'}
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
            <div style="font-size: 14px; font-weight: 600; color: #E91E63; margin-bottom: 8px;">
              🎁 ${coupon.title}
            </div>
            <button 
              onclick="window.showStoreDetail(${store.id})"
              style="
                width: 100%;
                padding: 8px 16px;
                background: linear-gradient(135deg, #FF9800 0%, #E91E63 100%);
                color: white;
                border: none;
                border-radius: 8px;
                font-size: 14px;
                font-weight: 600;
                cursor: pointer;
                transition: transform 0.2s;
              "
              onmouseover="this.style.transform='scale(1.05)'"
              onmouseout="this.style.transform='scale(1)'"
            >
              상세보기 →
            </button>
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
        marker.addListener('click', () => {
          setSelectedStore(store);
          setShowDetailModal(true);
        });

        newMarkers.push(marker);
        newInfoWindows.push(infoWindow);
      });

      setMarkers(newMarkers);
      setInfoWindows(newInfoWindows);

      // 전역 함수로 상세보기 핸들러 등록
      (window as any).showStoreDetail = (storeId: number) => {
        const store = filteredStores.find(s => s.id === storeId);
        if (store) {
          setSelectedStore(store);
          setShowDetailModal(true);
        }
      };
    },
    [stores, userLocation, calculateDistance, category, searchQuery]
  );

  // 카테고리 변경 시 지도 업데이트
  useEffect(() => {
    if (map && stores && userLocation) {
      handleMapReady(map);
    }
  }, [category, stores, map, userLocation, handleMapReady]);

  const categories = [
    { id: 'all', name: '전체', icon: '🎁' },
    { id: 'cafe', name: '카페', icon: '☕' },
    { id: 'restaurant', name: '음식점', icon: '🍽️' },
    { id: 'beauty', name: '뷰티', icon: '💅' },
    { id: 'hospital', name: '병원', icon: '🏥' },
    { id: 'fitness', name: '헬스장', icon: '💪' },
    { id: 'other', name: '기타', icon: '🎁' },
  ];

  return (
    <div className="h-screen flex flex-col">
      {/* 플로팅 프로모션 위젯 */}
      <FloatingPromoWidget landingUrl="#" />
      {/* Compact Header */}
      <header className="border-b bg-white/95 backdrop-blur-md z-50 shadow-sm">
        <div className="container mx-auto px-4 py-3 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2">
            <div className="w-8 h-8 bg-gradient-to-br from-primary to-accent rounded-xl flex items-center justify-center">
              <Gift className="w-5 h-5 text-white" />
            </div>
            <span className="text-xl font-bold bg-gradient-to-r from-primary to-accent bg-clip-text text-transparent">
              마이쿠폰
            </span>
          </Link>

          {user ? (
            <div className="flex items-center gap-2">
              <Link href="/">
                <Button variant="ghost" size="sm" className="rounded-xl hidden sm:flex">
                  내 쿠폰 찾기
                </Button>
              </Link>
              <span className="hidden sm:inline text-muted-foreground">/</span>
              <Link href="/my-coupons">
                <Button variant="ghost" size="sm" className="rounded-xl hidden sm:flex">
                  내 쿠폰북
                </Button>
              </Link>
              <span className="hidden sm:inline text-muted-foreground">/</span>
              <Link href="/gamification">
                <Button variant="ghost" size="sm" className="rounded-xl hidden sm:flex">
                  마이쿠폰 활동
                </Button>
              </Link>
              
              {(user.role === 'merchant' || user.role === 'admin') && (
                <Link href="/merchant/dashboard">
                  <Button variant="ghost" size="sm" className="rounded-xl hidden sm:flex">
                    사장님
                  </Button>
                </Link>
              )}
              {user.role === 'admin' && (
                <Link href="/admin">
                  <Button variant="ghost" size="sm" className="rounded-xl hidden sm:flex">
                    관리자
                  </Button>
                </Link>
              )}
              
              {/* 일반 유저에게만 알림 배지 표시 (모바일/데스크톱 모두) */}
              {user.role === 'user' && <NotificationBadge />}
              
              <Button
                variant="ghost"
                size="sm"
                className="rounded-full sm:hidden"
                onClick={() => setShowMenu(!showMenu)}
              >
                <Menu className="w-5 h-5" />
              </Button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="sm" className="rounded-full p-0 h-auto">
                    <div className="w-8 h-8 bg-gradient-to-br from-pink-400 to-purple-400 rounded-full flex items-center justify-center text-white text-sm font-bold cursor-pointer hover:opacity-80 transition-opacity">
                      {user.name?.[0] || 'U'}
                    </div>
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-48">
                  <div className="px-2 py-1.5 text-sm font-medium">{user.name}</div>
                  <div className="px-2 py-1 text-xs text-muted-foreground">{user.email}</div>
                  <DropdownMenuSeparator />
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
              onClick={() => window.location.href = getLoginUrl()}
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
              {(user.role === 'merchant' || user.role === 'admin') && (
                <Link href="/merchant/dashboard">
                  <Button variant="ghost" size="sm" className="w-full justify-start rounded-xl">
                    사장님
                  </Button>
                </Link>
              )}
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
            placeholder="가게명, 카테고리, 주소로 검색..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full px-4 py-2.5 pl-10 pr-10 rounded-full border-2 border-gray-200 focus:border-primary focus:outline-none text-sm"
          />
          <svg className="w-5 h-5 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          {searchQuery && (
            <button
              onClick={() => setSearchQuery('')}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      {/* Category Filter */}
      <div className="bg-white border-b px-4 py-3 overflow-x-auto">
        <div className="flex gap-2 min-w-max">
          {categories.map((cat) => (
            <Button
              key={cat.id}
              variant={category === cat.id ? "default" : "outline"}
              size="sm"
              onClick={() => setCategory(cat.id)}
              className={`rounded-full ${
                category === cat.id
                  ? 'bg-gradient-to-r from-primary to-accent'
                  : 'border-2 hover:border-primary'
              }`}
            >
              <span className="mr-1">{cat.icon}</span>
              {cat.name}
            </Button>
          ))}
        </div>
      </div>

      {/* Map Container */}
      <div className="flex-1 relative">
        {userLocation ? (
          <>
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

        {/* My Location Button */}
        {userLocation && map && (
          <div className="absolute top-4 right-4">
            <Button
              size="sm"
              className="rounded-full shadow-lg bg-white hover:bg-white/90 text-foreground border-2"
              onClick={async () => {
                // 기본 위치를 사용 중이면 위치 권한 요청
                if (isUsingDefaultLocation) {
                  await requestLocation();
                }
                // 지도 중심 이동
                map.setCenter(userLocation);
                map.setZoom(15);
              }}
              disabled={isLocationLoading}
            >
              <Navigation className={`w-4 h-4 mr-2 ${isLocationLoading ? 'animate-pulse' : ''}`} />
              {isLocationLoading ? '위치 확인 중...' : '내 위치'}
            </Button>
          </div>
        )}
      </div>

      {/* 상세 모달 */}
      <Dialog open={showDetailModal} onOpenChange={setShowDetailModal}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          {selectedStore && (
            <>
              <DialogHeader>
                <DialogTitle className="text-3xl font-bold mb-2">
                  {selectedStore.name}
                </DialogTitle>
              </DialogHeader>

              <div className="space-y-4">
                {/* 별점과 리뷰 수 */}
                {selectedStore.rating && (
                  <div className="flex items-center gap-1">
                    <span className="text-yellow-500 text-xl">★</span>
                    <span className="text-xl font-bold text-primary">{selectedStore.rating}</span>
                    <span className="text-sm text-muted-foreground ml-1">({selectedStore.ratingCount || 0}개 리뷰)</span>
                  </div>
                )}

                {/* 한줄평 */}
                {selectedStore.adminComment && (
                  <div className="flex items-center gap-2 bg-muted/50 rounded-lg px-3 py-2">
                    <div className="w-6 h-6 rounded-full bg-primary/20 flex items-center justify-center text-xs font-bold text-primary">
                      {selectedStore.adminCommentAuthor?.charAt(0) || '관'}
                    </div>
                    <span className="text-sm font-medium">{selectedStore.adminCommentAuthor || '관리자'}</span>
                    <span className="text-sm text-muted-foreground">"{selectedStore.adminComment}"</span>
                  </div>
                )}

                {/* 주소와 전화번호 */}
                <div className="space-y-2">
                  <div className="flex items-start gap-2">
                    <MapPin className="w-4 h-4 flex-shrink-0 mt-0.5 text-muted-foreground" />
                    <span className="text-sm text-muted-foreground">{selectedStore.address}</span>
                  </div>
                  {selectedStore.phone && (
                    <div className="flex items-center gap-2">
                      <Phone className="w-4 h-4 text-muted-foreground" />
                      <a href={`tel:${selectedStore.phone}`} className="text-sm text-primary hover:underline font-medium">{selectedStore.phone}</a>
                    </div>
                  )}
                </div>

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

                {selectedStore.description && (
                  <p className="text-muted-foreground text-sm leading-relaxed">{selectedStore.description}</p>
                )}

                {/* 쿠폰 목록 */}
                <div className="space-y-3 pt-2">
                  <h3 className="text-lg font-semibold flex items-center gap-2">
                    <Tag className="w-5 h-5" />
                    사용 가능한 쿠폰
                  </h3>
                  {selectedStore.coupons.map((coupon) => (
                    <Card key={coupon.id} className="border-2 border-primary/20 hover:border-primary/40 transition-colors">
                      <CardContent className="p-2">
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex-1">
                            <div className="flex items-center gap-2 mb-1">
                              <h4 className="font-semibold text-base">{coupon.title}</h4>
                              <Badge className="bg-pink-500 text-white rounded-md px-2 py-0.5 text-xs font-bold">
                                {formatDiscount(coupon.discountType, coupon.discountValue)}
                              </Badge>
                            </div>
                            {coupon.description && (
                              <p className="text-sm text-muted-foreground mb-1">
                                {coupon.description}
                              </p>
                            )}
                            <div className="flex items-center gap-2">
                              <Badge variant="outline" className="text-xs">
                                <Clock className="w-3 h-3 mr-1" />
                                {new Date(coupon.endDate).toLocaleDateString('ko-KR')}까지
                              </Badge>
                            </div>
                          </div>
                          <div className="flex gap-2">
                            <Button
                              onClick={() => handleDownloadCoupon(coupon.id)}
                              className="rounded-xl bg-gradient-to-r from-primary to-accent flex-shrink-0 active:scale-95 transition-all"
                              disabled={downloadCoupon.isPending || downloadingCouponId === coupon.id}
                              size="sm"
                            >
                              {downloadingCouponId === coupon.id || downloadCoupon.isPending ? (
                                <>
                                  <Spinner className="w-4 h-4 mr-1" />
                                  다운로드 중...
                                </>
                              ) : (
                                <>
                                  <Gift className="w-4 h-4 mr-1" />
                                  다운로드
                                </>
                              )}
                            </Button>
                            {user?.role === 'admin' && (
                              <Button
                                onClick={() => handleDeleteCoupon(coupon.id, coupon.title)}
                                variant="destructive"
                                size="icon"
                                className="rounded-xl flex-shrink-0"
                                disabled={deleteCouponMutation.isPending}
                              >
                                <Trash2 className="w-4 h-4" />
                              </Button>
                            )}
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>

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
