/**
 * Webhook 및 브릿지 연동 테스트
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  calculateDistance,
  filterUsersByRadius,
} from './webhook';
import {
  validateBridgeSecret,
  optionalBridgeAuth,
  isAdminEmail,
  validateWebhookPayload,
  validateSocketConnection,
} from './bridgeAuth';

describe('Webhook 유틸리티 함수', () => {
  describe('calculateDistance', () => {
    it('같은 위치는 거리가 0이어야 함', () => {
      const distance = calculateDistance(37.5665, 126.9780, 37.5665, 126.9780);
      expect(distance).toBe(0);
    });

    it('서울시청과 경복궁 사이 거리 계산 (약 1.3km)', () => {
      // 서울시청: 37.5665, 126.9780
      // 경복궁: 37.5796, 126.9770
      const distance = calculateDistance(37.5665, 126.9780, 37.5796, 126.9770);
      expect(distance).toBeGreaterThan(1000); // 1km 이상
      expect(distance).toBeLessThan(2000); // 2km 미만
    });

    it('100m 이내 거리 계산', () => {
      // 약 100m 떨어진 두 지점
      const distance = calculateDistance(37.5665, 126.9780, 37.5666, 126.9791);
      expect(distance).toBeLessThan(150); // 150m 미만
    });
  });

  describe('filterUsersByRadius', () => {
    const storeLocation = { lat: 37.5665, lng: 126.9780 };
    const users = [
      { id: 1, lat: 37.5665, lng: 126.9780 }, // 0m (같은 위치)
      { id: 2, lat: 37.5666, lng: 126.9781 }, // 약 15m
      { id: 3, lat: 37.5670, lng: 126.9790 }, // 약 100m
      { id: 4, lat: 37.5700, lng: 126.9800 }, // 약 400m
      { id: 5, lat: 37.5800, lng: 126.9900 }, // 약 1.8km
    ];

    it('100m 반경 내 유저 필터링', () => {
      const result = filterUsersByRadius(storeLocation, users, 100);
      expect(result.length).toBeGreaterThanOrEqual(2); // 최소 2명
      expect(result.every(u => u.distance <= 100)).toBe(true);
    });

    it('200m 반경 내 유저 필터링', () => {
      const result = filterUsersByRadius(storeLocation, users, 200);
      expect(result.length).toBeGreaterThanOrEqual(3); // 최소 3명
      expect(result.every(u => u.distance <= 200)).toBe(true);
    });

    it('500m 반경 내 유저 필터링', () => {
      const result = filterUsersByRadius(storeLocation, users, 500);
      expect(result.length).toBeGreaterThanOrEqual(4); // 최소 4명
      expect(result.every(u => u.distance <= 500)).toBe(true);
    });

    it('거리순으로 정렬되어야 함', () => {
      const result = filterUsersByRadius(storeLocation, users, 500);
      for (let i = 1; i < result.length; i++) {
        expect(result[i].distance).toBeGreaterThanOrEqual(result[i - 1].distance);
      }
    });
  });
});

describe('브릿지 인증 유틸리티', () => {
  describe('isAdminEmail', () => {
    it('마스터 관리자 이메일 확인', () => {
      expect(isAdminEmail('tnvjaosldka97@gmail.com')).toBe(true);
      expect(isAdminEmail('sakuradaezun@gmail.com')).toBe(true);
    });

    it('일반 이메일은 관리자가 아님', () => {
      expect(isAdminEmail('user@example.com')).toBe(false);
      expect(isAdminEmail('test@gmail.com')).toBe(false);
    });
  });

  describe('validateSocketConnection', () => {
    it('userId가 없으면 유효하지 않음', () => {
      const result = validateSocketConnection('');
      expect(result.isValid).toBe(false);
      expect(result.reason).toBe('userId is required');
    });

    it('관리자 이메일로 연결 시 isAdmin이 true', () => {
      const result = validateSocketConnection(123, 'tnvjaosldka97@gmail.com');
      expect(result.isValid).toBe(true);
      expect(result.isAdmin).toBe(true);
    });

    it('일반 이메일로 연결 시 isAdmin이 false', () => {
      const result = validateSocketConnection(456, 'user@example.com');
      expect(result.isValid).toBe(true);
      expect(result.isAdmin).toBe(false);
    });
  });

  describe('validateWebhookPayload', () => {
    it('유효한 payload 검증', () => {
      const payload = {
        appId: 'mycoupon',
        event: 'coupon.created',
        userId: 123,
        timestamp: new Date().toISOString(),
        data: { couponId: 1 },
      };
      const result = validateWebhookPayload(payload);
      expect(result.isValid).toBe(true);
      expect(result.payload?.event).toBe('coupon.created');
    });

    it('appId가 mycoupon이 아니면 실패', () => {
      const payload = {
        appId: 'other',
        event: 'test',
        timestamp: new Date().toISOString(),
        data: {},
      };
      const result = validateWebhookPayload(payload);
      expect(result.isValid).toBe(false);
      expect(result.error).toBe('Invalid appId');
    });

    it('event가 없으면 실패', () => {
      const payload = {
        appId: 'mycoupon',
        timestamp: new Date().toISOString(),
        data: {},
      };
      const result = validateWebhookPayload(payload);
      expect(result.isValid).toBe(false);
    });

    it('null payload는 실패', () => {
      const result = validateWebhookPayload(null);
      expect(result.isValid).toBe(false);
    });
  });
});
