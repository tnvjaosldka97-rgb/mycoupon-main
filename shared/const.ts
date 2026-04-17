export const COOKIE_NAME = "app_session_id";
export const ONE_YEAR_MS = 1000 * 60 * 60 * 24 * 365;
export const AXIOS_TIMEOUT_MS = 30_000;
export const UNAUTHED_ERR_MSG = 'Please login (10001)';
export const NOT_ADMIN_ERR_MSG = 'You do not have required permission (10002)';

// ─────────────────────────────────────────────────────────────────
// 유저 알림 맥락화 — 쿠폰찾기 필터 탭 + GPS 반경 레이더 정책값
// 설계 문서: docs/2026-04-17-user-notification-coupon-finder-design.md
// Phase 1 (2026-04-17): 상수만 정의 — 실제 소비는 Phase 2/3.
// ─────────────────────────────────────────────────────────────────

/**
 * 유저 알림 반경 선택지 (m).
 * users.notification_radius 컬럼 허용값과 1:1 일치 —
 * "유저 알림 반경 설정 = 지도 기본 반경"으로 통일.
 * 변경 시 NotificationSettings UI + users 테이블 데이터 정합성 재검토 필수.
 */
export const USER_ALERT_RADIUS_OPTIONS_M = [100, 200, 500] as const;
export const USER_ALERT_DEFAULT_RADIUS_M = 200;
export type UserAlertRadiusM = typeof USER_ALERT_RADIUS_OPTIONS_M[number];

/**
 * "새로 오픈했어요" 탭에 노출할 신규 매장 공개 윈도(일).
 * 판정 기준: stores.approved_at >= NOW() - N days
 * Phase 2 finder.listNewlyOpened 에서 사용.
 */
export const NEW_OPEN_WINDOW_DAYS = 14;

/**
 * 조르기(nudge) 24h 중복 방지.
 * 기존 server/routers.ts nudgeDormant 의 하드코딩 값과 동일 — 기존 정책 보존.
 */
export const NUDGE_DEDUP_HOURS = 24;

/**
 * 쿠폰찾기 필터 탭 key.
 * URL query param `?tab=` 값과 일치시킴.
 * 'all' = 기본(기존 쿠폰찾기 동선 보존), 'nudge' = 조르기 확인하기, 'newopen' = 새로 오픈했어요.
 */
export const USER_ALERT_TABS = ['all', 'nudge', 'newopen'] as const;
export type UserAlertTab = typeof USER_ALERT_TABS[number];

/**
 * 유저 체감 이벤트 알림 타입 (notification_type enum 추가값과 1:1 매핑).
 * Phase 1 migration 0015에서 enum 값으로 등록됨.
 * 기존 new_coupon / nearby_store 값과 의미 분리 (혼동 금지).
 */
export const USER_ALERT_NOTIFICATION_TYPES = ['nudge_activated', 'newly_opened_nearby'] as const;
export type UserAlertNotificationType = typeof USER_ALERT_NOTIFICATION_TYPES[number];

/**
 * 지도 반경 레이더 overlay 스타일 (Google Maps Circle).
 * 브랜드 톤: rose-300/400 은은한 반투명. 원색/군사 레이더 금지.
 */
export const USER_ALERT_RADAR_STYLE = {
  strokeColor: '#F472B6',   // rose-400
  strokeOpacity: 0.35,
  strokeWeight: 1.5,
  fillColor: '#FDA4AF',     // rose-300
  fillOpacity: 0.08,
} as const;
