/**
 * PR-67 Analytics Helper — GA4 + Google Ads 통합 진입점
 *
 * 회귀 0 보장 (사장님 가드레일):
 *  - 환경변수 미설정 시 send/consent 자동 no-op (송신 0건)
 *  - 모든 호출 try-catch wrap → event 실패해도 기존 onSuccess 흐름 차단 0
 *  - Consent Mode v2 default=denied (사용자 marketing 동의 후 grant)
 *  - PII 절대 미송신 (user_id/email/phone 차단 — params 에 받지 않음)
 *
 * 분기:
 *  - Native (Capacitor app): @capacitor-firebase/analytics → mycoupon-da98f Android stream
 *  - Web (브라우저/WebView): window.gtag → GTM 컨테이너 → GA4 web stream + Ads
 */

import { Capacitor } from '@capacitor/core';

const GA_MEASUREMENT_ID = import.meta.env.VITE_GA_MEASUREMENT_ID || '';
const GTM_CONTAINER_ID = import.meta.env.VITE_GTM_CONTAINER_ID || '';
const ADS_ID = import.meta.env.VITE_GOOGLE_ADS_ID || '';

const ADS_LABELS = {
  signup: import.meta.env.VITE_GOOGLE_ADS_LABEL_SIGNUP || '',
  couponIssue: import.meta.env.VITE_GOOGLE_ADS_LABEL_COUPON_ISSUE || '',
  couponRedeem: import.meta.env.VITE_GOOGLE_ADS_LABEL_COUPON_REDEEM || '',
  merchantSignup: import.meta.env.VITE_GOOGLE_ADS_LABEL_MERCHANT_SIGNUP || '',
  payment: import.meta.env.VITE_GOOGLE_ADS_LABEL_PAYMENT || '',
} as const;

const isAnalyticsConfigured = (): boolean =>
  !!(GA_MEASUREMENT_ID || GTM_CONTAINER_ID);

const isAdsConfigured = (): boolean => !!ADS_ID;

/**
 * 앱 부트 시 1회 호출 — GTM/GA4/Ads 동적 로드 + Consent Mode v2 default=denied.
 * 환경변수 미설정 시 no-op (회귀 0 보장).
 * 사용자 marketing 동의 → setAnalyticsConsent(true) 별도 호출 필요.
 */
export const initAnalytics = (): void => {
  if (!isAnalyticsConfigured()) return;
  if (typeof window === 'undefined' || typeof document === 'undefined') return;

  const w = window as any;
  if (w.__mc_analytics_inited) return;
  w.__mc_analytics_inited = true;

  try {
    w.dataLayer = w.dataLayer || [];
    w.gtag = w.gtag || function gtag(..._args: unknown[]) {
      w.dataLayer.push(arguments);
    };

    // Consent Mode v2 default=denied — 사용자 동의 전 송신 0 (한국 정통망법 준수)
    w.gtag('consent', 'default', {
      analytics_storage: 'denied',
      ad_storage: 'denied',
      ad_user_data: 'denied',
      ad_personalization: 'denied',
    });
    w.gtag('js', new Date());

    if (GTM_CONTAINER_ID) {
      const s = document.createElement('script');
      s.async = true;
      s.src = `https://www.googletagmanager.com/gtm.js?id=${GTM_CONTAINER_ID}`;
      document.head.appendChild(s);
    }
    if (GA_MEASUREMENT_ID) {
      const s = document.createElement('script');
      s.async = true;
      s.src = `https://www.googletagmanager.com/gtag/js?id=${GA_MEASUREMENT_ID}`;
      document.head.appendChild(s);
      w.gtag('config', GA_MEASUREMENT_ID, { anonymize_ip: true });
    }
    if (ADS_ID) {
      // GA4 와 같은 gtag.js 라이브러리 공유 — id 만 다른 config 추가
      if (!GA_MEASUREMENT_ID) {
        const s = document.createElement('script');
        s.async = true;
        s.src = `https://www.googletagmanager.com/gtag/js?id=${ADS_ID}`;
        document.head.appendChild(s);
      }
      w.gtag('config', ADS_ID);
    }
  } catch (e) {
    console.warn('[Analytics] initAnalytics failed (non-blocking):', e);
  }
};

