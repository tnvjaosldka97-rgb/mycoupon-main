import { COOKIE_NAME, ONE_YEAR_MS } from "@shared/const";
import type { Express, Request, Response } from "express";
import { SignJWT } from "jose";
import { randomBytes } from "crypto";
import * as db from "../db";
import { getSessionCookieOptions } from "./cookies";
import { getGoogleAuthUrl, authenticateWithGoogle } from "./googleOAuth";
import { ENV } from "./env";

// ❌ Manus SDK 제거: import { sdk } from "./sdk";

function getQueryParam(req: Request, key: string): string | undefined {
  const value = req.query[key];
  return typeof value === "string" ? value : undefined;
}

// ══════════════════════════════════════════════════════════════════════════════
// App Login Ticket Store
//
// 근본 원인 해결:
//   Chrome Custom Tabs와 Android WebView는 쿠키 저장소가 분리되어 있음.
//   → Custom Tabs OAuth로 생성된 세션 쿠키가 WebView로 전달되지 않음.
//   → auth.me retry/polling으로는 이 구조적 한계를 절대 극복할 수 없음.
//
// 해결 방식 (Login Ticket Exchange):
//   1. 앱이 redirect=_app_ 로 OAuth 시작
//   2. 서버 OAuth 완료 → 1회용 ticket(60s TTL) 생성
//   3. 서버 → com.mycoupon.app://auth/callback?ticket=<ticket> 로 redirect
//   4. Custom Tabs: custom scheme 수신 → 탭 닫힘 → appUrlOpen 발화
//   5. 앱 WebView: POST /api/oauth/app-exchange { ticket }
//   6. 서버: ticket 검증 → WebView 컨텍스트에 세션 쿠키 Set-Cookie
//   7. auth.me 1회 → 로그인 완료
//
// 보안:
//   - JWT 토큰 자체를 URL로 전달하지 않음
//   - ticket은 32바이트 random hex (64자), 추측 불가
//   - TTL 60초, 사용 즉시 삭제 (1회용)
//   - openId에 바인딩 → 다른 사용자 탈취 불가
// ══════════════════════════════════════════════════════════════════════════════

interface AppLoginTicket {
  openId: string;
  sessionToken: string;
  expiresAt: number; // timestamp ms
  used: boolean;
}

const _appLoginTickets = new Map<string, AppLoginTicket>();

// 만료 ticket 자동 정리 (1분 간격)
setInterval(() => {
  const now = Date.now();
  for (const [key, t] of _appLoginTickets) {
    if (t.expiresAt < now) _appLoginTickets.delete(key);
  }
}, 60_000);

