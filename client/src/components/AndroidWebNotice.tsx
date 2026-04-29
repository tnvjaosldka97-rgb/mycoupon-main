import { useState } from 'react';
import { isS25ChromeWeb } from '@/lib/browserDetect';

// sessionStorage 키 — 세션 내 1회 표시
const DISMISS_KEY = 'mc-android-notice-v1';

// Android intent URL: 앱 설치 시 앱 열기, 미설치 시 /install 페이지로 이동
const APP_OPEN_INTENT =
  'intent://open#Intent;' +
  'scheme=com.mycoupon.app;' +
  'package=com.mycoupon.app;' +
  'S.browser_fallback_url=' +
  encodeURIComponent('https://my-coupon-bridge.com/install') +
  ';end';

/**
 * S25 Ultra Android Chrome 웹 안내 오버레이
 * - isS25ChromeWeb() = true 인 경우에만 렌더 (S25/S25+/S25 Ultra)
 * - 세션 내 1회 표시 (dismiss 후 sessionStorage에 저장)
 * - Radix 컴포넌트 미사용 (scroll-lock 충돌 방지)
 */
export function AndroidWebNotice() {
  const [show] = useState(
    () => isS25ChromeWeb() && !sessionStorage.getItem(DISMISS_KEY)
  );
  const [visible, setVisible] = useState(true);

  if (!show || !visible) return null;

  const dismiss = () => {
    sessionStorage.setItem(DISMISS_KEY, '1');
    setVisible(false);
  };

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 9500,
        background: 'linear-gradient(180deg, #fff5f0 0%, #ffffff 55%)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '32px 28px',
        fontFamily: '-apple-system, BlinkMacSystemFont, "Noto Sans KR", sans-serif',
        WebkitTapHighlightColor: 'transparent',
      }}
    >
      {/* 곰돌이 아이콘 */}
      <img
        src="https://my-coupon-bridge.com/logo-bear-nobg.png"
        alt="MyCoupon 곰돌이 캐릭터"
        style={{ width: 72, height: 72, marginBottom: 20, objectFit: 'contain' }}
        onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
      />

      {/* 제목 */}
      <h2
        style={{
          fontSize: 19,
          fontWeight: 700,
          color: '#111827',
          textAlign: 'center',
          lineHeight: 1.45,
          margin: '0 0 14px',
        }}
      >
        일부 기기에서는<br />모바일 웹 이용이 제한됩니다
      </h2>

      {/* 본문 */}
      <p
        style={{
          fontSize: 14,
          color: '#6b7280',
          textAlign: 'center',
          lineHeight: 1.8,
          margin: '0 0 36px',
          maxWidth: 300,
        }}
      >
        갤럭시 S25 시리즈의 Chrome 모바일웹에서는<br />
        로그인 이후 화면 전환이 불안정할 수 있습니다.<br />
        보다 안정적인 이용을 위해 앱을 이용해 주세요.
      </p>

      {/* CTA 버튼 영역 */}
      <div
        style={{
          width: '100%',
          maxWidth: 320,
          display: 'flex',
          flexDirection: 'column',
          gap: 12,
        }}
      >
        {/* 앱에서 계속하기 (primary) */}
        <a
          href={APP_OPEN_INTENT}
          style={{
            display: 'block',
            padding: '15px 0',
            borderRadius: 14,
            textDecoration: 'none',
            background: 'linear-gradient(135deg, #f97316, #ec4899)',
            color: '#ffffff',
            fontSize: 16,
            fontWeight: 600,
            textAlign: 'center',
            boxShadow: '0 4px 18px rgba(249, 115, 22, 0.35)',
          }}
        >
          앱에서 계속하기
        </a>

        {/* 앱 설치하기 (secondary) */}
        <a
          href="/install"
          style={{
            display: 'block',
            padding: '14px 0',
            borderRadius: 14,
            border: '1.5px solid #e5e7eb',
            textDecoration: 'none',
            background: '#ffffff',
            color: '#374151',
            fontSize: 15,
            fontWeight: 500,
            textAlign: 'center',
          }}
        >
          앱 설치하기
        </a>
      </div>

      {/* 보조 문구 */}
      <p
        style={{
          marginTop: 20,
          fontSize: 12,
          color: '#9ca3af',
          textAlign: 'center',
        }}
      >
        문제가 계속되면 앱에서 이용해 주세요.
      </p>

      {/* 소프트 dismiss */}
      <button
        onClick={dismiss}
        style={{
          marginTop: 12,
          background: 'none',
          border: 'none',
          color: '#9ca3af',
          fontSize: 13,
          cursor: 'pointer',
          textDecoration: 'underline',
          padding: '8px 16px',
          WebkitTapHighlightColor: 'transparent',
        }}
      >
        웹에서 계속 이용하기
      </button>
    </div>
  );
}
