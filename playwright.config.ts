import { defineConfig, devices } from '@playwright/test';

/**
 * MyCoupon E2E 테스트 설정
 * 대상: https://my-coupon-bridge.com (Production)
 * 우선순위: 모바일 웹(PWA)
 */
export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 2,
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }]],

  use: {
    // 로컬/스테이징 기본값. 프로덕션 실행: BASE_URL=https://my-coupon-bridge.com pnpm test:e2e
    baseURL: process.env.BASE_URL || 'http://localhost:3000',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'off',
    // 모바일: 기본적으로 느린 네트워크 없이 기능 테스트 먼저
    actionTimeout: 15000,
    navigationTimeout: 30000,
  },

  projects: [
    // ── 모바일 우선 ────────────────────────────────────────────────────────
    {
      name: 'Mobile Chrome (Pixel 7)',
      use: {
        ...devices['Pixel 7'],
        locale: 'ko-KR',
      },
    },
    {
      name: 'Mobile Safari (iPhone 13)',
      use: {
        ...devices['iPhone 13'],
        locale: 'ko-KR',
      },
    },
    // ── 데스크톱 (관리자 테스트용) ─────────────────────────────────────────
    {
      name: 'Desktop Chrome',
      use: {
        ...devices['Desktop Chrome'],
        locale: 'ko-KR',
      },
    },
    // ── 느린 네트워크 시뮬레이션 ───────────────────────────────────────────
    {
      name: 'Mobile Chrome Slow 3G',
      use: {
        ...devices['Pixel 7'],
        locale: 'ko-KR',
      },
      // slow 3G: offline/timeout 테스트는 별도 spec에서 처리
    },
  ],
});
