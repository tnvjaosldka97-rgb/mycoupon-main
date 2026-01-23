import type { VercelRequest, VercelResponse } from "@vercel/node";
import { sdk } from "../../server/_core/sdk";
import * as db from "../../server/db";
import { getSessionCookieOptions } from "../../server/_core/cookies";

const COOKIE_NAME = "session";
const ONE_YEAR_MS = 365 * 24 * 60 * 60 * 1000;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const code = req.query.code as string;
  const state = req.query.state as string;

  if (!code || !state) {
    return res.status(400).json({ error: "code and state are required" });
  }

  try {
    const requestStartTime = Date.now();
    
    // 1. 토큰 교환 및 사용자 정보 조회
    const tokenResponse = await sdk.exchangeCodeForToken(code, state);
    const userInfo = await sdk.getUserInfo(tokenResponse.accessToken);

    if (!userInfo.openId) {
      return res.status(400).json({ error: "openId missing from user info" });
    }

    // 2. 세션 토큰 생성
    const sessionToken = await sdk.createSessionToken(userInfo.openId, {
      name: userInfo.name || "",
      expiresInMs: ONE_YEAR_MS,
    });

    // 3. DB upsert (백그라운드)
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

    // 쿠키 설정
    const cookieOptions = getSessionCookieOptions(req as any);
    res.setHeader(
      "Set-Cookie",
      `${COOKIE_NAME}=${sessionToken}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${ONE_YEAR_MS / 1000}${cookieOptions.secure ? "; Secure" : ""}`
    );

    // state에서 원래 URL 추출
    let redirectUrl = "/";
    try {
      const decodedState = Buffer.from(state, 'base64').toString('utf-8');
      if (decodedState.startsWith('http') || decodedState.startsWith('/')) {
        const url = new URL(decodedState, `https://${req.headers.host}`);
        redirectUrl = url.pathname + url.search;
      }
    } catch (e) {
      console.log('[OAuth] Could not decode state, redirecting to home');
    }

    return res.redirect(302, redirectUrl);
  } catch (error) {
    console.error("[OAuth] Callback failed", error);
    return res.redirect(302, "/?error=auth_failed");
  }
}