function generateAppTicket(openId: string, sessionToken: string): string {
  const ticket = randomBytes(32).toString("hex"); // 64자 hex, 추측 불가
  _appLoginTickets.set(ticket, {
    openId,
    sessionToken,
    expiresAt: Date.now() + 60_000, // 60초 TTL
    used: false,
  });
  return ticket;
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
      const redirectUri = ENV.googleOAuthRedirectUri;

      const authUrl = getGoogleAuthUrl(redirectUri, state);
      console.log(`[Google OAuth] Login initiated, redirect URI: ${redirectUri}, isApp: ${redirectUrl === '_app_'}`);

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
      const redirectUri = ENV.googleOAuthRedirectUri;

      console.log(`[Google OAuth] Callback processing with redirect URI: ${redirectUri}`);
      const googleUser = await authenticateWithGoogle(code, redirectUri);
      const authTime = Date.now() - requestStartTime;

      const openId = `google_${googleUser.id}`;

      if (!ENV.cookieSecret) {
        console.error('[OAuth] FATAL: JWT_SECRET is not set.');
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

      await db.upsertUser({
        openId: openId,
        name: googleUser.name || null,
        email: googleUser.email || null,
        loginMethod: "google",
        lastSignedIn: new Date(),
      });

      const dbUser = await db.getUserByOpenId(openId);
      const signupCompleted = !!(dbUser as any)?.signupCompletedAt;

      const totalTime = Date.now() - requestStartTime;
      console.log(`[Google OAuth] ${totalTime > 500 ? '⚠️ SLOW' : '✅'} LOGIN: ${totalTime}ms, signupCompleted=${signupCompleted}`);

      // ── state 디코딩 ──────────────────────────────────────────────────────
      let decodedState = "/";
      try {
        decodedState = state ? Buffer.from(state, "base64").toString("utf-8") : "/";
      } catch (e) {
        console.log("[Google OAuth] Could not decode state, using /");
      }

      // ── 앱 모드 감지: redirect=_app_ ─────────────────────────────────────
      const isAppMode = decodedState === "_app_";

      if (isAppMode) {
        // 앱 로그인:
        // 쿠키를 여기서 설정하면 Chrome Custom Tabs에 저장됨 → WebView로 전달 안 됨.
        // 대신 1회용 ticket을 발급해 앱이 WebView에서 직접 exchange하게 함.
        if (signupCompleted) {
          // 기존 사용자: ticket 발급 → custom scheme으로 redirect
          const ticket = generateAppTicket(openId, sessionToken);
          console.log(`[OAuth app-ticket] 🎫 Ticket generated for ${openId} (60s TTL)`);
          // com.mycoupon.app://auth/callback?ticket=xxx
          // → Custom Tabs가 custom scheme 수신 → 탭 닫힘 → appUrlOpen 발화
          res.redirect(302, `com.mycoupon.app://auth/callback?ticket=${ticket}`);
          return;
        } else {
          // 신규 사용자: consent 필요.
          // 쿠키를 설정하고 Custom Tabs에서 consent 진행.
          // consent 완료 후 browserFinished(fallback)으로 처리.
          const cookieOptions = getSessionCookieOptions(req);
          res.cookie(COOKIE_NAME, sessionToken, { ...cookieOptions, maxAge: ONE_YEAR_MS });
          const next = encodeURIComponent('/merchant/dashboard');
          console.log(`[OAuth app-ticket] 신규 앱 사용자 → consent 리다이렉트`);
          res.redirect(302, `/signup/consent?next=${next}`);
          return;
        }
      }

      // ── 웹 모드: 기존 플로우 유지 ─────────────────────────────────────────
      const cookieOptions = getSessionCookieOptions(req);
      res.cookie(COOKIE_NAME, sessionToken, { ...cookieOptions, maxAge: ONE_YEAR_MS });

      let intendedUrl = "/";
      if (decodedState.startsWith("http") || decodedState.startsWith("/")) {
        try {
          const url = new URL(decodedState, "https://my-coupon-bridge.com");
          intendedUrl = url.pathname + url.search;
        } catch (e) { /* ignore */ }
      }

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
  // App Login Ticket Exchange Endpoint
  // ========================================
  // 앱 WebView 컨텍스트에서 호출.
  // ticket을 검증하고 WebView에 직접 세션 쿠키를 설정함.
  // 쿠키가 WebView 컨텍스트에서 Set-Cookie로 설정되므로 auth.me가 즉시 user를 반환.
  app.post("/api/oauth/app-exchange", async (req: Request, res: Response) => {
    try {
      const { ticket } = req.body as { ticket?: string };

      if (!ticket || typeof ticket !== "string") {
        console.warn("[app-exchange] ticket 파라미터 없음");
        res.status(400).json({ error: "ticket_required" });
        return;
      }

      const ticketData = _appLoginTickets.get(ticket);

      // ticket 존재 여부
      if (!ticketData) {
        console.warn("[app-exchange] ticket 없음 (만료 or 잘못된 ticket)");
        res.status(401).json({ error: "ticket_invalid" });
        return;
      }

      // 1회용 보장
      if (ticketData.used) {
        console.warn(`[app-exchange] ticket 이미 사용됨 (openId: ${ticketData.openId})`);
        res.status(401).json({ error: "ticket_already_used" });
        return;
      }

      // TTL 체크
      if (Date.now() > ticketData.expiresAt) {
        _appLoginTickets.delete(ticket);
        console.warn(`[app-exchange] ticket 만료 (openId: ${ticketData.openId})`);
        res.status(401).json({ error: "ticket_expired" });
        return;
      }

      // 사용 처리 (1회용 보장) + 즉시 삭제
      ticketData.used = true;
      _appLoginTickets.delete(ticket);

      // WebView 컨텍스트에 세션 쿠키 설정
      // 이 요청은 앱 WebView에서 fetch()로 호출되므로
      // 응답의 Set-Cookie가 WebView 쿠키 저장소에 저장됨.
      const cookieOptions = getSessionCookieOptions(req);
      res.cookie(COOKIE_NAME, ticketData.sessionToken, { ...cookieOptions, maxAge: ONE_YEAR_MS });

      console.log(`[app-exchange] ✅ Session cookie set in WebView for openId: ${ticketData.openId}`);
      res.json({ success: true });
    } catch (err) {
      console.error("[app-exchange] Error:", err);
      res.status(500).json({ error: "internal_error" });
    }
  });

  // ========================================
  // App OAuth bridge route (legacy fallback)
  // ========================================
  app.get("/api/oauth/app-return", (_req: Request, res: Response) => {
    console.log('[OAuth bridge] app-return fallback → com.mycoupon.app://auth/callback');
    res.redirect(302, 'com.mycoupon.app://auth/callback');
  });

  console.log('✅ [OAuth] Google OAuth + App Ticket Exchange active.');
}
