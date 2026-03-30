import { useAuth } from "@/hooks/useAuth";
import { useGeolocation } from "@/hooks/useGeolocation";
import { useLocationNotifications } from "@/hooks/useLocationNotifications";
import { LocationPermissionBanner } from "@/components/LocationPermissionBanner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { MapView } from "@/components/Map";
import { Navigation, Gift, Clock, X, User, LogOut, Menu, Phone, MapPin, Tag, ChevronDown, Trash2, Store } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuSeparator } from "@/components/ui/dropdown-menu";
import { trpc } from "@/lib/trpc";
import { getTierColor, getCouponTierBadgeStyle } from "@/lib/tierColors";
import { useState, useEffect, useCallback, useRef } from "react";
import { Link, useLocation } from 'wouter';
import { getLoginUrl } from '@/lib/const';
import { openGoogleLogin } from '@/lib/capacitor';
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

  // stores.mapStores: 공개 지도 전용 endpoint
  // (approved + not deleted + has coordinates — 서버에서 SQL 레벨 강제)
  const storesQuery = trpc.stores.mapStores.useQuery({ 
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
  const utils = trpc.useUtils();

  const handleMerchantShortcut = () => setLocation('/merchant/dashboard');

  const downloadCoupon = trpc.coupons.download.useMutation({
    onSuccess: async () => {
      // ✅ 즉시 refetch (invalidate보다 빠름)
      await utils.coupons.myCoupons.refetch();
      console.log('[Download] ⚡ Coupon downloaded, my coupons list refreshed immediately');
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
      const loginUrl = getLoginUrl();
      const redirectUrl = encodeURIComponent(currentUrl);
      
      // 로그인 후 원래 페이지로 돌아오도록 state에 저장
      // openGoogleLogin: 앱=Chrome Custom Tabs, 웹=window.location.href
      setTimeout(() => {
        console.log('[OAUTH] login triggered from coupon download handler');
        openGoogleLogin(`${loginUrl}?redirect=${redirectUrl}`).catch(() => {});
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
      console.log('[MAP] ✅ 지도 인스턴스 준비 완료 (onMapReady)');
      setMap(mapInstance);

      if (!stores || !userLocation) return;

      // 기존 마커 및 InfoWindow 제거 (ref로 동기 정리 — stale 클로저 방지)
      markersRef.current.forEach((marker) => marker.setMap(null));
      markersRef.current = [];
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
        
        // 검색 결과 저장
        setSearchResults(filteredStores);
        setShowSearchResults(filteredStores.length > 0);
        
        // 검색 결과가 1개면 자동으로 해당 위치로 이동
        if (filteredStores.length === 1 && filteredStores[0].latitude && filteredStores[0].longitude) {
          const firstStore = filteredStores[0];
          mapInstance.setCenter({
            lat: parseFloat(firstStore.latitude),
            lng: parseFloat(firstStore.longitude),
          });
          mapInstance.setZoom(17);
        }
      } else {
        setSearchResults([]);
        setShowSearchResults(false);
      }

      console.log('📍 필터링된 스토어:', filteredStores.length);

      // 줌 레벨 기반 아이콘 빌더 — zoom<13: 작은 도트, zoom>=13: 이모지 마커
      const buildMarkerIcon = (
        emoji: string,
        isUsedStore: boolean,
        ownerTier: string,
        zoom: number
      ) => {
        const tc   = isUsedStore ? { main: '#9CA3AF' } : getTierColor(ownerTier);
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
      const storeMarkerData: { marker: google.maps.Marker; emoji: string; isUsedStore: boolean; ownerTier: string }[] = [];
      
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

        const isUsedStore = store.hasAvailableCoupons === false;
        const ownerTier = (store as any).ownerTier ?? 'FREE';
        const tc = isUsedStore ? { main: '#9CA3AF', bg: '#F3F4F6' } : getTierColor(ownerTier);

        const initialZoom = mapInstance.getZoom() ?? 13;
        const icon = buildMarkerIcon(emoji, isUsedStore, ownerTier, initialZoom);

        const marker = new google.maps.Marker({
          position: { lat, lng },
          map: mapInstance,
          title: store.name,
          icon,
          animation: initialZoom >= 13 ? window.google.maps.Animation.DROP : undefined,
        });

        storeMarkerData.push({ marker, emoji, isUsedStore, ownerTier });

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
        marker.addListener('click', () => {
          setSelectedStore(store);
          setShowDetailModal(true);
        });

        newMarkers.push(marker);
        newInfoWindows.push(infoWindow);
      });

      markersRef.current = newMarkers; // 동기 업데이트 — 다음 정리 사이클에서 즉시 참조
      setMarkers(newMarkers);
      setInfoWindows(newInfoWindows);

      // 줌 변경 시 도트 ↔ 이모지 마커 전환 (기존 리스너 제거 후 재등록 - 메모리 리크 방지)
      if (zoomListenerRef.current) {
        google.maps.event.removeListener(zoomListenerRef.current);
      }
      zoomListenerRef.current = mapInstance.addListener('zoom_changed', () => {
        const zoom = mapInstance.getZoom() ?? 13;
        storeMarkerData.forEach(({ marker, emoji, isUsedStore, ownerTier }) => {
          marker.setIcon(buildMarkerIcon(emoji, isUsedStore, ownerTier, zoom));
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
        if (!confirm(`"${storeName}" 사장님께 쿠폰을 더 달라고 조르시겠습니까?\n(계정당 1회만 가능)`)) return;
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
                  {selectedStore.coupons.map((coupon) => {
                    // P2-5: FREE=빨간 테두리, 유료=골드 테두리
                    const storeOwnerTier = (selectedStore as any).ownerTier ?? 'FREE';
                    const isStorePaid = storeOwnerTier !== 'FREE';
                    const couponBorder = isStorePaid
                      ? 'border-2 border-amber-400 hover:border-amber-500'
                      : 'border-2 border-red-400 hover:border-red-500';
                    return (
                    <Card key={coupon.id} className={`${couponBorder} transition-colors`}>
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
                            <div className="flex items-center gap-2 flex-wrap">
                              <Badge variant="outline" className="text-xs">
                                <Clock className="w-3 h-3 mr-1" />
                                {new Date(coupon.endDate).toLocaleDateString('ko-KR')}까지
                              </Badge>
                              <Badge variant="secondary" className="text-xs">
                                남은 수량: {(coupon as any).remainingQuantity || 0}개
                              </Badge>
                            </div>
                          </div>
                          <div className="flex gap-2 flex-col sm:flex-row">
                            <Button
                              onClick={() => handleDownloadCoupon(coupon.id)}
                              className="rounded-xl bg-gradient-to-r from-primary to-accent flex-shrink-0 active:scale-95 transition-all w-full sm:w-auto"
                              disabled={downloadCoupon.isPending || downloadingCouponId === coupon.id}
                              size="default"
                            >
                              {downloadingCouponId === coupon.id || downloadCoupon.isPending ? (
                                <>
                                  <Spinner className="w-4 h-4 mr-1" />
                                  <span className="text-sm">다운로드 중...</span>
                                </>
                              ) : (
                                <>
                                  <Gift className="w-4 h-4 mr-1" />
                                  <span className="text-sm font-medium">다운로드</span>
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
                    );
                  })}
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
