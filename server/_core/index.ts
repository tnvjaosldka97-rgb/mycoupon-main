import "dotenv/config";
import express from "express";
import { createServer } from "http";
import net from "net";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
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
  
  // DB 연결 풀 미리 생성 (Warm-up)
  const dbWarmupStart = Date.now();
  try {
    const { getDb } = await import("../db");
    await getDb();
    console.log(`[Cold Start Measurement] DB connection pool warmed up in ${Date.now() - dbWarmupStart}ms`);
  } catch (error) {
    console.error('[Cold Start Measurement] DB warm-up failed:', error);
  }
  
  const app = express();
  const server = createServer(app);
  
  // 헬스체크 엔드포인트를 가장 먼저 등록 (미들웨어 우회)
  // Keep-alive health check endpoint (ultra-fast)
  app.get("/api/health", async (req, res) => {
    const healthStatus = await healthCheck();
    res.json(healthStatus);
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
