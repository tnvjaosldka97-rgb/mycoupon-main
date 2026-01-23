/**
 * 기기 ID 생성 및 관리
 * localStorage에 저장하여 재사용
 */

const DEVICE_ID_KEY = 'mycoupon_device_id';

/**
 * 브라우저 핑거프린트 기반 기기 ID 생성
 */
function generateDeviceId(): string {
  const fingerprint = {
    userAgent: navigator.userAgent,
    language: navigator.language,
    platform: navigator.platform,
    screenResolution: `${screen.width}x${screen.height}`,
    colorDepth: screen.colorDepth,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    timestamp: Date.now(),
    random: Math.random().toString(36).substring(2, 15),
  };

  // JSON을 문자열로 변환 후 해시 생성 (간단한 해시 함수)
  const str = JSON.stringify(fingerprint);
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32bit integer
  }

  // 해시를 16진수로 변환하고 타임스탬프와 결합
  const hashStr = Math.abs(hash).toString(16);
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 8);
  
  return `${hashStr}-${timestamp}-${random}`;
}

/**
 * 기기 ID 가져오기 (없으면 생성)
 */
export function getDeviceId(): string {
  try {
    // localStorage에서 기존 ID 확인
    let deviceId = localStorage.getItem(DEVICE_ID_KEY);
    
    if (!deviceId) {
      // 없으면 새로 생성
      deviceId = generateDeviceId();
      localStorage.setItem(DEVICE_ID_KEY, deviceId);
    }
    
    return deviceId;
  } catch (error) {
    // localStorage 접근 불가 시 임시 ID 생성
    console.error('Failed to access localStorage:', error);
    return generateDeviceId();
  }
}

/**
 * 기기 ID 초기화 (테스트용)
 */
export function resetDeviceId(): void {
  try {
    localStorage.removeItem(DEVICE_ID_KEY);
  } catch (error) {
    console.error('Failed to reset device ID:', error);
  }
}
