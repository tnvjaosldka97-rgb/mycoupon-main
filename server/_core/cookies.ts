import type { CookieOptions } from "express";

// ══════════════════════════════════════════════════════════════════════════════
// Session Cookie Policy
//
// 쿠키 정책은 req.path / origin / user-agent 추론 없이
// 발급 지점에서 mode를 명시적으로 지정한다.
//
// native:
//   Capacitor WebView에서 fetch()로 호출하는 앱 전용 엔드포인트.
//   sameSite:'none' + secure:true 필수.
//   (sameSite:lax는 Capacitor 환경에서 cross-context fetch Set-Cookie가 무시될 수 있음)
//
// web:
//   브라우저 OAuth redirect / 웹 세션.
//   sameSite:'lax' + secure:true.
//   CSRF 방지 유지.
//
// secure: 항상 true.
//   - Railway production: 항상 HTTPS
//   - devLogin(dev전용)은 production에서 차단됨 → localhost HTTP 예외 불필요
//
// domain: 설정하지 않음 (host-only cookie).
//   브라우저가 요청 호스트(my-coupon-bridge.com)에 귀속시킴.
// ══════════════════════════════════════════════════════════════════════════════

export type CookieMode = 'web' | 'native';

export function getSessionCookieOptions(
  mode: CookieMode
): Pick<CookieOptions, "httpOnly" | "path" | "sameSite" | "secure"> {
  return {
    httpOnly: true,
    path: "/",
    sameSite: mode === 'native' ? 'none' : 'lax',
    secure: true,
  };
}

// clearCookie용 — maxAge:-1로 만료 처리 (path/domain만 일치하면 됨)
export function getSessionClearOptions(): Pick<CookieOptions, "httpOnly" | "path"> {
  return { httpOnly: true, path: "/" };
}
