import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { MapView } from "@/components/Map";
import { Navigation, Gift, Clock, X, List, Sparkles } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { useState, useEffect, useCallback } from "react";
import { Link } from "wouter";

interface CouponMarker {
  id: number;
  name: string;
  lat: number;
  lng: number;
  category: string;
  description: string;
  distance?: number;
}

export default function CouponMap() {
  const { user } = useAuth();
  const [map, setMap] = useState<google.maps.Map | null>(null);
  const [userLocation, setUserLocation] = useState<{ lat: number; lng: number } | null>(null);
  const [selectedCoupon, setSelectedCoupon] = useState<CouponMarker | null>(null);
  const [markers, setMarkers] = useState<google.maps.Marker[]>([]);
  const [category, setCategory] = useState<string>("all");

  // 공개 지도 전용 endpoint 사용 (approved + not deleted + has coordinates)
  const { data: stores, isLoading } = trpc.stores.mapStores.useQuery({});

  // 사용자 위치 가져오기
  useEffect(() => {
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          const location = {
            lat: position.coords.latitude,
            lng: position.coords.longitude,
          };
          setUserLocation(location);
        },
        (error) => {
          // 위치 권한이 거부되었거나 오류가 발생한 경우 기본 위치 사용
          console.warn('위치 정보를 가져올 수 없어 기본 위치(서울 강남역)를 사용합니다.');
          // 기본 위치: 서울 강남역
          setUserLocation({ lat: 37.4979, lng: 127.0276 });
        }
      );
    } else {
      // 기본 위치: 서울 강남역
      setUserLocation({ lat: 37.4979, lng: 127.0276 });
    }
  }, []);

  // 거리 계산 함수 (Haversine formula)
  const calculateDistance = useCallback((lat1: number, lon1: number, lat2: number, lon2: number): number => {
    const R = 6371e3; // 지구 반지름 (미터)
    const φ1 = (lat1 * Math.PI) / 180;
    const φ2 = (lat2 * Math.PI) / 180;
    const Δφ = ((lat2 - lat1) * Math.PI) / 180;
    const Δλ = ((lon2 - lon1) * Math.PI) / 180;

    const a =
      Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
      Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

    return R * c; // 미터 단위
  }, []);

  // 거리 포맷팅
  const formatDistance = (meters: number): string => {
    if (meters < 1000) {
      return `${Math.round(meters)}m`;
    }
    return `${(meters / 1000).toFixed(1)}km`;
  };

  // 지도 초기화
  const handleMapReady = useCallback(
    (mapInstance: google.maps.Map) => {
      setMap(mapInstance);

      if (!stores || !userLocation) return;

      // 기존 마커 제거
      markers.forEach((marker) => marker.setMap(null));
      const newMarkers: google.maps.Marker[] = [];

      // 쿠폰 마커 생성
      const coupons: CouponMarker[] = stores.map((store: any) => {
        // 임시 위치 (실제로는 DB에서 가져와야 함)
        const lat = 37.4979 + (Math.random() - 0.5) * 0.02;
        const lng = 127.0276 + (Math.random() - 0.5) * 0.02;
        const distance = calculateDistance(userLocation.lat, userLocation.lng, lat, lng);

        return {
          id: store.id,
          name: store.name,
          lat,
          lng,
          category: store.category || 'other',
          description: store.description || '할인 쿠폰',
          distance,
        };
      });

      // 거리순 정렬
      coupons.sort((a, b) => (a.distance || 0) - (b.distance || 0));

      coupons.forEach((coupon) => {
        // 카테고리별 마커 색상
        const icon = {
          path: window.google.maps.SymbolPath.CIRCLE,
          fillColor: coupon.category === 'cafe' ? '#FF9800' : 
                     coupon.category === 'food' ? '#E91E63' : 
                     coupon.category === 'beauty' ? '#00BCD4' : '#9C27B0',
          fillOpacity: 1,
          strokeColor: '#FFFFFF',
          strokeWeight: 3,
          scale: 12,
        };

        const marker = new google.maps.Marker({
          position: { lat: coupon.lat, lng: coupon.lng },
          map: mapInstance,
          title: coupon.name,
          icon,
          animation: window.google.maps.Animation.DROP,
        });

        marker.addListener('click', () => {
          setSelectedCoupon(coupon);
          mapInstance.panTo({ lat: coupon.lat, lng: coupon.lng });
        });

        newMarkers.push(marker);
      });

      setMarkers(newMarkers);

      // 첫 번째 쿠폰 선택
      if (coupons.length > 0) {
        setSelectedCoupon(coupons[0]);
      }
    },
    [stores, userLocation, calculateDistance]
  );

  // 카테고리 필터
  const categories = [
    { id: 'all', name: '전체', icon: '🎁' },
    { id: 'cafe', name: '카페', icon: '☕' },
    { id: 'food', name: '음식점', icon: '🍽️' },
    { id: 'beauty', name: '뷰티', icon: '💅' },
  ];

  return (
    <div className="h-screen flex flex-col">
      {/* Header */}
      <header className="border-b bg-white/90 backdrop-blur-md z-50 shadow-sm">
        <div className="container mx-auto px-4 py-3 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2">
            <div className="w-8 h-8 bg-gradient-to-br from-primary to-accent rounded-xl flex items-center justify-center">
              <Gift className="w-5 h-5 text-white" />
            </div>
            <span className="text-xl font-bold bg-gradient-to-r from-primary to-accent bg-clip-text text-transparent">
              마이쿠폰
            </span>
          </Link>
          <div className="flex items-center gap-2">
            <Link href="/">
              <Button variant="ghost" size="sm" className="rounded-xl">
                <List className="w-4 h-4 mr-2" />
                리스트
              </Button>
            </Link>
          </div>
        </div>
      </header>

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
          <MapView
            onMapReady={handleMapReady}
            initialCenter={userLocation}
            initialZoom={15}
            className="w-full h-full"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center bg-muted">
            <div className="text-center">
              <Navigation className="w-12 h-12 mx-auto mb-4 text-muted-foreground animate-pulse" />
              <p className="text-muted-foreground">위치 정보를 가져오는 중...</p>
            </div>
          </div>
        )}

        {/* Selected Coupon Card */}
        {selectedCoupon && (
          <div className="absolute bottom-0 left-0 right-0 p-4 pointer-events-none">
            <Card className="pointer-events-auto max-w-2xl mx-auto shadow-2xl border-2 border-primary/20 rounded-2xl overflow-hidden">
              <div className="h-1 bg-gradient-to-r from-primary via-accent to-secondary"></div>
              <CardContent className="p-4">
                <div className="flex items-start gap-4">
                  {/* Icon */}
                  <div className="w-16 h-16 bg-gradient-to-br from-primary/10 to-accent/10 rounded-2xl flex items-center justify-center text-3xl flex-shrink-0">
                    {selectedCoupon.category === 'cafe' ? '☕' : 
                     selectedCoupon.category === 'food' ? '🍽️' : 
                     selectedCoupon.category === 'beauty' ? '💅' : '🎁'}
                  </div>

                  {/* Content */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between mb-2">
                      <div className="flex-1">
                        <h3 className="font-semibold text-lg mb-1">{selectedCoupon.name}</h3>
                        <p className="text-sm text-muted-foreground mb-2">
                          {selectedCoupon.description}
                        </p>
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setSelectedCoupon(null)}
                        className="rounded-full -mt-1 -mr-1"
                      >
                        <X className="w-4 h-4" />
                      </Button>
                    </div>

                    {/* Badges */}
                    <div className="flex flex-wrap items-center gap-2 mb-3">
                      <Badge className="bg-secondary/20 text-secondary-foreground border-secondary/30 rounded-full">
                        <Navigation className="w-3 h-3 mr-1" />
                        {selectedCoupon.distance ? formatDistance(selectedCoupon.distance) : '계산 중'}
                      </Badge>
                      <Badge className="bg-accent/20 text-accent-foreground border-accent/30 rounded-full font-bold">
                        50% OFF
                      </Badge>
                      <Badge className="bg-primary/20 text-primary-foreground border-primary/30 rounded-full">
                        <Clock className="w-3 h-3 mr-1" />
                        오늘까지
                      </Badge>
                    </div>

                    {/* Actions */}
                    <div className="flex gap-2">
                      <Link href={`/store/${selectedCoupon.id}`} className="flex-1">
                        <Button className="w-full rounded-xl bg-gradient-to-r from-primary to-accent">
                          <Gift className="w-4 h-4 mr-2" />
                          쿠폰 받기
                        </Button>
                      </Link>
                      <Button
                        variant="outline"
                        className="rounded-xl border-2"
                        onClick={() => {
                          if (map) {
                            map.setCenter({ lat: selectedCoupon.lat, lng: selectedCoupon.lng });
                            map.setZoom(17);
                          }
                        }}
                      >
                        <Navigation className="w-4 h-4" />
                      </Button>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        )}

        {/* My Location Button */}
        {userLocation && map && (
          <div className="absolute top-4 right-4">
            <Button
              size="sm"
              className="rounded-full shadow-lg bg-white hover:bg-white/90 text-foreground border-2"
              onClick={() => {
                map.setCenter(userLocation);
                map.setZoom(15);
              }}
            >
              <Navigation className="w-4 h-4 mr-2" />
              내 위치
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
