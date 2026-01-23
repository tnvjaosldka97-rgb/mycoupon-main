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

    // 콜백 URL 생성 (토큰 교환에 필요)
    const protocol = req.headers["x-forwarded-proto"] || "https";
    const host = req.headers.host || "localhost:3000";
    const redirectUri = `${protocol}://${host}/api/oauth/google/callback`;

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

    // 5. 쿠키 설정
    const cookieOptions = getSessionCookieOptions(req as any);
    res.setHeader(
      "Set-Cookie",
      `${COOKIE_NAME}=${sessionToken}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${ONE_YEAR_MS / 1000}${
        cookieOptions.secure ? "; Secure" : ""
      }`
    );

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
