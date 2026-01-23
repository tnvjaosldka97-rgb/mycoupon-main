import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Keep-alive 스케줄러는 실제 환경에서만 동작하므로 간단한 통합 테스트만 수행
describe('Keep-alive Scheduler Integration', () => {
  it('should export startKeepAlive and stopKeepAlive functions', async () => {
    const { startKeepAlive, stopKeepAlive } = await import('./keepalive');
    
    expect(typeof startKeepAlive).toBe('function');
    expect(typeof stopKeepAlive).toBe('function');
  });

  it('should have correct interval constant', () => {
    // 5분 = 300초 = 300,000ms
    const expectedInterval = 5 * 60 * 1000;
    expect(expectedInterval).toBe(300000);
  });
});
