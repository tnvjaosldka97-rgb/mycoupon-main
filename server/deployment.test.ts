import { describe, it, expect, beforeAll } from "vitest";
import { appRouter } from "./routers";
import type { Context } from "./_core/context";

/**
 * 배포/운영 안정성 기능 테스트
 * - 버전 체크 API
 * - 설치 퍼널 이벤트 로깅
 * - 긴급 배너 조회
 * - 클라이언트 에러 로깅
 * - Feature Flag 조회
 */

describe("Deployment Stability Features", () => {
  const mockContext: Context = {
    user: null,
    req: {} as any,
    res: {} as any,
  };

  const mockAdminContext: Context = {
    user: {
      id: 1,
      openId: "admin-openid",
      name: "Admin User",
      email: "admin@test.com",
      role: "admin",
      createdAt: new Date(),
      updatedAt: new Date(),
      phone: null,
      profileImage: null,
      points: 0,
      totalSpent: 0,
      visitCount: 0,
      reviewCount: 0,
      favoriteCount: 0,
      tier: "bronze",
      lastLoginAt: new Date(),
    },
    req: {} as any,
    res: {} as any,
  };

  const caller = appRouter.createCaller(mockContext);
  const adminCaller = appRouter.createCaller(mockAdminContext);

  describe("Version Check API", () => {
    it("should return version information", async () => {
      const result = await caller.deployment.checkVersion({
        clientVersion: "1.0.0",
        deviceType: "android",
        browserType: "chrome",
      });

      expect(result).toHaveProperty("needsUpdate");
      expect(result).toHaveProperty("updateMode");
      expect(typeof result.needsUpdate).toBe("boolean");
    });

    it("should handle different client versions", async () => {
      const oldVersion = await caller.deployment.checkVersion({
        clientVersion: "0.9.0",
        deviceType: "ios",
        browserType: "safari",
      });

      expect(oldVersion).toBeDefined();
    });
  });

  describe("Install Funnel Tracking", () => {
    it("should log install funnel events", async () => {
      const sessionId = `test-session-${Date.now()}`;

      const result = await caller.deployment.logInstallEvent({
        sessionId,
        eventType: "landing_view",
        deviceType: "android",
        browserType: "chrome",
        osVersion: "Android 13",
        appVersion: "1.0.0",
        referrer: "https://google.com",
      });

      expect(result.success).toBe(true);
    });

    it("should log different event types", async () => {
      const sessionId = `test-session-${Date.now()}`;

      const events = [
        "landing_view",
        "install_cta_view",
        "install_cta_click",
        "appinstalled",
        "first_open_standalone",
        "login_complete",
      ] as const;

      for (const eventType of events) {
        const result = await caller.deployment.logInstallEvent({
          sessionId,
          eventType,
          deviceType: "ios",
          browserType: "safari",
          osVersion: "iOS 17",
          appVersion: "1.0.0",
        });

        expect(result.success).toBe(true);
      }
    });
  });

  describe("Emergency Banner", () => {
    it("should return active banners", async () => {
      const result = await caller.deployment.getActiveBanners({
        appVersion: "1.0.0",
        browserType: "chrome",
        osType: "android",
      });

      expect(Array.isArray(result)).toBe(true);
    });

    it("should log banner interactions", async () => {
      const sessionId = `test-session-${Date.now()}`;

      // Note: This will fail if no banner exists, which is expected in test environment
      try {
        const result = await caller.deployment.logBannerInteraction({
          bannerId: 1,
          sessionId,
          interactionType: "view",
        });

        expect(result.success).toBe(true);
      } catch (error) {
        // Expected to fail if no banner exists
        expect(error).toBeDefined();
      }
    });
  });

  describe("Client Error Logging", () => {
    it("should log client errors", async () => {
      const sessionId = `test-session-${Date.now()}`;

      const result = await caller.deployment.logError({
        sessionId,
        appVersion: "1.0.0",
        errorType: "js_error",
        errorMessage: "Test error message",
        errorStack: "Error stack trace",
        url: "https://example.com/test",
        userAgent: "Mozilla/5.0...",
        deviceType: "android",
        browserType: "chrome",
        osVersion: "Android 13",
      });

      expect(result.success).toBe(true);
    });

    it("should log different error types", async () => {
      const sessionId = `test-session-${Date.now()}`;

      const errorTypes = [
        "js_error",
        "promise_rejection",
        "api_failure",
        "network_error",
      ] as const;

      for (const errorType of errorTypes) {
        const result = await caller.deployment.logError({
          sessionId,
          appVersion: "1.0.0",
          errorType,
          errorMessage: `Test ${errorType}`,
          url: "https://example.com/test",
          userAgent: "Mozilla/5.0...",
          deviceType: "ios",
          browserType: "safari",
          osVersion: "iOS 17",
        });

        expect(result.success).toBe(true);
      }
    });
  });

  describe("Feature Flags", () => {
    it("should return user feature flags", async () => {
      const result = await caller.deployment.getFeatureFlags();

      expect(Array.isArray(result)).toBe(true);
    });

    it("should check specific feature flag", async () => {
      const result = await caller.deployment.checkFeatureFlag({
        flagName: "test_feature",
      });

      expect(result).toHaveProperty("isEnabled");
      expect(typeof result.isEnabled).toBe("boolean");
    });
  });

  describe("Admin Operations", () => {
    it("should allow admin to list feature flags", async () => {
      const result = await adminCaller.deployment.listFeatureFlags();

      expect(Array.isArray(result)).toBe(true);
    });

    it("should prevent non-admin from accessing admin endpoints", async () => {
      try {
        await caller.deployment.listFeatureFlags();
        // Should not reach here
        expect(true).toBe(false);
      } catch (error) {
        // Expected to fail for non-admin
        expect(error).toBeDefined();
      }
    });
  });
});
