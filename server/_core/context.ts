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

// 비상 마스터 관리자 이메일 목록 (하드코딩)
const FALLBACK_MASTER_ADMIN_EMAILS = [
  'tnvjaosldka97@gmail.com',   // 마스터 관리자
  'sakuradaezun@gmail.com',    // 서버 관리자
  'onlyup.myr@gmail.com',      // 서버 관리자
  'mapo8887@gmail.com',        // 서버 관리자
];

/**
 * 🔒 JWT 기반 세션 검증 (Manus SDK 완전 제거)
 */
async function authenticateJWT(req: CreateExpressContextOptions["req"]): Promise<User | null> {
  try {
    // 1. 쿠키에서 세션 토큰 추출
    const cookieHeader = req.headers.cookie;
    if (!cookieHeader) return null;
    
    const cookies = parseCookieHeader(cookieHeader);
    const token = cookies[COOKIE_NAME];
    if (!token) return null;
    
    // 2. JWT 검증
    const secret = new TextEncoder().encode(ENV.cookieSecret || "default-secret-key");
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
    
    // 마스터 관리자 권한 주입
    const masterAdminEmails = ENV.masterAdminEmails.length > 0 
      ? ENV.masterAdminEmails 
      : FALLBACK_MASTER_ADMIN_EMAILS;
    
    if (user && user.email && masterAdminEmails.includes(user.email)) {
      user.role = 'admin';
      isAdmin = true;
      console.log(`[Auth] ⚡ EMERGENCY ADMIN: ${user.email}`);
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
