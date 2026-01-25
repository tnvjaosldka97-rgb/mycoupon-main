/**
 * Google OAuth 로그인 시작 API
 * GET /api/oauth/google/login?redirect=<원래URL>
 */

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getGoogleAuthUrl } from "../../../server/_core/googleOAuth";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    // 🚨 CRITICAL FIX: Callback URL 강제 고정 (마누스 유령 제거)
    // Production 환경에서는 절대로 동적 URL 생성하지 않음
    const isProduction = process.env.NODE_ENV === 'production' || 
                         req.headers.host?.includes('my-coupon-bridge.com') ||
                         req.headers.host?.includes('railway.app');
    
    // 🔒 Production: 하드코딩 강제 고정
    // 🔧 Development: 동적 생성
    const redirectUri = isProduction
      ? 'https://my-coupon-bridge.com/api/oauth/google/callback'
      : `${req.headers["x-forwarded-proto"] || "http"}://${req.headers.host || "localhost:3000"}/api/oauth/google/callback`;
    
    console.log(`[Google OAuth] Environment: ${isProduction ? 'PRODUCTION' : 'DEVELOPMENT'}`);
    console.log(`[Google OAuth] Callback URI (FORCED): ${redirectUri}`);
    
    // 원래 페이지 URL을 state에 저장 (로그인 후 리다이렉트용)
    const redirectUrl = (req.query.redirect as string) || "/";
    const state = Buffer.from(redirectUrl).toString("base64");

    // Google OAuth URL 생성
    const authUrl = getGoogleAuthUrl(redirectUri, state);

    console.log(
      `[Google OAuth] Login initiated:\n` +
      `  Callback URI: ${redirectUri}\n` +
      `  Redirect after login: ${redirectUrl}`
    );
    
    // Google 로그인 페이지로 리다이렉트
    return res.redirect(302, authUrl);
  } catch (error) {
    console.error("[Google OAuth] Login error:", error);
    return res.redirect(302, "/?error=google_auth_failed");
  }
}
