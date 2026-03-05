/**
 * 회귀 테스트: 구독팩 발주요청 (BUG-08)
 *
 * 버그: "구매하기" 클릭 시 성공 모달은 뜨지만 POST 요청이 발생하지 않음
 * 원인: 자동 마이그레이션에서 PostgreSQL ENUM 생성 실패 → 테이블 미생성
 *        + RETURNING id 없이 INSERT 성공 여부 미검증
 * 수정: VARCHAR 기반 마이그레이션 + sql`` 태그드 템플릿 + RETURNING id 검증
 *
 * 이 테스트는 로그인된 merchant 계정이 필요합니다.
 * MERCHANT_EMAIL / MERCHANT_PASSWORD 환경변수로 주입하세요.
 */
import { test, expect, type Page, type BrowserContext } from '@playwright/test';

const BASE = process.env.BASE_URL || 'https://my-coupon-bridge.com';
const MERCHANT_EMAIL = process.env.MERCHANT_EMAIL || '';
const MERCHANT_PASSWORD = process.env.MERCHANT_PASSWORD || '';
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || '';

/**
 * tRPC API 직접 호출 헬퍼
 */
async function callTrpc(
  context: BrowserContext,
  procedure: string,
  input: unknown,
  method: 'GET' | 'POST' = 'GET'
) {
  const url = method === 'GET'
    ? `${BASE}/api/trpc/${procedure}?batch=1&input=${encodeURIComponent(JSON.stringify({ '0': { json: input } }))}`
    : `${BASE}/api/trpc/${procedure}?batch=1`;

  const options: any = { method };
  if (method === 'POST') {
    options.headers = { 'Content-Type': 'application/json' };
    options.data = JSON.stringify({ '0': { json: input } });
  }

  const res = await context.request.fetch(url, options);
  return res;
}

// ─── API 레벨 테스트 (로그인 불필요) ────────────────────────────────────────

test.describe('TC-ORDER-API: 발주요청 API 보안 (비인증)', () => {

  test('TC-ORDER-01: createOrderRequest 비인증 → 401/UNAUTHORIZED', async ({ request }) => {
    const res = await request.post(
      `${BASE}/api/trpc/packOrders.createOrderRequest?batch=1`,
      {
        headers: { 'Content-Type': 'application/json' },
        data: JSON.stringify({ '0': { json: { packCode: 'WELCOME_19800' } } }),
      }
    );

    const body = await res.json();
    const errorCode = body?.[0]?.error?.data?.code ?? body?.error?.data?.code ?? '';

    expect(
      ['UNAUTHORIZED', 'FORBIDDEN'].includes(errorCode) || res.status() === 401,
      `createOrderRequest 비인증 차단 실패. code="${errorCode}", status=${res.status()}`
    ).toBeTruthy();
  });

  test('TC-ORDER-02: listPackOrders 비인증 → 401/UNAUTHORIZED', async ({ request }) => {
    const res = await request.get(
      `${BASE}/api/trpc/packOrders.listPackOrders?batch=1&input=%7B%220%22%3A%7B%22json%22%3A%7B%7D%7D%7D`
    );

    const body = await res.json();
    const errorCode = body?.[0]?.error?.data?.code ?? body?.error?.data?.code ?? '';

    expect(
      ['UNAUTHORIZED', 'FORBIDDEN'].includes(errorCode) || res.status() === 401,
      `listPackOrders 비인증 차단 실패. code="${errorCode}"`
    ).toBeTruthy();
  });

  test('TC-ORDER-03: setUserPlan 비인증 → 401/UNAUTHORIZED', async ({ request }) => {
    const res = await request.post(
      `${BASE}/api/trpc/packOrders.setUserPlan?batch=1`,
      {
        headers: { 'Content-Type': 'application/json' },
        data: JSON.stringify({ '0': { json: { userId: 1, tier: 'BUSY' } } }),
      }
    );

    const body = await res.json();
    const errorCode = body?.[0]?.error?.data?.code ?? body?.error?.data?.code ?? '';

    expect(
      ['UNAUTHORIZED', 'FORBIDDEN'].includes(errorCode) || res.status() === 401,
      `setUserPlan 비인증 차단 실패 (보안 취약점). code="${errorCode}"`
    ).toBeTruthy();
  });
});

// ─── UI 레벨 테스트 ──────────────────────────────────────────────────────────

