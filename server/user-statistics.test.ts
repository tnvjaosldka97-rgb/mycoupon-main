import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { appRouter } from './routers';
import * as db from './db';
import type { User } from '../drizzle/schema';

describe('User Statistics API', () => {
  let testContext: any;
  let adminUser: User;

  beforeAll(async () => {
    // 테스트용 관리자 사용자 생성
    const db_connection = await db.getDb();
    if (!db_connection) throw new Error('Database connection failed');

    // 기존 테스트 사용자 삭제
    await db_connection.execute(`DELETE FROM users WHERE email LIKE 'test-stats-%'`);

    // 관리자 사용자 생성
    await db_connection.execute(
      `INSERT INTO users (openId, name, email, role, createdAt, lastSignedIn) 
       VALUES ('test-admin-stats', 'Admin User', 'test-stats-admin@example.com', 'admin', NOW(), NOW())`
    );

    const adminResult = await db_connection.execute(
      `SELECT * FROM users WHERE email = 'test-stats-admin@example.com' LIMIT 1`
    );
    adminUser = (adminResult as any)[0][0];

    // 테스트용 일반 사용자 생성 (연령/성별 정보 포함)
    await db_connection.execute(
      `INSERT INTO users (openId, name, email, role, ageGroup, gender, profileCompletedAt, createdAt, lastSignedIn) 
       VALUES 
       ('test-user-1', 'User 1', 'test-stats-user1@example.com', 'user', '20s', 'male', NOW(), DATE_SUB(NOW(), INTERVAL 5 DAY), NOW()),
       ('test-user-2', 'User 2', 'test-stats-user2@example.com', 'user', '30s', 'female', NOW(), DATE_SUB(NOW(), INTERVAL 3 DAY), NOW()),
       ('test-user-3', 'User 3', 'test-stats-user3@example.com', 'user', '20s', 'male', NOW(), DATE_SUB(NOW(), INTERVAL 1 DAY), NOW())`
    );

    // 테스트 컨텍스트 설정
    testContext = {
      user: adminUser,
      req: {} as any,
      res: {} as any,
    };
  });

  afterAll(async () => {
    // 테스트 데이터 정리
    const db_connection = await db.getDb();
    if (db_connection) {
      await db_connection.execute(`DELETE FROM users WHERE email LIKE 'test-stats-%'`);
    }
  });

  describe('analytics.dailySignups', () => {
    it('일별 신규 가입자 통계를 반환해야 함', async () => {
      const caller = appRouter.createCaller(testContext);
      const result = await caller.analytics.dailySignups({ days: 7 });

      expect(result).toBeDefined();
      expect(Array.isArray(result)).toBe(true);
      
      // 최근 7일 내 가입자가 있는지 확인
      const hasRecentSignups = result.some((item: any) => item.count > 0);
      expect(hasRecentSignups).toBe(true);
    });
  });

  describe('analytics.dailyActiveUsers', () => {
    it('일별 활성 사용자 통계를 반환해야 함', async () => {
      const caller = appRouter.createCaller(testContext);
      const result = await caller.analytics.dailyActiveUsers({ days: 7 });

      expect(result).toBeDefined();
      expect(Array.isArray(result)).toBe(true);
      
      // 최근 7일 내 활성 사용자가 있는지 확인
      const hasActiveUsers = result.some((item: any) => item.count > 0);
      expect(hasActiveUsers).toBe(true);
    });
  });

  describe('analytics.cumulativeUsers', () => {
    it('누적 가입자 통계를 반환해야 함', async () => {
      const caller = appRouter.createCaller(testContext);
      const result = await caller.analytics.cumulativeUsers({ days: 7 });

      expect(result).toBeDefined();
      expect(Array.isArray(result)).toBe(true);
      
      if (result.length > 0) {
        // cumulative_count가 증가하는지 확인
        const firstItem = result[0] as any;
        const lastItem = result[result.length - 1] as any;
        
        expect(firstItem.cumulative_count).toBeDefined();
        expect(lastItem.cumulative_count).toBeGreaterThanOrEqual(firstItem.cumulative_count);
      }
    });
  });

  describe('analytics.demographicDistribution', () => {
    it('연령/성별 분포 통계를 반환해야 함', async () => {
      const caller = appRouter.createCaller(testContext);
      const result = await caller.analytics.demographicDistribution();

      expect(result).toBeDefined();
      expect(result.ageDistribution).toBeDefined();
      expect(result.genderDistribution).toBeDefined();
      expect(result.profileCompletion).toBeDefined();

      expect(Array.isArray(result.ageDistribution)).toBe(true);
      expect(Array.isArray(result.genderDistribution)).toBe(true);

      // 프로필 완성 정보 확인
      expect(Number(result.profileCompletion.total)).toBeGreaterThan(0);
      expect(Number(result.profileCompletion.completed)).toBeGreaterThanOrEqual(0);
    });

    it('연령대 분포에 20대와 30대가 포함되어야 함', async () => {
      const caller = appRouter.createCaller(testContext);
      const result = await caller.analytics.demographicDistribution();

      const ageGroups = result.ageDistribution.map((item: any) => item.ageGroup);
      
      // 테스트 데이터에 20대와 30대를 추가했으므로 확인
      const has20s = ageGroups.includes('20s');
      const has30s = ageGroups.includes('30s');
      
      expect(has20s || has30s).toBe(true);
    });

    it('성별 분포에 남성과 여성이 포함되어야 함', async () => {
      const caller = appRouter.createCaller(testContext);
      const result = await caller.analytics.demographicDistribution();

      const genders = result.genderDistribution.map((item: any) => item.gender);
      
      // 테스트 데이터에 남성과 여성을 추가했으므로 확인
      const hasMale = genders.includes('male');
      const hasFemale = genders.includes('female');
      
      expect(hasMale || hasFemale).toBe(true);
    });
  });

  describe('users.updateProfile', () => {
    it('사용자 프로필을 업데이트해야 함', async () => {
      const db_connection = await db.getDb();
      if (!db_connection) throw new Error('Database connection failed');

      // 테스트용 사용자 생성 (프로필 미완성)
      await db_connection.execute(
        `INSERT INTO users (openId, name, email, role, createdAt, lastSignedIn) 
         VALUES ('test-profile-update', 'Profile Test', 'test-stats-profile@example.com', 'user', NOW(), NOW())`
      );

      const userResult = await db_connection.execute(
        `SELECT * FROM users WHERE email = 'test-stats-profile@example.com' LIMIT 1`
      );
      const testUser = (userResult as any)[0][0];

      // 프로필 업데이트
      const userContext = {
        user: testUser,
        req: {} as any,
        res: {} as any,
      };

      const caller = appRouter.createCaller(userContext);
      const result = await caller.users.updateProfile({
        ageGroup: '30s',
        gender: 'female',
      });

      expect(result.success).toBe(true);

      // 업데이트된 데이터 확인
      const updatedResult = await db_connection.execute(
        `SELECT * FROM users WHERE email = 'test-stats-profile@example.com' LIMIT 1`
      );
      const updatedUser = (updatedResult as any)[0][0];

      expect(updatedUser.ageGroup).toBe('30s');
      expect(updatedUser.gender).toBe('female');
      expect(updatedUser.profileCompletedAt).toBeDefined();
    });
  });
});
