import "dotenv/config";
import express from "express";
import { createServer } from "http";
import net from "net";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
// import { initSentry } from './sentry';

// 🚨 Sentry 임시 비활성화 (초기화 에러 방지)
// initSentry();
import { registerOAuthRoutes } from "./oauth";
import { appRouter } from "../routers";
import { createContext } from "./context";
import { serveStatic, setupVite } from "./vite";
import { startAllSchedulers } from "../scheduler";
import { startHealthCheckMonitoring } from "../monitoring";
import { startKeepAlive } from "../keepalive";
import { healthCheck } from "../health";

// 🔍 DEBUG: VITE_APP_ID 환경 변수 확인
console.log("[DEBUG] process.env.VITE_APP_ID =", process.env.VITE_APP_ID);


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

async function startServer() {
  const serverStartTime = Date.now();
  console.log('[Cold Start Measurement] Server initialization started at', new Date().toISOString());
  
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
      try {
        const revokeResult = await db.execute(`
          UPDATE users
          SET role = 'user'
          WHERE role = 'admin'
            AND (email IS NULL OR email != 'tnvjaosldka97@gmail.com')
        `);
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
        console.log('✅ [Migration] users consent columns ready');
      } catch (e) { console.error('⚠️ [Migration] users consent:', e); }

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

      // users.favorite_food_top3 컬럼 추가 (additive)
      try {
        await db.execute(`ALTER TABLE users ADD COLUMN IF NOT EXISTS favorite_food_top3 TEXT`);
        console.log('✅ [Migration] users.favorite_food_top3 column ready');
      } catch (e) {
        console.error('⚠️ [Migration] users.favorite_food_top3 error:', e);
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
        // 만료 ticket 정기 정리 (1분 이상 지난 만료분)
        await db.execute(`
          DELETE FROM app_login_tickets WHERE expires_at < NOW() - INTERVAL '1 minute'
        `);
        console.log('✅ [Migration] app_login_tickets table ready');
      } catch (e) {
        console.error('⚠️ [Migration] app_login_tickets error:', e);
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
    res.json([
      {
        relation: ["delegate_permission/common.handle_all_urls"],
        target: {
          namespace: "android_app",
          package_name: "com.mycoupon.app",
          sha256_cert_fingerprints: [
            // "AA:BB:CC:DD:..." ← Play Console에서 확인 후 교체
          ],
        },
      },
    ]);
  });

  // REST healthz endpoint (no-cache, bypasses Service Worker)
  app.get("/healthz", (req, res) => {
    res.json({
      status: "ok",
      version: process.env.VITE_APP_VERSION || "unknown",
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
    });
  });
  
  // Deep Awake 엔드포인트 - Railway 브릿지 서버에서 서버 깨우기
  // DB Connection Pool까지 즉시 활성화
  app.get("/api/awake", async (req, res) => {
    const startTime = Date.now();
    const bridgeSecret = req.headers['x-bridge-secret'];
    const expectedSecret = process.env.BRIDGE_SECRET || 'my-coupon-bridge-secret-2025';
    
    // 보안 인증 (선택적 - Secret이 없으면 기본 응답)
    const isAuthenticated = bridgeSecret === expectedSecret;
    
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
    const expectedSecret = process.env.BRIDGE_SECRET || 'my-coupon-bridge-secret-2025';
    
    // 보안 인증 필수
    if (bridgeSecret !== expectedSecret) {
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
      
      console.log('[Maps Proxy] Forwarding request:', mapsPath);
      console.log('[Maps Proxy] Full URL:', googleMapsUrl);

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
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.send(data);
    } catch (error) {
      console.error('[Maps Proxy] Error:', error);
      res.status(500).json({ error: "Maps proxy request failed", message: error instanceof Error ? error.message : 'Unknown error' });
    }
  });
  
  // tRPC API
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