/**
 * 사용자 marketing 동의 변경 시 호출 — Consent Mode v2 grant/deny 동기화.
 * 환경변수 미설정 → no-op.
 */
export const setAnalyticsConsent = async (granted: boolean): Promise<void> => {
  if (!isAnalyticsConfigured()) return;
  try {
    if (typeof window !== 'undefined' && (window as any).gtag) {
      (window as any).gtag('consent', 'update', {
        analytics_storage: granted ? 'granted' : 'denied',
        ad_storage: granted ? 'granted' : 'denied',
        ad_user_data: granted ? 'granted' : 'denied',
        ad_personalization: granted ? 'granted' : 'denied',
      });
    }
    if (Capacitor.isNativePlatform()) {
      const { FirebaseAnalytics, ConsentType, ConsentStatus } = await import(
        '@capacitor-firebase/analytics'
      );
      const status = granted ? ConsentStatus.Granted : ConsentStatus.Denied;
      // setConsent 는 단일 type 만 받음 — 4가지 type 별 분리 호출 (Consent Mode v2)
      await FirebaseAnalytics.setConsent({ type: ConsentType.AnalyticsStorage, status });
      await FirebaseAnalytics.setConsent({ type: ConsentType.AdStorage, status });
      await FirebaseAnalytics.setConsent({ type: ConsentType.AdUserData, status });
      await FirebaseAnalytics.setConsent({ type: ConsentType.AdPersonalization, status });
      await FirebaseAnalytics.setEnabled({ enabled: granted });
    }
  } catch (e) {
    console.warn('[Analytics] setAnalyticsConsent failed (non-blocking):', e);
  }
};

/**
 * 단일 event + 선택적 Google Ads conversion 송신.
 * 환경변수 미설정 또는 실패 시 silently no-op (기존 흐름 차단 X).
 */
const sendEvent = async (
  eventName: string,
  params: Record<string, unknown>,
  conversionLabel: string,
): Promise<void> => {
  if (!isAnalyticsConfigured()) return;
  try {
    if (typeof window !== 'undefined' && (window as any).gtag) {
      (window as any).gtag('event', eventName, params);
      if (isAdsConfigured() && conversionLabel) {
        (window as any).gtag('event', 'conversion', {
          send_to: `${ADS_ID}/${conversionLabel}`,
          ...params,
        });
      }
    }
    if (Capacitor.isNativePlatform()) {
      const { FirebaseAnalytics } = await import('@capacitor-firebase/analytics');
      await FirebaseAnalytics.logEvent({ name: eventName, params: params as any });
    }
  } catch (e) {
    console.warn(`[Analytics] ${eventName} failed (non-blocking):`, e);
  }
};

// ── 5개 전환 이벤트 helper (PII 차단: user_id/email/phone 받지 않음) ──────
export const logSignupComplete = (params: { method?: string } = {}) =>
  sendEvent('sign_up', params, ADS_LABELS.signup);

export const logCouponIssue = (
  params: { coupon_id?: number | string; store_id?: number | string } = {},
) => sendEvent('coupon_issue', params, ADS_LABELS.couponIssue);

export const logCouponRedeem = (
  params: { coupon_id?: number | string; store_id?: number | string } = {},
) => sendEvent('coupon_redeem', params, ADS_LABELS.couponRedeem);

export const logMerchantSignup = (params: { store_id?: number | string } = {}) =>
  sendEvent('merchant_signup', params, ADS_LABELS.merchantSignup);

export const logPaymentComplete = (
  params: { value?: number; currency?: string; pack_code?: string } = {},
) => sendEvent('payment_complete', params, ADS_LABELS.payment);
