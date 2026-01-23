import { publicProcedure, protectedProcedure, router } from "../_core/trpc";
import { z } from "zod";
import * as db from "../db";
import { TRPCError } from "@trpc/server";

/**
 * 배포/운영 안정성 관련 API
 * - 앱 버전 체크 (하드/소프트 업데이트)
 * - 설치 퍼널 이벤트 로깅
 * - 긴급 공지 배너
 * - 클라이언트 에러 로깅
 */

// 관리자 전용 프로시저
const adminProcedure = protectedProcedure.use(({ ctx, next }) => {
  if (ctx.user.role !== "admin") {
    throw new TRPCError({ code: "FORBIDDEN", message: "Admin access required" });
  }
  return next({ ctx });
});

export const deploymentRouter = router({
  // ==================== 앱 버전 관리 ====================
  
  /**
   * 클라이언트 버전 체크
   * - 하드 블록: 최소 버전보다 낮으면 사용 차단
   * - 소프트 블록: 권장 버전보다 낮으면 경고 표시
   */
  checkVersion: publicProcedure
    .input(
      z.object({
        clientVersion: z.string(),
        deviceType: z.string().optional(),
        browserType: z.string().optional(),
      })
    )
    .query(async ({ input }) => {
      const activeVersion = await db.getActiveAppVersion();
      
      if (!activeVersion) {
        // 기본값 반환
        return {
          updateMode: "none" as const,
          updateMessage: null,
          updateUrl: null,
          currentVersion: input.clientVersion,
          minVersion: "1.0.0",
          recommendedVersion: "1.0.0",
        };
      }

      const clientVer = parseVersion(input.clientVersion);
      const minVer = parseVersion(activeVersion.minVersion);
      const recommendedVer = parseVersion(activeVersion.recommendedVersion);

      // 하드 블록: 최소 버전보다 낮으면 사용 차단
      if (compareVersions(clientVer, minVer) < 0) {
        return {
          updateMode: "hard" as const,
          updateMessage: activeVersion.updateMessage || "필수 업데이트가 필요합니다. 앱을 업데이트해주세요.",
          updateUrl: activeVersion.updateUrl,
          currentVersion: activeVersion.version,
          minVersion: activeVersion.minVersion,
          recommendedVersion: activeVersion.recommendedVersion,
        };
      }

      // 소프트 블록: 권장 버전보다 낮으면 경고 표시
      if (compareVersions(clientVer, recommendedVer) < 0) {
        return {
          updateMode: "soft" as const,
          updateMessage: activeVersion.updateMessage || "새로운 버전이 있습니다. 업데이트를 권장합니다.",
          updateUrl: activeVersion.updateUrl,
          currentVersion: activeVersion.version,
          minVersion: activeVersion.minVersion,
          recommendedVersion: activeVersion.recommendedVersion,
        };
      }

      return {
        updateMode: "none" as const,
        updateMessage: null,
        updateUrl: null,
        currentVersion: activeVersion.version,
        minVersion: activeVersion.minVersion,
        recommendedVersion: activeVersion.recommendedVersion,
      };
    }),

  /**
   * 앱 버전 설정 업데이트 (관리자 전용)
   */
  updateAppVersion: adminProcedure
    .input(
      z.object({
        version: z.string(),
        minVersion: z.string(),
        recommendedVersion: z.string(),
        updateMode: z.enum(["none", "soft", "hard"]),
        updateMessage: z.string().optional(),
        updateUrl: z.string().optional(),
      })
    )
    .mutation(async ({ input }) => {
      await db.upsertAppVersion(input);
      return { success: true };
    }),

  // ==================== 설치 퍼널 이벤트 ====================

  /**
   * 설치 퍼널 이벤트 로깅
   * - landing_view, install_cta_view, install_cta_click, appinstalled, first_open_standalone, login_complete
   */
  logInstallEvent: publicProcedure
    .input(
      z.object({
        sessionId: z.string(),
        eventType: z.enum([
          "landing_view",
          "install_cta_view",
          "install_cta_click",
          "appinstalled",
          "first_open_standalone",
          "login_complete",
        ]),
        deviceType: z.string().optional(),
        browserType: z.string().optional(),
        osVersion: z.string().optional(),
        appVersion: z.string().optional(),
        referrer: z.string().optional(),
        metadata: z.record(z.string(), z.any()).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      await db.logInstallFunnelEvent({
        ...input,
        userId: ctx.user?.id,
        metadata: input.metadata ? JSON.stringify(input.metadata) : null,
      });
      return { success: true };
    }),

  /**
   * 설치 퍼널 통계 조회 (관리자 전용)
   */
  getInstallFunnelStats: adminProcedure
    .input(
      z.object({
        startDate: z.string().optional(),
        endDate: z.string().optional(),
      })
    )
    .query(async ({ input }) => {
      return await db.getInstallFunnelStats(input.startDate, input.endDate);
    }),

  // ==================== 긴급 공지 배너 ====================

  /**
   * 활성 배너 조회 (클라이언트용)
   */
  getActiveBanners: publicProcedure
    .input(
      z.object({
        appVersion: z.string().optional(),
        browserType: z.string().optional(),
        osType: z.string().optional(),
      })
    )
    .query(async ({ input }) => {
      return await db.getActiveBanners(input);
    }),

  /**
   * 배너 상호작용 로깅 (노출/클릭/닫기)
   */
  logBannerInteraction: publicProcedure
    .input(
      z.object({
        bannerId: z.number(),
        sessionId: z.string(),
        interactionType: z.enum(["view", "click", "dismiss"]),
      })
    )
    .mutation(async ({ ctx, input }) => {
      await db.logBannerInteraction({
        ...input,
        userId: ctx.user?.id,
      });
      return { success: true };
    }),

  /**
   * 배너 생성 (관리자 전용)
   */
  createBanner: adminProcedure
    .input(
      z.object({
        title: z.string(),
        content: z.string(),
        type: z.enum(["info", "warning", "error", "maintenance"]),
        priority: z.number().default(0),
        linkUrl: z.string().optional(),
        linkText: z.string().optional(),
        targetVersions: z.array(z.string()).optional(),
        targetBrowsers: z.array(z.string()).optional(),
        targetOS: z.array(z.string()).optional(),
        startDate: z.string().optional(),
        endDate: z.string().optional(),
      })
    )
    .mutation(async ({ input }) => {
      await db.createEmergencyBanner({
        ...input,
        targetVersions: input.targetVersions ? JSON.stringify(input.targetVersions) : null,
        targetBrowsers: input.targetBrowsers ? JSON.stringify(input.targetBrowsers) : null,
        targetOS: input.targetOS ? JSON.stringify(input.targetOS) : null,
      });
      return { success: true };
    }),

  /**
   * 배너 목록 조회 (관리자 전용)
   */
  listBanners: adminProcedure.query(async () => {
    return await db.getAllBanners();
  }),

  /**
   * 배너 업데이트 (관리자 전용)
   */
  updateBanner: adminProcedure
    .input(
      z.object({
        id: z.number(),
        title: z.string().optional(),
        content: z.string().optional(),
        type: z.enum(["info", "warning", "error", "maintenance"]).optional(),
        priority: z.number().optional(),
        linkUrl: z.string().optional(),
        linkText: z.string().optional(),
        isActive: z.boolean().optional(),
        targetVersions: z.array(z.string()).optional(),
        targetBrowsers: z.array(z.string()).optional(),
        targetOS: z.array(z.string()).optional(),
        startDate: z.string().optional(),
        endDate: z.string().optional(),
      })
    )
    .mutation(async ({ input }) => {
      await db.updateEmergencyBanner(input.id, {
        ...input,
        targetVersions: input.targetVersions ? JSON.stringify(input.targetVersions) : undefined,
        targetBrowsers: input.targetBrowsers ? JSON.stringify(input.targetBrowsers) : undefined,
        targetOS: input.targetOS ? JSON.stringify(input.targetOS) : undefined,
      });
      return { success: true };
    }),

  /**
   * 배너 삭제 (관리자 전용)
   */
  deleteBanner: adminProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      await db.deleteEmergencyBanner(input.id);
      return { success: true };
    }),

  // ==================== 클라이언트 에러 로깅 ====================

  /**
   * 클라이언트 에러 로깅
   */
  logError: publicProcedure
    .input(
      z.object({
        sessionId: z.string(),
        appVersion: z.string(),
        errorType: z.enum(["js_error", "promise_rejection", "api_failure", "network_error"]),
        errorMessage: z.string(),
        errorStack: z.string().optional(),
        url: z.string().optional(),
        userAgent: z.string().optional(),
        deviceType: z.string().optional(),
        browserType: z.string().optional(),
        osVersion: z.string().optional(),
        metadata: z.record(z.string(), z.any()).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      await db.logClientError({
        ...input,
        userId: ctx.user?.id,
        errorStack: input.errorStack || null,
        url: input.url || null,
        userAgent: input.userAgent || null,
        deviceType: input.deviceType || null,
        browserType: input.browserType || null,
        osVersion: input.osVersion || null,
        metadata: input.metadata ? JSON.stringify(input.metadata) : null,
      });
      return { success: true };
    }),

  /**
   * 에러 통계 조회 (관리자 전용)
   */
  getErrorStats: adminProcedure
    .input(
      z.object({
        startDate: z.string().optional(),
        endDate: z.string().optional(),
        appVersion: z.string().optional(),
        errorType: z.string().optional(),
      })
    )
    .query(async ({ input }) => {
      return await db.getClientErrorStats(input);
    }),

  /**
   * 최근 에러 목록 조회 (관리자 전용)
   */
  getRecentErrors: adminProcedure
    .input(
      z.object({
        limit: z.number().default(50),
        offset: z.number().default(0),
        appVersion: z.string().optional(),
        errorType: z.string().optional(),
      })
    )
    .query(async ({ input }) => {
      return await db.getRecentClientErrors(input);
    }),

  // ==================== Feature Flag ====================

  /**
   * Feature Flag 조회 (클라이언트용)
   */
  getFeatureFlags: publicProcedure.query(async ({ ctx }) => {
    return await db.getUserFeatureFlags(ctx.user?.id);
  }),

  /**
   * 특정 Feature Flag 확인
   */
  checkFeatureFlag: publicProcedure
    .input(z.object({ flagName: z.string() }))
    .query(async ({ ctx, input }) => {
      const isEnabled = await db.isFeatureFlagEnabled(input.flagName, ctx.user?.id);
      return { isEnabled };
    }),

  /**
   * Feature Flag 생성 (관리자 전용)
   */
  createFeatureFlag: adminProcedure
    .input(
      z.object({
        name: z.string(),
        description: z.string().optional(),
        isEnabled: z.boolean().default(false),
        rolloutPercentage: z.number().min(0).max(100).default(0),
        targetUserGroups: z.array(z.string()).optional(),
        targetVersions: z.array(z.string()).optional(),
      })
    )
    .mutation(async ({ input }) => {
      await db.createFeatureFlag({
        ...input,
        targetUserGroups: input.targetUserGroups ? JSON.stringify(input.targetUserGroups) : null,
        targetVersions: input.targetVersions ? JSON.stringify(input.targetVersions) : null,
      });
      return { success: true };
    }),

  /**
   * Feature Flag 목록 조회 (관리자 전용)
   */
  listFeatureFlags: adminProcedure.query(async () => {
    return await db.getAllFeatureFlags();
  }),

  /**
   * Feature Flag 업데이트 (관리자 전용)
   */
  updateFeatureFlag: adminProcedure
    .input(
      z.object({
        id: z.number(),
        name: z.string().optional(),
        description: z.string().optional(),
        isEnabled: z.boolean().optional(),
        rolloutPercentage: z.number().min(0).max(100).optional(),
        targetUserGroups: z.array(z.string()).optional(),
        targetVersions: z.array(z.string()).optional(),
      })
    )
    .mutation(async ({ input }) => {
      await db.updateFeatureFlag(input.id, {
        ...input,
        targetUserGroups: input.targetUserGroups ? JSON.stringify(input.targetUserGroups) : undefined,
        targetVersions: input.targetVersions ? JSON.stringify(input.targetVersions) : undefined,
      });
      return { success: true };
    }),

  /**
   * Feature Flag 삭제 (관리자 전용)
   */
  deleteFeatureFlag: adminProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      await db.deleteFeatureFlag(input.id);
      return { success: true };
    }),
});


