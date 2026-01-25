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
    // 🔍 환경변수 검증: 올바른 도메인 설정 확인
    const protocol = req.headers["x-forwarded-proto"] || "https";
    const host = req.headers.host || "localhost:3000";
    const currentUrl = `${protocol}://${host}`;
    
    // NEXTAUTH_URL 환경변수가 설정되어 있으면 검증
    const expectedUrl = process.env.NEXTAUTH_URL;
    if (expectedUrl && expectedUrl !== currentUrl && !currentUrl.includes('localhost')) {
      console.warn(
        `[Google OAuth] ⚠️ URL 불일치 경고:\n` +
        `  현재 요청 URL: ${currentUrl}\n` +
        `  설정된 NEXTAUTH_URL: ${expectedUrl}\n` +
        `  이 불일치는 OAuth 콜백 실패의 원인이 될 수 있습니다.`
      );
    }
    
    // 원래 페이지 URL을 state에 저장 (로그인 후 리다이렉트용)
    const redirectUrl = (req.query.redirect as string) || "/";
    const state = Buffer.from(redirectUrl).toString("base64");

    // 콜백 URL 생성
    const redirectUri = `${protocol}://${host}/api/oauth/google/callback`;

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
