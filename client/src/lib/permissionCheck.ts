import { isCapacitorNative } from '@/lib/capacitor';

/**
 * PR-95 — 위치 권한 상태 정확 구분 helper.
 *
 * native PermissionCheck plugin (Kotlin 단순 read API) wrapper.
 *
 * 사장님 명시: "앱 사용 중에만 허용" vs "항상 허용" 구분 의무.
 *
 * 사용:
 *   const status = await getLocationPermissionStatus();
 *   if (status === 'always') { ... }      // 항상 허용
 *   if (status === 'while-using') { ... } // 앱 사용 중에만 허용
 *   if (status === 'denied') { ... }      // 거부
 *   if (status === 'unknown') { ... }     // web 환경 또는 plugin error
 */

export type LocationPermissionStatus =
  | 'always'       // 항상 허용 (foreground + background)
  | 'while-using'  // 앱 사용 중에만 허용
  | 'denied'       // 거부
  | 'unknown';     // web 환경 또는 native plugin error

interface PermissionCheckPlugin {
  getLocationStatus: () => Promise<{
    status: 'always' | 'while-using' | 'denied';
    foreground: boolean;
    background: boolean;
  }>;
}

export async function getLocationPermissionStatus(): Promise<LocationPermissionStatus> {
  if (!isCapacitorNative()) return 'unknown';

  try {
    const { registerPlugin } = await import('@capacitor/core');
    const PermissionCheck = registerPlugin<PermissionCheckPlugin>('PermissionCheck');
    const result = await PermissionCheck.getLocationStatus();
    return result.status;
  } catch (e) {
    console.warn('[PermissionCheck] getLocationStatus failed:', e);
    return 'unknown';
  }
}
