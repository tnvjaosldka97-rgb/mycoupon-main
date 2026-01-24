import { useEffect, useRef } from 'react';
import { trpc } from '@/lib/trpc';
import { toast } from '@/components/ui/sonner';

/**
 * 위치 기반 근처 가게 알림 Hook
 * 
 * 사용자의 위치가 변경될 때마다 설정한 반경 내의 가게를 확인하고 알림을 표시합니다.
 */
export function useLocationNotifications() {
  const { data: settings } = trpc.users.getNotificationSettings.useQuery();
  const { data: stores } = trpc.stores.list.useQuery();
  const lastPositionRef = useRef<{ lat: number; lng: number } | null>(null);
  const notifiedStoresRef = useRef<Set<number>>(new Set());

  useEffect(() => {
    // 위치 알림이 비활성화되어 있으면 중단
    if (!settings?.locationNotificationsEnabled) {
      return;
    }

    // Geolocation API가 없으면 중단
    if (!navigator.geolocation) {
      console.warn('[LocationNotifications] Geolocation API not available');
      return;
    }

    const radius = settings.notificationRadius || 200; // 기본 200m

    // 두 지점 간 거리 계산 (Haversine formula, 미터 단위)
    function calculateDistance(
      lat1: number,
      lon1: number,
      lat2: number,
      lon2: number
    ): number {
      const R = 6371000; // 지구 반지름 (미터)
      const dLat = ((lat2 - lat1) * Math.PI) / 180;
      const dLon = ((lon2 - lon1) * Math.PI) / 180;
      const a =
        Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos((lat1 * Math.PI) / 180) *
          Math.cos((lat2 * Math.PI) / 180) *
          Math.sin(dLon / 2) *
          Math.sin(dLon / 2);
      const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
      return R * c; // 거리 (미터)
    }

    // 위치 변경 감지 및 근처 가게 확인
    function checkNearbyStores(position: GeolocationPosition) {
      const currentLat = position.coords.latitude;
      const currentLng = position.coords.longitude;

      console.log('[LocationNotifications] Current position:', { currentLat, currentLng });

      // 이전 위치와 비교하여 50m 이상 이동했을 때만 처리
      if (lastPositionRef.current) {
        const movedDistance = calculateDistance(
          lastPositionRef.current.lat,
          lastPositionRef.current.lng,
          currentLat,
          currentLng
        );

        if (movedDistance < 50) {
          // 50m 미만 이동은 무시 (너무 빈번한 알림 방지)
          return;
        }

        console.log('[LocationNotifications] Moved:', movedDistance.toFixed(0), 'm');
        
        // 위치가 크게 변경되면 (500m 이상) 알림 이력 초기화
        if (movedDistance > 500) {
          console.log('[LocationNotifications] Location changed significantly, resetting notifications');
          notifiedStoresRef.current.clear();
        }
      }

      // 현재 위치 저장
      lastPositionRef.current = { lat: currentLat, lng: currentLng };

      // 근처 가게 확인
      if (!stores || stores.length === 0) {
        return;
      }

      const nearbyStores = stores.filter((store) => {
        if (!store.latitude || !store.longitude) return false;

        const storeLat = parseFloat(store.latitude);
        const storeLng = parseFloat(store.longitude);

        if (isNaN(storeLat) || isNaN(storeLng)) return false;

        const distance = calculateDistance(currentLat, currentLng, storeLat, storeLng);
        return distance <= radius;
      });

      console.log('[LocationNotifications] Nearby stores:', nearbyStores.length);

      // 새로운 근처 가게에 대해서만 알림 표시
      nearbyStores.forEach((store) => {
        if (!notifiedStoresRef.current.has(store.id)) {
          const distance = calculateDistance(
            currentLat,
            currentLng,
            parseFloat(store.latitude!),
            parseFloat(store.longitude!)
          );

          console.log('[LocationNotifications] New nearby store:', store.name, distance.toFixed(0), 'm');

          // 알림 표시
          toast.info(`🎁 ${store.name}`, {
            description: `${Math.round(distance)}m 거리에 쿠폰이 있어요!`,
            duration: 5000,
          });

          // 알림 표시한 가게 기록
          notifiedStoresRef.current.add(store.id);
        }
      });
    }

    // 위치 추적 시작
    const watchId = navigator.geolocation.watchPosition(
      checkNearbyStores,
      (error) => {
        console.error('[LocationNotifications] Geolocation error:', error);
      },
      {
        enableHighAccuracy: true,
        timeout: 10000,
        maximumAge: 30000, // 30초간 캐시된 위치 사용
      }
    );

    console.log('[LocationNotifications] Started watching position, radius:', radius, 'm');

    // 정리 함수
    return () => {
      navigator.geolocation.clearWatch(watchId);
      console.log('[LocationNotifications] Stopped watching position');
    };
  }, [settings, stores]);

  return null;
}
