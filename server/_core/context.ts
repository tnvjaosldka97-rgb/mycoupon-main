import type { CreateExpressContextOptions } from "@trpc/server/adapters/express";
import type { User } from "../../drizzle/schema";
import { ENV } from "./env";
import { jwtVerify } from "jose";
import { parse as parseCookieHeader } from "cookie";
import { COOKIE_NAME } from "@shared/const";
import * as db from "../db";

export type TrpcContext = {
  req: CreateExpressContextOptions["req"];
  res: CreateExpressContextOptions["res"];
  user: User | null;
  isAdmin: boolean;
  // PR-32 (2026-05-01): JWT 토큰 블랙리스트 — auth.logout 에서 INSERT 시 사용
  sessionJti: string | null;
  sessionExp: Date | null;
};

// 마스터 관리자 이메일 allowlist
// 하드코딩 + Railway 환경변수 MASTER_ADMIN_EMAILS 의 UNION (합집합).
// 하드코딩 목록은 영구 admin, 환경변수는 추가적으로만 작용 (override 아님).
// → env 에 누락된 하드코딩 admin 이 요청 시 권한 박탈되는 사고 방지.
const HARDCODED_ADMIN_EMAILS = [
  'tnvjaosldka97@gmail.com',
  'mycoupon.official@gmail.com',
];
const MASTER_ADMIN_ALLOWLIST: string[] = Array.from(
  new Set<string>([...HARDCODED_ADMIN_EMAILS, ...ENV.masterAdminEmails])
);

/**
 * 🔒 JWT 기반 세션 검증 (Manus SDK 완전 제거)
 * PR-32: jti(blacklist 검증) + exp 보존 (auth.logout INSERT 용)
 */
async function authenticateJWT(req: CreateExpressContextOptions["req"]): Promise<{
  user: User;
  jti: string | null;
  exp: Date | null;
} | null> {
  try {
    // 1. 쿠키에서 세션 토큰 추출
    const cookieHeader = req.headers.cookie;

    // [DIAG-B] auth.me 요청 수신 시 cookie 헤더 존재 여부
    const trpcPath = (req.query?.['0']?.toString() ?? '') || req.url;
    const isMeQuery = trpcPath.includes('auth.me') || trpcPath.includes('auth,me');
    if (isMeQuery) {
      console.log(`[Auth] auth.me — cookie: ${!!cookieHeader}, has_session: ${cookieHeader?.includes(COOKIE_NAME) ?? false}, origin: ${req.headers['origin'] ?? 'none'}`);
    }

    if (!cookieHeader) return null;

    const cookies = parseCookieHeader(cookieHeader);
    const token = cookies[COOKIE_NAME];
    if (!token) return null;

    // 2. JWT 검증
    // 🚨 SEC-002: hardcoded fallback 제거 — JWT_SECRET 미설정 시 인증 거부
    if (!ENV.cookieSecret) {
      console.error('[Auth] FATAL: JWT_SECRET is not configured. All authentication rejected.');
      return null;
    }
    const secret = new TextEncoder().encode(ENV.cookieSecret);
    const { payload } = await jwtVerify(token, secret);

    if (!payload.openId || typeof payload.openId !== 'string') {
      console.warn('[Auth] Invalid JWT payload: openId missing');
      return null;
    }

    // PR-32: token_blacklist 조회 — jti 있으면 검증, 없으면 skip (PR-32 production 적용 전 발급된 옛 토큰)
    // 옛 토큰은 JWT_SECRET rotation 으로 강제 invalidate (사장님 결정 (다))
    const jti = typeof payload.jti === 'string' ? payload.jti : null;
    if (jti) {
      const blacklisted = await db.isTokenBlacklisted(jti);
      if (blacklisted) {
        console.warn(`[Auth] Token blacklisted: jti=${jti.slice(0, 8)}...`);
        return null;
      }
    }

    // 3. DB에서 사용자 조회
    const user = await db.getUserByOpenId(payload.openId);
    if (!user) {
      console.warn(`[Auth] User not found in DB: ${payload.openId}`);
      return null;
    }

    const exp = typeof payload.exp === 'number' ? new Date(payload.exp * 1000) : null;
    return { user, jti, exp };
  } catch (error) {
    console.error('[Auth] JWT verification failed:', error);
    return null;
  }
}

export async function createContext(
  opts: CreateExpressContextOptions
): Promise<TrpcContext> {
  let user: User | null = null;
  let isAdmin = false;
  let sessionJti: string | null = null;
  let sessionExp: Date | null = null;

  try {
    // 🚨 CRITICAL FIX: Manus SDK 제거, JWT 직접 검증
    const authResult = await authenticateJWT(opts.req);
    if (authResult) {
      user = authResult.user;
      sessionJti = authResult.jti;
      sessionExp = authResult.exp;
    }

    // 마스터 관리자 allowlist 기반 권한 주입
    if (user && user.email && MASTER_ADMIN_ALLOWLIST.includes(user.email)) {
      user.role = 'admin';
      isAdmin = true;
      console.log(`[Auth] ✅ MASTER ADMIN: ${user.email}`);
    } else if (user && user.role === 'admin') {
      // DB에 admin role이 남아있어도 allowlist 외 계정은 강등
      user.role = 'user';
      console.warn(`[Auth] ⛔ Admin role revoked for non-allowlisted: ${user.email}`);
    }
  } catch (error) {
    user = null;
  }

  return {
    req: opts.req,
    res: opts.res,
    user,
    isAdmin,
    sessionJti,
    sessionExp,
  };
}