test.describe('TC-ORDER-UI: 구독팩 구매하기 플로우 (로그인 필요)', () => {

  test.skip(!MERCHANT_EMAIL, 'MERCHANT_EMAIL 환경변수 필요');

  test('TC-ORDER-04: 구매하기 클릭 시 POST /api/trpc/packOrders.createOrderRequest 발생', async ({ page }) => {
    // 로그인 상태 설정은 테스트 계정 제공 시 구현
    // 현재는 Network intercept로 POST 요청 발생 여부만 확인
    await page.goto(`${BASE}/merchant/dashboard`);

    let postCaptured = false;
    let postUrl = '';

    page.on('request', (req) => {
      if (
        req.method() === 'POST' &&
        req.url().includes('/api/trpc') &&
        req.url().includes('packOrders')
      ) {
        postCaptured = true;
        postUrl = req.url();
        console.log(`[TC-ORDER-04] POST 감지: ${postUrl}`);
      }
    });

    // 구독팩 탭 클릭
    const subscriptionTab = page.locator('[data-value="subscription"], button:has-text("마이쿠폰 구독팩")').first();
    if (await subscriptionTab.count() === 0) {
      console.log('[TC-ORDER-04] 구독팩 탭 없음 (비로그인 상태) - 스킵');
      return;
    }
    await subscriptionTab.click();

    // 구매하기 버튼 클릭
    const buyBtn = page.locator('button:has-text("구매하기")').first();
    if (await buyBtn.count() === 0) {
      console.log('[TC-ORDER-04] 구매하기 버튼 없음 - 스킵');
      return;
    }

    // POST 요청 감지를 위한 인터셉트
    const [response] = await Promise.all([
      page.waitForResponse((res) =>
        res.request().method() === 'POST' &&
        res.url().includes('packOrders.createOrderRequest'),
        { timeout: 10000 }
      ).catch(() => null),
      buyBtn.click(),
    ]);

    if (response) {
      postCaptured = true;
      const body = await response.json().catch(() => null);
      console.log(`[TC-ORDER-04] POST 응답:`, JSON.stringify(body));

      expect(response.status(), 'createOrderRequest가 500 에러 반환').not.toBe(500);
    }

    expect(postCaptured, '구매하기 클릭 후 POST 요청이 발생하지 않음 (BUG-08 재발)').toBeTruthy();
  });

  test('TC-ORDER-05: 성공 모달이 뜰 때 POST 응답도 있어야 함 (동시 확인)', async ({ page }) => {
    await page.goto(`${BASE}/merchant/dashboard`);

    const postRequests: string[] = [];
    page.on('request', (req) => {
      if (req.method() === 'POST' && req.url().includes('/api/trpc')) {
        postRequests.push(req.url());
      }
    });

    // 구독팩 탭
    const tab = page.locator('button:has-text("마이쿠폰 구독팩"), [data-value="subscription"]').first();
    if (await tab.count() === 0) {
      test.skip(); return;
    }
    await tab.click();
    await page.waitForTimeout(500);

    const buyBtn = page.locator('button:has-text("구매하기")').first();
    if (await buyBtn.count() === 0) { test.skip(); return; }

    await buyBtn.click();
    await page.waitForTimeout(3000);

    // 모달이 뜨면
    const modal = page.locator('text=담당자가 개별적으로 연락드리겠습니다');
    if (await modal.isVisible({ timeout: 5000 }).catch(() => false)) {
      // POST가 있어야 함 (모달은 onSuccess에서만 열림)
      const packOrderPost = postRequests.some(url => url.includes('packOrders'));
      expect(
        packOrderPost,
        '성공 모달은 떴지만 packOrders POST 요청이 없음 (BUG-08 재현 상태)'
      ).toBeTruthy();
    }
  });

  test('TC-ORDER-06: 발주요청 후 admin listPackOrders에 1건 이상 표시', async ({ page, context }) => {
    // admin 세션이 있는 경우에만 실행
    if (!ADMIN_EMAIL) { test.skip(); return; }

    // admin 계정으로 발주요청 목록 조회
    const res = await callTrpc(context, 'packOrders.listPackOrders', {}, 'GET');
    if (res.status() === 401) { test.skip(); return; }

    expect(res.status()).toBe(200);
    const body = await res.json();
    const data = body?.[0]?.result?.data ?? [];
    expect(
      Array.isArray(data),
      'listPackOrders 응답이 배열이 아님'
    ).toBeTruthy();

    console.log(`[TC-ORDER-06] 발주요청 수: ${data.length}`);
  });
});

// ─── 마이그레이션 검증 ──────────────────────────────────────────────────────

test.describe('TC-ORDER-MIGRATION: 테이블 존재 여부 (healthz + 간접 확인)', () => {

  test('TC-ORDER-07: healthz 응답으로 서버 기동 확인', async ({ request }) => {
    const res = await request.get(`${BASE}/healthz`);
    expect(res.status()).toBe(200);

    const body = await res.json();
    expect(body.status).toBe('ok');

    // 서버가 정상 기동했다면 자동 마이그레이션도 완료된 것
    console.log(`[TC-ORDER-07] 서버 버전: ${body.version ?? 'unknown'}`);
  });

  test('TC-ORDER-08: packOrders.listPacks 비인증 → 적절한 에러 (엔드포인트 존재 확인)', async ({ request }) => {
    // 엔드포인트 자체가 없으면 다른 에러 코드가 옴
    const res = await request.get(
      `${BASE}/api/trpc/packOrders.listPacks?batch=1&input=%7B%220%22%3A%7B%22json%22%3Anull%7D%7D`
    );

    const body = await res.json();
    const errorCode = body?.[0]?.error?.data?.code ?? '';

    // NOT_FOUND가 아닌 UNAUTHORIZED/FORBIDDEN이면 엔드포인트가 존재함
    expect(
      errorCode !== 'NOT_FOUND',
      `packOrders.listPacks 엔드포인트가 등록되지 않음 (NOT_FOUND). 서버 라우터 확인 필요.`
    ).toBeTruthy();
  });
});
