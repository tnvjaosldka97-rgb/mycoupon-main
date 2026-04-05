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
};

// 슈퍼어드민 이메일 — 단 1개만 허용 (절대 변경 금지)
// 이 목록 외 어떤 계정도 admin 권한을 가질 수 없음
const SUPER_ADMIN_EMAIL = 'tnvjaosldka97@gmail.com';
const FALLBACK_MASTER_ADMIN_EMAILS = [SUPER_ADMIN_EMAIL];

/**
 * 🔒 JWT 기반 세션 검증 (Manus SDK 완전 제거)
 */
async function authenticateJWT(req: CreateExpressContextOptions["req"]): Promise<User | null> {
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
    
    // 3. DB에서 사용자 조회
    const user = await db.getUserByOpenId(payload.openId);
    if (!user) {
      console.warn(`[Auth] User not found in DB: ${payload.openId}`);
      return null;
    }
    
    return user;
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

  try {
    // 🚨 CRITICAL FIX: Manus SDK 제거, JWT 직접 검증
    user = await authenticateJWT(opts.req);
    
    // 슈퍼어드민 권한 주입 — 단 1개 이메일만 허용 (ENV 우선이지만 allowlist 강제 교차 검증)
    // ENV.masterAdminEmails가 있더라도 SUPER_ADMIN_EMAIL이 포함된 경우만 인정
    if (user && user.email && user.email === SUPER_ADMIN_EMAIL) {
      user.role = 'admin';
      isAdmin = true;
      console.log(`[Auth] ✅ SUPER ADMIN: ${user.email}`);
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
  };
}
