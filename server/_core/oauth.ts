import { COOKIE_NAME, ONE_YEAR_MS } from "@shared/const";
import type { Express, Request, Response } from "express";
import { SignJWT } from "jose";
import { randomBytes } from "crypto";
import { sql } from "drizzle-orm";
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
// App Login Ticket — DB 기반 영속 저장 (메모리 Map 제거)
//
// 이전 방식의 문제:
//   _appLoginTickets = new Map<...>()  ← 프로세스 메모리
//   Railway 재시작 or 멀티 인스턴스 시 → 다른 인스턴스가 ticket을 모름
//   → 간헐적 "ticket_invalid" 에러 → 로그인 실패
//
// 현재 방식:
//   PostgreSQL app_login_tickets 테이블 (영속)
//   - 모든 인스턴스가 동일 DB를 바라봄 → 일관성 보장
//   - UPDATE ... WHERE used = FALSE 원자 연산으로 1회용 보장
//   - Race condition 불가: PostgreSQL row-level locking
//
// 보안:
//   - ticket = 64자 hex (randomBytes(32)) → 추측 불가
//   - TTL 60초 → 탈취 후 재사용 불가
//   - 1회용: used=TRUE 설정 즉시 삭제 가능
//   - session_token을 URL에 노출하지 않고 ticket으로만 전달
// ══════════════════════════════════════════════════════════════════════════════

async function getDbConn() {
  const dbConn = await db.getDb();
  if (!dbConn) throw new Error('DB connection unavailable');
  return dbConn;
}

async function insertAppTicket(openId: string, sessionToken: string): Promise<string> {
  const ticket = randomBytes(32).toString("hex"); // 64자 hex, 추측 불가
  const dbConn = await getDbConn();
  // sql`` 태그 파라미터 바인딩 — 수동 escaping 없이 드라이버가 처리
  await dbConn.execute(
    sql`INSERT INTO app_login_tickets (ticket, open_id, session_token, expires_at)
        VALUES (${ticket}, ${openId}, ${sessionToken}, NOW() + INTERVAL '60 seconds')`
  );
  return ticket;
}

/**
 * ticket 검증 + 1회용 사용 처리 (원자적 UPDATE)
 * 성공 시 { openId, sessionToken } 반환, 실패 시 null 반환
 */
async function consumeAppTicket(ticket: string): Promise<{ openId: string; sessionToken: string } | null> {
  if (!ticket || typeof ticket !== 'string' || ticket.length > 128) return null;
  const dbConn = await getDbConn();

  // 원자적 UPDATE + sql`` 파라미터 바인딩
  // WHERE used=FALSE AND expires_at>NOW(): race condition 없이 1회만 성공
  const result = await dbConn.execute(
    sql`UPDATE app_login_tickets
        SET used = TRUE
        WHERE ticket = ${ticket}
          AND used = FALSE
          AND expires_at > NOW()
        RETURNING open_id, session_token`
  ) as any;

  const rows = result?.rows ?? [];
  if (rows.length === 0) return null;

  // 사용 완료 → 즉시 삭제 (민감 데이터 제거, 재사용 불가)
  await dbConn.execute(
    sql`DELETE FROM app_login_tickets WHERE ticket = ${ticket}`
  ).catch(() => {}); // 삭제 실패해도 used=TRUE이므로 재사용 불가

  return {
    openId: rows[0].open_id as string,
    sessionToken: rows[0].session_token as string,
  };
}

