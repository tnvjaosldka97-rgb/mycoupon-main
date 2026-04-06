import type { CookieOptions, Request } from "express";

function isSecureRequest(req: Request) {
  if (req.protocol === "https") return true;

  const forwardedProto = req.headers["x-forwarded-proto"];
  if (!forwardedProto) return false;

  const protoList = Array.isArray(forwardedProto)
    ? forwardedProto
    : forwardedProto.split(",");

  return protoList.some(proto => proto.trim().toLowerCase() === "https");
}

// ── Native App 요청 감지 ──────────────────────────────────────────────────────
//
// 감지 기준 (OR):
//   1. Origin이 Capacitor WebView의 기본 localhost 계열
//      - http://localhost      (androidScheme 미설정 또는 구형 APK)
//      - https://localhost     (androidScheme: 'https' + hostname 미설정)
//      - capacitor://localhost (구형 Capacitor 기본값)
//   2. 앱 전용 엔드포인트 경로
//      - /api/oauth/app-exchange   (항상 native에서만 호출)
//      - /api/oauth/google/native  (항상 native에서만 호출)
//
// 참고: capacitor.config.ts에 server.url: 'https://my-coupon-bridge.com'이 설정된
//       최신 APK는 origin이 https://my-coupon-bridge.com으로 오지만,
//       app-exchange/google/native 경로 기준으로 여전히 native로 판별됨.
//
export function isNativeAppRequest(req: Request): boolean {
  const origin = req.headers.origin ?? '';

  // Origin 기반 감지 (구형 APK / androidScheme 미설정)
  if (
    origin === 'http://localhost' ||
    origin === 'https://localhost' ||
    origin === 'capacitor://localhost'
  ) {
    return true;
  }

  // 경로 기반 감지는 req.path 신뢰성 문제로 제거.
  // 앱 전용 엔드포인트(app-exchange, google/native)는
  // 호출 지점에서 forceNative:true 를 명시적으로 전달한다.

  return false;
}

export function getSessionCookieOptions(
  req: Request,
  opts?: { forceNative?: boolean }
): Pick<CookieOptions, "domain" | "httpOnly" | "path" | "sameSite" | "secure"> {
  const isSecure = isSecureRequest(req);
  const hostname = req.hostname;
  const forwardedProto = req.headers['x-forwarded-proto'];
  const isBehindProxy = forwardedProto === 'https';
  const isProduction =
    process.env.NODE_ENV === 'production' ||
    hostname.includes('railway.app') ||
    hostname.includes('my-coupon-bridge.com') ||
    hostname.includes('vercel.app');

  const finalSecure = isSecure || isProduction || isBehindProxy;
  // forceNative: 호출 지점에서 "이 요청은 반드시 앱 전용"임을 명시할 때 사용
  const native = opts?.forceNative === true || isNativeAppRequest(req);

  // ── SameSite 분기 ─────────────────────────────────────────────────────────
  // 앱(native) 요청:
  //   sameSite: 'none' — Capacitor WebView cross-site fetch에서도 쿠키 저장/전달
  //   secure: true 필수 (sameSite:none + secure:false는 브라우저가 거부)
  //
  // 웹 요청:
  //   sameSite: 'lax' — OAuth redirect 허용, CSRF 방지 유지
  //
  // domain은 설정하지 않음 (host-only 유지 — 더 안전)
  const sameSite: 'none' | 'lax' = native ? 'none' : 'lax';
  // sameSite:none은 반드시 secure:true 필요 — native면 무조건 true
  const secure = native ? true : finalSecure;

  console.log(`[Cookies] options:`, {
    path: req.path,
    origin: req.headers.origin ?? 'none',
    native,
    sameSite,
    secure,
    hostname,
  });

  return {
    httpOnly: true,
    path: "/",
    sameSite,
    secure,
    // domain 미설정 — host-only cookie (my-coupon-bridge.com 기준)
  };
}
