import { COOKIE_NAME, ONE_YEAR_MS } from "@shared/const";
import type { Express, Request, Response } from "express";
import { SignJWT } from "jose";
import * as db from "../db";
import { getSessionCookieOptions } from "./cookies";
import { sdk } from "./sdk";
import { getGoogleAuthUrl, authenticateWithGoogle } from "./googleOAuth";
import { ENV } from "./env";

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

      // redirect URI - 고정 사용 (Google Cloud Console 등록값과 정확히 일치)
      const redirectUri = 'https://my-coupon-bridge.com/api/oauth/google/callback';

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

      // redirect URI - 환경 변수 또는 고정값
      const redirectUri = process.env.GOOGLE_OAUTH_REDIRECT_URI || 'https://my-coupon-bridge.com/api/oauth/google/callback';

      // 1. Google OAuth 인증 (토큰 교환 + 사용자 정보 조회)
      console.log(`[Google OAuth] Callback processing with redirect URI: ${redirectUri}`);
      console.log('[Google OAuth] Code received from:', req.get('referer'));
      const googleUser = await authenticateWithGoogle(code, redirectUri);
      const authTime = Date.now() - requestStartTime;

      // 2. openId 생성 (Google ID 기반)
      const openId = `google_${googleUser.id}`;

      // 3. JWT 세션 토큰 직접 생성
      const secret = new TextEncoder().encode(ENV.cookieSecret || "default-secret-key");
      const sessionToken = await new SignJWT({
        openId: openId,
        appId: ENV.appId || "",
        name: googleUser.name || "",
      })
        .setProtectedHeader({ alg: "HS256", typ: "JWT" })
        .setExpirationTime(Math.floor((Date.now() + ONE_YEAR_MS) / 1000))
        .sign(secret);

      const tokenTime = Date.now() - requestStartTime;

      // 4. DB upsert (백그라운드)
      setImmediate(() => {
        db.upsertUser({
          openId: openId,
          name: googleUser.name || null,
          email: googleUser.email || null,
          loginMethod: "google",
          lastSignedIn: new Date(),
        }).catch((err) => {
          console.error("[Google OAuth] Background upsertUser failed:", err);
        });
      });

      const totalTime = Date.now() - requestStartTime;
      
      if (totalTime > 500) {
        console.warn(`[Google OAuth] ⚠️ SLOW LOGIN: ${totalTime}ms (auth: ${authTime}ms, token: ${tokenTime - authTime}ms)`);
      } else {
        console.log(`[Google OAuth] ✅ FAST LOGIN: ${totalTime}ms (auth: ${authTime}ms)`);
      }

      // 5. 쿠키 설정
      const cookieOptions = getSessionCookieOptions(req);
      res.cookie(COOKIE_NAME, sessionToken, { ...cookieOptions, maxAge: ONE_YEAR_MS });

      // 6. 원래 페이지로 리다이렉트
      let redirectUrl = "/";
      if (state) {
        try {
          const decodedState = Buffer.from(state, "base64").toString("utf-8");
          if (decodedState.startsWith("http") || decodedState.startsWith("/")) {
            const url = new URL(decodedState, "https://my-coupon-bridge.com");
            redirectUrl = url.pathname + url.search;
          }
        } catch (e) {
          console.log("[Google OAuth] Could not decode state, redirecting to home");
        }
      }

      res.redirect(302, redirectUrl);
    } catch (error) {
      console.error("[Google OAuth] Callback failed:", error);
      res.redirect(302, "/?error=google_auth_failed");
    }
  });

  // ========================================
  // 기존 MANUS OAuth (폴백용 유지)
  // ========================================
  
  app.get("/api/oauth/callback", async (req: Request, res: Response) => {
    const code = getQueryParam(req, "code");
    const state = getQueryParam(req, "state");

    if (!code || !state) {
      res.status(400).json({ error: "code and state are required" });
      return;
    }

    try {
      const requestStartTime = Date.now();
      
      // 1. 토큰 교환 및 사용자 정보 조회 (최소화)
      const tokenResponse = await sdk.exchangeCodeForToken(code, state);
      const userInfo = await sdk.getUserInfo(tokenResponse.accessToken);

      if (!userInfo.openId) {
        res.status(400).json({ error: "openId missing from user info" });
        return;
      }

      // 2. 세션 토큰 생성 (로컬 JWT 서명만 수행)
      const sessionToken = await sdk.createSessionToken(userInfo.openId, {
        name: userInfo.name || "",
        expiresInMs: ONE_YEAR_MS,
      });

      // 3. DB upsert는 완전히 백그라운드로 이동 (응답 후 처리)
      setImmediate(() => {
        db.upsertUser({
          openId: userInfo.openId,
          name: userInfo.name || null,
          email: userInfo.email ?? null,
          loginMethod: userInfo.loginMethod ?? userInfo.platform ?? null,
          lastSignedIn: new Date(),
        }).catch(err => {
          console.error('[OAuth] Background upsertUser failed:', err);
        });
      });

      const totalTime = Date.now() - requestStartTime;
      console.log(`[OAuth Performance] Session issued in ${totalTime}ms`);
      
      if (totalTime > 500) {
        console.warn(`[OAuth Performance] ⚠️ SLOW LOGIN: ${totalTime}ms (target: <500ms)`);
      } else {
        console.log(`[OAuth Performance] ✅ FAST LOGIN: ${totalTime}ms < 500ms`);
      }

      const cookieOptions = getSessionCookieOptions(req);
      res.cookie(COOKIE_NAME, sessionToken, { ...cookieOptions, maxAge: ONE_YEAR_MS });

      // state에서 원래 URL 추출 (있으면 그리로, 없으면 홈으로)
      let redirectUrl = "/";
      try {
        const decodedState = Buffer.from(state, 'base64').toString('utf-8');
        // state가 URL이면 그것을 사용, 아니면 홈으로
        if (decodedState.startsWith('http') || decodedState.startsWith('/')) {
          const url = new URL(decodedState, `${req.protocol}://${req.get('host')}`);
          redirectUrl = url.pathname + url.search;
        }
      } catch (e) {
        console.log('[OAuth] Could not decode state, redirecting to home');
      }

      res.redirect(302, redirectUrl);
    } catch (error) {
      console.error("[OAuth] Callback failed", error);
      res.status(500).json({ error: "OAuth callback failed" });
    }
  });
}