// ==================== 유틸리티 함수 ====================

/**
 * 버전 문자열을 숫자 배열로 파싱
 * - 시맨틱 버전: "1.2.3" -> [1, 2, 3]
 * - 타임스탬프 버전: "v2025121911271" -> [2025121911271] (BigInt로 처리)
 */
function parseVersion(version: string): (number | bigint)[] {
  // 'v' 접두사 제거
  const cleanVersion = version.startsWith('v') ? version.slice(1) : version;
  
  // 타임스탬프 기반 버전 (예: v2025121911271) - 10자리 이상 연속 숫자
  if (/^\d{10,}$/.test(cleanVersion)) {
    // BigInt로 변환하여 안전하게 처리
    return [BigInt(cleanVersion)];
  }
  
  // 시맨틱 버전 (예: 1.2.3)
  return cleanVersion.split(".").map((v) => parseInt(v, 10) || 0);
}

/**
 * 두 버전 비교
 * - 시맨틱 버전: 각 세그먼트를 순차적으로 비교
 * - 타임스탬프 버전: BigInt로 직접 비교
 * @returns -1 (v1 < v2), 0 (v1 == v2), 1 (v1 > v2)
 */
function compareVersions(v1: (number | bigint)[], v2: (number | bigint)[]): number {
  // 타임스탬프 버전 비교 (둘 다 길이 1이고 BigInt인 경우)
  if (v1.length === 1 && v2.length === 1 && typeof v1[0] === 'bigint' && typeof v2[0] === 'bigint') {
    if (v1[0] < v2[0]) return -1;
    if (v1[0] > v2[0]) return 1;
    return 0;
  }
  
  // 시맨틱 버전 비교
  const maxLength = Math.max(v1.length, v2.length);
  for (let i = 0; i < maxLength; i++) {
    const num1 = Number(v1[i] || 0);
    const num2 = Number(v2[i] || 0);
    if (num1 < num2) return -1;
    if (num1 > num2) return 1;
  }
  return 0;
}
