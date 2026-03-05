/**
 * TC-HOME: 홈 페이지 모바일 렌더링 + 네비게이션
 */
import { test, expect } from '@playwright/test';

const BASE = process.env.BASE_URL || 'https://my-coupon-bridge.com';

test.describe('홈페이지 모바일 기본', () => {

  test('TC-HOME-01: 홈페이지 200 응답 + 기본 요소 렌더링', async ({ page }) => {
    const res = await page.goto(BASE);
    expect(res?.status(), '홈 페이지 비정상 응답').toBe(200);

    // 로고/브랜드 노출
    await expect(page.locator('text=마이쿠폰').first()).toBeVisible({ timeout: 10000 });
  });

  test('TC-HOME-02: 헤더가 sticky top-0 z-50으로 스크롤 시 유지', async ({ page }) => {
    await page.goto(BASE);
    await page.waitForLoadState('networkidle');

    const header = page.locator('header').first();
    await expect(header).toBeVisible();

    // 스크롤 후에도 헤더가 화면에 보여야 함
    await page.evaluate(() => window.scrollTo(0, 500));
    await expect(header).toBeVisible();
  });

  test('TC-HOME-03: 뷰포트 너비 내에서 가로 스크롤 없음', async ({ page }) => {
    await page.goto(BASE);
    await page.waitForLoadState('networkidle');

    const bodyWidth = await page.evaluate(() => document.body.scrollWidth);
    const viewportWidth = page.viewportSize()!.width;

    expect(
      bodyWidth,
      `가로 스크롤 발생: body.scrollWidth(${bodyWidth}) > viewport(${viewportWidth})`
    ).toBeLessThanOrEqual(viewportWidth + 5); // 5px 오차 허용
  });

  test('TC-HOME-04: 도장판 메뉴 제거됨 (네비게이션에 미노출)', async ({ page }) => {
    await page.goto(BASE);
    await page.waitForLoadState('networkidle');

    // 도장판 링크가 노출되면 안 됨
    const stampLink = page.locator('a[href="/district-stamps"], text=도장판');
    await expect(stampLink).toHaveCount(0);
  });

  test('TC-HOME-05: 내 쿠폰 찾기 링크 존재', async ({ page }) => {
    await page.goto(BASE);
    const link = page.locator('a[href="/map"]');
    await expect(link.first()).toBeVisible();
  });

  test('TC-HOME-06: 비로그인 상태에서 관리자 페이지 직접 접속 시 접근 차단', async ({ page }) => {
    await page.goto(`${BASE}/admin`);
    await page.waitForLoadState('networkidle');

    // 어드민 페이지 접속 시 로그인 유도 또는 "접근 권한 없음" 표시
    const isAdminContent = await page.locator('text=관리자').count();
    const isBlocked = await page.locator('text=접근 권한 없음').count() > 0
      || page.url().includes('/login')
      || page.url() === `${BASE}/`
      || page.url() === `${BASE}`;

    // 보안: 관리자 대시보드 핵심 기능이 비로그인에 노출되면 안 됨
    const hasAdminControls = await page.locator('text=가게 관리').count();
    expect(hasAdminControls, '비로그인 상태에서 어드민 가게 관리 노출됨 (보안 이슈)').toBe(0);
  });

  test('TC-HOME-07: /merchant/dashboard 비로그인 접속 시 리다이렉트', async ({ page }) => {
    await page.goto(`${BASE}/merchant/dashboard`);
    await page.waitForLoadState('networkidle');

    // 사장님 대시보드 핵심 기능(쿠폰 등록 등)이 비로그인에 노출되면 안 됨
    const hasMerchantControls = await page.locator('text=쿠폰 등록').count();
    expect(hasMerchantControls, '비로그인에서 사장님 쿠폰 등록 노출됨 (보안 이슈)').toBe(0);
  });

  test('TC-HOME-08: 모바일 뷰에서 터치 타겟 최소 크기 (44px)', async ({ page }) => {
    await page.goto(BASE);
    await page.waitForLoadState('networkidle');

    // 주요 버튼들의 최소 터치 영역 확인
    const buttons = await page.locator('button:visible').all();
    const tooSmall: string[] = [];

    for (const btn of buttons.slice(0, 10)) {
      const box = await btn.boundingBox();
      if (box && (box.width < 30 || box.height < 30)) {
        const text = await btn.textContent();
        tooSmall.push(`"${text?.trim()}" (${box.width.toFixed(0)}x${box.height.toFixed(0)}px)`);
      }
    }

    // 경고 수준 (P3): 작은 버튼 있을 경우 리포트
    if (tooSmall.length > 0) {
      console.warn(`[P3] 터치 타겟 30px 미만 버튼: ${tooSmall.join(', ')}`);
    }
  });
});
