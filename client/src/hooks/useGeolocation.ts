import { useState, useCallback, useEffect, useRef } from 'react';
import { isCapacitorNative } from '../lib/capacitor';

// Capacitor + Web 통합 위치 헬퍼 — Capacitor 앱은 @capacitor/geolocation 의 native dialog,
// Web (PWA/Chrome) 은 navigator.geolocation 의 브라우저 권한 prompt 사용.
// 동일 PositionCallback / PositionErrorCallback 시그니처 유지 → 호출처 변경 최소화.
export async function getCurrentPositionUnified(
  success: PositionCallback,
  error: PositionErrorCallback,
  options: PositionOptions,
): Promise<void> {
  if (isCapacitorNative()) {
    try {
      const { Geolocation } = await import('@capacitor/geolocation');
      const result = await Geolocation.getCurrentPosition({
        enableHighAccuracy: options.enableHighAccuracy ?? false,
        timeout: options.timeout,
        maximumAge: options.maximumAge,
      });
      success({
        coords: result.coords as GeolocationCoordinates,
        timestamp: result.timestamp,
      } as GeolocationPosition);
    } catch (e: any) {
      error({
        code: e?.code === 1 ? 1 : 2,
        message: e?.message ?? 'Capacitor Geolocation 실패',
        PERMISSION_DENIED: 1,
        POSITION_UNAVAILABLE: 2,
        TIMEOUT: 3,
      } as GeolocationPositionError);
    }
    return;
  }
  navigator.geolocation.getCurrentPosition(success, error, options);
}

// 서울 명동 기본 위치
const DEFAULT_LOCATION = { lat: 37.5665, lng: 126.9780 };

// 한국 주요 도시 IP 기반 추정 위치 (IP 지역화 API 대안)
const KOREA_CITY_LOCATIONS: Record<string, { lat: number; lng: number; name: string }> = {
  'Seoul': { lat: 37.5665, lng: 126.9780, name: '서울' },
  'Busan': { lat: 35.1796, lng: 129.0756, name: '부산' },
  'Incheon': { lat: 37.4563, lng: 126.7052, name: '인천' },
  'Daegu': { lat: 35.8714, lng: 128.6014, name: '대구' },
  'Daejeon': { lat: 36.3504, lng: 127.3845, name: '대전' },
  'Gwangju': { lat: 35.1595, lng: 126.8526, name: '광주' },
  'Ulsan': { lat: 35.5384, lng: 129.3114, name: '울산' },
  'Sejong': { lat: 36.4800, lng: 127.2890, name: '세종' },
};

export type PermissionStatus = 'prompt' | 'granted' | 'denied' | 'unavailable';

interface GeolocationState {
  location: { lat: number; lng: number } | null;
  permissionStatus: PermissionStatus;
  isLoading: boolean;
  error: string | null;
  isUsingDefaultLocation: boolean;
}

interface UseGeolocationReturn extends GeolocationState {
  requestLocation: () => Promise<void>;
  retryLocation: () => Promise<void>;
  checkPermission: () => Promise<PermissionStatus>;
  locationName: string | null; // IP 기반 지역명
}

/**
 * useGeolocation 옵션
 * - watch=true 면 navigator.geolocation.watchPosition 로 지속 추적.
 * - throttleMs: 상태 업데이트 최소 간격 (배터리 절약, 기본 3000ms).
 * - minDistanceM: 이 거리 미만 이동은 무시 (GPS 지터 방지, 기본 5m).
 * - highAccuracy: true 면 enableHighAccuracy=true (GPS 직접, 배터리 소모 ↑).
 * 기본값으로 호출(옵션 생략) 시 기존 동작(getCurrentPosition 단발) 그대로 유지.
 */
export interface UseGeolocationOptions {
  watch?: boolean;
  throttleMs?: number;
  minDistanceM?: number;
  highAccuracy?: boolean;
}

// Haversine — 두 좌표 사이 거리(미터). watch 모드 minDistanceM 판정용.
function distanceMeters(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const s =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.sin(dLng / 2) * Math.sin(dLng / 2) * Math.cos(lat1) * Math.cos(lat2);
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}

