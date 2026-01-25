/**
 * Google OAuth 콜백 API
 * GET /api/oauth/google/callback?code=<code>&state=<state>
 */

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { SignJWT } from "jose";
import { authenticateWithGoogle } from "../../../server/_core/googleOAuth";
import { getSessionCookieOptions } from "../../../server/_core/cookies";
import * as db from "../../../server/db";

const COOKIE_NAME = "session";
const ONE_YEAR_MS = 365 * 24 * 60 * 60 * 1000;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const code = req.query.code as string;
  const state = req.query.state as string;
  const error = req.query.error as string;

  // Google에서 에러 반환한 경우
  if (error) {
    console.error("[Google OAuth] Error from Google:", error);
    return res.redirect(302, "/?error=google_auth_denied");
  }

  if (!code) {
    return res.status(400).json({ error: "Authorization code is required" });
  }

  try {
    const requestStartTime = Date.now();

    // 🚨 CRITICAL FIX: Callback URL 강제 고정 (마누스 유령 제거)
    const isProduction = process.env.NODE_ENV === 'production' || 
                         req.headers.host?.includes('my-coupon-bridge.com') ||
                         req.headers.host?.includes('railway.app');
    
    // 🔒 Production: 하드코딩 강제 고정 (Google Cloud Console 등록값과 정확히 일치)
    const redirectUri = isProduction
      ? 'https://my-coupon-bridge.com/api/oauth/google/callback'
      : `${req.headers["x-forwarded-proto"] || "http"}://${req.headers.host || "localhost:3000"}/api/oauth/google/callback`;
    
    console.log(`[Google OAuth] Callback processing:`);
    console.log(`  Environment: ${isProduction ? 'PRODUCTION' : 'DEVELOPMENT'}`);
    console.log(`  Redirect URI (FORCED): ${redirectUri}`);
    console.log(`  Host: ${req.headers.host}`);

    // 1. Google OAuth 인증 (토큰 교환 + 사용자 정보 조회)
    const googleUser = await authenticateWithGoogle(code, redirectUri);
    const authTime = Date.now() - requestStartTime;

    // 2. openId 생성 (Google ID를 기반으로)
    // 기존 MANUS 사용자와 구분하기 위해 'google_' 접두사 사용
    const openId = `google_${googleUser.id}`;

    // 3. JWT 세션 토큰 직접 생성
    const secret = new TextEncoder().encode(process.env.JWT_SECRET || "default-secret-key");
    const sessionToken = await new SignJWT({
      openId: openId,
      appId: process.env.VITE_APP_ID || "",
      name: googleUser.name || "",
    })
      .setProtectedHeader({ alg: "HS256", typ: "JWT" })
      .setExpirationTime(Math.floor((Date.now() + ONE_YEAR_MS) / 1000))
      .sign(secret);

    const tokenTime = Date.now() - requestStartTime;

    // 4. DB upsert (백그라운드 - 응답 속도에 영향 없음)
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
    console.log(
      `[Google OAuth] ✅ Session issued in ${totalTime}ms (auth: ${authTime}ms, token: ${tokenTime - authTime}ms)`
    );

    // 5. 쿠키 설정 (모바일 PWA 환경 최적화)
    const cookieOptions = getSessionCookieOptions(req as any);
    
    // 🔒 PWA/모바일 환경에서 쿠키가 확실히 저장되도록 명시적 설정
    // Secure 플래그를 강제 적용 (HTTPS 환경에서만 쿠키 전송)
    // SameSite=Lax: OAuth 리다이렉트에서 쿠키 전달 허용
    const isProduction = process.env.NODE_ENV === 'production' || 
                         req.headers.host?.includes('my-coupon-bridge.com') ||
                         req.headers.host?.includes('railway.app');
    
    const cookieString = [
      `${COOKIE_NAME}=${sessionToken}`,
      'Path=/',
      'HttpOnly',
      'SameSite=Lax',
      `Max-Age=${Math.floor(ONE_YEAR_MS / 1000)}`,
      // Production 환경에서는 항상 Secure 플래그 적용
      isProduction ? 'Secure' : (cookieOptions.secure ? 'Secure' : '')
    ].filter(Boolean).join('; ');
    
    res.setHeader('Set-Cookie', cookieString);
    
    console.log(`[Google OAuth] Cookie set: ${COOKIE_NAME}=${sessionToken.substring(0, 20)}... (Secure: ${isProduction || cookieOptions.secure})`);

    // 6. 원래 페이지로 리다이렉트
    let redirectUrl = "/";
    if (state) {
      try {
        const decodedState = Buffer.from(state, "base64").toString("utf-8");
        if (decodedState.startsWith("http") || decodedState.startsWith("/")) {
          const url = new URL(decodedState, `${protocol}://${host}`);
          redirectUrl = url.pathname + url.search;
        }
      } catch (e) {
        console.log("[Google OAuth] Could not decode state, redirecting to home");
      }
    }

    return res.redirect(302, redirectUrl);
  } catch (error) {
    console.error("[Google OAuth] Callback failed:", error);
    return res.redirect(302, "/?error=google_auth_failed");
  }
}
