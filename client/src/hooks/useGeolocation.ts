import { useState, useCallback, useEffect, useRef } from 'react';

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

export function useGeolocation(): UseGeolocationReturn {
  const [state, setState] = useState<GeolocationState>({
    location: DEFAULT_LOCATION, // 기본 위치로 시작
    permissionStatus: 'prompt',
    isLoading: false,
    error: null,
    isUsingDefaultLocation: true,
  });
  const [locationName, setLocationName] = useState<string | null>('서울 명동');
  const ipLocationRef = useRef<{ lat: number; lng: number; city: string } | null>(null);

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

    navigator.geolocation.getCurrentPosition(
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
