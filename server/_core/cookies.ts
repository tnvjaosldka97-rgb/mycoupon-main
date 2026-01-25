import type { CookieOptions, Request } from "express";

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);

function isIpAddress(host: string) {
  // Basic IPv4 check and IPv6 presence detection.
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) return true;
  return host.includes(":");
}

function isSecureRequest(req: Request) {
  if (req.protocol === "https") return true;

  const forwardedProto = req.headers["x-forwarded-proto"];
  if (!forwardedProto) return false;

  const protoList = Array.isArray(forwardedProto)
    ? forwardedProto
    : forwardedProto.split(",");

  return protoList.some(proto => proto.trim().toLowerCase() === "https");
}

export function getSessionCookieOptions(
  req: Request
): Pick<CookieOptions, "domain" | "httpOnly" | "path" | "sameSite" | "secure"> {
  // 🔒 PWA/모바일 환경 쿠키 정책 강화
  // - httpOnly: XSS 공격 방지 (JavaScript에서 접근 불가)
  // - sameSite: 'lax' - OAuth 리다이렉트에서 쿠키 전달 허용 (CSRF 방지)
  // - secure: HTTPS 환경에서만 쿠키 전송 (중간자 공격 방지)
  
  const isSecure = isSecureRequest(req);
  const hostname = req.hostname;
  
  // Production 환경 감지 (Railway, Vercel, 커스텀 도메인)
  const isProduction = 
    process.env.NODE_ENV === 'production' ||
    hostname.includes('railway.app') ||
    hostname.includes('my-coupon-bridge.com') ||
    hostname.includes('vercel.app');
  
  console.log(`[Cookies] Setting cookie options - hostname: ${hostname}, secure: ${isSecure || isProduction}, sameSite: lax`);

  return {
    httpOnly: true,
    path: "/",
    sameSite: "lax", // OAuth 리다이렉트 지원 (모바일 PWA 필수)
    secure: isSecure || isProduction, // Production에서는 항상 Secure 플래그 적용
  };
}
