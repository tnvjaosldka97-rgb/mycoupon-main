/**
 * Railway 브릿지 서버로 Webhook 발송 기능
 * 실시간 알림 처리를 위한 이벤트 전송
 */

// 환경 변수는 process.env에서 직접 가져옴

// Webhook 이벤트 타입 정의
export type WebhookEventType = 
  | 'coupon.created'      // 신규 쿠폰 등록
  | 'coupon.expiring'     // 쿠폰 마감 임박 (24시간 이내)
  | 'coupon.downloaded'   // 쿠폰 다운로드
  | 'coupon.used'         // 쿠폰 사용 완료
  | 'user.levelup'        // 유저 레벨업
  | 'user.signup'         // 신규 가입
  | 'store.created'       // 신규 업장 등록
  | 'notification.nearby' // 근처 쿠폰 알림 (거리 기반)
  | 'system.awake';       // 시스템 깨우기

// Webhook Payload 인터페이스
export interface WebhookPayload {
  appId: string;
  event: WebhookEventType;
  userId?: string | number;
  timestamp: string;
  data: Record<string, unknown>;
}

// 거리 기반 알림 대상 범위
export type NotificationRadius = 100 | 200 | 500; // meters

// 근처 유저 알림 데이터
export interface NearbyNotificationData {
  couponId: number;
  couponTitle: string;
  storeId: number;
  storeName: string;
  storeLocation: {
    lat: number;
    lng: number;
  };
  discountValue: string;
  expiresAt?: string;
  targetRadius: NotificationRadius[];
  targetUserIds: (string | number)[];
}

// 레벨업 알림 데이터
export interface LevelUpData {
  userId: number;
  userName: string;
  previousLevel: number;
  newLevel: number;
  totalPoints: number;
  reward?: string;
}

// 쿠폰 마감 임박 알림 데이터
export interface CouponExpiringData {
  couponId: number;
  couponTitle: string;
  storeId: number;
  storeName: string;
  expiresAt: string;
  hoursRemaining: number;
  targetUserIds: (string | number)[];
}

// Railway 브릿지 서버 URL (환경 변수에서 가져오거나 기본값 사용)
const BRIDGE_SERVER_URL = process.env.BRIDGE_SERVER_URL || 'https://your-railway-url.railway.app';
const BRIDGE_SECRET = process.env.BRIDGE_SECRET || 'mycoupon-bridge-secret-2025';

// 재시도 설정
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 1000; // 1초

/**
 * 지연 함수
 */
function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Railway 브릿지 서버로 Webhook 발송 (재시도 로직 포함)
 */
export async function sendWebhook(
  event: WebhookEventType,
  data: Record<string, unknown>,
  userId?: string | number
): Promise<{ success: boolean; error?: string; retries?: number }> {
  const payload: WebhookPayload = {
    appId: 'mycoupon',
    event,
    userId,
    timestamp: new Date().toISOString(),
    data,
  };

  let lastError: string = '';
  
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      console.log(`[Webhook] 발송 시도 ${attempt}/${MAX_RETRIES}: ${event}`);
      
      const response = await fetch(`${BRIDGE_SERVER_URL}/api/bridge/webhook`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Bridge-Secret': BRIDGE_SECRET,
        },
        body: JSON.stringify(payload),
      });

      if (response.ok) {
        console.log(`[Webhook] 발송 성공: ${event}`, { userId, dataKeys: Object.keys(data), attempt });
        return { success: true, retries: attempt - 1 };
      }

      const errorText = await response.text();
      lastError = `HTTP ${response.status}: ${errorText}`;
      console.error(`[Webhook] 발송 실패 (시도 ${attempt}/${MAX_RETRIES}): ${lastError}`);
      
    } catch (error) {
      lastError = error instanceof Error ? error.message : 'Unknown error';
      console.error(`[Webhook] 발송 오류 (시도 ${attempt}/${MAX_RETRIES}): ${lastError}`);
    }
    
    // 마지막 시도가 아니면 재시도 전 대기
    if (attempt < MAX_RETRIES) {
      const delayTime = RETRY_DELAY_MS * attempt; // 지수 백오프
      console.log(`[Webhook] ${delayTime}ms 후 재시도...`);
      await delay(delayTime);
    }
  }
  
  console.error(`[Webhook] 최종 실패: ${event} - ${MAX_RETRIES}회 재시도 후 포기`);
  return { success: false, error: lastError, retries: MAX_RETRIES };
}

