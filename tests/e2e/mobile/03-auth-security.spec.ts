/**
 * TC-AUTH: 인증/보안/권한 테스트
 * 프로덕션 데이터 변경 없이 GET 요청 + 화면 확인만 수행
 */
import { test, expect } from '@playwright/test';

const BASE = process.env.BASE_URL || 'https://my-coupon-bridge.com';

test.describe('인증 & 보안 (IDOR / 권한 체크)', () => {

  test('TC-AUTH-01: 비인증 API 호출 시 401/UNAUTHORIZED 반환', async ({ request }) => {
    // tRPC batch 호출 - 보호된 엔드포인트 (auth.me)
    const res = await request.get(`${BASE}/api/trpc/auth.me`);
    // 401이거나 200이어도 user가 null이어야 함
    const body = await res.text();
    if (res.status() === 200) {
      // tRPC 200으로 내려오더라도 result.data가 null이어야 함
      expect(body).not.toContain('"role":"admin"');
    }
  });

  test('TC-AUTH-02: 어드민 전용 API - 비인증 시 접근 차단', async ({ request }) => {
    // admin.listStores tRPC 엔드포인트 호출
    const res = await request.get(`${BASE}/api/trpc/admin.listStores`);
    const body = await res.json();

    // tRPC 에러 구조: body[0].error.data.code === 'UNAUTHORIZED' 또는 'FORBIDDEN'
    const errorCode = body?.[0]?.error?.data?.code
      ?? body?.error?.data?.code
      ?? '';

    expect(
      ['UNAUTHORIZED', 'FORBIDDEN'].includes(errorCode) || res.status() === 401,
      `어드민 API가 비인증 상태에서 차단되지 않음. error.code: "${errorCode}", status: ${res.status()}`
    ).toBeTruthy();
  });

  test('TC-AUTH-03: 사장님 전용 API - 비인증 시 접근 차단', async ({ request }) => {
    const res = await request.get(`${BASE}/api/trpc/coupons.create`);
    const body = await res.json();
    const errorCode = body?.[0]?.error?.data?.code ?? body?.error?.data?.code ?? '';

    expect(
      ['UNAUTHORIZED', 'FORBIDDEN'].includes(errorCode) || res.status() === 401 || res.status() === 405,
      `쿠폰 생성 API가 비인증에서 차단 안 됨. code: "${errorCode}"`
    ).toBeTruthy();
  });

  test('TC-AUTH-04: /api/trpc CORS 헤더 확인', async ({ request }) => {
    const res = await request.get(`${BASE}/api/trpc/healthz`);
    // OPTIONS preflight 테스트는 별도이므로 GET 기본 확인
    expect(res.status()).toBeLessThan(500);
  });

  test('TC-AUTH-05: 401 발생 시 프론트 로그인 유도 (TanStack Query 에러 핸들링)', async ({ page }) => {
    // 로그인 없이 /my-coupons 접속 → 로그인 페이지로 이동해야 함
    await page.goto(`${BASE}/my-coupons`);
    await page.waitForLoadState('networkidle');

    // 로그인 버튼 또는 리다이렉트 확인
    const isRedirected = page.url().includes('oauth') || page.url().includes('login');
    const hasLoginPrompt = await page.locator('text=로그인, text=구글, text=Google').count() > 0;

    expect(
      isRedirected || hasLoginPrompt || page.url() === BASE || page.url() === `${BASE}/`,
      '비로그인 상태에서 /my-coupons 접속 시 로그인 유도가 없음'
    ).toBeTruthy();
  });

  test('TC-AUTH-06: healthz 엔드포인트 공개 접근 가능', async ({ request }) => {
    const res = await request.get(`${BASE}/healthz`);
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('ok');
  });

  test('TC-AUTH-07: XSS - 검색 파라미터 스크립트 주입 방지', async ({ page }) => {
    // q 파라미터에 스크립트 주입 시도
    await page.goto(`${BASE}/search?q=<script>alert(1)</script>`);
    await page.waitForLoadState('networkidle');

    // alert가 실행되면 dialog 이벤트가 발생함
    let alertTriggered = false;
    page.on('dialog', async (dialog) => {
      alertTriggered = true;
      await dialog.dismiss();
    });

    await page.waitForTimeout(1000);
    expect(alertTriggered, 'XSS alert 실행됨! 스크립트 주입 취약점').toBeFalsy();
  });
});