// IP 기반 대략적인 위치 추정 (무료 API 사용)
async function getIPBasedLocation(): Promise<{ lat: number; lng: number; city: string } | null> {
  try {
    // ipapi.co HTTPS API 사용 (Mixed Content 방지)
    const response = await fetch('https://ipapi.co/json/', {
      signal: AbortSignal.timeout(3000), // 3초 타임아웃
    });
    
    if (!response.ok) return null;
    
    const data = await response.json();
    
    // ipapi.co 응답 형식: { latitude, longitude, city, ... }
    if (data.latitude && data.longitude) {
      console.log('[Geolocation] IP 기반 위치 추정 성공:', data.city);
      return {
        lat: data.latitude,
        lng: data.longitude,
        city: data.city || '알 수 없음',
      };
    }
    
    return null;
  } catch (error) {
    console.warn('[Geolocation] IP 기반 위치 추정 실패:', error);
    return null;
  }
}

export function useGeolocation(options?: UseGeolocationOptions): UseGeolocationReturn {
  const watch = options?.watch ?? false;
  const throttleMs = options?.throttleMs ?? 3000;
  const minDistanceM = options?.minDistanceM ?? 5;
  const highAccuracy = options?.highAccuracy ?? false;

  const [state, setState] = useState<GeolocationState>({
    location: DEFAULT_LOCATION, // 기본 위치로 시작
    permissionStatus: 'prompt',
    isLoading: false,
    error: null,
    isUsingDefaultLocation: true,
  });
  const [locationName, setLocationName] = useState<string | null>('서울 명동');
  const ipLocationRef = useRef<{ lat: number; lng: number; city: string } | null>(null);
  // watch 모드 상태 (훅 인스턴스 단위)
  const watchIdRef = useRef<number | null>(null);
  const capWatchIdRef = useRef<string | null>(null); // Capacitor watchId (string)
  const lastUpdateAtRef = useRef<number>(0);
  const lastLocationRef = useRef<{ lat: number; lng: number } | null>(null);

  // 초기 로드 시 IP 기반 위치 추정 시도
  useEffect(() => {
    const fetchIPLocation = async () => {
      const ipLocation = await getIPBasedLocation();
      if (ipLocation) {
        ipLocationRef.current = ipLocation;
        setState(prev => ({
          ...prev,
          location: { lat: ipLocation.lat, lng: ipLocation.lng },
        }));
        setLocationName(ipLocation.city);
        console.log('[Geolocation] IP 기반 기본 위치 설정:', ipLocation.city);
      }
    };

    // IP 기반 위치 추정 (백그라운드)
    fetchIPLocation();
  }, []);

  // Permissions API로 현재 권한 상태 확인
  const checkPermission = useCallback(async (): Promise<PermissionStatus> => {
    if (!navigator.geolocation) {
      return 'unavailable';
    }

    try {
      // Permissions API 지원 여부 확인
      if (navigator.permissions && navigator.permissions.query) {
        const result = await navigator.permissions.query({ name: 'geolocation' });
        return result.state as PermissionStatus;
      }
      // Permissions API를 지원하지 않는 경우 'prompt'로 가정
      return 'prompt';
    } catch (error) {
      console.warn('[Geolocation] Permissions API 오류:', error);
      return 'prompt';
    }
  }, []);

  // 위치 권한 상태 변경 감지
  useEffect(() => {
    const setupPermissionListener = async () => {
      if (!navigator.permissions || !navigator.permissions.query) return;

      try {
        const permissionStatus = await navigator.permissions.query({ name: 'geolocation' });
        
        // 초기 상태 설정
        setState(prev => ({
          ...prev,
          permissionStatus: permissionStatus.state as PermissionStatus,
        }));

        // 권한 상태 변경 리스너
        permissionStatus.addEventListener('change', () => {
          console.log('[Geolocation] 권한 상태 변경:', permissionStatus.state);
          setState(prev => ({
            ...prev,
            permissionStatus: permissionStatus.state as PermissionStatus,
          }));
        });
      } catch (error) {
        console.warn('[Geolocation] 권한 리스너 설정 실패:', error);
      }
    };

    setupPermissionListener();
  }, []);

  // 위치 요청 함수 (사용자가 버튼 클릭 시에만 호출)
  const requestLocation = useCallback(async () => {
    console.log('[GEO] 위치 권한 요청 시작');
    if (!navigator.geolocation) {
      console.error('[GEO] ❌ navigator.geolocation 미지원');
      setState(prev => ({
        ...prev,
        permissionStatus: 'unavailable',
        error: '브라우저가 위치 정보를 지원하지 않습니다.',
        isUsingDefaultLocation: true,
      }));
      return;
    }

    // 먼저 권한 상태 확인
    const currentPermission = await checkPermission();
    console.log('[GEO] 현재 권한 상태:', currentPermission);
    
    if (currentPermission === 'denied') {
      console.warn('[GEO] 위치 권한 거부 상태 → 기본 위치 사용');
      setState(prev => ({
        ...prev,
        permissionStatus: 'denied',
        error: '위치 권한이 거부되었습니다. 브라우저 설정에서 위치 권한을 허용해주세요.',
        isUsingDefaultLocation: true,
      }));
      return;
    }

    console.log('[GEO] getCurrentPosition 호출 시작 (timeout:5000ms)');
    setState(prev => ({ ...prev, isLoading: true, error: null }));

    const options: PositionOptions = {
      enableHighAccuracy: false,
      timeout: 12000, // PC WiFi 위치 추정은 5초로 부족, 12초로 연장
      maximumAge: 60000,
    };

    await getCurrentPositionUnified(
      (position) => {
        const location = {
          lat: position.coords.latitude,
          lng: position.coords.longitude,
        };
        console.log('[GEO] ✅ 위치 권한 획득 및 위치 수신 성공:', location);
        setState({
          location,
          permissionStatus: 'granted',
          isLoading: false,
          error: null,
          isUsingDefaultLocation: false,
        });
      },
      (error) => {
        console.error('[GEO] ❌ 위치 권한/수신 실패 → code:', error.code, '| message:', error.message);
        let errorMessage = '위치 정보를 가져올 수 없습니다.';
        let permStatus: PermissionStatus = 'prompt';

        switch (error.code) {
          case error.PERMISSION_DENIED:
            errorMessage = '위치 권한이 거부되었습니다. 브라우저 설정에서 위치 권한을 허용해주세요.';
            permStatus = 'denied';
            break;
          case error.POSITION_UNAVAILABLE:
          case error.TIMEOUT: {
            // PC에서 GPS 없는 경우 IP 기반 위치로 폴백
            const ipLoc = ipLocationRef.current;
            if (ipLoc) {
              console.log('[GEO] PC 위치 실패 → IP 기반 위치로 폴백:', ipLoc.city);
              setState({
                location: { lat: ipLoc.lat, lng: ipLoc.lng },
                permissionStatus: 'granted',
                isLoading: false,
                error: null,
                isUsingDefaultLocation: false,
              });
              return;
            }
            errorMessage = error.code === error.TIMEOUT
              ? 'PC에서 위치를 찾지 못했습니다. Windows 설정 → 개인 정보 보호 → 위치에서 위치 서비스를 켜주세요.'
              : 'PC에서 위치를 확인할 수 없습니다. Windows 위치 서비스를 활성화하거나 모바일에서 이용해주세요.';
            break;
          }
        }

        setState(prev => ({
          ...prev,
          permissionStatus: permStatus,
          isLoading: false,
          error: errorMessage,
          isUsingDefaultLocation: true,
        }));
      },
      options
    );
  }, [checkPermission]);

  // 재시도 함수
  const retryLocation = useCallback(async () => {
    // 권한이 거부된 경우 안내 메시지 표시
    const currentPermission = await checkPermission();
    
    if (currentPermission === 'denied') {
      setState(prev => ({
        ...prev,
        error: '위치 권한이 거부되어 있습니다. 브라우저 주소창 왼쪽의 자물쇠 아이콘을 클릭하여 위치 권한을 허용해주세요.',
      }));
      return;
    }

    // 권한이 prompt 또는 granted인 경우 다시 요청
    await requestLocation();
  }, [checkPermission, requestLocation]);

  // ── watch 모드: 유저 이동 시 GPS 지속 추적 (옵션으로 활성화) ────────────────
  // - throttleMs 간격 내엔 무시 (배터리 절약)
  // - minDistanceM 미만 이동도 무시 (GPS 지터 방지)
  // - 화면 숨김 시 watch 중지, 복귀 시 재시작
  useEffect(() => {
    if (!watch) return;
    if (!navigator.geolocation) return;
    // 권한이 granted 가 아니면 watch 시작 안 함 (requestLocation 으로 먼저 획득).
    if (state.permissionStatus !== 'granted') return;

    // 통합 success/error callback — Capacitor + Web 양쪽에서 동일 사용
    const onWatchPosition = (position: GeolocationPosition) => {
      const newLoc = {
        lat: position.coords.latitude,
        lng: position.coords.longitude,
      };
      const now = Date.now();
      // throttle
      if (now - lastUpdateAtRef.current < throttleMs) return;
      // min distance
      if (lastLocationRef.current) {
        const d = distanceMeters(lastLocationRef.current, newLoc);
        if (d < minDistanceM) return;
      }
      lastUpdateAtRef.current = now;
      lastLocationRef.current = newLoc;
      setState((prev) => ({
        ...prev,
        location: newLoc,
        isUsingDefaultLocation: false,
      }));
    };
    const onWatchError = (err: { code?: number; message?: string }) => {
      // watch 중 에러는 로깅만 — watchPosition 은 계속 콜백 받으므로 throw 안 함
      console.warn('[GEO watch] position error:', err.code, err.message);
    };
    const watchOptions: PositionOptions = {
      enableHighAccuracy: highAccuracy,
      maximumAge: 10000,
      timeout: 15000,
    };

    const startWatching = async () => {
      if (watchIdRef.current !== null || capWatchIdRef.current !== null) return;
      if (isCapacitorNative()) {
        try {
          const { Geolocation } = await import('@capacitor/geolocation');
          capWatchIdRef.current = await Geolocation.watchPosition(
            watchOptions,
            (position, err) => {
              if (err) {
                onWatchError({ message: String(err) });
                return;
              }
              if (!position) return;
              onWatchPosition({
                coords: position.coords as GeolocationCoordinates,
                timestamp: position.timestamp,
              } as GeolocationPosition);
            },
          );
        } catch (e) {
          console.warn('[GEO watch] Capacitor watchPosition failed:', e);
        }
        return;
      }
      watchIdRef.current = navigator.geolocation.watchPosition(
        onWatchPosition,
        onWatchError,
        watchOptions,
      );
    };

    const stopWatching = async () => {
      if (capWatchIdRef.current !== null) {
        try {
          const { Geolocation } = await import('@capacitor/geolocation');
          await Geolocation.clearWatch({ id: capWatchIdRef.current });
        } catch (e) {
          console.warn('[GEO watch] Capacitor clearWatch failed:', e);
        }
        capWatchIdRef.current = null;
      }
      if (watchIdRef.current !== null) {
        navigator.geolocation.clearWatch(watchIdRef.current);
        watchIdRef.current = null;
      }
    };

    // 화면 보이는 상태에서만 watch 활성
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        startWatching();
      } else {
        stopWatching();
      }
    };

    // 초기 시작 (탭 켜있을 때만)
    if (typeof document !== 'undefined' && document.visibilityState === 'visible') {
      startWatching();
    }
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', handleVisibility);
    }

    return () => {
      stopWatching();
      if (typeof document !== 'undefined') {
        document.removeEventListener('visibilitychange', handleVisibility);
      }
    };
  }, [watch, state.permissionStatus, throttleMs, minDistanceM, highAccuracy]);

  return {
    ...state,
    locationName,
    requestLocation,
    retryLocation,
    checkPermission,
  };
}

// 권한 거부 시 안내 메시지 컴포넌트용 헬퍼
export function getPermissionDeniedMessage(): string {
  const isChrome = /Chrome/.test(navigator.userAgent) && !/Edge/.test(navigator.userAgent);
  const isSafari = /Safari/.test(navigator.userAgent) && !/Chrome/.test(navigator.userAgent);
  const isFirefox = /Firefox/.test(navigator.userAgent);

  if (isChrome) {
    return '주소창 왼쪽의 자물쇠(🔒) 아이콘을 클릭 → "사이트 설정" → "위치"를 "허용"으로 변경해주세요.';
  } else if (isSafari) {
    return 'Safari 설정 → 웹사이트 → 위치에서 이 사이트의 위치 접근을 허용해주세요.';
  } else if (isFirefox) {
    return '주소창 왼쪽의 아이콘을 클릭 → "권한" → "위치 접근"을 허용해주세요.';
  }
  
  return '브라우저 설정에서 이 사이트의 위치 접근 권한을 허용해주세요.';
}
