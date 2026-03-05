/**
 * TC-COUPON: 쿠폰 리스트/지도/상세 (읽기 전용)
 * ※ 실제 쿠폰 발급/사용은 테스트 계정 없이는 불가 → 화면 렌더링 + API 형식 검증
 */
import { test, expect } from '@playwright/test';

const BASE = process.env.BASE_URL || 'https://my-coupon-bridge.com';

test.describe('쿠폰 리스트 & 지도 (공개 영역)', () => {

  test('TC-CPN-01: 쿠폰 지도(/map) 페이지 로드', async ({ page }) => {
    await page.goto(`${BASE}/map`);
    await page.waitForLoadState('networkidle');
    expect(page.url()).toContain('/map');
    // 지도 또는 쿠폰 목록 요소가 있어야 함
    const hasContent = await page.locator('[class*="map"], canvas, text=쿠폰').count();
    expect(hasContent, '지도 페이지에 콘텐츠 없음').toBeGreaterThan(0);
  });

  test('TC-CPN-02: 공개 쿠폰 API 응답 형식', async ({ request }) => {
    // tRPC로 공개 쿠폰 목록 조회
    const res = await request.get(`${BASE}/api/trpc/coupons.listActive`);
    expect(res.status()).toBeLessThan(500);
    const body = await res.json();
    // 에러가 아니거나 UNAUTHORIZED가 아닌 다른 에러면 버그
    if (res.status() === 200 && body[0]?.result?.data) {
      const data = body[0].result.data;
      expect(Array.isArray(data)).toBeTruthy();
    }
  });

  test('TC-CPN-03: 홈페이지에서 쿠폰/매장 데이터 로드 (timeout 없이)', async ({ page }) => {
    await page.goto(BASE);

    // 데이터 로딩 스피너가 15초 내로 사라져야 함
    const spinner = page.locator('[class*="animate-spin"], [class*="loading"]');
    if (await spinner.count() > 0) {
      await expect(spinner.first()).toBeHidden({ timeout: 15000 });
    }
  });

  test('TC-CPN-04: /coupons 경로 접근 가능', async ({ page }) => {
    const res = await page.goto(`${BASE}/coupons`);
    // 404가 아닌 응답이어야 함
    expect(res?.status(), '/coupons 404').not.toBe(404);
  });

  test('TC-CPN-05: 가게 상세 페이지 존재하지 않는 ID → 404/빈화면 처리', async ({ page }) => {
    await page.goto(`${BASE}/store/99999999`);
    await page.waitForLoadState('networkidle');

    // 에러가 터지면 안 됨. 빈 상태 또는 Not Found 표시
    const hasUnhandledError = await page.locator('text=Unhandled, text=TypeError, text=ReferenceError').count();
    expect(hasUnhandledError, '존재하지 않는 store ID에서 JS 에러 노출').toBe(0);
  });

  test('TC-CPN-06: 쿠폰 다운로드 API 비인증 호출 시 차단', async ({ request }) => {
    const res = await request.post(`${BASE}/api/trpc/coupons.download`, {
      headers: { 'Content-Type': 'application/json' },
      data: JSON.stringify({ '0': { json: { couponId: 1, deviceId: 'test' } } }),
    });

    const body = await res.json();
    const errorCode = body?.[0]?.error?.data?.code ?? body?.error?.data?.code ?? '';
    expect(
      ['UNAUTHORIZED', 'FORBIDDEN'].includes(errorCode) || res.status() === 401,
      `쿠폰 다운로드 비인증 차단 안 됨. code: "${errorCode}"`
    ).toBeTruthy();
  });

  test('TC-CPN-07: 쿠폰 사용(markAsUsed) API 비인증 호출 시 차단', async ({ request }) => {
    const res = await request.post(`${BASE}/api/trpc/coupons.markAsUsed`, {
      headers: { 'Content-Type': 'application/json' },
      data: JSON.stringify({ '0': { json: { userCouponId: 1 } } }),
    });

    const body = await res.json();
    const errorCode = body?.[0]?.error?.data?.code ?? body?.error?.data?.code ?? '';
    expect(
      ['UNAUTHORIZED', 'FORBIDDEN'].includes(errorCode) || res.status() === 401,
      `쿠폰 사용 비인증 차단 안 됨. code: "${errorCode}"`
    ).toBeTruthy();
  });
});
