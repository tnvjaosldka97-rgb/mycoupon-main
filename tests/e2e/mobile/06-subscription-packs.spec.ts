/**
 * TC-PACK: 구독팩 UI 검증 (이번 스프린트 신규 기능)
 * 사장님 로그인 없이 검증 가능한 항목 + API 구조 확인
 */
import { test, expect } from '@playwright/test';

const BASE = process.env.BASE_URL || 'https://my-coupon-bridge.com';

test.describe('구독팩 API 기본 동작', () => {

  test('TC-PACK-01: packOrders.listPacks API 공개 여부 확인', async ({ request }) => {
    // 구독팩 목록은 사장님 인증 필요이므로 비인증 시 차단되어야 함
    const res = await request.get(`${BASE}/api/trpc/packOrders.listPacks`);
    const body = await res.json();
    const errorCode = body?.[0]?.error?.data?.code ?? body?.error?.data?.code ?? '';

    expect(
      ['UNAUTHORIZED', 'FORBIDDEN'].includes(errorCode) || res.status() === 401,
      `구독팩 목록 API가 비인증 상태에서 열려있음. code: "${errorCode}"`
    ).toBeTruthy();
  });

  test('TC-PACK-02: packOrders.getMyPlan 비인증 차단', async ({ request }) => {
    const res = await request.get(`${BASE}/api/trpc/packOrders.getMyPlan`);
    const body = await res.json();
    const errorCode = body?.[0]?.error?.data?.code ?? body?.error?.data?.code ?? '';

    expect(
      ['UNAUTHORIZED', 'FORBIDDEN'].includes(errorCode) || res.status() === 401,
      `플랜 조회 API가 비인증 상태에서 열려있음. code: "${errorCode}"`
    ).toBeTruthy();
  });

  test('TC-PACK-03: packOrders.createOrderRequest 비인증 차단', async ({ request }) => {
    const res = await request.post(`${BASE}/api/trpc/packOrders.createOrderRequest`, {
      headers: { 'Content-Type': 'application/json' },
      data: JSON.stringify({ '0': { json: { packCode: 'WELCOME_19800' } } }),
    });
    const body = await res.json();
    const errorCode = body?.[0]?.error?.data?.code ?? body?.error?.data?.code ?? '';

    expect(
      ['UNAUTHORIZED', 'FORBIDDEN'].includes(errorCode) || res.status() === 401,
      `발주요청 API가 비인증 상태에서 열려있음. code: "${errorCode}"`
    ).toBeTruthy();
  });

  test('TC-PACK-04: 어드민 발주요청 리스트 비인증 차단', async ({ request }) => {
    const res = await request.get(`${BASE}/api/trpc/packOrders.listPackOrders`);
    const body = await res.json();
    const errorCode = body?.[0]?.error?.data?.code ?? body?.error?.data?.code ?? '';

    expect(
      ['UNAUTHORIZED', 'FORBIDDEN'].includes(errorCode) || res.status() === 401,
      `어드민 발주요청 리스트 API 비인증 노출. code: "${errorCode}"`
    ).toBeTruthy();
  });

  test('TC-PACK-05: 어드민 setUserPlan 비인증 차단', async ({ request }) => {
    const res = await request.post(`${BASE}/api/trpc/packOrders.setUserPlan`, {
      headers: { 'Content-Type': 'application/json' },
      data: JSON.stringify({
        '0': { json: { userId: 1, tier: 'BUSY' } }
      }),
    });
    const body = await res.json();
    const errorCode = body?.[0]?.error?.data?.code ?? body?.error?.data?.code ?? '';

    expect(
      ['UNAUTHORIZED', 'FORBIDDEN'].includes(errorCode) || res.status() === 401,
      `계급 부여 API가 비인증으로 호출 가능. code: "${errorCode}" — 보안 취약점!`
    ).toBeTruthy();
  });
});
