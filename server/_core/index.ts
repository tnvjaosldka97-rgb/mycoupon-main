import "dotenv/config";

// QA-N5 (PR-21): server timezone KST 강제 — Railway US-West 호스팅 시 Date 객체가 PT/UTC
//   → 사장님 분노 "지금 우리가 보는 시간과 현재시간이 달라"
// 효과: Node.js Date.toString/toLocaleString, console.log timestamp, log 출력 모두 KST
// DB timestamptz 컬럼 영향: 0 (UTC 저장 + 표시 시 client TZ 변환)
// 새 INSERT 시 new Date() 도 KST 기준 (단 DB timestamptz 면 자동 UTC 변환 후 저장)
// dotenv/config 직후 + 모든 import 전에 설정 필요 (이후 module 의 Date 캐싱 방지)
process.env.TZ = process.env.TZ || 'Asia/Seoul';

import express from "express";
import helmet from "helmet";
import { createServer } from "http";
import net from "net";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { initSentry } from './sentry';

// Sentry: DSN 없으면 조용히 skip, 있으면 모니터링 활성화
initSentry();
import { registerOAuthRoutes } from "./oauth";
import { appRouter } from "../routers";
import { createContext } from "./context";
import { serveStatic, setupVite } from "./vite";
import { ENV } from "./env";
import { startAllSchedulers } from "../scheduler";
import { startHealthCheckMonitoring } from "../monitoring";
import { startKeepAlive } from "../keepalive";
import { healthCheck } from "../health";

function isPortAvailable(port: number): Promise<boolean> {
  return new Promise(resolve => {
    const server = net.createServer();
    server.listen(port, () => {
      server.close(() => resolve(true));
    });
    server.on("error", () => resolve(false));
  });
}

async function findAvailablePort(startPort: number = 3000): Promise<number> {
  for (let port = startPort; port < startPort + 20; port++) {
    if (await isPortAvailable(port)) {
      return port;
    }
  }
  throw new Error(`No available port found starting from ${startPort}`);
}

// ── BuildSha: 서버가 어떤 커밋 기준으로 실행 중인지 추적 ──────────────────────
// Railway 자동 환경변수: RAILWAY_GIT_COMMIT_SHA
// 없으면 COMMIT_SHA, GIT_COMMIT_SHA 순으로 fallback
const BUILD_SHA = (
  process.env.RAILWAY_GIT_COMMIT_SHA ||
  process.env.COMMIT_SHA ||
  process.env.GIT_COMMIT_SHA ||
  'unknown'
).slice(0, 8); // 앞 8자만 (short sha)

