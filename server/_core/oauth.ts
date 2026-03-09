import { COOKIE_NAME, ONE_YEAR_MS } from "@shared/const";
import type { Express, Request, Response } from "express";
import { SignJWT } from "jose";
import * as db from "../db";
import { getSessionCookieOptions } from "./cookies";
import { getGoogleAuthUrl, authenticateWithGoogle } from "./googleOAuth";
import { ENV } from "./env";

// ❌ Manus SDK 제거: import { sdk } from "./sdk";

function getQueryParam(req: Request, key: string): string | undefined {
  const value = req.query[key];
  return typeof value === "string" ? value : undefined;
}

export function registerOAuthRoutes(app: Express) {
  // ========================================
  // Google OAuth 직접 연동 (성능 최적화)
  // ========================================
  
  // Google OAuth 로그인 시작
  app.get("/api/oauth/google/login", async (req: Request, res: Response) => {
    try {
      const redirectUrl = getQueryParam(req, "redirect") || "/";
      const state = Buffer.from(redirectUrl).toString("base64");

      // redirect URI — ENV.googleOAuthRedirectUri 로 일원화 (env.ts에서 관리)
      // 웹 기본: 'https://my-coupon-bridge.com/api/oauth/google/callback'
      // 앱 대응: GOOGLE_OAUTH_REDIRECT_URI 환경변수로 override 가능
      const redirectUri = ENV.googleOAuthRedirectUri;

      const authUrl = getGoogleAuthUrl(redirectUri, state);
      console.log(`[Google OAuth] Login initiated, redirect URI: ${redirectUri}`);
      
      res.redirect(302, authUrl);
    } catch (error) {
      console.error("[Google OAuth] Login error:", error);
      res.redirect(302, "/?error=google_auth_failed");
    }
  });

  // Google OAuth 콜백
  app.get("/api/oauth/google/callback", async (req: Request, res: Response) => {
    const code = getQueryParam(req, "code");
    const state = getQueryParam(req, "state");
    const error = getQueryParam(req, "error");

    if (error) {
      console.error("[Google OAuth] Error from Google:", error);
      res.redirect(302, "/?error=google_auth_denied");
      return;
    }

    if (!code) {
      res.status(400).json({ error: "Authorization code is required" });
      return;
    }

    try {
      const requestStartTime = Date.now();

      // redirect URI — ENV.googleOAuthRedirectUri 로 일원화 (env.ts에서 관리)
      const redirectUri = ENV.googleOAuthRedirectUri;

      // 1. Google OAuth 인증 (토큰 교환 + 사용자 정보 조회)
      console.log(`[Google OAuth] Callback processing with redirect URI: ${redirectUri}`);
      console.log('[Google OAuth] Code received from:', req.get('referer'));
      const googleUser = await authenticateWithGoogle(code, redirectUri);
      const authTime = Date.now() - requestStartTime;

      // 2. openId 생성 (Google ID 기반)
      const openId = `google_${googleUser.id}`;

      // 3. JWT 세션 토큰 직접 생성
      // JWT_SECRET이 없으면 fail-fast (env.ts에서 이미 경고 출력됨)
      if (!ENV.cookieSecret) {
        console.error('[OAuth] FATAL: JWT_SECRET is not set. Cannot create session token.');
        res.redirect(302, "/?error=server_config_error");
        return;
      }
      const secret = new TextEncoder().encode(ENV.cookieSecret);
      const sessionToken = await new SignJWT({
        openId: openId,
        appId: ENV.appId || "",
        name: googleUser.name || "",
      })
        .setProtectedHeader({ alg: "HS256", typ: "JWT" })
        .setExpirationTime(Math.floor((Date.now() + ONE_YEAR_MS) / 1000))
        .sign(secret);

      const tokenTime = Date.now() - requestStartTime;

      // 4. DB upsert (동기 — consent 체크를 위해 await 필요)
      await db.upsertUser({
        openId: openId,
        name: googleUser.name || null,
        email: googleUser.email || null,
        loginMethod: "google",
        lastSignedIn: new Date(),
      });

      // 5. 동의 완료 여부 확인 (신규 or 미동의 계정 → consent 페이지로)
      const dbUser = await db.getUserByOpenId(openId);
      const signupCompleted = !!(dbUser as any)?.signupCompletedAt;

      const totalTime = Date.now() - requestStartTime;
      if (totalTime > 500) {
        console.warn(`[Google OAuth] ⚠️ SLOW LOGIN: ${totalTime}ms (auth: ${authTime}ms)`);
      } else {
        console.log(`[Google OAuth] ✅ LOGIN: ${totalTime}ms, signupCompleted=${signupCompleted}`);
      }

      // 6. 쿠키 설정
      const cookieOptions = getSessionCookieOptions(req);
      res.cookie(COOKIE_NAME, sessionToken, { ...cookieOptions, maxAge: ONE_YEAR_MS });

      // 7. 원래 의도했던 목적지 파싱
      let intendedUrl = "/";
      if (state) {
        try {
          const decodedState = Buffer.from(state, "base64").toString("utf-8");
          if (decodedState.startsWith("http") || decodedState.startsWith("/")) {
            const url = new URL(decodedState, "https://my-coupon-bridge.com");
            intendedUrl = url.pathname + url.search;
          }
        } catch (e) {
          console.log("[Google OAuth] Could not decode state, using /");
        }
      }

      // 8. consent 미완료 → /signup/consent 로 강제 리다이렉트
      //    (consent 페이지 자체로의 이동은 루프 방지)
      if (!signupCompleted && !intendedUrl.startsWith('/signup')) {
        const next = encodeURIComponent(intendedUrl === '/' ? '/merchant/dashboard' : intendedUrl);
        console.log(`[Google OAuth] 신규/미동의 계정 → consent 리다이렉트 (next=${next})`);
        res.redirect(302, `/signup/consent?next=${next}`);
        return;
      }

      res.redirect(302, intendedUrl);
    } catch (error) {
      console.error("[Google OAuth] Callback failed:", error);
      res.redirect(302, "/?error=google_auth_failed");
    }
  });

  // ========================================
  // Android 앱 OAuth 복귀 bridge route
  // ========================================
  // 목적:
  //   앱 OAuth 완료 후 쿠키 의존 없이 명시적으로 Custom Tabs를 닫고 앱으로 복귀.
  //
  // 흐름:
  //   1. 앱이 /api/oauth/google/login?redirect=/api/oauth/app-return 으로 로그인 시작
  //   2. Google OAuth 완료 → 서버가 /api/oauth/app-return 으로 redirect
  //   3. 이 route: com.mycoupon.app://auth/callback 으로 redirect
  //   4. Chrome Custom Tabs가 custom scheme 수신 → Android 처리 → 탭 닫힘
  //   5. 앱 appUrlOpen 발화 → auth.me 1회 → 홈 진입
  //
  // 웹 로그인 영향 없음:
  //   웹 로그인은 redirect 파라미터를 /api/oauth/app-return 으로 설정하지 않으므로
  //   이 route를 거치지 않는다.
  app.get("/api/oauth/app-return", (_req: Request, res: Response) => {
    console.log('[OAuth bridge] 앱 복귀 bridge route 호출 → com.mycoupon.app://auth/callback 으로 이동');
    // custom scheme redirect → Chrome Custom Tabs 종료 → appUrlOpen 발화
    res.redirect(302, 'com.mycoupon.app://auth/callback');
  });

  // ========================================
  // ❌ DEPRECATED: Manus OAuth 완전 제거
  // Google OAuth만 사용 (위 코드)
  // ========================================
  
  // Manus OAuth 폴백 제거됨
  console.log('✅ [OAuth] Only Google OAuth is active. Manus OAuth removed.');
}
