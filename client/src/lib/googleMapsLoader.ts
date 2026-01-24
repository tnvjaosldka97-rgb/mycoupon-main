/**
 * Google Maps API 스크립트 로더
 * 
 * 전역 플래그를 사용하여 스크립트가 한 번만 로드되도록 보장합니다.
 * 여러 컴포넌트에서 동시에 호출해도 중복 로드를 방지합니다.
 */

const API_KEY = import.meta.env.VITE_FRONTEND_FORGE_API_KEY;
// 직접 Google Maps API 사용 (Proxy 우회)
const USE_DIRECT_GOOGLE_MAPS = true;

// 전역 플래그로 스크립트 로딩 상태 추적
let isLoadingScript = false;
let isScriptLoaded = false;
const loadPromises: Array<(value: null) => void> = [];

export function loadGoogleMapsScript(): Promise<null> {
  // 이미 로드되었으면 즉시 반환
  if (window.google?.maps) {
    return Promise.resolve(null);
  }

  // 로딩 중이면 기존 Promise에 추가
  if (isLoadingScript) {
    return new Promise(resolve => {
      loadPromises.push(resolve);
    });
  }

  // 새로운 로딩 시작
  isLoadingScript = true;

  return new Promise(resolve => {
    const script = document.createElement("script");
    
    // 직접 Google Maps API 사용 (빠른 로딩)
    if (USE_DIRECT_GOOGLE_MAPS) {
      script.src = `https://maps.googleapis.com/maps/api/js?key=${API_KEY}&v=weekly&libraries=marker,places,geocoding,geometry&language=ko&region=KR`;
      console.log('[GoogleMaps] Loading directly from Google Maps API');
    } else {
      // Maps Proxy 사용 (서버 경유)
      const FORGE_BASE_URL = import.meta.env.VITE_FRONTEND_FORGE_API_URL || "https://forge.butterfly-effect.dev";
      const MAPS_PROXY_URL = `${FORGE_BASE_URL}/v1/maps/proxy`;
      script.src = `${MAPS_PROXY_URL}/maps/api/js?key=${API_KEY}&v=weekly&libraries=marker,places,geocoding,geometry&language=ko&region=KR`;
      console.log('[GoogleMaps] Loading via Maps Proxy:', MAPS_PROXY_URL);
    }
    
    script.async = true;
    script.crossOrigin = "anonymous";
    script.onload = () => {
      isScriptLoaded = true;
      isLoadingScript = false;
      console.log('[GoogleMaps] ✅ Loaded successfully');
      resolve(null);
      // 대기 중인 모든 Promise 해결
      loadPromises.forEach(r => r(null));
      loadPromises.length = 0;
    };
    script.onerror = () => {
      console.error("[GoogleMaps] ❌ Failed to load Google Maps script");
      isLoadingScript = false;
    };
    document.head.appendChild(script);
  });
}
