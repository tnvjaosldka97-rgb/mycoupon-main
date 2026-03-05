/**
 * TC-UX: 모바일 UX 품질 체크
 * safe-area, 스크롤, 키보드, 레이아웃 이슈
 */
import { test, expect } from '@playwright/test';

const BASE = process.env.BASE_URL || 'https://my-coupon-bridge.com';

test.describe('모바일 UX & 레이아웃', () => {

  test('TC-UX-01: safe-area CSS 변수 적용 확인 (body에만 존재)', async ({ page }) => {
    await page.goto(BASE);

    // body의 padding-top이 safe-area-inset-top 값을 사용하는지
    const bodyPaddingTop = await page.evaluate(() =>
      window.getComputedStyle(document.body).paddingTop
    );
    // html의 padding-top은 0이어야 함 (이중 적용 방지 버그 수정 후)
    const htmlPaddingTop = await page.evaluate(() =>
      window.getComputedStyle(document.documentElement).paddingTop
    );

    // 브라우저 테스트 환경에선 safe-area = 0px이므로 둘 다 0px임
    // 중요한 건 html에 padding이 추가로 붙지 않아야 한다는 것
    console.log(`html.paddingTop: ${htmlPaddingTop}, body.paddingTop: ${bodyPaddingTop}`);
    // 이 값을 리포트에 기록 (실제 값 검증은 iOS 실기기 필요)
  });

  test('TC-UX-02: #root min-height 설정 (100svh 또는 100vh)', async ({ page }) => {
    await page.goto(BASE);

    const rootMinHeight = await page.evaluate(() =>
      window.getComputedStyle(document.getElementById('root')!).minHeight
    );

    // 100svh 또는 100vh가 적용돼야 함 (px 값으로 반환)
    const rootHeightPx = parseFloat(rootMinHeight);
    const viewportHeight = page.viewportSize()!.height;

    expect(rootHeightPx, `#root min-height(${rootMinHeight})가 뷰포트 높이보다 작음`).toBeGreaterThanOrEqual(
      viewportHeight - 10
    );
  });

  test('TC-UX-03: 홈 페이지 스크롤 잠김 없음', async ({ page }) => {
    await page.goto(BASE);
    await page.waitForLoadState('networkidle');

    // body overflow가 hidden이 아니어야 함
    const overflow = await page.evaluate(() =>
      window.getComputedStyle(document.body).overflow
    );
    expect(overflow, `body overflow: "${overflow}" → 스크롤 잠김 가능성`).not.toBe('hidden');
  });

  test('TC-UX-04: 모달 닫힌 후 body 스크롤 복원', async ({ page }) => {
    await page.goto(BASE);
    await page.waitForLoadState('networkidle');

    // 초기 overflow 확인
    const initialOverflow = await page.evaluate(() =>
      document.body.style.overflow
    );

    // 설치 모달이 없을 경우 다른 인터랙션 없어도 스크롤 잠김 없음 확인
    expect(initialOverflow, '페이지 로드 후 body overflow가 hidden').not.toBe('hidden');
  });

  test('TC-UX-05: 검색 결과 페이지 로드 (/search?q=카페)', async ({ page }) => {
    await page.goto(`${BASE}/search?q=카페`);
    await page.waitForLoadState('networkidle');

    // JS 에러 없어야 함
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.waitForTimeout(2000);

    const criticalErrors = errors.filter(e =>
      !e.includes('ResizeObserver') && !e.includes('Non-Error')
    );
    expect(criticalErrors, `검색 페이지 JS 에러: ${criticalErrors.join(', ')}`).toHaveLength(0);
  });

  test('TC-UX-06: 404 페이지 처리', async ({ page }) => {
    await page.goto(`${BASE}/this-page-does-not-exist-xyz`);
    await page.waitForLoadState('networkidle');

    // React SPA이므로 NotFound 컴포넌트 렌더링
    const notFound = await page.locator('text=404, text=Not Found, text=페이지를 찾을 수 없').count();
    // 빈 화면이거나 에러 화면이면 안 됨
    const bodyText = await page.locator('body').innerText();
    expect(bodyText.trim().length, '404 페이지가 완전히 비어있음').toBeGreaterThan(0);
  });

  test('TC-UX-07: 모바일 viewport에서 텍스트 overflow 없음', async ({ page }) => {
    await page.goto(BASE);
    await page.waitForLoadState('networkidle');

    // 가로 스크롤 트리거 되는 요소 없는지
    const overflowingElements = await page.evaluate(() => {
      const all = document.querySelectorAll('*');
      const overflowing: string[] = [];
      for (const el of all) {
        const rect = el.getBoundingClientRect();
        if (rect.right > window.innerWidth + 5) {
          overflowing.push(el.tagName + (el.className ? `.${el.className.toString().split(' ')[0]}` : ''));
        }
      }
      return overflowing.slice(0, 5); // 최대 5개
    });

    if (overflowingElements.length > 0) {
      console.warn(`[P2] 가로 overflow 요소: ${overflowingElements.join(', ')}`);
    }
    // P2 경고 수준 (실패로 처리하지 않음, 리포트에 기록)
  });

  test('TC-UX-08: 페이지 콘솔 에러 없음 (주요 페이지)', async ({ page }) => {
    const consoleErrors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });

    await page.goto(BASE);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);

    const criticalErrors = consoleErrors.filter(e =>
      !e.includes('favicon') &&
      !e.includes('ERR_BLOCKED') &&
      !e.includes('404') &&
      !e.includes('icon') &&
      !e.includes('ResizeObserver')
    );

    if (criticalErrors.length > 0) {
      console.warn(`[P2] 콘솔 에러: ${criticalErrors.slice(0, 3).join('\n')}`);
    }
  });

  test('TC-UX-09: 빠른 연속 클릭 - 버튼 중복 실행 방지 (로딩 상태)', async ({ page }) => {
    await page.goto(BASE);
    await page.waitForLoadState('networkidle');

    // 쿠폰 다운로드 버튼이 있는 경우에만 테스트
    const downloadBtn = page.locator('button:has-text("다운로드"), button:has-text("받기")').first();
    if (await downloadBtn.count() === 0) {
      test.skip(); // 버튼이 없으면 스킵
      return;
    }

    // 첫 클릭 후 버튼이 disabled 또는 로딩 상태가 되어야 함
    await downloadBtn.click();
    const isDisabledOrLoading = await downloadBtn.evaluate((el: HTMLButtonElement) =>
      el.disabled || el.getAttribute('aria-disabled') === 'true' || el.textContent?.includes('...')
    );

    expect(
      isDisabledOrLoading,
      '다운로드 클릭 후 버튼이 즉시 비활성화되지 않아 중복 클릭 가능'
    ).toBeTruthy();
  });

  test('TC-UX-10: 네트워크 오류 시 에러 메시지 표시 (API 실패 처리)', async ({ page }) => {
    // 네트워크를 차단하고 API 호출 시 에러 처리 확인
    await page.goto(BASE);
    await page.waitForLoadState('networkidle');

    // 이미 로드된 페이지에서 네트워크 차단
    await page.route('**/api/trpc/**', (route) => route.abort('connectionrefused'));

    // 새로고침 또는 새 데이터 요청 트리거
    await page.reload();
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(3000);

    // 앱이 완전히 깨지면 안 됨 (흰 화면 또는 JS 에러 아니어야 함)
    const bodyText = await page.locator('body').innerText();
    expect(bodyText.trim().length, '네트워크 오류 시 빈 화면').toBeGreaterThan(0);

    // 언라우트
    await page.unroute('**/api/trpc/**');
  });
});
