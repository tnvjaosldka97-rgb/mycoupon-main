/**
 * notificationPolicy.ts — 알림 발송 정책 유틸리티
 *
 * ① 야간 방해 금지 (Do Not Disturb)
 *    - 한국 서비스 → KST(UTC+9) 기준 21:00~08:00 발송 차단
 *    - 적용 대상: 위치 기반 알림(nearby_store), 쿠폰 등록 광역 알림
 *    - 비적용: 만료 임박 알림(서비스 알림), 이메일(스케줄러가 09:00 KST 실행)
 *
 * ② 마케팅 Opt-in 필터
 *    - 광고성 알림 = marketingAgreed=true 유저에게만 발송
 *    - 서비스 알림(coupon_expiring, mission_complete, level_up) = 동의 불필요
 *
 * ③ 광고성 알림 (광고) 문구 강제 삽입 (정보통신망법 제50조)
 *    - 푸시: 제목 앞 "(광고) " 삽입
 *    - 이메일: 제목 앞 "[광고] " 삽입
 *
 * 광고성 알림 유형 분류:
 *   PROMOTIONAL  → nearby_store, new_coupon, food_recommendation  (마케팅)
 *   SERVICE      → coupon_expiring, mission_complete, level_up, general  (서비스)
 */

// KST = UTC+9
const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

/**
 * 현재 KST 시각이 야간 방해 금지 구간(21:00~08:00)인지 확인.
 * @param now - 기준 시각 (기본값: 현재 UTC)
 */
export function isQuietHoursKST(now: Date = new Date()): boolean {
  const kstHour = new Date(now.getTime() + KST_OFFSET_MS).getUTCHours();
  // 21:00 이상 또는 08:00 미만 → 야간
  return kstHour >= 21 || kstHour < 8;
}

/**
 * 광고성 푸시 제목에 "(광고) " 강제 삽입.
 * 이미 삽입된 경우 중복 삽입 방지.
 */
export function makeAdPushTitle(title: string): string {
  if (title.startsWith('(광고)')) return title;
  return `(광고) ${title}`;
}

/**
 * 광고성 이메일 제목에 "[광고] " 강제 삽입 (정보통신망법 제50조).
 * 이미 삽입된 경우 중복 삽입 방지.
 */
export function makeAdEmailSubject(subject: string): string {
  if (subject.startsWith('[광고]')) return subject;
  return `[광고] ${subject}`;
}

/**
 * 해당 알림 타입이 광고성(마케팅)인지 판별.
 * - PROMOTIONAL: marketingAgreed + 야간 제한 + (광고) 표시 모두 적용
 * - SERVICE     : 세 가지 모두 면제
 */
export function isPromotionalType(type: string): boolean {
  return ['nearby_store', 'new_coupon'].includes(type);
}