export function registerOAuthRoutes(app: Express) {
  // ========================================
  // Google OAuth 직접 연동
  // ========================================

  app.get("/api/oauth/google/login", async (req: Request, res: Response) => {
    try {
      const redirectUrl = getQueryParam(req, "redirect") || "/";
      const state = Buffer.from(redirectUrl).toString("base64");
      const redirectUri = ENV.googleOAuthRedirectUri;
      const authUrl = getGoogleAuthUrl(redirectUri, state);
      console.log(`[Google OAuth] Login initiated, isApp: ${redirectUrl === '_app_'}`);
      res.redirect(302, authUrl);
    } catch (error) {
      console.error("[Google OAuth] Login error:", error);
      res.redirect(302, "/?error=google_auth_failed");
    }
  });

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
      const googleUser = await authenticateWithGoogle(code, redirectUri);
      const openId = `google_${googleUser.id}`;

      if (!ENV.cookieSecret) {
        console.error('[OAuth] FATAL: JWT_SECRET is not set.');
        res.redirect(302, "/?error=server_config_error");
        return;
      }
      const secret = new TextEncoder().encode(ENV.cookieSecret);
      const sessionToken = await new SignJWT({
        openId,
        appId: ENV.appId || "",
        name: googleUser.name || "",
      })
        .setProtectedHeader({ alg: "HS256", typ: "JWT" })
        .setExpirationTime(Math.floor((Date.now() + ONE_YEAR_MS) / 1000))
        .sign(secret);

      await db.upsertUser({
        openId,
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
      } catch (_) { /* ignore */ }

      const isAppMode = decodedState === "_app_";

      // ── 앱 모드 (redirect=_app_) ──────────────────────────────────────────
      if (isAppMode) {
        if (signupCompleted) {
          // 기존 사용자: DB에 ticket 저장 → custom scheme redirect (쿠키 노출 없음)
          try {
            const ticket = await insertAppTicket(openId, sessionToken);
            console.log(`[OAuth app-ticket] 🎫 Ticket stored in DB for ${openId} (60s TTL)`);
            res.redirect(302, `com.mycoupon.app://auth/callback?ticket=${ticket}`);
          } catch (ticketErr) {
            console.error('[OAuth app-ticket] Failed to create ticket:', ticketErr);
            res.redirect(302, "/?error=ticket_creation_failed");
          }
          return;
        } else {
          // 신규/미동의 사용자: consent 필요 → Custom Tabs에서 진행, 쿠키 설정
          // mode=app 파라미터 추가 → 동의 완료 후 WebView 세션 주입을 위해 사용
          const cookieOptions = getSessionCookieOptions(req);
          res.cookie(COOKIE_NAME, sessionToken, { ...cookieOptions, maxAge: ONE_YEAR_MS });
          const next = encodeURIComponent('/');
          console.log(`[OAuth app-ticket] 신규/미동의 앱 사용자 → consent 리다이렉트 (mode=app)`);
          res.redirect(302, `/signup/consent?next=${next}&mode=app`);
          return;
        }
      }

      // ── 웹 모드: 기존 플로우 유지 (변경 없음) ─────────────────────────────
      const cookieOptions = getSessionCookieOptions(req);
      res.cookie(COOKIE_NAME, sessionToken, { ...cookieOptions, maxAge: ONE_YEAR_MS });

      let intendedUrl = "/";
      if (decodedState.startsWith("http") || decodedState.startsWith("/")) {
        try {
          const url = new URL(decodedState, "https://my-coupon-bridge.com");
          intendedUrl = url.pathname + url.search;
        } catch (_) { /* ignore */ }
      }

      if (!signupCompleted && !intendedUrl.startsWith('/signup')) {
        const next = encodeURIComponent(intendedUrl === '/' ? '/merchant/dashboard' : intendedUrl);
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
  // 앱 WebView 컨텍스트에서 fetch() credentials:'include' 로 호출.
  // 서버가 응답 Set-Cookie로 WebView 쿠키 저장소에 직접 세션 설정.
  // Chrome Custom Tabs 쿠키와 완전히 독립적으로 WebView 세션 확립.
  app.post("/api/oauth/app-exchange", async (req: Request, res: Response) => {
    try {
      const { ticket } = req.body as { ticket?: unknown };

      if (!ticket || typeof ticket !== "string") {
        console.warn("[app-exchange] ticket 파라미터 없음 또는 잘못된 타입");
        res.status(400).json({ error: "ticket_required" });
        return;
      }

      // 원자적 소비: 유효성 + TTL + 1회용을 DB에서 단일 UPDATE로 처리
      const ticketData = await consumeAppTicket(ticket);

      if (!ticketData) {
        console.warn("[app-exchange] ticket 유효하지 않음 (없음/만료/이미 사용됨)");
        res.status(401).json({ error: "ticket_invalid" });
        return;
      }

      // WebView 쿠키 저장소에 세션 쿠키 설정
      // 이 요청은 앱 WebView의 fetch()에서 오므로 Set-Cookie가 WebView 저장소에 저장됨
      const cookieOptions = getSessionCookieOptions(req);
      res.cookie(COOKIE_NAME, ticketData.sessionToken, { ...cookieOptions, maxAge: ONE_YEAR_MS });

      console.log(`[app-exchange] ✅ Session cookie SET in WebView for openId: ${ticketData.openId}`);
      res.json({ success: true });
    } catch (err) {
      console.error("[app-exchange] Error:", err);
      res.status(500).json({ error: "internal_error" });
    }
  });

  // ========================================
  // App Consent Complete: Session → Ticket
  // ========================================
  // 동의(consent)가 Custom Tabs에서 완료된 후, WebView에 세션을 주입하기 위한 엔드포인트.
  //
  // 문제:
  //   앱 모드 신규/미동의 유저 → Custom Tabs에서 동의 완료 → 세션 쿠키가 Custom Tabs에만 존재
  //   → WebView는 쿠키 없음 → auth.me = null → 로그인 안 된 것처럼 보임
  //
  // 해결:
  //   동의 완료 후 이 엔드포인트로 리다이렉트
  //   → 현재 Custom Tabs 세션 쿠키 검증 → 티켓 발급 → 딥링크로 WebView에 티켓 전달
  //   → useAuth.ts의 appUrlOpen 핸들러 → /api/oauth/app-exchange → WebView 쿠키 설정
  app.get("/api/auth/app-ticket-from-session", async (req: Request, res: Response) => {
    try {
      const { jwtVerify } = await import('jose');
      const { parse: parseCookieHeader } = await import('cookie');

      const cookieHeader = req.headers.cookie || '';
      const cookies = parseCookieHeader(cookieHeader);
      const token = cookies[COOKIE_NAME];

      if (!token || !ENV.cookieSecret) {
        console.warn('[app-ticket-from-session] 세션 없음 또는 JWT_SECRET 미설정');
        res.redirect(302, '/?error=not_authenticated');
        return;
      }

      const secret = new TextEncoder().encode(ENV.cookieSecret);
      const { payload } = await jwtVerify(token, secret);
      const openId = payload.openId as string | undefined;

      if (!openId) {
        console.warn('[app-ticket-from-session] JWT payload에 openId 없음');
        res.redirect(302, '/?error=invalid_session');
        return;
      }

      // DB에서 유저 확인 + signupCompletedAt 검증
      const dbUser = await db.getUserByOpenId(openId);
      if (!dbUser) {
        console.warn(`[app-ticket-from-session] 유저 없음: ${openId}`);
        res.redirect(302, '/?error=user_not_found');
        return;
      }

      if (!(dbUser as any).signupCompletedAt) {
        console.warn(`[app-ticket-from-session] 동의 미완료 유저: ${openId}`);
        res.redirect(302, '/signup/consent?next=/&mode=app');
        return;
      }

      // 티켓 발급 → WebView deeplink
      const ticket = await insertAppTicket(openId, token);
      console.log(`[app-ticket-from-session] ✅ 티켓 발급 완료 → WebView 세션 주입: ${openId}`);
      res.redirect(302, `com.mycoupon.app://auth/callback?ticket=${ticket}`);
    } catch (err) {
      console.error('[app-ticket-from-session] Error:', err);
      res.redirect(302, '/?error=ticket_error');
    }
  });

  // Legacy bridge fallback
  app.get("/api/oauth/app-return", (_req: Request, res: Response) => {
    res.redirect(302, 'com.mycoupon.app://auth/callback');
  });

  console.log('✅ [OAuth] Google OAuth + App Ticket Exchange (DB-backed) active.');
}
