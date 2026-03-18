/**
 * 서버 환경변수 로딩
 *
 * Fail-fast 정책:
 *   - JWT_SECRET, GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET 은 production에서 필수.
 *   - 누락 시 서버 시작 즉시 오류를 출력한다.
 *   - 빈 문자열 fallback으로 동작하면 JWT 위조 및 OAuth 실패가 무음 처리되므로 반드시 막아야 함.
 */

const isProduction = process.env.NODE_ENV === "production";

/** production에서 필수 환경변수 누락 시 경고/오류 출력 */
function requireEnv(key: string, value: string, critical = true): string {
  if (!value && isProduction) {
    const msg = `[ENV] FATAL: ${key} is required in production but not set.`;
    if (critical) {
      console.error(msg);
      // 서버를 즉시 종료하지는 않되, 명확한 오류 출력
      // (Railway healthcheck 실패로 자연스럽게 재시작됨)
    } else {
      console.warn(`[ENV] WARNING: ${key} is not set.`);
    }
  }
  return value;
}

export const ENV = {
  appId: process.env.VITE_APP_ID ?? "",
  // CRITICAL: 빈 문자열 fallback 금지 — 빈 문자열이면 JWT 서명이 의미 없어짐
  cookieSecret: requireEnv("JWT_SECRET", process.env.JWT_SECRET ?? ""),
  databaseUrl: requireEnv("DATABASE_URL", process.env.DATABASE_URL ?? ""),
  oAuthServerUrl: process.env.OAUTH_SERVER_URL ?? "",
  ownerOpenId: process.env.OWNER_OPEN_ID ?? "",
  isProduction,
  forgeApiUrl: process.env.BUILT_IN_FORGE_API_URL ?? "",
  forgeApiKey: process.env.BUILT_IN_FORGE_API_KEY ?? "",
  emailUser: process.env.EMAIL_USER ?? "",
  emailPass: process.env.EMAIL_PASS ?? "",
  // Google OAuth
  googleClientId: requireEnv("GOOGLE_CLIENT_ID", process.env.GOOGLE_CLIENT_ID ?? ""),
  googleClientSecret: requireEnv("GOOGLE_CLIENT_SECRET", process.env.GOOGLE_CLIENT_SECRET ?? ""),
  // Google Maps API (프론트 빌드 시 VITE_ prefix로 주입됨 — 서버에서는 참조 불필요)
  // VITE_FRONTEND_FORGE_API_KEY 는 vite 빌드 타임에만 필요 (서버 런타임 불필요)

  // OAuth 리다이렉트 URI
  // 웹: 'https://my-coupon-bridge.com/api/oauth/google/callback'  (기본값)
  // 앱: 추후 Capacitor 딥링크 scheme 등록 후 별도 URI 사용 가능
  //     예: 'com.mycoupon.app:/oauth2redirect/google'
  googleOAuthRedirectUri: process.env.GOOGLE_OAUTH_REDIRECT_URI
    ?? 'https://my-coupon-bridge.com/api/oauth/google/callback',

  // Railway 브릿지 서버
  bridgeSecret: process.env.BRIDGE_SECRET ?? "",
  bridgeServerUrl: process.env.BRIDGE_SERVER_URL ?? "",
  // 마스터 관리자 이메일 (쉼표로 구분)
  masterAdminEmails: (process.env.MASTER_ADMIN_EMAILS || "").split(',').map(e => e.trim()).filter(Boolean),
};

// production 시작 시 필수 환경변수 요약 로깅
if (isProduction) {
  const missing = [
    !ENV.cookieSecret && "JWT_SECRET",
    !ENV.databaseUrl && "DATABASE_URL",
    !ENV.googleClientId && "GOOGLE_CLIENT_ID",
    !ENV.googleClientSecret && "GOOGLE_CLIENT_SECRET",
  ].filter(Boolean);

  if (missing.length > 0) {
    console.error(`[ENV] FATAL: Missing required environment variables: ${missing.join(', ')}`);
    console.error('[ENV] Server cannot start safely. Set these variables in Railway > Variables.');
    process.exit(1);
  } else {
    console.log('[ENV] ✅ All required environment variables are set.');
  }
}
