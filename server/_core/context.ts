import type { CreateExpressContextOptions } from "@trpc/server/adapters/express";
import type { User } from "../../drizzle/schema";
import { sdk } from "./sdk";
import { ENV } from "./env";

export type TrpcContext = {
  req: CreateExpressContextOptions["req"];
  res: CreateExpressContextOptions["res"];
  user: User | null;
  isAdmin: boolean; // 비상 관리자 플래그 추가
};

// 비상 마스터 관리자 이메일 목록 (하드코딩) - 4명만 유지
// ENV.masterAdminEmails가 비어있을 경우 폴백으로 사용
const FALLBACK_MASTER_ADMIN_EMAILS = [
  'tnvjaosldka97@gmail.com',   // 마스터 관리자
  'sakuradaezun@gmail.com',    // 서버 관리자 (임시)
  'onlyup.myr@gmail.com',      // 서버 관리자 (임시)
  'mapo8887@gmail.com',        // 서버 관리자 (임시)
];

export async function createContext(
  opts: CreateExpressContextOptions
): Promise<TrpcContext> {
  let user: User | null = null;
  let isAdmin = false;

  try {
    user = await sdk.authenticateRequest(opts.req);
    
    // 마스터 관리자 이메일 목록 (ENV에서 가져오거나 폴백 사용)
    const masterAdminEmails = ENV.masterAdminEmails.length > 0 
      ? ENV.masterAdminEmails 
      : FALLBACK_MASTER_ADMIN_EMAILS;
    
    // 비상 관리자 권한 주입: DB 상태나 세션에 관계없이 무조건 admin 권한 부여
    if (user && user.email && masterAdminEmails.includes(user.email)) {
      user.role = 'admin';
      isAdmin = true;
      console.log(`[Auth] ⚡ EMERGENCY ADMIN: ${user.email} - role forced to admin`);
    }
  } catch (error) {
    // Authentication is optional for public procedures.
    user = null;
  }

  return {
    req: opts.req,
    res: opts.res,
    user,
    isAdmin,
  };
}
