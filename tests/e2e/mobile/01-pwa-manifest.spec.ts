/**
 * TC-PWA: PWA/iOS 메타 유효성 점검
 * 우선순위: P1 - 앱 설치 품질 직결
 */
import { test, expect } from '@playwright/test';

const BASE = process.env.BASE_URL || 'https://my-coupon-bridge.com';

test.describe('PWA / iOS 홈화면 추가 품질', () => {

  test('TC-PWA-01: manifest.json 200 응답 + 필수 필드', async ({ request }) => {
    const res = await request.get(`${BASE}/manifest.json`);
    expect(res.status(), 'manifest.json 404').toBe(200);

    const manifest = await res.json();
    expect(manifest.name, 'name 누락').toBeTruthy();
    expect(manifest.short_name, 'short_name 누락').toBeTruthy();
    expect(manifest.start_url, 'start_url 누락').toBeTruthy();
    expect(manifest.display, 'display 누락').toBeTruthy();
    expect(manifest.icons, 'icons 누락').toBeTruthy();
    expect(manifest.icons.length, 'icons 비어있음').toBeGreaterThan(0);

    // short_name은 12자 이하 권장 (홈화면 라벨 잘림 방지)
    expect(
      manifest.short_name.length,
      `short_name "${manifest.short_name}"이 너무 김 (12자 초과 시 잘림)`
    ).toBeLessThanOrEqual(12);
  });

  test('TC-PWA-02: 192x192 아이콘 파일 200 응답', async ({ request }) => {
    const manifest = await (await request.get(`${BASE}/manifest.json`)).json();
    const icon192 = manifest.icons.find((i: any) =>
      i.sizes?.includes('192x192') || i.sizes === '192x192'
    );
    expect(icon192, '192x192 아이콘 manifest에 미정의').toBeTruthy();

    const iconRes = await request.get(`${BASE}${icon192.src}`);
    expect(iconRes.status(), `192x192 아이콘 파일 없음: ${icon192.src}`).toBe(200);
  });

  test('TC-PWA-03: 512x512 아이콘 파일 200 응답', async ({ request }) => {
    const manifest = await (await request.get(`${BASE}/manifest.json`)).json();
    const icon512 = manifest.icons.find((i: any) =>
      i.sizes?.includes('512x512') || i.sizes === '512x512'
    );
    expect(icon512, '512x512 아이콘 manifest에 미정의').toBeTruthy();

    const iconRes = await request.get(`${BASE}${icon512.src}`);
    expect(iconRes.status(), `512x512 아이콘 파일 없음: ${icon512.src}`).toBe(200);
  });

  test('TC-PWA-04: maskable 아이콘 존재', async ({ request }) => {
    const manifest = await (await request.get(`${BASE}/manifest.json`)).json();
    const maskable = manifest.icons.find((i: any) =>
      i.purpose?.includes('maskable')
    );
    expect(maskable, 'maskable 아이콘 없음 (Android 적응형 아이콘 미지원)').toBeTruthy();
  });

  test('TC-PWA-05: HTML에 apple-mobile-web-app-title 메타 태그', async ({ page }) => {
    await page.goto(BASE);
    const title = await page.locator('meta[name="apple-mobile-web-app-title"]').getAttribute('content');
    expect(title, 'apple-mobile-web-app-title 없음').toBeTruthy();
    expect(title, '서비스명이 비어있음').not.toBe('');
  });

  test('TC-PWA-06: apple-touch-icon 180x180 존재 + 파일 응답', async ({ page, request }) => {
    await page.goto(BASE);
    const icon180 = await page.locator('link[rel="apple-touch-icon"][sizes="180x180"]').getAttribute('href');
    expect(icon180, 'apple-touch-icon 180x180 없음').toBeTruthy();

    const iconRes = await request.get(`${BASE}${icon180}`);
    expect(iconRes.status(), `apple-touch-icon 파일 404: ${icon180}`).toBe(200);
  });

  test('TC-PWA-07: apple-touch-icon 파일 응답 (사이즈 무관)', async ({ page, request }) => {
    await page.goto(BASE);
    const href = await page.locator('link[rel="apple-touch-icon"]').first().getAttribute('href');
    expect(href, 'apple-touch-icon link 없음').toBeTruthy();

    const res = await request.get(`${BASE}${href}`);
    expect(res.status(), `apple-touch-icon 파일 없음: ${href}`).toBe(200);

    // Content-Type이 image/* 여야 함
    const ct = res.headers()['content-type'] ?? '';
    expect(ct, `아이콘 파일이 image가 아님: ${ct}`).toMatch(/^image\//);
  });

  test('TC-PWA-08: viewport-fit=cover 설정 확인', async ({ page }) => {
    await page.goto(BASE);
    const viewport = await page.locator('meta[name="viewport"]').getAttribute('content');
    expect(viewport, 'viewport meta 없음').toBeTruthy();
    expect(viewport, 'viewport-fit=cover 없음 → iOS 노치 영역 처리 안 됨').toContain('viewport-fit=cover');
  });

  test('TC-PWA-09: 서비스워커 파일 200 응답', async ({ request }) => {
    const res = await request.get(`${BASE}/service-worker.js`);
    expect(res.status(), 'service-worker.js 404').toBe(200);
  });

  test('TC-PWA-10: manifest theme_color 설정', async ({ request }) => {
    const manifest = await (await request.get(`${BASE}/manifest.json`)).json();
    expect(manifest.theme_color, 'theme_color 없음').toBeTruthy();
  });
});