/**
 * 신규 쿠폰 등록 시 Webhook 발송
 * 100m/200m/500m 이내 유저들에게 알림
 */
export async function notifyCouponCreated(
  couponId: number,
  couponTitle: string,
  storeId: number,
  storeName: string,
  storeLocation: { lat: number; lng: number },
  discountValue: string,
  expiresAt?: string,
  targetUserIds?: (string | number)[]
): Promise<{ success: boolean; error?: string }> {
  const data: NearbyNotificationData = {
    couponId,
    couponTitle,
    storeId,
    storeName,
    storeLocation,
    discountValue,
    expiresAt,
    targetRadius: [100, 200, 500],
    targetUserIds: targetUserIds || [],
  };

  return sendWebhook('coupon.created', data as unknown as Record<string, unknown>);
}

/**
 * 쿠폰 마감 임박 알림 Webhook 발송
 * 다운로드한 유저들에게 24시간 전 알림
 */
export async function notifyCouponExpiring(
  couponId: number,
  couponTitle: string,
  storeId: number,
  storeName: string,
  expiresAt: string,
  hoursRemaining: number,
  targetUserIds: (string | number)[]
): Promise<{ success: boolean; error?: string }> {
  const data: CouponExpiringData = {
    couponId,
    couponTitle,
    storeId,
    storeName,
    expiresAt,
    hoursRemaining,
    targetUserIds,
  };

  return sendWebhook('coupon.expiring', data as unknown as Record<string, unknown>);
}

/**
 * 유저 레벨업 알림 Webhook 발송
 */
export async function notifyUserLevelUp(
  userId: number,
  userName: string,
  previousLevel: number,
  newLevel: number,
  totalPoints: number,
  reward?: string
): Promise<{ success: boolean; error?: string }> {
  const data: LevelUpData = {
    userId,
    userName,
    previousLevel,
    newLevel,
    totalPoints,
    reward,
  };

  return sendWebhook('user.levelup', data as unknown as Record<string, unknown>, userId);
}

/**
 * 근처 쿠폰 알림 Webhook 발송 (거리 기반)
 */
export async function notifyNearbyCoupons(
  userId: number | string,
  userLocation: { lat: number; lng: number },
  nearbyCoupons: Array<{
    couponId: number;
    couponTitle: string;
    storeName: string;
    distance: number;
    discountValue: string;
  }>
): Promise<{ success: boolean; error?: string }> {
  return sendWebhook('notification.nearby', {
    userLocation,
    nearbyCoupons,
    notifiedAt: new Date().toISOString(),
  }, userId);
}

/**
 * Haversine 공식으로 두 지점 간 거리 계산 (미터 단위)
 */
export function calculateDistance(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number
): number {
  const R = 6371000; // 지구 반지름 (미터)
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
    Math.sin(dLng / 2) * Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function toRad(deg: number): number {
  return deg * (Math.PI / 180);
}

/**
 * 특정 반경 내 유저 필터링
 */
export function filterUsersByRadius(
  storeLocation: { lat: number; lng: number },
  users: Array<{ id: number | string; lat: number; lng: number }>,
  radiusMeters: NotificationRadius
): Array<{ id: number | string; distance: number }> {
  return users
    .map(user => ({
      id: user.id,
      distance: calculateDistance(
        storeLocation.lat,
        storeLocation.lng,
        user.lat,
        user.lng
      ),
    }))
    .filter(user => user.distance <= radiusMeters)
    .sort((a, b) => a.distance - b.distance);
}
