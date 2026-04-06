import { COOKIE_NAME, ONE_YEAR_MS } from "@shared/const";
import type { Express, Request, Response } from "express";
import { SignJWT, createRemoteJWKSet } from "jose";
import { randomBytes } from "crypto";
import { sql } from "drizzle-orm";
import * as db from "../db";
import { getSessionCookieOptions, getSessionClearOptions } from "./cookies";
import { getGoogleAuthUrl, authenticateWithGoogle } from "./googleOAuth";
import { ENV } from "./env";

// ── Deep Link Bridge Helper ───────────────────────────────────────────────────
// Chrome Custom Tabs에서 서버 302 → custom scheme redirect는 Android/Chrome 버전에 따라
// 차단될 수 있다. JS redirect (window.location.replace)는 항상 허용된다.
// 이 helper는 custom scheme으로 이동하는 HTML 브리지 페이지를 반환한다.
function sendDeepLinkBridge(res: Response, deepLinkUrl: string): void {
  // [STEP-1] 브리지 페이지 전송 — 이 로그가 찍히면 서버가 브리지 페이지를 반환한 것
  const preview = deepLinkUrl.replace(/ticket=[^&]+/, 'ticket=***');
  console.log(`[STEP-1] 🌉 Bridge page sent → ${preview}`);

  // intent:// URI 변환:
  //   com.mycoupon.app://auth/callback?ticket=XXX
  //   → intent://auth/callback?ticket=XXX#Intent;scheme=com.mycoupon.app;package=com.mycoupon.app;end
  //
  // Chrome Custom Tabs는 custom scheme (com.xxx://) JS redirect를 차단할 수 있지만
  // intent:// URI는 Android 앱 연결을 위한 Chrome 공식 지원 포맷이므로 항상 처리된다.
  // S.browser_fallback_url: 앱 미설치 시 fallback
  let intentUrl = deepLinkUrl;
  if (deepLinkUrl.startsWith('com.mycoupon.app://')) {
    const path = deepLinkUrl.slice('com.mycoupon.app://'.length);
    const fallback = encodeURIComponent('https://my-coupon-bridge.com');
    intentUrl = `intent://${path}#Intent;scheme=com.mycoupon.app;package=com.mycoupon.app;S.browser_fallback_url=${fallback};end`;
  }

  // XSS-safe: JSON.stringify는 따옴표/슬래시를 안전하게 이스케이프
  const escapedIntent = JSON.stringify(intentUrl);
  const escapedOriginal = JSON.stringify(deepLinkUrl);

  // href에 사용할 HTML-safe 버전
  const hrefSafe = intentUrl.replace(/&/g, '&amp;').replace(/"/g, '&quot;');

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.send(`<!DOCTYPE html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>마이쿠폰</title>
<script>
(function(){
  // 1차: intent:// (Chrome Custom Tabs 공식 앱 연결 방식)
  try { window.location.replace(${escapedIntent}); return; } catch(e1){}
  // 2차: 원본 custom scheme fallback
  try { window.location.replace(${escapedOriginal}); } catch(e2){}
})();
</script>
</head><body style="background:#fff5f0;display:flex;flex-direction:column;align-items:center;justify-content:center;height:100vh;margin:0;font-family:sans-serif;color:#f97316;gap:16px">
<img src="https://my-coupon-bridge.com/logo-bear-nobg.png" style="width:64px;height:64px" alt="">
<p style="margin:0;font-size:17px;font-weight:600">마이쿠폰 앱을 여는 중...</p>
<a href="${hrefSafe}" style="margin-top:8px;font-size:13px;color:#9ca3af;text-decoration:underline">앱이 열리지 않으면 여기를 탭하세요</a>
</body></html>`);
}

// ── Google JWKS (모듈 레벨 캐시) ──────────────────────────────────────────────
// createRemoteJWKSet은 호출 시 키를 지연 로딩하고 내부적으로 캐싱함.
// 모듈 레벨에서 1회만 생성해 HTTPS 요청 횟수를 최소화.
const _googleJwks = createRemoteJWKSet(
  new URL('https://www.googleapis.com/oauth2/v3/certs')
);

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

// ══════════════════════════════════════════════════════════════════════════════
// 인메모리 레이트 리미터 — /api/oauth/app-exchange 브루트포스 차단
// 외부 패키지 없이 구현. 창 크기 60초 (ticket TTL과 동일), IP당 최대 5회.
// Railway 멀티 인스턴스 환경: 인스턴스별 독립 카운터 (수용 가능한 근사치).
// ══════════════════════════════════════════════════════════════════════════════
const _exchangeAttempts = new Map<string, { count: number; resetAt: number }>();

function checkExchangeRateLimit(ip: string): boolean {
  const now = Date.now();
  const WINDOW_MS = 60_000; // 60초
  const MAX_ATTEMPTS = 5;
  const record = _exchangeAttempts.get(ip);
  if (!record || now > record.resetAt) {
    _exchangeAttempts.set(ip, { count: 1, resetAt: now + WINDOW_MS });
    return true;
  }
  if (record.count >= MAX_ATTEMPTS) return false;
  record.count++;
  return true;
}

// 만료된 레이트리밋 항목 주기적 정리 (메모리 누수 방지)
setInterval(() => {
  const now = Date.now();
  _exchangeAttempts.forEach((record, ip) => {
    if (now > record.resetAt) _exchangeAttempts.delete(ip);
  });
}, 5 * 60_000); // 5분마다

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
            sendDeepLinkBridge(res, `com.mycoupon.app://auth/callback?ticket=${ticket}`);
          } catch (ticketErr) {
            console.error('[OAuth app-ticket] Failed to create ticket:', ticketErr);
            res.redirect(302, "/?error=ticket_creation_failed");
          }
          return;
        } else {
          // 신규/미동의 사용자: consent 필요 → Custom Tabs에서 진행, 쿠키 설정
          // mode=app 파라미터 추가 → 동의 완료 후 WebView 세션 주입을 위해 사용
          // 앱 모드 신규/미동의 — native: sameSite:none
          const cookieOptions = getSessionCookieOptions('native');
          res.cookie(COOKIE_NAME, sessionToken, { ...cookieOptions, maxAge: ONE_YEAR_MS });
          const next = encodeURIComponent('/');
          console.log(`[OAuth app-ticket] 신규/미동의 앱 사용자 → consent 리다이렉트 (mode=app)`);
          res.redirect(302, `/signup/consent?next=${next}&mode=app`);
          return;
        }
      }

      // ── 웹 모드: sameSite:lax 유지 ────────────────────────────────────────
      const cookieOptions = getSessionCookieOptions('web');
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
      // 레이트리밋: IP당 60초 내 5회 초과 시 차단
      const clientIp = (req.ip ?? req.socket?.remoteAddress ?? 'unknown').replace('::ffff:', '');
      if (!checkExchangeRateLimit(clientIp)) {
        console.warn(`[app-exchange] 레이트리밋 초과 — IP: ${clientIp}`);
        res.status(429).json({ error: "too_many_requests" });
        return;
      }

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
      // app-exchange는 앱 WebView fetch() 전용 — forceNative:true로 sameSite:none 보장
      // app-exchange: 앱 WebView fetch() 전용 — native: sameSite:none
      const cookieOptions = getSessionCookieOptions('native');
      res.cookie(COOKIE_NAME, ticketData.sessionToken, { ...cookieOptions, maxAge: ONE_YEAR_MS });

      // [DIAG-A] Set-Cookie 발급 확인 로그 — sameSite:none / secure:true 이어야 정상
      console.log(`[app-exchange] ✅ Set-Cookie issued — openId: ${ticketData.openId}, sameSite: ${cookieOptions.sameSite}, secure: ${cookieOptions.secure}`);
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

      // 티켓 발급 → WebView deeplink (JS bridge — 302 custom scheme은 Chrome에서 차단될 수 있음)
      const ticket = await insertAppTicket(openId, token);
      console.log(`[app-ticket-from-session] ✅ 티켓 발급 완료 → WebView 세션 주입: ${openId}`);
      sendDeepLinkBridge(res, `com.mycoupon.app://auth/callback?ticket=${ticket}`);
    } catch (err) {
      console.error('[app-ticket-from-session] Error:', err);
      res.redirect(302, '/?error=ticket_error');
    }
  });

  // Legacy bridge fallback (ticket 없이 복귀 — browserFinished fallback 경로)
  app.get("/api/oauth/app-return", (_req: Request, res: Response) => {
    sendDeepLinkBridge(res, 'com.mycoupon.app://auth/callback');
  });

  // ========================================
  // Native App Google Login (Option B)
  // ========================================
  //
  // 흐름:
  //   Android 앱 → 네이티브 Google Sign-In → idToken 획득
  //   → POST /api/oauth/google/native { idToken }
  //   → 서버: Google JWKS로 idToken 검증
  //   → sub 추출 → openId = "google_${sub}"  ← 웹 OAuth와 동일 포맷 보장
  //   → 기존 upsertUser() / getUserByOpenId() 그대로 재사용
  //   → 기존 JWT 세션 발급 그대로 재사용
  //   → WebView Set-Cookie
  //
  // DB 무결성 보장 근거:
  //   - openId = "google_${sub}" = "google_${googleUser.id}" (웹 OAuth와 동일)
  //   - upsertUser → ON CONFLICT (open_id) DO UPDATE → 중복 row 생성 불가
  //   - users.id / roles / stores.ownerId 등 기존 FK 영향 없음
  //
  // 신규/미동의 유저:
  //   - needsConsent: true 응답 + 세션 쿠키 설정
  //   - 앱은 /signup/consent?next=%2F&mode=app 으로 이동
  //   - 동의 완료 후 기존 /api/auth/app-ticket-from-session → deeplink → ticket exchange 경로 재사용
  app.post("/api/oauth/google/native", async (req: Request, res: Response) => {
    // ── 레이트리밋: 기존 exchange 리미터 재사용 (IP당 60초 내 5회) ──────────
    const clientIp = (req.ip ?? req.socket?.remoteAddress ?? 'unknown').replace('::ffff:', '');
    if (!checkExchangeRateLimit(clientIp)) {
      console.warn(`[native-login] 레이트리밋 초과 — IP: ${clientIp}`);
      res.status(429).json({ error: "too_many_requests" });
      return;
    }

    // ── 입력 검증 ────────────────────────────────────────────────────────────
    const { idToken } = req.body as { idToken?: unknown };
    if (!idToken || typeof idToken !== 'string' || idToken.length > 4096) {
      console.warn('[native-login] idToken 파라미터 없음 또는 잘못된 타입/길이');
      res.status(400).json({ error: "id_token_required" });
      return;
    }

    if (!ENV.cookieSecret) {
      console.error('[native-login] FATAL: JWT_SECRET 미설정');
      res.status(500).json({ error: "server_config_error" });
      return;
    }

    if (!ENV.googleClientId) {
      console.error('[native-login] FATAL: GOOGLE_CLIENT_ID 미설정');
      res.status(500).json({ error: "server_config_error" });
      return;
    }

    try {
      // ── Google idToken 검증 (JWKS 서명 + issuer + audience) ───────────────
      // audience: ENV.googleClientId (웹 클라이언트 ID)
      //   → Codetrix 플러그인에서 serverClientId 로 동일 값을 지정해야 함
      //   → Android 클라이언트 ID를 serverClientId 로 쓰면 aud 불일치 → 401
      const { jwtVerify } = await import('jose');
      const { payload } = await jwtVerify(idToken, _googleJwks, {
        issuer: ['https://accounts.google.com', 'accounts.google.com'],
        audience: ENV.googleClientId,
      });

      const sub = payload.sub;
      if (!sub) {
        console.warn('[native-login] idToken payload에 sub 없음');
        res.status(401).json({ error: "invalid_token_no_sub" });
        return;
      }

      const email = typeof payload.email === 'string' ? payload.email : null;
      const name  = typeof payload.name  === 'string' ? payload.name  : null;

      // ── CRITICAL: openId 포맷을 웹 OAuth와 동일하게 유지 ─────────────────
      // 웹 OAuth:   openId = `google_${googleUser.id}`  (googleUser.id === sub)
      // 네이티브:   openId = `google_${sub}`
      // → 동일 포맷 → 기존 user row를 그대로 재사용함
      const openId = `google_${sub}`;

      // ── 기존 upsertUser 재사용 ────────────────────────────────────────────
      // ON CONFLICT (open_id) DO UPDATE → 기존 유저 row 재사용, 중복 생성 없음
      // users.id / role / stores.ownerId / subscriptions 등 변경 없음
      await db.upsertUser({
        openId,
        name,
        email,
        loginMethod: "google",
        lastSignedIn: new Date(),
      });

      // ── 기존 getUserByOpenId 재사용 ──────────────────────────────────────
      const dbUser = await db.getUserByOpenId(openId);
      const signupCompleted = !!(dbUser as any)?.signupCompletedAt;

      // ── 기존 JWT 세션 발급 로직 그대로 재사용 ────────────────────────────
      const secret = new TextEncoder().encode(ENV.cookieSecret);
      const sessionToken = await new SignJWT({
        openId,
        appId: ENV.appId || "",
        name: name || "",
      })
        .setProtectedHeader({ alg: "HS256", typ: "JWT" })
        .setExpirationTime(Math.floor((Date.now() + ONE_YEAR_MS) / 1000))
        .sign(secret);

      // /api/oauth/google/native: 앱 전용 — native: sameSite:none
      const cookieOptions = getSessionCookieOptions('native');
      res.cookie(COOKIE_NAME, sessionToken, { ...cookieOptions, maxAge: ONE_YEAR_MS });

      if (!signupCompleted) {
        // 신규/미동의: 세션 쿠키는 이미 설정됨
        // 앱은 /signup/consent?next=%2F&mode=app 으로 이동
        // 동의 완료 후 기존 /api/auth/app-ticket-from-session 경로 재사용
        console.log(`[native-login] 신규/미동의 유저 → needsConsent: true | openId: ${openId}`);
        res.json({ success: true, needsConsent: true });
        return;
      }

      console.log(`[native-login] ✅ 로그인 성공 | openId: ${openId}`);
      res.json({ success: true, needsConsent: false });

    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);

      // JWT 검증 실패 (서명 불일치 / 만료 / issuer 불일치 / audience 불일치)
      const isVerificationError =
        msg.includes('JWTExpired') ||
        msg.includes('JWSSignatureVerificationFailed') ||
        msg.includes('JWTClaimValidationFailed') ||
        msg.includes('JWSInvalid') ||
        msg.includes('unexpected');

      if (isVerificationError) {
        console.warn('[native-login] idToken 검증 실패:', msg);
        res.status(401).json({ error: "token_verification_failed" });
        return;
      }

      console.error('[native-login] 서버 오류:', err);
      res.status(500).json({ error: "internal_error" });
    }
  });

  console.log('✅ [OAuth] Google OAuth + App Ticket Exchange (DB-backed) active.');
}
