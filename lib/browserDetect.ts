/**
 * 인앱 브라우저 감지 및 Chrome 리다이렉트 유틸리티
 */

/**
 * 카카오톡 인앱 브라우저 감지
 */
export function isKakaoInAppBrowser(): boolean {
  const ua = navigator.userAgent.toLowerCase();
  return ua.includes('kakaotalk');
}

/**
 * 네이버 인앱 브라우저 감지
 */
export function isNaverInAppBrowser(): boolean {
  const ua = navigator.userAgent.toLowerCase();
  return ua.includes('naver');
}

/**
 * 페이스북 인앱 브라우저 감지
 */
export function isFacebookInAppBrowser(): boolean {
  const ua = navigator.userAgent.toLowerCase();
  return ua.includes('fb') || ua.includes('facebook');
}

/**
 * 인스타그램 인앱 브라우저 감지
 */
export function isInstagramInAppBrowser(): boolean {
  const ua = navigator.userAgent.toLowerCase();
  return ua.includes('instagram');
}

/**
 * 모든 인앱 브라우저 감지
 */
export function isInAppBrowser(): boolean {
  return (
    isKakaoInAppBrowser() ||
    isNaverInAppBrowser() ||
    isFacebookInAppBrowser() ||
    isInstagramInAppBrowser()
  );
}

/**
 * Chrome 브라우저 감지
 */
export function isChrome(): boolean {
  const ua = navigator.userAgent.toLowerCase();
  return ua.includes('chrome') && !isInAppBrowser();
}

/**
 * Safari 브라우저 감지
 */
export function isSafari(): boolean {
  const ua = navigator.userAgent.toLowerCase();
  return ua.includes('safari') && !ua.includes('chrome') && !isInAppBrowser();
}

/**
 * iOS에서 Safari 브라우저인지 감지
 */
export function isIOSSafari(): boolean {
  return isIOS() && isSafari();
}

/**
 * Android 기기 감지
 */
export function isAndroid(): boolean {
  const ua = navigator.userAgent.toLowerCase();
  return ua.includes('android');
}

/**
 * iOS 기기 감지
 */
export function isIOS(): boolean {
  const ua = navigator.userAgent.toLowerCase();
  return /iphone|ipad|ipod/.test(ua);
}

/**
 * 캐시 무효화를 위한 타임스탬프 추가 함수
 */
export function addCacheBuster(url: string): string {
  const timestamp = Date.now();
  const separator = url.includes('?') ? '&' : '?';
  return `${url}${separator}_t=${timestamp}&_v=latest`;
}

/**
 * Chrome Intent URL로 리다이렉트
 * Android 인앱 브라우저에서 Chrome으로 페이지 열기
 */
export function redirectToChrome(url: string = window.location.href): void {
  if (isAndroid()) {
    // 현재 URL의 프로토콜 확인 (http 또는 https)
    const protocol = url.startsWith('https://') ? 'https' : 'http';
    // 캐시 무효화를 위한 타임스탬프 추가
    const urlWithTimestamp = addCacheBuster(url);
    // URL에서 프로토콜 제거
    const urlWithoutProtocol = urlWithTimestamp.replace(/^https?:\/\//, '');
    // Chrome Intent URL 생성 (현재 프로토콜 사용)
    const intentUrl = `intent://${urlWithoutProtocol}#Intent;scheme=${protocol};package=com.android.chrome;end`;
    window.location.href = intentUrl;
  }
}

/**
 * Safari로 리다이렉트
 * iOS 인앱 브라우저에서 Safari로 페이지 열기
 */
export function redirectToSafari(url: string = window.location.href): void {
  if (isIOS() && isInAppBrowser()) {
    // 캐시 무효화를 위한 타임스탬프 추가
    const urlWithTimestamp = addCacheBuster(url);
    // Safari URL Scheme 사용
    window.location.href = urlWithTimestamp;
  }
}

/**
 * 인앱 브라우저에서 외부 브라우저로 자동 리다이렉트
 */
export function redirectToExternalBrowser(url: string = window.location.href): void {
  if (isAndroid() && isInAppBrowser()) {
    redirectToChrome(url);
  } else if (isIOS() && isInAppBrowser()) {
    redirectToSafari(url);
  }
}

/**
 * 인앱 브라우저 이름 반환
 */
export function getInAppBrowserName(): string | null {
  if (isKakaoInAppBrowser()) return '카카오톡';
  if (isNaverInAppBrowser()) return '네이버';
  if (isFacebookInAppBrowser()) return '페이스북';
  if (isInstagramInAppBrowser()) return '인스타그램';
  return null;
}

/**
 * 세션 ID 생성 또는 가져오기
 */
export function getOrCreateSessionId(): string {
  const SESSION_KEY = 'app_session_id';
  let sessionId = sessionStorage.getItem(SESSION_KEY);
  
  if (!sessionId) {
    sessionId = `${Date.now()}-${Math.random().toString(36).substring(2, 15)}`;
    sessionStorage.setItem(SESSION_KEY, sessionId);
  }
  
  return sessionId;
}

/**
 * 디바이스 정보 수집
 */
export function getDeviceInfo() {
  const ua = navigator.userAgent.toLowerCase();
  const isPWA = window.matchMedia('(display-mode: standalone)').matches || 
                (window.navigator as any).standalone === true;
  
  let browserType = 'unknown';
  if (isKakaoInAppBrowser()) browserType = 'kakao_inapp';
  else if (isNaverInAppBrowser()) browserType = 'naver_inapp';
  else if (isInstagramInAppBrowser()) browserType = 'instagram_inapp';
  else if (isFacebookInAppBrowser()) browserType = 'facebook_inapp';
  else if (/chrome/.test(ua) && !/edg/.test(ua)) browserType = 'chrome';
  else if (/safari/.test(ua) && !/chrome/.test(ua)) browserType = 'safari';
  else if (/edg/.test(ua)) browserType = 'edge';
  else if (/firefox/.test(ua)) browserType = 'firefox';
  else if (/samsung/.test(ua)) browserType = 'samsung';
  
  let osType = 'unknown';
  if (isIOS()) osType = 'ios';
  else if (isAndroid()) osType = 'android';
  else if (/mac/.test(ua)) osType = 'macos';
  else if (/win/.test(ua)) osType = 'windows';
  else if (/linux/.test(ua)) osType = 'linux';
  
  return {
    deviceType: isIOS() ? 'ios' : isAndroid() ? 'android' : 'desktop',
    browserType,
    osType,
    osVersion: getOSVersion(),
    userAgent: navigator.userAgent,
    isPWA,
    isInAppBrowser: isInAppBrowser(),
  };
}

/**
 * OS 버전 추출
 */
function getOSVersion(): string {
  const ua = navigator.userAgent;
  
  // iOS 버전
  const iosMatch = ua.match(/OS (\d+)_(\d+)/);
  if (iosMatch) {
    return `iOS ${iosMatch[1]}.${iosMatch[2]}`;
  }
  
  // Android 버전
  const androidMatch = ua.match(/Android (\d+\.?\d*)/);
  if (androidMatch) {
    return `Android ${androidMatch[1]}`;
  }
  
  return 'unknown';
}
