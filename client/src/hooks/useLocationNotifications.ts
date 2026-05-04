import { useEffect, useRef } from 'react';
import { trpc } from '@/lib/trpc';
import { toast } from '@/components/ui/sonner';

// ── localStorage dedup 키 헬퍼 ─────────────────────────────────────────────
const LS_GLOBAL_RATE_KEY = 'location_notif_last_at';       // 전역 30분 레이트리밋
const LS_STORE_DAY_PREFIX = 'location_notif_seen_store_';   // storeId+날짜 dedup
const LS_DAY_COUNT_PREFIX = 'location_notif_count_';        // 하루 최대 3회 캡
const GLOBAL_RATE_MS = 30 * 60 * 1000;                     // 30분
const MAX_DAILY_COUNT = 3;                                  // 하루 최대 알림 횟수

function getTodayKST(): string {
  const kst = new Date(Date.now() + 9 * 60 * 60 * 1000);
  return kst.toISOString().slice(0, 10); // "YYYY-MM-DD"
}

/** 전역 30분 레이트리밋 체크. 통과 시 last_at 갱신 후 true 반환. */
function checkAndUpdateGlobalRate(): boolean {
  const lastAt = localStorage.getItem(LS_GLOBAL_RATE_KEY);
  const now = Date.now();
  if (lastAt && now - Number(lastAt) < GLOBAL_RATE_MS) return false;
  localStorage.setItem(LS_GLOBAL_RATE_KEY, String(now));
  return true;
}

/** 같은 storeId × 같은 날(KST) dedup. 아직 안 봤으면 기록 후 true 반환. */
function checkAndMarkStoreSeen(storeId: number): boolean {
  const key = `${LS_STORE_DAY_PREFIX}${storeId}_${getTodayKST()}`;
  if (localStorage.getItem(key)) return false;
  localStorage.setItem(key, '1');
  return true;
}

/** 하루 최대 3회 캡 체크. 한도 미달이면 true 반환(발송 허용), 발송 후 incrementDailyCount() 호출. */
function checkDailyCount(): boolean {
  const key = `${LS_DAY_COUNT_PREFIX}${getTodayKST()}`;
  const count = parseInt(localStorage.getItem(key) || '0', 10);
  if (count >= MAX_DAILY_COUNT) {
    console.log(`[LocationNotifications] daily cap reached (${count}/${MAX_DAILY_COUNT}), skip`);
    return false;
  }
  return true;
}

/** 알림 실제 발송(toast) 후 호출 — 하루 카운트 +1 */
function incrementDailyCount(): void {
  const key = `${LS_DAY_COUNT_PREFIX}${getTodayKST()}`;
  const count = parseInt(localStorage.getItem(key) || '0', 10);
  localStorage.setItem(key, String(count + 1));
}

/**
 * 위치 기반 근처 가게 알림 Hook
 * - 포그라운드 in-app toast only (FCM/WebPush 금지)
 * - opt-in: locationNotificationsEnabled=true 일 때만 동작
 * - dedup: localStorage 전역 30분 + storeId×날짜
 */
export function useLocationNotifications() {
  const { data: settings } = trpc.users.getNotificationSettings.useQuery();
  const { data: stores } = trpc.stores.list.useQuery();
  const updateLocation = trpc.users.updateLocation.useMutation();
  const lastPositionRef = useRef<{ lat: number; lng: number } | null>(null);
  const notifiedStoresRef = useRef<Set<number>>(new Set());
  const lastSavedPositionRef = useRef<{ lat: number; lng: number } | null>(null);

  useEffect(() => {
    // PR-52: 가드 분리 — server 위치 저장(updateLocation)은 항상 작동.
    //   이유: locationNotificationsEnabled=false 사용자도 newly_opened_nearby (사장 쿠폰 등록 시 push)
    //         받으려면 last_location_update 가 채워져야 함 (server routers.ts:3010 6h 가드).
    //   기존 결함: 토글 OFF 면 useEffect 즉시 return → updateLocation 호출 0 → 위치 push 영원히 0.
    //   fix: settings 없어도 watchPosition + updateLocation 항상 작동, toast 발송만 토글 따라.

    // Geolocation API가 없으면 중단
    if (!navigator.geolocation) {
      console.warn('[LocationNotifications] Geolocation API not available');
      return;
    }

    const radius = settings?.notificationRadius || 200; // 기본 200m
    const locationNotifEnabled = settings?.locationNotificationsEnabled ?? false;

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

      // 현재 위치 저장 (로컬 ref)
      lastPositionRef.current = { lat: currentLat, lng: currentLng };

      // 서버에 위치 저장 (100m 이상 이동했거나 첫 위치 기록 시)
      const shouldSaveToServer = !lastSavedPositionRef.current || (() => {
        const d = calculateDistance(
          lastSavedPositionRef.current!.lat, lastSavedPositionRef.current!.lng,
          currentLat, currentLng
        );
        return d >= 100;
      })();
      if (shouldSaveToServer) {
        lastSavedPositionRef.current = { lat: currentLat, lng: currentLng };
        updateLocation.mutate({
          latitude: currentLat,
          longitude: currentLng,
          accuracy: position.coords.accuracy ?? undefined,
          timestamp: position.timestamp,
        });
      }

      // PR-52: locationNotificationsEnabled=false 사용자는 server 위치 저장까지만, toast 발송 X.
      //   (server 저장은 위 shouldSaveToServer 분기에서 이미 완료 — newly_opened_nearby 가드 통과 위해)
      if (!locationNotifEnabled) {
        return;
      }

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
      for (const store of nearbyStores) {
        // 세션 내 중복 skip (기존 메모리 dedup)
        if (notifiedStoresRef.current.has(store.id)) continue;

        const distance = calculateDistance(
          currentLat, currentLng,
          parseFloat(store.latitude!), parseFloat(store.longitude!)
        );

        // localStorage storeId×날짜 dedup — 같은 날 이미 알린 가게 skip (read-only check)
        const storeSeenKey = `location_notif_seen_store_${store.id}_${getTodayKST()}`;
        if (localStorage.getItem(storeSeenKey)) {
          console.log('[LocationNotifications] store dedup skip (seen today):', store.name);
          notifiedStoresRef.current.add(store.id);
          continue;
        }

        // localStorage 하루 최대 3회 캡 체크 (먼저 확인, 발송 전에만 skip)
        if (!checkDailyCount()) {
          break; // 오늘 한도 초과 → 이번 배치 전체 중단
        }

        // localStorage 전역 30분 레이트리밋 (먼저 확인, 발송 전에만 skip)
        if (!checkAndUpdateGlobalRate()) {
          console.log('[LocationNotifications] global rate limit: skip until 30min elapsed');
          break; // 이번 배치 전체 중단 (30분 후 재시도)
        }

        console.log('[LocationNotifications] New nearby store:', store.name, distance.toFixed(0), 'm');

        // 포그라운드 in-app toast 알림
        toast.info(`🎁 ${store.name}`, {
          description: `${Math.round(distance)}m 거리에 쿠폰이 있어요!`,
          duration: 5000,
        });

        // 실제 발송 성공 후에만 seen 기록 + 카운트 증가
        localStorage.setItem(storeSeenKey, '1');
        incrementDailyCount();
        notifiedStoresRef.current.add(store.id);
      }
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