async function startServer() {
  const serverStartTime = Date.now();
  console.log(`[Cold Start Measurement] Server initialization started at ${new Date().toISOString()} | buildSha: ${BUILD_SHA}`);
  
  // 🚨 CRITICAL: Railway Proxy 신뢰 설정 (HTTPS 인식)
  // Railway는 HTTPS를 HTTP로 변환해서 내부 서버로 전달
  // 이 설정이 없으면 req.protocol이 'http'로 감지되어 Secure 쿠키가 생성되지 않음
  console.log('⚠️ [Trust Proxy] Enabling trust proxy for Railway environment...');
  
  // DB 연결 풀 미리 생성 (Warm-up)
  const dbWarmupStart = Date.now();
  try {
    const { getDb } = await import("../db");
    const db = await getDb();
    console.log(`[Cold Start Measurement] DB connection pool warmed up in ${Date.now() - dbWarmupStart}ms`);
    
    // ✅ 자동 마이그레이션
    if (db) {
      // ✅ 기존 가입 완료 계정 role 업그레이드 (signup_completed_at 있지만 role='user'인 계정)
      try {
        const upgradeResult = await db.execute(`
          UPDATE users SET role = 'merchant'
          WHERE role = 'user' AND signup_completed_at IS NOT NULL
        `);
        const upgraded = (upgradeResult as any)?.rowCount ?? 0;
        if (upgraded > 0) console.log(`✅ [Migration] ${upgraded} account(s) upgraded user→merchant`);
      } catch (e) { console.error('⚠️ [Migration] role upgrade:', e); }

      // ⛔ 슈퍼어드민 권한 오염 방지 — 허용 이메일 외 admin role 즉시 박탈
      // 서버 시작마다 실행 (idempotent) — 허가되지 않은 admin이 DB에 있으면 강제 강등
      // allowlist 는 하드코딩 + 환경변수 UNION (context.ts 와 동일 정책)
      try {
        const HARDCODED_ADMINS = ['tnvjaosldka97@gmail.com', 'mycoupon.official@gmail.com'];
        const allowlist = Array.from(
          new Set<string>([...HARDCODED_ADMINS, ...ENV.masterAdminEmails])
        );
        const escaped = allowlist.map(e => `'${e.replace(/'/g, "''")}'`).join(', ');
        const revokeResult = await db.execute(
          `UPDATE users SET role = 'user' WHERE role = 'admin' AND (email IS NULL OR email NOT IN (${escaped}))`
        );
        const revoked = (revokeResult as any)?.rowCount ?? 0;
        if (revoked > 0) {
          console.warn(`⛔ [Security] Admin role revoked from ${revoked} non-allowlisted account(s)`);
        } else {
          console.log('✅ [Security] Admin allowlist check passed');
        }
      } catch (e) { console.error('⚠️ [Security] Admin revoke failed:', e); }

      // stores: soft delete 컬럼
      try {
        await db.execute(`
          ALTER TABLE stores
          ADD COLUMN IF NOT EXISTS deleted_at  TIMESTAMP,
          ADD COLUMN IF NOT EXISTS deleted_by  INTEGER
        `);
        console.log('✅ [Migration] stores soft-delete columns ready');
      } catch (e) { console.error('⚠️ [Migration] stores soft-delete:', e); }

      // users: 동의/체험 컬럼
      try {
        await db.execute(`ALTER TABLE users ADD COLUMN IF NOT EXISTS signup_completed_at TIMESTAMP`);
        await db.execute(`ALTER TABLE users ADD COLUMN IF NOT EXISTS terms_agreed_at TIMESTAMP`);
        await db.execute(`ALTER TABLE users ADD COLUMN IF NOT EXISTS privacy_agreed_at TIMESTAMP`);
        await db.execute(`ALTER TABLE users ADD COLUMN IF NOT EXISTS lbs_agreed_at TIMESTAMP`);
        await db.execute(`ALTER TABLE users ADD COLUMN IF NOT EXISTS terms_version VARCHAR(20)`);
        await db.execute(`ALTER TABLE users ADD COLUMN IF NOT EXISTS privacy_version VARCHAR(20)`);
        await db.execute(`ALTER TABLE users ADD COLUMN IF NOT EXISTS marketing_agreed BOOLEAN DEFAULT FALSE`);
        await db.execute(`ALTER TABLE users ADD COLUMN IF NOT EXISTS marketing_agreed_at TIMESTAMP`);
        await db.execute(`ALTER TABLE users ADD COLUMN IF NOT EXISTS trial_ends_at TIMESTAMP`);
        // 기존 사용자 grandfather: consent 기능 도입(2026-03-05) 이전 가입 계정만
        // ⚠️ 이 backfill은 매 재시작마다 실행되므로 신규 계정을 포함하면 안 됨
        // last_signed_in이 consent 도입 이전인 계정만 자동 동의 완료 처리
        await db.execute(`
          UPDATE users
          SET signup_completed_at = COALESCE(last_signed_in, created_at)
          WHERE signup_completed_at IS NULL
            AND last_signed_in IS NOT NULL
            AND last_signed_in < '2026-03-05 00:00:00'::timestamp
        `);
        // privacy_agreed_at backfill: terms_agreed_at이 있으면 동시에 동의한 것으로 간주
        await db.execute(`
          UPDATE users
          SET privacy_agreed_at = terms_agreed_at
          WHERE terms_agreed_at IS NOT NULL AND privacy_agreed_at IS NULL
        `);
        console.log('✅ [Migration] users consent columns ready');
      } catch (e) { console.error('⚠️ [Migration] users consent:', e); }

      // Trial 시작 시점 정책 변경 보정 (stores.create → coupons.create)
      //
      // 대상: 모든 가게를 통틀어 쿠폰이 단 1건도 없는 사용자
      //   (가게 A에 쿠폰 있고 가게 B에 없는 사용자는 제외 — 이미 trial 사용 중)
      //
      // 이전 버그 패턴:
      //   IN (SELECT owner_id FROM stores WHERE NOT EXISTS coupons)
      //   → "쿠폰 없는 가게가 하나라도 있는 owner"까지 포함 → 잘못된 reset 위험
      //
      // 수정된 패턴 (users 행 단위 NOT EXISTS):
      //   NOT EXISTS (이 사용자의 어떤 가게에도 쿠폰 없음)
      //   → 사용자 전체 가게 기준으로 쿠폰 여부 판정
      //
      // 멱등성: reset 후 trial_ends_at=NULL → WHERE 조건 재매칭 없음
      try {
        const trialResetResult = await db.execute(`
          UPDATE users
          SET trial_ends_at = NULL, updated_at = NOW()
          WHERE trial_ends_at IS NOT NULL
            AND role != 'admin'
            AND is_franchise = FALSE
            AND NOT EXISTS (
              SELECT 1
              FROM coupons c
              JOIN stores s ON c.store_id = s.id
              WHERE s.owner_id = users.id
                AND s.deleted_at IS NULL
            )
            AND EXISTS (
              SELECT 1
              FROM stores s
              WHERE s.owner_id = users.id
                AND s.deleted_at IS NULL
            )
        `);
        const affected = (trialResetResult as any)?.rowCount ?? (trialResetResult as any)?.rowsAffected ?? 0;
        if (affected > 0) {
          console.log(`✅ [Migration] trial reset: ${affected}명 trial_ends_at 초기화 (모든 가게에 쿠폰 없음)`);
        } else {
          console.log('✅ [Migration] trial reset: 보정 대상 없음 (이미 적용 완료)');
        }
      } catch (e) { console.error('⚠️ [Migration] trial reset:', e); }

      // ✅ 자동 마이그레이션: daily_limit 컬럼 추가
      try {
        console.log('[Migration] Checking daily_limit columns...');
        await db.execute(`
          ALTER TABLE coupons 
          ADD COLUMN IF NOT EXISTS daily_limit INTEGER,
          ADD COLUMN IF NOT EXISTS daily_used_count INTEGER DEFAULT 0,
          ADD COLUMN IF NOT EXISTS last_reset_date TIMESTAMP DEFAULT NOW();
        `);
        console.log('✅ [Migration] daily_limit columns ready');
      } catch (migrationError) {
        console.error('⚠️ [Migration] Error (non-critical):', migrationError);
      }

      // ✅ 자동 마이그레이션: 구독팩 / 계급 테이블 추가
      // - PostgreSQL custom ENUM 대신 VARCHAR 사용 (Drizzle execute 호환성)
      // - CREATE TABLE IF NOT EXISTS → 멱등성 보장
      // - 테이블 생성 후 pg_tables 조회로 존재 여부를 반드시 검증
      // - 인덱스: (user_id, requested_pack, status) WHERE status IN (...) → 중복 방지 쿼리 최적화

      // user_plans 테이블
      try {
        await db.execute(`
          CREATE TABLE IF NOT EXISTS user_plans (
            id                    SERIAL PRIMARY KEY,
            user_id               INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            tier                  VARCHAR(20) NOT NULL DEFAULT 'FREE',
            starts_at             TIMESTAMP NOT NULL DEFAULT NOW(),
            expires_at            TIMESTAMP,
            default_duration_days INTEGER NOT NULL DEFAULT 7,
            default_coupon_quota  INTEGER NOT NULL DEFAULT 10,
            is_active             BOOLEAN NOT NULL DEFAULT TRUE,
            created_by_admin_id   INTEGER,
            memo                  TEXT,
            created_at            TIMESTAMP NOT NULL DEFAULT NOW(),
            updated_at            TIMESTAMP NOT NULL DEFAULT NOW()
          )
        `);
        // 존재 여부 확인
        const upCheck = await db.execute(`
          SELECT 1 FROM information_schema.tables
          WHERE table_schema = 'public' AND table_name = 'user_plans'
        `);
        const upExists = (upCheck as any)?.rows?.length > 0 || (upCheck as any)?.[0]?.length > 0;
        console.log(`✅ [Migration] user_plans table ready (exists=${upExists})`);
      } catch (e) {
        console.error('⚠️ [Migration] user_plans error:', e);
      }

      // pack_order_requests 테이블
      try {
        await db.execute(`
          CREATE TABLE IF NOT EXISTS pack_order_requests (
            id              SERIAL PRIMARY KEY,
            user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            store_id        INTEGER,
            requested_pack  VARCHAR(50) NOT NULL,
            status          VARCHAR(20) NOT NULL DEFAULT 'REQUESTED',
            admin_memo      TEXT,
            created_at      TIMESTAMP NOT NULL DEFAULT NOW(),
            updated_at      TIMESTAMP NOT NULL DEFAULT NOW()
          )
        `);

        // 중복 방지용 부분 유니크 인덱스 (멱등성 보장 + ON CONFLICT 사용 가능)
        await db.execute(`
          CREATE UNIQUE INDEX IF NOT EXISTS idx_pack_orders_active_unique
          ON pack_order_requests(user_id, requested_pack)
          WHERE status IN ('REQUESTED', 'CONTACTED')
        `);

        // 존재 여부 확인 (Railway 로그에서 반드시 확인할 것)
        const porCheck = await db.execute(`
          SELECT COUNT(*) as cnt FROM information_schema.tables
          WHERE table_schema = 'public' AND table_name = 'pack_order_requests'
        `);
        const porRows = (porCheck as any)?.rows ?? (porCheck as any)?.[0] ?? [];
        const porExists = Number(porRows[0]?.cnt ?? porRows[0]?.count ?? 0) > 0;
        console.log(`✅ [Migration] pack_order_requests table ready (exists=${porExists})`);
        if (!porExists) {
          console.error('🚨 [Migration] pack_order_requests 테이블이 생성되지 않았습니다! DB 권한 또는 연결을 확인하세요.');
        }
      } catch (e) {
        console.error('⚠️ [Migration] pack_order_requests error:', e);
      }

      // admin_audit_logs 테이블 (관리자 행위 DB 감사 로그)
      try {
        await db.execute(`
          CREATE TABLE IF NOT EXISTS admin_audit_logs (
            id          SERIAL PRIMARY KEY,
            admin_id    INTEGER NOT NULL,
            action      VARCHAR(100) NOT NULL,
            target_type VARCHAR(50),
            target_id   INTEGER,
            payload     JSONB,
            created_at  TIMESTAMP NOT NULL DEFAULT NOW()
          )
        `);
        await db.execute(`CREATE INDEX IF NOT EXISTS idx_audit_admin_id   ON admin_audit_logs(admin_id)`);
        await db.execute(`CREATE INDEX IF NOT EXISTS idx_audit_created_at ON admin_audit_logs(created_at DESC)`);
        await db.execute(`CREATE INDEX IF NOT EXISTS idx_audit_action      ON admin_audit_logs(action)`);
        console.log('✅ [Migration] admin_audit_logs table ready');
      } catch (e) {
        console.error('⚠️ [Migration] admin_audit_logs error:', e);
      }

      // admin_checked_items 테이블 (신규 요청 확인 상태 추적)
      try {
        await db.execute(`
          CREATE TABLE IF NOT EXISTS admin_checked_items (
            id          SERIAL PRIMARY KEY,
            item_type   VARCHAR(30) NOT NULL,
            item_id     INTEGER NOT NULL,
            checked_by  INTEGER NOT NULL REFERENCES users(id),
            checked_at  TIMESTAMP NOT NULL DEFAULT NOW()
          )
        `);
        await db.execute(`CREATE UNIQUE INDEX IF NOT EXISTS idx_admin_checked_type_id ON admin_checked_items(item_type, item_id)`);
        await db.execute(`CREATE INDEX IF NOT EXISTS idx_admin_checked_type ON admin_checked_items(item_type)`);
        console.log('✅ [Migration] admin_checked_items table ready');
      } catch (e) {
        console.error('⚠️ [Migration] admin_checked_items error:', e);
      }

      // users.favorite_food_top3 컬럼 추가 (additive)
      try {
        await db.execute(`ALTER TABLE users ADD COLUMN IF NOT EXISTS favorite_food_top3 TEXT`);
        console.log('✅ [Migration] users.favorite_food_top3 column ready');
      } catch (e) {
        console.error('⚠️ [Migration] users.favorite_food_top3 error:', e);
      }

      // favorites.notify_new_coupon 컬럼 추가 (additive, Phase C2b-1)
      // - 단골 등록된 매장에 신규 쿠폰 활성화 시 push/알림 대상 여부
      // - DEFAULT TRUE: 기존 row(단골 등록 이미 된 유저) 는 자동 알림 ON
      // - 유저가 개별 해제 가능 (미래 UI — 런칭 후 별건)
      try {
        await db.execute(
          `ALTER TABLE favorites ADD COLUMN IF NOT EXISTS notify_new_coupon BOOLEAN NOT NULL DEFAULT TRUE`
        );
        console.log('✅ [Migration] favorites.notify_new_coupon column ready');
      } catch (e) {
        console.error('⚠️ [Migration] favorites.notify_new_coupon error:', e);
      }

      // notification_send_logs 테이블 (알림 발송 중복 방지)
      try {
        await db.execute(`
          CREATE TABLE IF NOT EXISTS notification_send_logs (
            id        SERIAL PRIMARY KEY,
            user_id   INTEGER NOT NULL,
            type      VARCHAR(50) NOT NULL,
            coupon_id INTEGER,
            sent_at   TIMESTAMP NOT NULL DEFAULT NOW()
          )
        `);
        await db.execute(`
          CREATE UNIQUE INDEX IF NOT EXISTS idx_notif_send_dedup
          ON notification_send_logs(user_id, type, coupon_id)
          WHERE coupon_id IS NOT NULL
        `);
        await db.execute(`CREATE INDEX IF NOT EXISTS idx_notif_send_user ON notification_send_logs(user_id)`);
        console.log('✅ [Migration] notification_send_logs table ready');
      } catch (e) {
        console.error('⚠️ [Migration] notification_send_logs error:', e);
      }

      // app_login_tickets: Android 앱 1회용 로그인 ticket (DB 영속 저장)
      // 이전: 프로세스 메모리 Map → Railway 재시작/멀티 인스턴스 시 ticket 소실 → 간헐 로그인 실패
      // 현재: PostgreSQL 영속 저장 → 인스턴스 무관, 원자적 exchange 보장
      try {
        await db.execute(`
          CREATE TABLE IF NOT EXISTS app_login_tickets (
            ticket      VARCHAR(64)  PRIMARY KEY,
            open_id     VARCHAR(255) NOT NULL,
            session_token TEXT       NOT NULL,
            expires_at  TIMESTAMP    NOT NULL,
            used        BOOLEAN      NOT NULL DEFAULT FALSE,
            created_at  TIMESTAMP    NOT NULL DEFAULT NOW()
          )
        `);
        // expires_at 인덱스 — 정기 cleanup 쿼리 (WHERE expires_at < NOW()) 성능 보장
        await db.execute(`
          CREATE INDEX IF NOT EXISTS idx_app_tickets_expires_at
          ON app_login_tickets(expires_at)
        `);
        // 만료 ticket 정기 정리 (1분 이상 지난 만료분)
        await db.execute(`
          DELETE FROM app_login_tickets WHERE expires_at < NOW() - INTERVAL '1 minute'
        `);
        console.log('✅ [Migration] app_login_tickets table + expires_at index ready');
      } catch (e) {
        console.error('⚠️ [Migration] app_login_tickets error:', e);
      }

      // ── 유저 알림 맥락화 (user notification context) — additive 마이그레이션 ────────────
      // docs/2026-04-17-user-notification-coupon-finder-design.md Phase 1
      // 목적: 상단 알림 → 쿠폰찾기 랜딩 시 "조르기 확인하기 / 새로 오픈했어요" 2개 탭 UX 지원
      // 원칙: 기존 컬럼 의미 무변경, 모두 nullable 또는 DEFAULT 보유, ORM/클라이언트 하위호환
      try {
        // 1) coupon_extension_requests (조르기): store 단위 granularity + 매칭 소비 시각
        //    - 기존 (user_id, owner_id, store_name) 구조 유지
        //    - store_id (nullable FK): 이후 신규 조르기부터 매장 단위로 정확히 매칭
        //    - consumed_at: "이 조르기는 어떤 쿠폰 활성화 이벤트로 소비됐다" 표시 (탭 클릭 시 NOW())
        await db.execute(`
          ALTER TABLE coupon_extension_requests
            ADD COLUMN IF NOT EXISTS store_id INTEGER REFERENCES stores(id) ON DELETE SET NULL,
            ADD COLUMN IF NOT EXISTS consumed_at TIMESTAMP
        `);
        // 조회 핫패스: "아직 미소비된 내 조르기" (user_id, consumed_at IS NULL)
        await db.execute(`
          CREATE INDEX IF NOT EXISTS idx_cer_user_store_consumed
            ON coupon_extension_requests(user_id, store_id, consumed_at)
            WHERE store_id IS NOT NULL
        `);

        // 2) 레거시 row 백필 (B안) — owner_id + store_name 으로 매장 단일 매칭 성공분만 store_id 채움
        //    - 동명 매장/다매장 등 매칭 2건 이상이면 NULL 유지 (안전)
        //    - 매칭 실패분도 NULL 유지 — 과거 이력 삭제 금지
        //    - 재실행 안전: store_id IS NULL 인 row에만 적용
        await db.execute(`
          UPDATE coupon_extension_requests cer
          SET store_id = sub.id
          FROM (
            SELECT cer2.id AS cer_id, s.id
            FROM coupon_extension_requests cer2
            JOIN stores s
              ON s.owner_id = cer2.owner_id
             AND s.name = cer2.store_name
             AND s.deleted_at IS NULL
            WHERE cer2.store_id IS NULL
              AND cer2.store_name <> ''
              AND (
                SELECT COUNT(*) FROM stores s2
                WHERE s2.owner_id = cer2.owner_id
                  AND s2.name = cer2.store_name
                  AND s2.deleted_at IS NULL
              ) = 1
          ) sub
          WHERE cer.id = sub.cer_id
        `);

        // 3) coupons.last_activated_at: 최초 승인 + 재승인/재활성화 시각 추적
        //    - 기존 approved_at은 raw 의미 보존 (최초 승인 시각으로 계속 사용 가능)
        //    - last_activated_at은 derived additive: 재승인 때도 갱신됨
        await db.execute(`
          ALTER TABLE coupons
            ADD COLUMN IF NOT EXISTS last_activated_at TIMESTAMP
        `);
        // 기존 승인된 쿠폰은 approved_at으로 1회성 backfill (NULL인 경우에만)
        await db.execute(`
          UPDATE coupons
          SET last_activated_at = approved_at
          WHERE last_activated_at IS NULL AND approved_at IS NOT NULL
        `);
        // "조르기 업장에 새로 켜진 쿠폰" 조회 최적화
        await db.execute(`
          CREATE INDEX IF NOT EXISTS idx_coupons_store_last_activated
            ON coupons(store_id, last_activated_at DESC)
            WHERE is_active = TRUE AND approved_by IS NOT NULL
        `);

        // 4) notification_type enum 값 2종 추가 (유저 체감 이벤트 전용)
        //    - 기존 값 보존: coupon_expiring, new_coupon, nearby_store, mission_complete, level_up, general
        //    - 신규: nudge_activated(조르기한 업장 쿠폰 활성화), newly_opened_nearby(반경 내 신규 오픈)
        //    - enum ADD VALUE는 트랜잭션 밖에서만 실행 가능 — execute(raw) 단건 호출이라 OK
        await db.execute(`
          ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'nudge_activated'
        `);
        await db.execute(`
          ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'newly_opened_nearby'
        `);
        // 2026-04-25: 사장님 대상 알림 2종 추가
        await db.execute(`
          ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'merchant_coupon_reminder'
        `);
        await db.execute(`
          ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'merchant_plan_expiry_reminder'
        `);
        // email_type enum 도 동일하게 보강
        await db.execute(`
          ALTER TYPE email_type ADD VALUE IF NOT EXISTS 'merchant_renewal_nudge'
        `);
        await db.execute(`
          ALTER TYPE email_type ADD VALUE IF NOT EXISTS 'merchant_coupon_reminder'
        `);
        await db.execute(`
          ALTER TYPE email_type ADD VALUE IF NOT EXISTS 'merchant_plan_expiry_reminder'
        `);

        // ── 2026-04-26: Phase 2b — 사장님 카테고리 2종 추가 (D9-1 = δ 분리) ──
        await db.execute(`
          ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'merchant_coupon_exhausted'
        `);
        await db.execute(`
          ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'merchant_nudge_received'
        `);

        // ── 2026-04-26: Phase 2b — dispatch_channel ENUM (push/email/inapp) ──
        // CREATE TYPE 은 IF NOT EXISTS 미지원 → DO $$ EXCEPTION 블록 패턴
        await db.execute(`
          DO $$ BEGIN
            CREATE TYPE dispatch_channel AS ENUM ('push','email','inapp');
          EXCEPTION WHEN duplicate_object THEN NULL; END $$
        `);

        // ── 2026-04-26: Phase 2b — notification_dispatch_log 테이블 + 인덱스 (D8 = A 신규) ──
        await db.execute(`
          CREATE TABLE IF NOT EXISTS notification_dispatch_log (
            id SERIAL PRIMARY KEY,
            user_id INTEGER NOT NULL,
            category notification_type NOT NULL,
            channel dispatch_channel NOT NULL,
            sent_at TIMESTAMP NOT NULL DEFAULT NOW(),
            success_count INTEGER NOT NULL DEFAULT 0,
            failure_count INTEGER NOT NULL DEFAULT 0,
            invalid_count INTEGER NOT NULL DEFAULT 0,
            blocked_reason VARCHAR(50)
          )
        `);
        await db.execute(`
          CREATE INDEX IF NOT EXISTS idx_dispatch_log_cap
            ON notification_dispatch_log(user_id, sent_at)
        `);
        await db.execute(`
          CREATE INDEX IF NOT EXISTS idx_dispatch_log_cooldown
            ON notification_dispatch_log(user_id, category, sent_at)
        `);

        // ── 2026-04-26: Phase 2b — notification_pending_queue 테이블 + 인덱스 (D12 야간 큐) ──
        await db.execute(`
          CREATE TABLE IF NOT EXISTS notification_pending_queue (
            id SERIAL PRIMARY KEY,
            user_id INTEGER NOT NULL,
            category notification_type NOT NULL,
            payload JSONB NOT NULL,
            enqueued_at TIMESTAMP NOT NULL DEFAULT NOW(),
            scheduled_for TIMESTAMP NOT NULL,
            processed_at TIMESTAMP
          )
        `);
        await db.execute(`
          CREATE INDEX IF NOT EXISTS idx_pending_queue_flush
            ON notification_pending_queue(scheduled_for, processed_at)
        `);

        // ── 2026-04-26: Phase 2c — notification_stats 테이블 (chunk bulk 발송 통계) ──
        // drizzle/schema.ts:437 notificationStats 정의 + db.ts:1581 createNotificationGroup INSERT.
        // Phase 2b-1 자동 마이그 추가 시 누락 — production 부재 시 routers.ts:2834 throw → silent fail.
        // IF NOT EXISTS 멱등 — 이미 존재하는 환경 영향 0.
        await db.execute(`
          CREATE TABLE IF NOT EXISTS notification_stats (
            id              SERIAL PRIMARY KEY,
            group_id        VARCHAR(128) NOT NULL UNIQUE,
            title           VARCHAR(255) NOT NULL,
            sent_count      INTEGER NOT NULL DEFAULT 0,
            delivered_count INTEGER NOT NULL DEFAULT 0,
            open_count      INTEGER NOT NULL DEFAULT 0,
            created_at      TIMESTAMP NOT NULL DEFAULT NOW()
          )
        `);

        // ── 2026-04-28: 슈퍼어드민 공지/이벤트 게시판 (notice_posts) ──
        await db.execute(`
          CREATE TABLE IF NOT EXISTS notice_posts (
            id SERIAL PRIMARY KEY,
            title VARCHAR(200) NOT NULL,
            body TEXT NOT NULL,
            image_urls JSONB,
            author_id INTEGER NOT NULL,
            is_pinned BOOLEAN NOT NULL DEFAULT FALSE,
            view_count INTEGER NOT NULL DEFAULT 0,
            created_at TIMESTAMP NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMP NOT NULL DEFAULT NOW()
          )
        `);
        await db.execute(`
          CREATE INDEX IF NOT EXISTS idx_notice_posts_list
            ON notice_posts(is_pinned DESC, created_at DESC)
        `);

        // ── 2026-04-30: PR-23 D4 — 사용자 1만 도달 전 핵심 인덱스 추가 ──
        // 첫 런칭 ~ 1만 사용자 시점 가장 자주 사용되는 query 의 full scan 방어
        // IF NOT EXISTS 멱등 — 이미 존재 시 영향 0. 빌드 시간: 기존 row 적어 무시 가능
        await db.execute(`
          CREATE INDEX IF NOT EXISTS idx_stores_category
            ON stores(category)
        `);
        await db.execute(`
          CREATE INDEX IF NOT EXISTS idx_stores_active_deleted
            ON stores(is_active, deleted_at)
        `);
        await db.execute(`
          CREATE INDEX IF NOT EXISTS idx_coupons_store
            ON coupons(store_id)
        `);
        await db.execute(`
          CREATE INDEX IF NOT EXISTS idx_coupons_active_end
            ON coupons(is_active, end_date)
        `);
        await db.execute(`
          CREATE INDEX IF NOT EXISTS idx_user_coupons_user_status
            ON user_coupons(user_id, status)
        `);
        await db.execute(`
          CREATE INDEX IF NOT EXISTS idx_notifications_user_created
            ON notifications(user_id, created_at DESC)
        `);

        console.log('✅ [Migration] user_notification_context (nudge store_id + last_activated_at + enum values incl. merchant reminders) ready');
      } catch (e) {
        console.error('⚠️ [Migration] user_notification_context error (non-critical):', e);
      }

      // ── 2026-04-30: PR-23 N5+ — KST 진단 SQL (1회성 startup 로그) ──
      // 사장님 명시: SQL 직접 실행 + Railway log 결과 보고
      // 진단 목적: DB 서버 timezone + 기존 데이터 raw 시간 확인 → backfill 정책 결정
      try {
        const tzResult: any = await db.execute(`SHOW timezone`);
        const tzRows = (tzResult as any).rows ?? tzResult;
        console.log('🕐 [TZ-DIAG] DB server timezone:', JSON.stringify(tzRows));

        const nowResult: any = await db.execute(`
          SELECT
            NOW() as db_now,
            NOW() AT TIME ZONE 'Asia/Seoul' as kst_view,
            EXTRACT(HOUR FROM NOW()) as raw_hour
        `);
        const nowRows = (nowResult as any).rows ?? nowResult;
        console.log('🕐 [TZ-DIAG] NOW() snapshot:', JSON.stringify(nowRows));

        const storesResult: any = await db.execute(`
          SELECT id, name, created_at,
            EXTRACT(HOUR FROM created_at) as raw_hour
          FROM stores
          ORDER BY id DESC
          LIMIT 5
        `);
        const storesRows = (storesResult as any).rows ?? storesResult;
        console.log('🕐 [TZ-DIAG] stores latest 5:', JSON.stringify(storesRows));

        const couponsResult: any = await db.execute(`
          SELECT id, title, created_at,
            EXTRACT(HOUR FROM created_at) as raw_hour
          FROM coupons
          ORDER BY id DESC
          LIMIT 5
        `);
        const couponsRows = (couponsResult as any).rows ?? couponsResult;
        console.log('🕐 [TZ-DIAG] coupons latest 5:', JSON.stringify(couponsRows));

        console.log('🕐 [TZ-DIAG] 진단 완료 — backfill 결정 기준 확보');
      } catch (e) {
        console.error('⚠️ [TZ-DIAG] error (non-critical):', e);
      }

      // ── 2026-04-30: PR-23 AUDIT-DIAG — admin_audit_logs 진단 (히스토리 안 찍힘 분석) ──
      // 사장님 분노: "지금 계급관리 히스토리쪽 안 찍힘 로직 빠진듯"
      // 가설: wipe CASCADE 후 admin_audit_logs row 0 → 새 작업 1번 후 INSERT 됐는지 확인
      try {
        const auditCount: any = await db.execute(`SELECT COUNT(*) as cnt FROM admin_audit_logs`);
        const auditCountRows = (auditCount as any).rows ?? auditCount;
        console.log('📋 [AUDIT-DIAG] admin_audit_logs row count:', JSON.stringify(auditCountRows));

        const auditLatest: any = await db.execute(`
          SELECT id, action, target_type, target_id, admin_id, created_at
          FROM admin_audit_logs
          ORDER BY created_at DESC
          LIMIT 5
        `);
        const auditLatestRows = (auditLatest as any).rows ?? auditLatest;
        console.log('📋 [AUDIT-DIAG] admin_audit_logs latest 5:', JSON.stringify(auditLatestRows));

        const planActions: any = await db.execute(`
          SELECT action, COUNT(*) as cnt
          FROM admin_audit_logs
          WHERE action IN ('admin_set_user_plan', 'admin_adjust_plan_quota', 'admin_terminate_plan', 'auto_plan_expired')
          GROUP BY action
        `);
        const planActionsRows = (planActions as any).rows ?? planActions;
        console.log('📋 [AUDIT-DIAG] plan action counts:', JSON.stringify(planActionsRows));
      } catch (e) {
        console.error('⚠️ [AUDIT-DIAG] error (non-critical):', e);
      }

      // ── 2026-04-30: PR-26 WIPE-AUTO — sentinel 패턴 1회 자동 wipe ──
      // 사장님 명시: "나한테 시키지 말고 니가 해야지" + "더미데이터 + 가게 + 쿠폰 삭제"
      // 패턴: _wipe_sentinel 테이블에 표식 row 없으면 1회 wipe + 표식 INSERT.
      //   다음 startup 부터는 표식 보고 skip → 영구 1회 보장.
      //   다시 wipe 필요 시 사장님 SQL: DELETE FROM _wipe_sentinel WHERE id = 1; → 다음 deploy 시 재실행.
      // 보존: jobRuns, feature_flags, _wipe_sentinel 등 시스템 메타
      // 사장님 admin: HARDCODED_ADMIN_EMAILS allowlist 가 OAuth 재로그인 시 자동 admin 부여
      try {
        await db.execute(`
          CREATE TABLE IF NOT EXISTS _wipe_sentinel (
            id INTEGER PRIMARY KEY,
            wiped_at TIMESTAMP NOT NULL DEFAULT NOW(),
            note TEXT
          )
        `);
        const sentinel: any = await db.execute(`SELECT id FROM _wipe_sentinel WHERE id = 1`);
        const sentinelRows = (sentinel as any).rows ?? sentinel;
        if (Array.isArray(sentinelRows) && sentinelRows.length === 0) {
          console.log('🧨 [WIPE-AUTO] sentinel 없음 — 비즈니스 데이터 1회 wipe 시작');
          await db.execute(`
            TRUNCATE
              users,
              stores,
              coupons
            RESTART IDENTITY CASCADE
          `);
          await db.execute(`
            INSERT INTO _wipe_sentinel (id, note)
            VALUES (1, 'PR-26 1회 자동 wipe — 더미 데이터 정리')
          `);
          console.log('✅ [WIPE-AUTO] 비즈니스 데이터 wipe 완료 + sentinel set. 사장님 OAuth 재로그인 시 admin 자동 부여.');
        } else {
          console.log('ℹ️ [WIPE-AUTO] sentinel 존재 — wipe skip (이미 1회 실행됨)');
        }
      } catch (e) {
        console.error('🚨 [WIPE-AUTO] 실패:', e);
        // wipe 실패해도 server 부팅은 진행 (non-blocking)
      }

      // ── 1회성 과거 데이터 정합성 감지 ────────────────────────────────────
      // 유료 플랜 만료 후에도 active 쿠폰이 남아있는 유저를 감지해 경고 로깅.
      // 실제 정리는 admin.runReconciliation endpoint 또는 스케줄러로 처리.
      try {
        const orphanCheck = await db.execute(`
          SELECT COUNT(DISTINCT u.id) AS cnt
          FROM users u
          INNER JOIN user_plans up ON up.user_id = u.id
            AND up.tier != 'FREE'
            AND up.expires_at IS NOT NULL
            AND up.expires_at < NOW()
          INNER JOIN stores s ON s.owner_id = u.id AND s.deleted_at IS NULL
          INNER JOIN coupons c ON c.store_id = s.id AND c.is_active = TRUE
          WHERE NOT EXISTS (
            SELECT 1 FROM user_plans up2
            WHERE up2.user_id = u.id
              AND up2.is_active = TRUE
              AND (up2.expires_at IS NULL OR up2.expires_at > NOW())
          )
        `);
        const orphanRows = (orphanCheck as any)?.rows ?? [];
        const orphanCount = Number(orphanRows[0]?.cnt ?? 0);
        if (orphanCount > 0) {
          console.warn(`⚠️ [Reconciliation] ${orphanCount}명의 만료 유저가 FREE 기준 초과 active 쿠폰을 보유 중.`);
          console.warn('   → admin.runReconciliation API로 1회성 정리 가능.');
        } else {
          console.log('✅ [Reconciliation] 과거 데이터 정합성 이상 없음.');
        }
      } catch (e) {
        console.error('⚠️ [Reconciliation] 과거 데이터 감지 실패 (non-critical):', e);
      }
    }
  } catch (error) {
    console.error('[Cold Start Measurement] DB warm-up failed:', error);
  }
  
  const app = express();
  const server = createServer(app);
  
  // 🚨 CRITICAL: Railway Proxy 신뢰 설정 (HTTPS 쿠키 생성)
  // Railway는 HTTPS를 HTTP로 변환 → 이 설정 없으면 Secure 쿠키가 생성 안 됨!
  app.set('trust proxy', 1);
  console.log('✅ [Trust Proxy] Railway proxy trusted - HTTPS detection enabled');

  // 🔒 SEC-004: HTTP 보안 헤더 (HSTS, X-Frame-Options, X-Content-Type-Options 등)
  // CSP는 프론트엔드 리소스 분석 후 별도 설정 예정
  app.use(helmet({ contentSecurityPolicy: false }));
  
  // 헬스체크 엔드포인트를 가장 먼저 등록 (미들웨어 우회)
  // Keep-alive health check endpoint (ultra-fast)
  app.get("/api/health", async (req, res) => {
    const healthStatus = await healthCheck();
    res.json(healthStatus);
  });
  
  // Android App Links 검증 파일 — Android OAuth 자동 복귀에 필요
  // Google Play Console에서 앱을 등록하고 SHA-256 지문을 얻은 후 sha256_cert_fingerprints를 업데이트하세요.
  // 현재는 placeholder — App Links 없이도 OAuth는 동작하지만, 자동 앱 복귀는 이 파일이 필요합니다.
  app.get("/.well-known/assetlinks.json", (req, res) => {
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Cache-Control', 'no-cache');
    // TODO: sha256_cert_fingerprints를 실제 앱 서명 지문으로 교체
    //       Play Console > 앱 서명 > SHA-256 인증서 지문 참조
    // sha256_cert_fingerprints 배열에 두 가지 지문을 모두 등록:
    //   [0] 로컬 release keystore SHA-256 (직접 APK 설치 / 개발 테스트용)
    //   [1] Play Console App Signing SHA-256 (스토어 배포본용 — Play Console > 앱 서명에서 확인)
    //
    // Play App Signing 미사용(직접 서명 배포)이면 [0]만 유지해도 됩니다.
    // 두 지문을 모두 등록하면 직접 설치본 + 스토어 배포본 모두 App Links 검증을 통과합니다.
    const fingerprints: string[] = [
      "62:F3:37:A3:D0:63:E7:8F:E3:A3:BD:F1:F3:1A:36:A3:7F:D4:40:D7:A1:52:3B:96:90:BF:C1:30:DF:A8:5B:AC",
      // TODO: Play Console > 앱 서명 > "앱 서명 키 인증서 SHA-256" 확인 후 아래에 추가
      // "XX:XX:XX:...",
    ].filter(Boolean);

    res.json([
      {
        relation: ["delegate_permission/common.handle_all_urls"],
        target: {
          namespace: "android_app",
          package_name: "com.mycoupon.app",
          sha256_cert_fingerprints: fingerprints,
        },
      },
    ]);
  });

  // ── Android APK 다운로드 엔드포인트 ─────────────────────────────────────────
  // ANDROID_APK_URL 환경변수: Railway Variables에 설정 (빌드 불필요, 런타임 변수)
  // 설정된 경우: APK 직접 다운로드 (302 redirect)
  // 미설정 시: /install PWA 안내 페이지로 fallback (dead link 없음)
  app.get("/api/download/android", (req, res) => {
    const apkUrl = process.env.ANDROID_APK_URL;
    if (apkUrl && apkUrl.startsWith('http')) {
      res.redirect(302, apkUrl);
    } else {
      // APK 미준비 → PWA 홈화면 추가 안내로 fallback (404 없음)
      res.redirect(302, '/install');
    }
  });

  // REST healthz endpoint (no-cache, bypasses Service Worker)
  // buildSha: 어떤 커밋 기준으로 실행 중인지 확인 가능
  app.get("/healthz", (req, res) => {
    res.json({
      status: "ok",
      version: process.env.VITE_APP_VERSION || "unknown",
      buildSha: BUILD_SHA,
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
    });
  });
  
  // Deep Awake 엔드포인트 - Railway 브릿지 서버에서 서버 깨우기
  // DB Connection Pool까지 즉시 활성화
  app.get("/api/awake", async (req, res) => {
    const startTime = Date.now();
    const bridgeSecret = req.headers['x-bridge-secret'];
    // hardcoded fallback 제거: 미설정 시 "" → isAuthenticated=false (의도된 동작)
    const expectedSecret = process.env.BRIDGE_SECRET ?? "";

    // 보안 인증 (선택적 - Secret이 없으면 기본 응답)
    const isAuthenticated = !!expectedSecret && bridgeSecret === expectedSecret;
    
    try {
      // DB Connection Pool 활성화 (SELECT 1 쿼리 실행)
      const { getDb } = await import("../db");
      const db = await getDb();
      if (!db) {
        throw new Error('DB connection failed');
      }
      const dbStartTime = Date.now();
      await db.execute('SELECT 1 as awake_check');
      const dbLatency = Date.now() - dbStartTime;
      
      const totalLatency = Date.now() - startTime;
      
      console.log(`[Awake] 서버 깨우기 성공 - DB: ${dbLatency}ms, Total: ${totalLatency}ms, Auth: ${isAuthenticated}`);
      
      res.json({
        status: "awake",
        message: "마이쿠폰 서버가 활성화되었습니다.",
        authenticated: isAuthenticated,
        dbConnectionActive: true,
        latency: {
          db: dbLatency,
          total: totalLatency,
        },
        uptime: process.uptime(),
        timestamp: new Date().toISOString(),
        version: process.env.VITE_APP_VERSION || "unknown",
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      console.error(`[Awake] 서버 깨우기 실패:`, errorMessage);
      
      res.status(500).json({
        status: "error",
        message: "서버 깨우기 실패",
        error: errorMessage,
        timestamp: new Date().toISOString(),
      });
    }
  });
  
  // Webhook 수신 엔드포인트 (Railway에서 역방향 통신 시 사용)
  app.post("/api/bridge/receive", async (req, res) => {
    const bridgeSecret = req.headers['x-bridge-secret'];
    // hardcoded fallback 제거: 미설정 시 "" → 모든 bridge 요청 거부 (의도된 동작)
    const expectedSecret = process.env.BRIDGE_SECRET ?? "";

    // 보안 인증 필수 (BRIDGE_SECRET 미설정 시 bridge 비활성화)
    if (!expectedSecret || bridgeSecret !== expectedSecret) {
      console.warn('[Bridge] 인증 실패 - 잘못된 Secret');
      return res.status(401).json({ error: 'Unauthorized', message: 'Invalid X-Bridge-Secret' });
    }
    
    try {
      const { event, data } = req.body;
      console.log(`[Bridge] 수신: ${event}`, data);
      
      // 이벤트 처리 로직 (필요에 따라 확장)
      switch (event) {
        case 'notification.delivered':
          console.log('[Bridge] 알림 전송 완료:', data);
          break;
        case 'user.connected':
          console.log('[Bridge] 사용자 연결:', data);
          break;
        default:
          console.log('[Bridge] 미정의 이벤트:', event);
      }
      
      res.json({ success: true, received: event });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      console.error('[Bridge] 수신 오류:', errorMessage);
      res.status(500).json({ error: 'Internal Server Error', message: errorMessage });
    }
  });
  
  // Configure body parser with larger size limit for file uploads
  app.use(express.json({ limit: "50mb" }));
  app.use(express.urlencoded({ limit: "50mb", extended: true }));
  
  // OAuth callback under /api/oauth/callback
  registerOAuthRoutes(app);
  
  // Google Maps Proxy endpoint - wildcard route to catch all paths
  app.get("/v1/maps/proxy/*", async (req, res) => {
    try {
      const apiKey = process.env.BUILT_IN_FORGE_API_KEY;
      if (!apiKey) {
        console.error('[Maps Proxy] BUILT_IN_FORGE_API_KEY not configured');
        return res.status(500).json({ error: "Google Maps API key not configured" });
      }

      // Extract the path after /v1/maps/proxy
      const mapsPath = req.path.replace('/v1/maps/proxy', '');
      
      // Build query string from request query parameters
      const queryParams = new URLSearchParams(req.query as any);
      queryParams.set('key', apiKey); // Add API key
      
      const googleMapsUrl = `https://maps.googleapis.com${mapsPath}?${queryParams.toString()}`;
      
      // 🚨 SEC-005: API 키가 포함된 Full URL 로그 제거
      console.log('[Maps Proxy] Forwarding request:', mapsPath);

      // Forward the request to Google Maps API
      const response = await fetch(googleMapsUrl);
      
      if (!response.ok) {
        console.error('[Maps Proxy] Google Maps API error:', response.status, response.statusText);
        return res.status(response.status).send(await response.text());
      }
      
      const contentType = response.headers.get('content-type');
      const data = await response.text();
      
      // Forward the response back to client
      res.setHeader('Content-Type', contentType || 'application/json');
      // 🚨 SEC-005: wildcard CORS 제거 → 운영 도메인만 허용
      res.setHeader('Access-Control-Allow-Origin', 'https://my-coupon-bridge.com');
      res.send(data);
    } catch (error) {
      console.error('[Maps Proxy] Error:', error);
      res.status(500).json({ error: "Maps proxy request failed", message: error instanceof Error ? error.message : 'Unknown error' });
    }
  });
  
  // tRPC API — auth.me 등 세션 의존 쿼리는 CDN/브라우저 캐시 절대 금지
  app.use("/api/trpc", (req, res, next) => {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    next();
  });
  app.use(
    "/api/trpc",
    createExpressMiddleware({
      router: appRouter,
      createContext,
    })
  );
  // development mode uses Vite, production mode uses static files
  if (process.env.NODE_ENV === "development") {
    await setupVite(app, server);
  } else {
    serveStatic(app);
  }

  const preferredPort = parseInt(process.env.PORT || "3000");
  const port = await findAvailablePort(preferredPort);

  if (port !== preferredPort) {
    console.log(`Port ${preferredPort} is busy, using port ${port} instead`);
  }

  server.listen(port, () => {
    const serverReadyTime = Date.now() - serverStartTime;
    console.log(`[Cold Start Measurement] ===== SERVER READY in ${serverReadyTime}ms =====`);
    console.log(`Server running on http://localhost:${port}/`);
    
    // 이메일 알림 스케줄러 시작
    startAllSchedulers();
    
    // healthz 모니터링 시작
    startHealthCheckMonitoring();
    
    // Keep-alive 스케줄러 시작 (Cold Start 방지)
    startKeepAlive();
  });
}

startServer().catch(console.error);
