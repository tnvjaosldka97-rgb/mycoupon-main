import { TRPCError } from "@trpc/server";
import { sql } from "drizzle-orm";
import { COOKIE_NAME } from "@shared/const";
import { getSessionCookieOptions, getSessionClearOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { publicProcedure, protectedProcedure, adminProcedure, router } from "./_core/trpc";
import { z } from "zod";
import * as db from "./db";
import { APP_VERSION, isVersionLower } from "../shared/version";
import { invokeLLM } from "./_core/llm";
import { analyticsRouter } from "./analytics";
import QRCode from 'qrcode';
import { deploymentRouter } from "./routers/deployment";
import { districtStampsRouter } from "./routers/districtStamps";
import { packOrdersRouter, TIER_DEFAULTS } from "./routers/packOrders";
import { abuseRouter } from "./routers/abuse";
import { finderRouter } from "./routers/finder";
import { sendEmail, getMerchantRenewalNudgeEmailTemplate, sendAdminNotificationEmail } from "./email";
import { eventPopups, notifications, users, noticePosts } from "../drizzle/schema";
import { desc, lt, gt, isNull, or, eq, and } from "drizzle-orm";
import { rateLimitByIP, rateLimitByUser, rateLimitCriticalAction } from "./_core/rateLimit";
import { isQuietHoursKST, makeAdPushTitle, isPromotionalType } from "./notificationPolicy";
import { captureBusinessCriticalError } from "./_core/sentry";
import { notify } from "./_core/notify";


const merchantProcedure = protectedProcedure.use(({ ctx, next }) => {
  if (ctx.user.role !== 'merchant' && ctx.user.role !== 'admin') {
    throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Merchant access required' });
  }
  // SIGNUP_REQUIRED 가드 제거:
  // - OAuth 콜백에서 이미 signupCompletedAt 없으면 /signup/consent 로 리다이렉트
  // - completeUserSignup() 이 role='merchant' + signupCompletedAt 동시 세팅
  // - merchantProcedure에서 매번 체크하면 여러 쿼리 동시 실패 → main.tsx에서 다중
  //   window.location.href 할당 → auth.me 폭주 루프 유발
  return next({ ctx });
});

export const appRouter = router({
  // Health check endpoint with DB warm-up
  healthz: publicProcedure.query(async () => {
    const { healthCheck } = await import('./health');
    const healthStatus = await healthCheck();
    return {
      ...healthStatus,
      version: process.env.VITE_APP_VERSION || 'unknown',
      uptime: process.uptime(),
    };
  }),

  // 배포/운영 안정성 API
  deployment: deploymentRouter,

  system: router({
    ...systemRouter._def.procedures,
    reportLoginPerformance: publicProcedure
      .input(z.object({
        totalTime: z.number(),
        startTime: z.string(),
        endTime: z.string(),
        isFast: z.boolean(),
      }))
      .mutation(async ({ input }) => {
        console.log(
          `[E2E Login Performance] ===== 클라이언트 측정 결과 =====\n` +
          `총 소요 시간: ${input.totalTime}ms\n` +
          `목표 달성: ${input.isFast ? '✅ PASS (<500ms)' : '❌ FAIL (≥500ms)'}\n` +
          `시작: ${input.startTime}\n` +
          `완료: ${input.endTime}`
        );
        return { success: true };
      }),
    getAppVersion: publicProcedure.query(async () => {
      return {
        minSupportedVersion: "1.0.0", // 운영팀이 수동 업데이트
        currentVersion: "1.0.0", // package.json에서 자동 읽기 가능
        forceUpdate: false, // 긴급 업데이트 플래그
      };
    }),
    logSession: publicProcedure
      .input(z.object({
        appVersion: z.string(),
        browser: z.string(),
        isPwa: z.boolean(),
        isKakaoInapp: z.boolean(),
        userAgent: z.string().optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        await db.logSession({
          userId: ctx.user?.id,
          ...input,
        });
        return { success: true };
      }),
  }),

  // 버전 체크 API
  version: router({
    check: publicProcedure
      .input(z.object({ clientVersion: z.string() }))
      .query(async ({ input }) => {
        // 최소 지원 버전 (치명적 버그 수정 시 여기를 수정)
        const MIN_SUPPORTED_VERSION = '1.0.0';

        const needsUpdate = isVersionLower(input.clientVersion, MIN_SUPPORTED_VERSION);
        const needsForceUpdate = needsUpdate; // 최소 버전보다 낮으면 강제 업데이트

        return {
          currentVersion: APP_VERSION,
          minSupportedVersion: MIN_SUPPORTED_VERSION,
          needsUpdate,
          needsForceUpdate,
          updateMessage: needsForceUpdate
            ? '치명적인 버그가 수정되었습니다. 즉시 업데이트해주세요.'
            : '새로운 버전이 있습니다.',
        };
      }),
  }),

  auth: router({
    me: publicProcedure.query(opts => opts.ctx.user),
    // QA-H6 (PR-19): logout publicProcedure → protectedProcedure
    // 비로그인 호출 차단 (의도적 spam 방어 + 보안 패턴 준수). 토큰 만료 시 401 자연스러움.
    logout: protectedProcedure
      .input(z.object({
        deviceId: z.string().optional(), // Capacitor 앱에서 전달. 해당 기기 push token 제거용.
      }).optional())
      .mutation(async ({ ctx, input }) => {
        // push token unlink — 로그아웃 기기의 토큰 제거 (FCM 발송 목록에서 제외)
        // ctx.user: JWT가 유효한 동안은 파싱됨 (로그아웃 호출 시점에는 아직 유효)
        const deviceId = input?.deviceId;
        if (ctx.user && deviceId) {
          try {
            const dbConn = await db.getDb();
            if (dbConn) {
              await dbConn.execute(
                `DELETE FROM push_tokens WHERE user_id = $1 AND device_id = $2`,
                [ctx.user.id, deviceId]
              );
              console.log(`[Logout] Push token unlinked — userId=${ctx.user.id} deviceId=${deviceId.slice(0, 8)}...`);
            }
          } catch (e) {
            // 토큰 unlink 실패해도 로그아웃 자체는 반드시 진행
            console.warn('[Logout] Push token unlink failed (non-critical):', e);
          }
        }
        // clearCookie: path/domain 일치만 필요. sameSite/secure는 삭제에 영향 없음.
        ctx.res.clearCookie(COOKIE_NAME, { ...getSessionClearOptions(), maxAge: -1 });
        return { success: true } as const;
      }),
    // 테스트용 간단 로그인 (임시)
    devLogin: publicProcedure
      .input(z.object({
        userId: z.number().optional().default(1),
      }))
      .mutation(async ({ ctx, input }) => {
        // 🚨 SEC-001: production에서 완전 차단 — 개발 전용 라우트
        if (process.env.NODE_ENV === 'production') {
          throw new TRPCError({ code: 'NOT_FOUND' });
        }
        // DB에서 사용자 조회
        const db_connection = await db.getDb();
        if (!db_connection) throw new Error('Database connection failed');

        // QA-C2 (PR-19): SQL injection 차단 — raw 문자열 보간 → drizzle sql template (자동 prepared parameter)
        // production NODE_ENV 체크(line 156) 외에 dev 환경에서도 raw 삽입 패턴 자체 제거
        const result = await db_connection.execute(
          sql`SELECT id, openId, name, email, role FROM users WHERE id = ${input.userId} LIMIT 1`
        );

        const user = (result[0] as any)[0];
        if (!user) {
          throw new Error('User not found');
        }

        // JWT 토큰 생성 (jose 라이브러리 사용)
        // 🚨 SEC: 하드코딩 fallback 제거. JWT_SECRET 미설정 시 검증 측 _core/context.ts SEC-002 거부와 대칭
        if (!process.env.JWT_SECRET) {
          throw new Error('[devLogin] JWT_SECRET is not configured');
        }
        const { SignJWT } = await import('jose');
        const secret = new TextEncoder().encode(process.env.JWT_SECRET);

        const token = await new SignJWT({
          openId: user.openId,
          appId: process.env.VITE_APP_ID || '',
          name: user.name
        })
          .setProtectedHeader({ alg: 'HS256' })
          .setExpirationTime('7d')
          .sign(secret);

        // devLogin: 웹 브라우저 전용 dev 엔드포인트 — web: sameSite:lax
        ctx.res.cookie(COOKIE_NAME, token, getSessionCookieOptions('web'));

        return {
          success: true,
          user: {
            id: user.id,
            name: user.name,
            email: user.email,
            role: user.role,
          },
        };
      }),

    // 네이티브 앱 기동 시 세션 + 푸시 토큰 일괄 동기화
    // 호출 시점: 앱 포그라운드 복귀 또는 최초 기동 (Capacitor appStateChange)
    // 반환: userId, role — 네이티브 레이어가 로컬 캐시와 비교하여 강제 재로그인 판단에 사용
    syncNativeSession: protectedProcedure
      .input(z.object({
        deviceId: z.string().min(1),
        pushToken: z.string().min(1),
        osType: z.enum(['android', 'ios']),
      }))
      .mutation(async ({ ctx, input }) => {
        // 토큰 UPSERT — 소유권 이전 감지 포함 (upsertPushToken 내부 처리)
        await db.upsertPushToken({
          userId: ctx.user.id,
          deviceToken: input.pushToken,
          osType: input.osType,
          deviceId: input.deviceId,
          updatedAt: new Date(),
        });
        return {
          userId: ctx.user.id,
          role: ctx.user.role,
          synced: true,
        };
      }),

    // 가입 동의 완료 (Consent Onboarding)
    completeSignup: protectedProcedure
      .input(z.object({
        termsAgreed: z.boolean(),                    // 필수: 이용약관
        privacyAgreed: z.boolean(),                  // 필수: 개인정보 처리방침
        lbsAgreed: z.boolean(),                      // 필수: 위치기반서비스(LBS) 동의
        servicePushAgreed: z.boolean(),              // 필수: 거래·서비스 통지 동의 (내 쿠폰·단골 매장 알림)
        marketingAgreed: z.boolean(),                // 선택: 마케팅 동의
        termsVersion: z.string().default('v1'),                // 동의한 이용약관 버전
        privacyVersion: z.string().default('v1'),              // 동의한 개인정보방침 버전
        servicePushTermsVersion: z.string().default('v1'),     // 동의한 거래·서비스 통지 약관 버전
      }))
      .mutation(async ({ ctx, input }) => {
        if (!input.termsAgreed || !input.privacyAgreed || !input.lbsAgreed || !input.servicePushAgreed) {
          throw new TRPCError({ code: 'BAD_REQUEST', message: '필수 약관에 모두 동의해야 합니다.' });
        }
        await db.completeUserSignup(ctx.user.id, {
          marketingAgreed: input.marketingAgreed,
          lbsAgreed: input.lbsAgreed,
          termsVersion: input.termsVersion,
          privacyVersion: input.privacyVersion,
          servicePushAgreed: input.servicePushAgreed,
          servicePushTermsVersion: input.servicePushTermsVersion,
        });
        return { success: true };
      }),
  }),

  users: router({
    // 사용자 프로필 업데이트 (연령/성별/지역)
    updateProfile: protectedProcedure
      .input(z.object({
        ageGroup: z.enum(['10s', '20s', '30s', '40s', '50s']).optional(),
        gender: z.enum(['male', 'female', 'other']).optional(),
        preferredDistrict: z.string().optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        // Drizzle ORM 사용 (타입 안전하게 처리)
        const updateData: any = {};

        if (input.ageGroup) {
          updateData.ageGroup = input.ageGroup;
        }
        if (input.gender) {
          updateData.gender = input.gender;
        }
        if (input.preferredDistrict) {
          updateData.preferredDistrict = input.preferredDistrict;
        }

        if (Object.keys(updateData).length > 0) {
          updateData.profileCompletedAt = new Date();
          try {
            await db.updateUser(ctx.user.id, updateData);
            console.log('[Profile] 프로필 업데이트 성공');
          } catch (error) {
            console.error('[Profile] 프로필 업데이트 실패:', error);
            throw new Error('프로필 저장에 실패했습니다.');
          }
        }

        return { success: true };
      }),

    // 이메일 알림 설정 조회
    getNotificationSettings: protectedProcedure
      .query(async ({ ctx }) => {
        // Drizzle ORM 사용 (타입 안전)
        const user = await db.getUserById(ctx.user.id);

        if (!user) {
          throw new Error('사용자를 찾을 수 없습니다.');
        }

        console.log('[NotificationSettings] 조회 성공:', {
          emailNotificationsEnabled: user.emailNotificationsEnabled,
          pushNotificationsEnabled: (user as any).pushNotificationsEnabled,
          newCouponNotifications: user.newCouponNotifications,
          expiryNotifications: user.expiryNotifications,
        });

        // favoriteFoodTop3: DB TEXT → string[] 파싱
        let favoriteFoodTop3: string[] = [];
        if ((user as any).favoriteFoodTop3) {
          try { favoriteFoodTop3 = JSON.parse((user as any).favoriteFoodTop3); } catch { }
        }
        return {
          emailNotificationsEnabled: user.emailNotificationsEnabled ?? true,
          pushNotificationsEnabled: (user as any).pushNotificationsEnabled ?? true,
          newCouponNotifications: user.newCouponNotifications ?? true,
          expiryNotifications: user.expiryNotifications ?? true,
          preferredDistrict: user.preferredDistrict ?? null,
          locationNotificationsEnabled: user.locationNotificationsEnabled ?? false,
          notificationRadius: user.notificationRadius ?? 200,
          favoriteFoodTop3,  // 선호 음식 Top3 (순서 = 1픽/2픽/3픽)
          marketingAgreed: (user as any).marketingAgreed ?? false,  // 마케팅 동의 (광고성 알림)
        };
      }),

    // 이메일 알림 설정 업데이트
    updateNotificationSettings: protectedProcedure
      .input(z.object({
        emailNotificationsEnabled: z.boolean().optional(),
        pushNotificationsEnabled: z.boolean().optional(),    // 앱 푸시 마스터 스위치
        newCouponNotifications: z.boolean().optional(),
        expiryNotifications: z.boolean().optional(),
        preferredDistrict: z.string().nullable().optional(),
        locationNotificationsEnabled: z.boolean().optional(),
        notificationRadius: z.union([z.literal(100), z.literal(200), z.literal(500)]).optional(),
        favoriteFoodTop3: z.array(z.string().max(30)).max(3).optional(), // 선호 음식 Top3 (최대 3개)
        marketingAgreed: z.boolean().optional(),             // 마케팅 동의 갱신 (위치 토글 ON 시 모달 동의 경로)
      }))
      .mutation(async ({ ctx, input }) => {
        // Drizzle ORM 사용 (PostgreSQL boolean 타입 안전하게 처리)
        const updateData: any = {};

        if (input.emailNotificationsEnabled !== undefined) {
          updateData.emailNotificationsEnabled = input.emailNotificationsEnabled;
        }
        if (input.pushNotificationsEnabled !== undefined) {
          updateData.pushNotificationsEnabled = input.pushNotificationsEnabled;
        }
        if (input.newCouponNotifications !== undefined) {
          updateData.newCouponNotifications = input.newCouponNotifications;
        }
        if (input.expiryNotifications !== undefined) {
          updateData.expiryNotifications = input.expiryNotifications;
        }
        if (input.preferredDistrict !== undefined) {
          updateData.preferredDistrict = input.preferredDistrict;
        }
        if (input.locationNotificationsEnabled !== undefined) {
          updateData.locationNotificationsEnabled = input.locationNotificationsEnabled;
        }
        if (input.notificationRadius !== undefined) {
          updateData.notificationRadius = input.notificationRadius;
        }
        if (input.favoriteFoodTop3 !== undefined) {
          // string[] → JSON 문자열로 DB에 저장
          (updateData as any).favoriteFoodTop3 = JSON.stringify(input.favoriteFoodTop3.slice(0, 3));
        }
        if (input.marketingAgreed !== undefined) {
          // 마케팅 동의 갱신 (위치 토글 ON 시 모달 동의 경로 — 정보통신망법 §50①)
          (updateData as any).marketingAgreed = input.marketingAgreed;
          (updateData as any).marketingAgreedAt = input.marketingAgreed ? new Date() : null;
        }

        if (Object.keys(updateData).length > 0) {
          try {
            await db.updateUser(ctx.user.id, updateData);
            console.log('[NotificationSettings] 알림 설정 업데이트 성공:', updateData);
          } catch (error) {
            console.error('[NotificationSettings] 알림 설정 업데이트 실패:', error);
            const { TRPCError } = await import('@trpc/server');
            throw new TRPCError({
              code: 'INTERNAL_SERVER_ERROR',
              message: 'DB 동기화 문제로 설정을 저장할 수 없습니다. 관리자에게 문의하세요.',
            });
          }
        }

        return { success: true };
      }),

    // 위치 정보 업데이트 (위치 기반 알림용)
    // rate-limit: 마지막 업데이트로부터 10초 이내면 스킵
    updateLocation: protectedProcedure
      .input(z.object({
        latitude: z.number().min(-90).max(90),
        longitude: z.number().min(-180).max(180),
        accuracy: z.number().optional(),        // GPS 정확도(미터), 있으면 로그만
        timestamp: z.union([z.string(), z.number()]).optional(), // 클라이언트 측정 시각
      }))
      .mutation(async ({ ctx, input }) => {
        try {
          // rate-limit: lastLocationUpdate 기준 10초 이내면 폭주 방지 스킵
          const user = await db.getUserById(ctx.user.id);
          if (user?.lastLocationUpdate) {
            const secondsSince = (Date.now() - new Date(user.lastLocationUpdate).getTime()) / 1000;
            if (secondsSince < 10) {
              return {
                success: true,
                skipped: true,
                lastLatitude: user.lastLatitude,
                lastLongitude: user.lastLongitude,
                lastLocationUpdate: user.lastLocationUpdate,
              };
            }
          }

          // ── GPS Drift Protection ─────────────────────────────────────────────
          // 이전 좌표와 현재 좌표의 거리가 50m 미만이면 알림 트리거 생략
          // (GPS 오차/실내 흔들림으로 인한 스팸 알림 방지)
          const gpsHaversine = (la1: number, lo1: number, la2: number, lo2: number) => {
            const R = 6371000;
            const dLa = (la2 - la1) * Math.PI / 180;
            const dLo = (lo2 - lo1) * Math.PI / 180;
            const a = Math.sin(dLa / 2) ** 2 + Math.cos(la1 * Math.PI / 180) * Math.cos(la2 * Math.PI / 180) * Math.sin(dLo / 2) ** 2;
            return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
          };
          const prevLat = user?.lastLatitude ? parseFloat(user.lastLatitude) : null;
          const prevLng = user?.lastLongitude ? parseFloat(user.lastLongitude) : null;
          const drift = (prevLat !== null && prevLng !== null)
            ? gpsHaversine(prevLat, prevLng, input.latitude, input.longitude)
            : Infinity;
          const triggerNotification = drift >= 50 && (user?.locationNotificationsEnabled ?? false);

          await db.updateUser(ctx.user.id, {
            lastLatitude: input.latitude.toString(),
            lastLongitude: input.longitude.toString(),
            lastLocationUpdate: new Date(),
          } as any);

          console.log(`[updateLocation] userId=${ctx.user.id} lat=${input.latitude} lng=${input.longitude} drift=${drift === Infinity ? 'first' : `${drift.toFixed(0)}m`}${input.accuracy ? ` accuracy=${input.accuracy}m` : ''}`);

          // ── Smart Aggregation: 근처 가게 묶음 알림 ───────────────────────────
          // drift >= 50m 이고 위치 알림 활성화 시에만 트리거 (백그라운드)
          if (triggerNotification) {
            const userId = ctx.user.id;
            const userLat = input.latitude;
            const userLng = input.longitude;
            const radius = user?.notificationRadius ?? 200;
            const userMarketingAgreed = (user as any)?.marketingAgreed ?? false;
            const favoriteFoodTop3: string[] = (() => {
              try { return JSON.parse((user as any)?.favoriteFoodTop3 ?? '[]'); } catch { return []; }
            })();

            setImmediate(async () => {
              try {
                const db_conn = await db.getDb();
                if (!db_conn) return;

                // ── 정책 가드 1: 마케팅 동의 미완료 → 광고성 알림 차단 ──────────────
                if (!userMarketingAgreed) {
                  console.log(`[Location Notification] userId=${userId} marketing not agreed — skip`);
                  return;
                }
                // ── 정책 가드 2: 야간 방해 금지 (21:00~08:00 KST) ──────────────────
                if (isQuietHoursKST()) {
                  console.log(`[Location Notification] userId=${userId} quiet hours KST — skip`);
                  return;
                }

                // Step 1: User-Level 1h cool-down — 1시간 내 nearby_store 수신 시 전체 생략
                const recentRows = await db_conn.execute(`
                  SELECT id FROM notifications
                  WHERE user_id = ${userId}
                    AND type = 'nearby_store'
                    AND created_at > NOW() - INTERVAL '1 hour'
                  LIMIT 1
                `);
                if (((recentRows as any)?.rows ?? []).length > 0) {
                  console.log(`[Location Notification] userId=${userId} on 1h user-level cooldown`);
                  return;
                }

                // Step 2: Bounding Box — 근처 활성 쿠폰 보유 가게 조회
                const deltaLat = radius / 111000;
                const deltaLng = radius / (111000 * Math.cos(userLat * Math.PI / 180));
                const storeRows = await db_conn.execute(`
                  SELECT DISTINCT ON (s.id)
                    s.id, s.name, s.category,
                    s.latitude::float AS lat,
                    s.longitude::float AS lng
                  FROM stores s
                  JOIN coupons c ON c.store_id = s.id
                  WHERE s.is_active = true
                    AND c.is_active = true
                    AND c.approved_by IS NOT NULL
                    AND c.end_date > NOW()
                    AND c.remaining_quantity > 0
                    AND s.latitude IS NOT NULL AND s.longitude IS NOT NULL
                    AND s.latitude::float  BETWEEN ${userLat - deltaLat} AND ${userLat + deltaLat}
                    AND s.longitude::float BETWEEN ${userLng - deltaLng} AND ${userLng + deltaLng}
                `);
                const allStores = (storeRows as any)?.rows ?? [];

                // Haversine 정확 반경 필터
                const inRange = allStores.filter((s: any) =>
                  gpsHaversine(userLat, userLng, s.lat, s.lng) <= radius
                );
                if (inRange.length === 0) return;

                // Step 3: Store-Level 24h cool-down (배치 IN 쿼리)
                const inRangeIds = inRange.map((s: any) => s.id).join(',');
                const notifiedRows = await db_conn.execute(`
                  SELECT DISTINCT related_id FROM notifications
                  WHERE user_id = ${userId}
                    AND type = 'nearby_store'
                    AND related_id IN (${inRangeIds})
                    AND created_at > NOW() - INTERVAL '24 hours'
                `);
                const notifiedIds = new Set<number>(
                  ((notifiedRows as any)?.rows ?? []).map((r: any) => Number(r.related_id))
                );
                const freshStores = inRange.filter((s: any) => !notifiedIds.has(s.id));
                if (freshStores.length === 0) return;

                // Step 4: 대표 가게 선정 — 선호 음식 카테고리 우선
                //   users.favoriteFoodTop3: ["제육볶음","커피","돈까스"] 순서로 저장됨
                //   store.category: 'cafe'|'restaurant'|'beauty'|'hospital'|'fitness'|'other'
                const CATEGORY_FOOD_MAP: Record<string, string[]> = {
                  cafe: ['커피', '카페/음료', '디저트/케이크'],
                  restaurant: ['제육볶음', '돈까스', '백반', '국밥', '초밥/일식', '라멘', '분식', '파스타', '삼겹살/고기', '짜장면/중식', '냉면'],
                  fitness: [],
                  beauty: [],
                  hospital: [],
                  other: [],
                };
                const preferredCategories = new Set(
                  Object.entries(CATEGORY_FOOD_MAP)
                    .filter(([, foods]) => foods.some(f => favoriteFoodTop3.includes(f)))
                    .map(([cat]) => cat)
                );
                const representative =
                  freshStores.find((s: any) => preferredCategories.has(s.category)) ??
                  freshStores[0];

                // Step 5: Smart Aggregation 메시지 생성
                // (광고) 문구 강제 삽입 — 정보통신망법 제50조
                const title = makeAdPushTitle('🎁 근처에 새로운 혜택이 있어요!');
                const message = freshStores.length === 1
                  ? `${representative.name} 쿠폰이 근처에 있습니다!`
                  : `${representative.name} 포함 주변 ${freshStores.length}개의 새로운 혜택이 모여있습니다!`;
                const targetUrl = freshStores.length === 1
                  ? `/store/${representative.id}`
                  : `/map`;

                await db.createNotification({
                  userId: userId,
                  title,
                  message,
                  type: 'nearby_store',
                  relatedId: representative.id,
                  targetUrl,
                });

                console.log(`[Location Notification] userId=${userId} stores=${freshStores.length} rep="${representative.name}" target=${targetUrl}`);
              } catch (err) {
                console.error('[Location Notification] Error:', err);
              }
            });
          }

          return {
            success: true,
            skipped: drift < 50,
            lastLatitude: input.latitude.toString(),
            lastLongitude: input.longitude.toString(),
            lastLocationUpdate: new Date(),
          };
        } catch (error) {
          console.error('[updateLocation] 위치 업데이트 실패:', error);
          return { success: false, skipped: false };
        }
      }),
  }),

  stores: router({
    /**
     * nudgeDormant — 로그인한 모든 유저가 가게 사장에게 "쿠폰 더 달라"고 조르기
     * - 유저 1인당 특정 가게 오너에게 24시간 내 1회 조르기 가능 (재고 상태 무관)
     * - 매 조르기마다 사장에게 이메일 발송 (단, owner 기준 1시간 throttle로 메일 폭탄 방지)
     */
    nudgeDormant: protectedProcedure
      .input(z.object({ ownerId: z.number(), storeName: z.string() }))
      .mutation(async ({ ctx, input }) => {
        const dbConn = await db.getDb();
        if (!dbConn) throw new Error('DB 연결 실패');

        // 24시간 내 동일 유저 × 동일 오너 중복 조르기 방지
        const dup = await dbConn.execute(
          `SELECT id FROM coupon_extension_requests
           WHERE user_id  = ${ctx.user.id}
             AND owner_id = ${input.ownerId}
             AND created_at > NOW() - INTERVAL '24 hours'
           LIMIT 1`
        );
        if (((dup as any)?.rows ?? []).length > 0) {
          throw new Error('이미 조르기를 보냈습니다. 24시간 후 다시 시도해주세요.');
        }

        // coupon_extension_requests 에 기록
        await dbConn.execute(
          sql`INSERT INTO coupon_extension_requests (user_id, owner_id, store_name, created_at)
              VALUES (${ctx.user.id}, ${input.ownerId}, ${input.storeName}, NOW())`
        );

        // 30일 기준 대기 인원 (distinct user_id)
        const countResult = await dbConn.execute(
          `SELECT COUNT(DISTINCT user_id) AS cnt
           FROM coupon_extension_requests
           WHERE owner_id  = ${input.ownerId}
             AND created_at > NOW() - INTERVAL '30 days'`
        );
        const nudgeCount = Number(((countResult as any)?.rows ?? [])[0]?.cnt ?? 1);

        // 감사 로그
        void db.insertAuditLog({
          adminId: ctx.user.id,
          action: 'USER_NUDGE',
          targetType: 'user',
          targetId: input.ownerId,
          payload: { nudgeCount, storeName: input.storeName, actorUserId: ctx.user.id },
        });

        // 사장님 알림함에 조르기 알림 생성 — Phase 2c: notify() wrapper + type 'general' → 'merchant_nudge_received' (G3 적용, P1=β fire-and-forget 보존)
        void notify(input.ownerId, 'merchant_nudge_received', {
          title: `🎁 "${input.storeName}" 쿠폰을 기다리는 고객이 있어요!`,
          message: `현재 ${nudgeCount}명이 쿠폰 등록을 기다리고 있습니다. 쿠폰을 등록해 단골손님을 만들어보세요.`,
          relatedId: ctx.user.id,
          targetUrl: '/merchant/dashboard',
        });

        // ── 이메일 발송 (10건마다 사장님 이메일 발송) ──────────────────────────
        // 10의 배수 도달 시 발송: 10, 20, 30 ...
        let mailSent = false;
        try {
          if (nudgeCount % 10 === 0) {
            const merchant = await db.getUserById(input.ownerId);
            const merchantStores = await db.getStoresByOwnerId(input.ownerId);
            const appUrl = process.env.VITE_APP_URL || 'https://my-coupon-bridge.com';
            const couponUrl = merchantStores.length > 0
              ? `${appUrl}/store/${merchantStores[0].id}`
              : `${appUrl}/map`;

            // 사업주가 본인 설정 or 슈퍼어드민 제어로 이메일 수신을 끈 경우 발송 skip.
            // in-app notifications 는 별도 경로이므로 이메일만 차단되고 알림 자체는 유지됨.
            if (merchant?.email && (merchant as any).emailNotificationsEnabled !== false) {
              const { sendEmail, getMerchantRenewalNudgeEmailTemplate } = await import('./email');
              mailSent = await sendEmail({
                userId: input.ownerId,
                email: merchant.email,
                subject: `[마이쿠폰] "${input.storeName}" 쿠폰을 기다리는 고객이 ${nudgeCount}명!`,
                html: getMerchantRenewalNudgeEmailTemplate(merchant.name, nudgeCount, input.storeName, couponUrl),
                type: 'merchant_renewal_nudge',
              });

              if (mailSent) {
                void db.insertAuditLog({
                  adminId: ctx.user.id,
                  action: 'nudge_email_sent',
                  targetType: 'user',
                  targetId: input.ownerId,
                  payload: { nudgeCount, storeName: input.storeName },
                });
              }
            }
          }
        } catch (mailErr) {
          console.error('[nudgeDormant] email error (non-critical):', mailErr);
        }

        return { success: true, nudgeCount, mailSent };
      }),

    /** 조르기 대기 현황 (가게 상세·사장 대시보드용) */
    getExtensionStats: publicProcedure
      .input(z.object({ ownerId: z.number() }))
      .query(async ({ input }) => {
        const dbConn = await db.getDb();
        if (!dbConn) return { waitingCount: 0, last7days: 0, last30days: 0, today: 0 };

        const result = await dbConn.execute(
          `SELECT
             COUNT(DISTINCT user_id) FILTER (WHERE created_at > NOW() - INTERVAL '30 days') AS last30days,
             COUNT(DISTINCT user_id) FILTER (WHERE created_at > NOW() - INTERVAL '7 days')  AS last7days,
             COUNT(DISTINCT user_id) FILTER (WHERE created_at > NOW() - INTERVAL '1 day')   AS today
           FROM coupon_extension_requests
           WHERE owner_id = ${input.ownerId}`
        );
        const row = ((result as any)?.rows ?? [])[0] ?? {};
        return {
          waitingCount: Number(row.last30days ?? 0),
          last30days:   Number(row.last30days ?? 0),
          last7days:    Number(row.last7days  ?? 0),
          today:        Number(row.today      ?? 0),
        };
      }),

    // 어드민용 — 조르기 누적 TOP 목록
    getNudgeLeaderboard: adminProcedure
      .query(async () => {
        const dbConn = await db.getDb();
        if (!dbConn) return [];
        const result = await dbConn.execute(
          `SELECT
             cer.owner_id,
             u.name AS owner_name,
             u.email AS owner_email,
             cer.store_name,
             COUNT(*) AS total_nudges,
             COUNT(*) FILTER (WHERE cer.created_at > NOW() - INTERVAL '7 days')  AS nudges_7d,
             COUNT(*) FILTER (WHERE cer.created_at > NOW() - INTERVAL '1 day')   AS nudges_today,
             MAX(cer.created_at) AS last_nudge_at
           FROM coupon_extension_requests cer
           LEFT JOIN users u ON u.id = cer.owner_id
           GROUP BY cer.owner_id, u.name, u.email, cer.store_name
           ORDER BY total_nudges DESC
           LIMIT 50`
        );
        return ((result as any)?.rows ?? []).map((r: any) => ({
          ownerId: Number(r.owner_id),
          ownerName: r.owner_name ?? '',
          ownerEmail: r.owner_email ?? '',
          storeName: r.store_name ?? '',
          totalNudges: Number(r.total_nudges ?? 0),
          nudges7d: Number(r.nudges_7d ?? 0),
          nudgesToday: Number(r.nudges_today ?? 0),
          lastNudgeAt: r.last_nudge_at ? new Date(r.last_nudge_at).toISOString() : null,
        }));
      }),

    // 가게 생성 (사장님 전용) - 승인 대기 상태로 등록
    create: merchantProcedure
      .input(z.object({
        name: z.string(),
        category: z.enum(["cafe", "restaurant", "beauty", "hospital", "fitness", "other"]),
        description: z.string().optional(),
        address: z.string(),
        latitude: z.string().optional(),
        longitude: z.string().optional(),
        phone: z.string().optional(),
        imageUrl: z.string().optional(),
        openingHours: z.string().optional(),
        naverPlaceUrl: z.string().optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        // 어드민 또는 isFranchise 계정은 1가게 제한 없음
        if (ctx.user.role !== 'admin' && !ctx.user.isFranchise) {
          const existing = await db.getStoresByOwnerId(ctx.user.id);
          if (existing.length > 0) {
            throw new Error('현재 정책상 한 계정당 1개 매장만 등록 가능합니다. 추가 지점 등록은 관리자에게 문의해주세요.');
          }
        }

        // 가게는 즉시 활성화되지만, 관리자 승인 전까지는 지도에 노출 안 됨
        const storeData: any = {
          ...input,
          ownerId: ctx.user.id,
          isActive: true,
        };

        // 관리자 또는 AUTO_APPROVE=true(테스트 전용) 이면 즉시 승인
        if (ctx.user.role === 'admin' || process.env.AUTO_APPROVE === 'true') {
          storeData.approvedBy = ctx.user.id;
          storeData.approvedAt = new Date();
        }

        await db.createStore(storeData);

        // 관리자 아닌 사장님이 가게 등록 → 승인 대기 알림 메일
        if (ctx.user.role !== 'admin' && process.env.AUTO_APPROVE !== 'true') {
          void sendAdminNotificationEmail({
            type: 'store_pending',
            merchantName: ctx.user.name ?? ctx.user.email ?? `ID:${ctx.user.id}`,
            merchantEmail: ctx.user.email ?? '',
            targetName: input.name,
          });
        }

        // trial_ends_at은 첫 쿠폰 등록 시 시작 (coupons.create에서 설정)
        // stores.create에서는 trial을 건드리지 않음

        return {
          success: true,
          message: (ctx.user.role === 'admin' || process.env.AUTO_APPROVE === 'true')
            ? '가게가 등록되었습니다.'
            : '가게 등록이 완료되었습니다. 관리자 승인 후 지도에 노출됩니다.'
        };
      }),

    // 가게 목록 조회 (쿠폰 정보 포함 + 사용 여부)
    list: publicProcedure
      .input(z.object({
        limit: z.number().optional().default(50),
        userLat: z.number().optional(),
        userLon: z.number().optional(),
      }))
      .query(async ({ input, ctx }) => {
        const allStores = await db.getAllStores(input.limit);

        // 일반 사용자에게는 승인된 가게만 표시
        const stores = ctx.user?.role === 'admin'
          ? allStores
          : allStores.filter(s => s.approvedBy !== null);

        // 가게 소유자 tier 배치 조회 (N+1 방지 — 단일 쿼리)
        // raw string IN() 방식 사용: sql`` + ANY(array) 는 Drizzle에서 silent fail 가능
        let ownerTierMap: Record<number, string> = {};
        if (stores.length > 0) {
          try {
            const dbForTier = await db.getDb();
            if (dbForTier) {
              const ownerIds = [...new Set(stores.map(s => s.ownerId))];
              // ownerIds는 DB PK(integer)이므로 직접 embed 안전
              const tierResult = await dbForTier.execute(
                `SELECT DISTINCT ON (user_id) user_id, tier
                 FROM user_plans
                 WHERE user_id IN (${ownerIds.join(',')})
                   AND is_active = TRUE
                   AND (expires_at IS NULL OR expires_at > NOW())
                 ORDER BY user_id, created_at DESC`
              );
              const tierRows = (tierResult as any)?.rows ?? (tierResult as any)?.[0] ?? [];
              for (const row of tierRows) {
                ownerTierMap[Number(row.user_id)] = String(row.tier ?? 'FREE');
              }
            }
          } catch (e) {
            console.error('[stores.list] Tier query failed (non-critical):', e);
          }
        }

        // 로그인한 사용자의 경우 사용한 쿠폰 목록 가져오기
        let userUsedCouponIds: Set<number> = new Set();
        if (ctx.user) {
          const userCouponsList = await db.getUserCoupons(ctx.user.id);
          userUsedCouponIds = new Set(
            userCouponsList
              .filter(uc => uc.status === 'used')
              .map(uc => uc.couponId)
          );
        }

        // 각 가게의 쿠폰 정보도 함께 가져오기 (배치 단일 쿼리 — N+1 제거)
        const couponsByStore = await db.getCouponsByStoreIds(stores.map(s => s.id));
        const storesWithCoupons = await Promise.all(
          stores.map(async (store) => {
            const activeCoupons = couponsByStore.get(store.id) ?? [];

            // 사용 가능한 쿠폰이 있는지 확인 (사용하지 않은 쿠폰이 하나라도 있으면 true)
            const hasAvailableCoupons = activeCoupons.some(c => !userUsedCouponIds.has(c.id));

            // GPS 거리 계산
            let distance: number | undefined;
            if (input.userLat !== undefined && input.userLon !== undefined && store.latitude && store.longitude) {
              const { calculateDistance } = await import('../shared/geoUtils');
              distance = calculateDistance(input.userLat, input.userLon, parseFloat(store.latitude), parseFloat(store.longitude));
            }

            return {
              ...store,
              coupons: activeCoupons,
              distance,             // 거리 정보 추가 (미터 단위)
              hasAvailableCoupons,  // 사용 가능한 쿠폰 여부 (UX 개선)
              ownerTier: ownerTierMap[store.ownerId] ?? 'FREE', // 마커 tier 색상용
            };
          })
        );

        // 거리 기준으로 정렬 (가까운 순)
        if (input.userLat !== undefined && input.userLon !== undefined) {
          storesWithCoupons.sort((a, b) => {
            if (a.distance === undefined) return 1;
            if (b.distance === undefined) return -1;
            return a.distance - b.distance;
          });
        }

        return storesWithCoupons;
      }),

    /**
     * 공개 지도 전용 endpoint (MapPage, CouponMap 전용)
     *
     * 서버에서 SQL 레벨로 엄격하게 필터링:
     *   - approved_by IS NOT NULL  (슈퍼어드민 승인 완료)
     *   - is_active = true
     *   - deleted_at IS NULL       (soft-delete 제외)
     *   - latitude/longitude 존재  (좌표 있는 가게만)
     *
     * pending/rejected/deleted 가게는 이 endpoint에 절대 포함되지 않는다.
     * admin bypass 없음 — 누가 호출해도 동일한 엄격 조건 적용.
     */
    mapStores: publicProcedure
      .input(z.object({
        userLat: z.number().optional(),
        userLon: z.number().optional(),
      }))
      .query(async ({ input, ctx }) => {
        // SQL 레벨 엄격 필터 — approved + not deleted + has coords
        const approvedStores = await db.getPublicMapStores();

        // 가게 소유자 tier 배치 조회
        // 주의: sql`` 태그드 템플릿에서 JS 배열을 ANY()로 전달 시 PostgreSQL이 올바르게
        //       처리하지 못하는 케이스가 있어 raw string IN() 방식으로 교체
        let ownerTierMap: Record<number, string> = {};
        // ownerTrialMap: userId → trial_ends_at (dormant 판정용)
        let ownerTrialMap: Record<number, Date | null> = {};
        // ownerFranchiseMap: userId → isFranchise (FRANCHISE는 무조건 ACTIVE)
        let ownerFranchiseMap: Record<number, boolean> = {};
        if (approvedStores.length > 0) {
          try {
            const dbConn = await db.getDb();
            if (dbConn) {
              const ownerIds = [...new Set(approvedStores.map(s => s.ownerId))];
              // ownerIds는 DB의 integer PK이므로 직접 embed 해도 SQL injection 위험 없음
              const tierResult = await dbConn.execute(
                `SELECT DISTINCT ON (user_id) user_id, tier
                 FROM user_plans
                 WHERE user_id IN (${ownerIds.join(',')})
                   AND is_active = TRUE
                   AND (expires_at IS NULL OR expires_at > NOW())
                 ORDER BY user_id, created_at DESC`
              );
              const tierRows = (tierResult as any)?.rows ?? (tierResult as any)?.[0] ?? [];
              for (const row of tierRows) {
                ownerTierMap[Number(row.user_id)] = String(row.tier ?? 'FREE');
              }

              // trial_ends_at + is_franchise 조회 — dormant 판정용
              // franchise 계정은 trialEndsAt=NULL이어도 활성 체험중으로 간주 → 휴면 아님
              const trialResult = await dbConn.execute(
                `SELECT id, trial_ends_at, is_franchise FROM users WHERE id IN (${ownerIds.join(',')})`
              );
              const trialRows = (trialResult as any)?.rows ?? [];
              for (const row of trialRows) {
                ownerTrialMap[Number(row.id)] = row.trial_ends_at ? new Date(row.trial_ends_at) : null;
                // is_franchise: PostgreSQL boolean이 't'/'f' 또는 true/false로 올 수 있음
                ownerFranchiseMap[Number(row.id)] =
                  row.is_franchise === true || row.is_franchise === 't';
              }

              console.log(`[mapStores] Tier resolved for ${Object.keys(ownerTierMap).length}/${ownerIds.length} owners`);
            }
          } catch (e) {
            console.error('[mapStores] Tier query failed (non-critical):', e);
          }
        }

        // 로그인 사용자의 사용한 쿠폰 목록
        let userUsedCouponIds: Set<number> = new Set();
        if (ctx.user) {
          const used = await db.getUserCoupons(ctx.user.id);
          userUsedCouponIds = new Set(
            // 'used'(사용완료) + 'active'(다운로드됨, 미사용) 모두 제외
            // → 이미 다운로드한 쿠폰은 지도에서 "받을 수 있음"으로 표시되지 않도록
            used.filter(uc => uc.status === 'used' || uc.status === 'active').map(uc => uc.couponId)
          );
        }

        // 배치 단일 쿼리 — N+1 제거 (buildStoreCouponFilter 동일 조건 일괄 적용)
        const couponsByStore = await db.getCouponsByStoreIds(approvedStores.map(s => s.id));

        // 매장별 누적 다운로드 수 집계 — storeId 단위 배치 쿼리 (N+1 없음)
        // user_coupons → coupons.store_id 로 JOIN 집계
        let downloadCountMap: Record<number, number> = {};
        if (approvedStores.length > 0) {
          try {
            const dbConn = await db.getDb();
            if (dbConn) {
              const storeIds = approvedStores.map(s => s.id);
              const dlResult = await dbConn.execute(
                `SELECT c.store_id, COUNT(uc.id)::int AS download_count
                 FROM user_coupons uc
                 JOIN coupons c ON c.id = uc.coupon_id
                 WHERE c.store_id IN (${storeIds.join(',')})
                 GROUP BY c.store_id`
              );
              for (const row of ((dlResult as any)?.rows ?? [])) {
                downloadCountMap[Number(row.store_id)] = Number(row.download_count ?? 0);
              }
            }
          } catch (e) {
            console.error('[mapStores] downloadCount query failed (non-critical):', e);
          }
        }

        const storesWithCoupons = await Promise.all(
          approvedStores.map(async (store) => {
            const activeCoupons = couponsByStore.get(store.id) ?? [];
            const hasAvailableCoupons = activeCoupons.some(c => !userUsedCouponIds.has(c.id));

            let distance: number | undefined;
            if (input.userLat !== undefined && input.userLon !== undefined) {
              const { calculateDistance } = await import('../shared/geoUtils');
              distance = calculateDistance(
                input.userLat, input.userLon,
                parseFloat(store.latitude!), parseFloat(store.longitude!)
              );
            }

            const ownerTier = ownerTierMap[store.ownerId] ?? 'FREE';
            const isFranchiseOwner = ownerFranchiseMap[store.ownerId] ?? false;
            // FRANCHISE는 무조건 ACTIVE — dormant 아님
            const hasPaidPlan = ownerTier !== 'FREE';
            const trialEndsAt = ownerTrialMap[store.ownerId] ?? null;
            const ownerIsDormant = isFranchiseOwner
              ? false
              : !hasPaidPlan && (!trialEndsAt || trialEndsAt <= new Date());

            return {
              ...store,
              coupons: activeCoupons,
              distance,
              hasAvailableCoupons,
              ownerTier,
              ownerIsDormant,
              downloadCount: downloadCountMap[store.id] ?? 0,
            };
          })
        );

        // 거리순 정렬
        if (input.userLat !== undefined && input.userLon !== undefined) {
          storesWithCoupons.sort((a, b) => {
            if (a.distance === undefined) return 1;
            if (b.distance === undefined) return -1;
            return a.distance - b.distance;
          });
        }

        return storesWithCoupons;
      }),

    // 가게 검색
    search: publicProcedure
      .input(z.object({
        query: z.string(),
        category: z.enum(["cafe", "restaurant", "beauty", "hospital", "fitness", "other"]).optional(),
      }))
      .query(async ({ input, ctx }) => {
        const results = await db.searchStores(input.query, input.category);

        // 검색 로그 기록
        await db.createSearchLog({
          userId: ctx.user?.id,
          query: input.query,
          category: input.category,
          resultCount: results.length,
        });

        return results;
      }),

    // 가게 상세 조회
    get: publicProcedure
      .input(z.object({
        id: z.number(),
      }))
      .query(async ({ input }) => {
        const store = await db.getStoreById(input.id);
        if (!store) throw new Error('Store not found');

        const reviews = await db.getReviewsByStoreId(input.id);
        const visitCount = await db.getVisitCountByStoreId(input.id);

        // 가게 오너 휴면 여부 계산
        let ownerIsDormant = false;
        let ownerId: number | null = null;
        try {
          const dbConn = await db.getDb();
          if (dbConn && store.ownerId) {
            ownerId = store.ownerId;
            const ownerResult = await dbConn.execute(
              `SELECT u.trial_ends_at, u.is_franchise,
                      up.tier, up.expires_at, up.is_active
               FROM users u
               LEFT JOIN user_plans up
                 ON up.user_id = u.id AND up.is_active = TRUE
                 AND (up.expires_at IS NULL OR up.expires_at > NOW())
               WHERE u.id = ${store.ownerId}
               LIMIT 1`
            );
            const ownerRow = ((ownerResult as any)?.rows ?? [])[0];
            if (ownerRow) {
              // FRANCHISE 계정은 무조건 ACTIVE — ownerIsDormant=false
              const isFranchise = ownerRow.is_franchise === true || ownerRow.is_franchise === 't';
              if (isFranchise) {
                ownerIsDormant = false;
              } else {
                const hasPaidPlan = ownerRow.tier && ownerRow.tier !== 'FREE' && ownerRow.is_active;
                const trialEndsAt = ownerRow.trial_ends_at ? new Date(ownerRow.trial_ends_at) : null;
                ownerIsDormant = !hasPaidPlan && (!trialEndsAt || trialEndsAt <= new Date());
              }
            }
          }
        } catch (_) { /* non-critical */ }

        return {
          ...store,
          reviews,
          visitCount,
          ownerIsDormant,
          ownerId,
        };
      }),

    // 내 가게 목록 (사장님 전용)
    // 일반 계정(비프랜차이즈): 다중 업장이 있어도 canonical store(id 최소=최초 등록) 1개만 반환
    // DB 데이터는 유지 — UI 노출만 제한, 자동 삭제 없음
    myStores: merchantProcedure.query(async ({ ctx }) => {
      const allStores = await db.getStoresByOwnerId(ctx.user.id);
      if (ctx.user.role !== 'admin' && !(ctx.user as any).isFranchise && allStores.length > 1) {
        const canonical = allStores.slice().sort((a, b) => (a.id as number) - (b.id as number))[0];
        return [canonical];
      }
      return allStores;
    }),

    // 내 가게 존재 여부 (모든 로그인 유저 — 사장님 바로가기 스마트 라우팅용)
    hasMyStores: protectedProcedure.query(async ({ ctx }) => {
      const myStores = await db.getStoresByOwnerId(ctx.user.id);
      return { hasStores: myStores.length > 0 };
    }),

    // 내 가게 Soft Delete (사장님 전용)
    softDeleteMyStore: merchantProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ ctx, input }) => {
        // 1) 소유권 확인
        const store = await db.getStoreById(input.id);
        if (!store || (store as any).deletedAt) {
          throw new TRPCError({ code: 'NOT_FOUND', message: '가게를 찾을 수 없습니다.' });
        }
        if (store.ownerId !== ctx.user.id && ctx.user.role !== 'admin') {
          throw new TRPCError({ code: 'NOT_FOUND', message: '가게를 찾을 수 없습니다.' });
        }
        // 2) 활성 쿠폰 체크
        const dbConn = await db.getDb();
        if (dbConn) {
          const couponCheck = await dbConn.execute(
            sql`SELECT COUNT(*) AS cnt FROM coupons
                WHERE store_id = ${input.id}
                  AND is_active = TRUE
                  AND end_date > NOW()`
          );
          const rows = (couponCheck as any)?.rows ?? (couponCheck as any)?.[0] ?? [];
          const activeCnt = Number(rows[0]?.cnt ?? 0);
          if (activeCnt > 0) {
            throw new TRPCError({
              code: 'CONFLICT',
              message: `활성 쿠폰이 ${activeCnt}개 있어 삭제할 수 없습니다. 먼저 쿠폰을 삭제하거나 만료 후 시도해주세요.`,
            });
          }
        }
        // 3) Soft delete
        await db.softDeleteStore(input.id, ctx.user.id);
        return { success: true };
      }),

    // 가게 정보 수정 (사장님 전용)
    update: merchantProcedure
      .input(z.object({
        id: z.number(),
        name: z.string().optional(),
        category: z.enum(["cafe", "restaurant", "beauty", "hospital", "fitness", "other"]).optional(),
        description: z.string().optional(),
        address: z.string().optional(),
        latitude: z.string().optional(),
        longitude: z.string().optional(),
        phone: z.string().optional(),
        imageUrl: z.string().optional(),
        openingHours: z.string().optional(),
        isActive: z.boolean().optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        const { id, ...data } = input;

        // 본인 가게인지 확인
        const store = await db.getStoreById(id);
        if (!store) throw new Error('Store not found');
        if (store.ownerId !== ctx.user.id && ctx.user.role !== 'admin') {
          throw new Error('Unauthorized');
        }

        // QA-C1 (PR-19): address 변경 감지 시 서버 측 geocoding fallback
        // 사장님 분노 사례: admin 이 주소 수정해도 lat/lng 그대로 유지 → 거리 검색 / FCM nearby 알림 / 지도 마커 옛 위치
        // 클라이언트(KakaoAddressSearch)가 lat/lng 를 함께 보내면 그대로 사용. 누락 시 서버 geocoding 자동 호출.
        const addressChanged = !!data.address && data.address !== store.address;
        const latLngMissing = !data.latitude || !data.longitude;
        if (addressChanged && latLngMissing) {
          try {
            const { makeRequest } = await import('./_core/map');
            const response = await makeRequest('/maps/api/geocode/json', {
              address: data.address,
              language: 'ko',
            }) as any;
            if (response?.results?.[0]?.geometry?.location) {
              const loc = response.results[0].geometry.location;
              data.latitude = loc.lat.toString();
              data.longitude = loc.lng.toString();
              console.log(`[stores.update] Re-geocoded "${data.address}" → ${loc.lat}, ${loc.lng}`);
            }
          } catch (geocodeError) {
            // geocoding 실패해도 update 자체는 진행 — admin 이 좌표 수동 수정 가능
            console.error('[stores.update] Geocoding failed (non-blocking):', geocodeError);
          }
        }

        await db.updateStore(id, data);
        return { success: true };
      }),
  }),

  reviews: router({
    // 리뷰 작성
    create: protectedProcedure
      .input(z.object({
        storeId: z.number(),
        rating: z.number().min(1).max(5),
        content: z.string().optional(),
        imageUrls: z.string().optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        await db.createReview({
          ...input,
          userId: ctx.user.id,
        });
        return { success: true };
      }),

    // 가게별 리뷰 목록
    byStore: publicProcedure
      .input(z.object({
        storeId: z.number(),
      }))
      .query(async ({ input }) => {
        return await db.getReviewsByStoreId(input.storeId);
      }),

    // 내 리뷰 목록
    myReviews: protectedProcedure.query(async ({ ctx }) => {
      return await db.getReviewsByUserId(ctx.user.id);
    }),
  }),

  visits: router({
    // 방문 기록 생성
    create: publicProcedure
      .input(z.object({
        storeId: z.number(),
        source: z.string(),
      }))
      .mutation(async ({ ctx, input }) => {
        const visit = await db.createVisit({
          storeId: input.storeId,
          userId: ctx.user?.id,
          source: input.source,
        });

        // 광고비 거래 생성 (성과형 후불제)
        if (input.source === 'search' || input.source === 'recommendation') {
          await db.createAdTransaction({
            storeId: input.storeId,
            visitId: visit[0].insertId,
            amount: 300, // $3 = 300센트
            status: 'pending',
          });
        }

        return { success: true };
      }),

    // 내 방문 기록
    myVisits: protectedProcedure.query(async ({ ctx }) => {
      return await db.getVisitsByUserId(ctx.user.id);
    }),
  }),

  recommendations: router({
    // AI 기반 추천
    get: publicProcedure
      .input(z.object({
        category: z.enum(["cafe", "restaurant", "beauty", "hospital", "fitness", "other"]).optional(),
        location: z.string().optional(),
      }))
      .query(async ({ input }) => {
        // 모든 가게 가져오기
        const allStores = await db.getAllStores(100);

        if (allStores.length === 0) {
          return [];
        }

        // AI를 사용하여 추천
        const prompt = `
당신은 로컬 가게 추천 AI입니다. 다음 가게 목록에서 사용자에게 가장 적합한 가게를 추천해주세요.

사용자 선호:
- 카테고리: ${input.category || '모든 카테고리'}
- 위치: ${input.location || '모든 위치'}

가게 목록:
${allStores.map((s, i) => `${i + 1}. ${s.name} (${s.category}) - ${s.address}`).join('\n')}

추천할 가게 ID를 JSON 배열로 반환해주세요. 최대 10개까지.
예: [1, 3, 5, 7, 9]
`;

        try {
          const response = await invokeLLM({
            messages: [
              { role: 'system', content: '당신은 로컬 가게 추천 AI입니다. 사용자의 선호도를 분석하여 최적의 가게를 추천합니다.' },
              { role: 'user', content: prompt },
            ],
          });

          const messageContent = response.choices[0]?.message?.content;
          const content = typeof messageContent === 'string' ? messageContent : '[]';
          const recommendedIndices = JSON.parse(content) as number[];

          // 추천된 가게들 반환
          const recommended = recommendedIndices
            .map(i => allStores[i - 1])
            .filter(Boolean)
            .slice(0, 10);

          return recommended;
        } catch (error) {
          console.error('AI recommendation error:', error);
          // AI 실패 시 랜덤으로 10개 반환
          return allStores.slice(0, 10);
        }
      }),
  }),

  coupons: router({
    // 🗺️ 내 주변 쿠폰 찾기 (Haversine 공식)
    getNearby: publicProcedure
      .input(z.object({
        latitude: z.number(),
        longitude: z.number(),
        radius: z.number().default(5000), // 기본 5km
      }))
      .query(async ({ input }) => {
        const db_connection = await db.getDb();
        if (!db_connection) throw new Error('Database connection failed');

        // Haversine 공식으로 거리 계산 (PostgreSQL)
        const result = await db_connection.execute(`
          SELECT 
            c.*,
            s.name as "storeName",
            s.latitude as "storeLatitude",
            s.longitude as "storeLongitude",
            s.address as "storeAddress",
            s.category as "storeCategory",
            (
              6371000 * acos(
                cos(radians(${input.latitude})) * cos(radians(CAST(s.latitude AS FLOAT))) *
                cos(radians(CAST(s.longitude AS FLOAT)) - radians(${input.longitude})) +
                sin(radians(${input.latitude})) * sin(radians(CAST(s.latitude AS FLOAT)))
              )
            ) AS distance
          FROM coupons c
          JOIN stores s ON c.store_id = s.id
          WHERE c.is_active = true
            AND s.is_active = true
            AND c.end_date > NOW()
            AND s.latitude IS NOT NULL
            AND s.longitude IS NOT NULL
          HAVING distance <= ${input.radius}
          ORDER BY distance ASC
        `);

        return (result as any)[0] || [];
      }),

    // 쿠폰 생성 (사장님 전용)
    create: merchantProcedure
      // 사장님 결정: % 발급 차단 (4곳 UI + 3개 zod schema). fixed 최소 1,000원 강제.
      // 기존 % 쿠폰은 DB 보존 (자연 만료 대기, 테스트 매장).
      .input(z.object({
        storeId: z.number(),
        title: z.string(),
        description: z.string().optional(),
        discountType: z.enum(['fixed', 'freebie']),
        discountValue: z.number(),
        minPurchase: z.number().optional(),
        maxDiscount: z.number().optional(),
        totalQuantity: z.number(),
        dailyLimit: z.number().optional(),
        startDate: z.date(),
        endDate: z.date().optional(), // 클라이언트 전송값은 무시, 서버가 재계산 (하위 호환 유지)
      }).refine(
        (d) => d.discountType !== 'fixed' || d.discountValue >= 1000,
        { message: '원 할인 쿠폰은 최소 1,000원 이상이어야 합니다', path: ['discountValue'] }
      ))
      .mutation(async ({ ctx, input }) => {
        // 본인 가게인지 확인
        const store = await db.getStoreById(input.storeId);
        if (!store) throw new Error('Store not found');
        if (store.ownerId !== ctx.user.id && ctx.user.role !== 'admin') {
          throw new Error('Unauthorized');
        }

        // 일반 계정(비프랜차이즈): 다중 업장 보유 시 canonical store(최초 등록=id 최소)만 허용
        if (ctx.user.role !== 'admin' && !(ctx.user as any).isFranchise) {
          const ownerStores = await db.getStoresByOwnerId(ctx.user.id);
          if (ownerStores.length > 1) {
            const canonicalId = ownerStores.slice().sort((a, b) => (a.id as number) - (b.id as number))[0].id;
            if (input.storeId !== canonicalId) {
              throw new TRPCError({
                code: 'FORBIDDEN',
                message: '일반 계정은 대표 업장(최초 등록 가게)에만 쿠폰을 등록할 수 있습니다.',
              });
            }
          }
        }

        // 거절된 가게는 쿠폰 등록 불가 (사장님 + 어드민 동일 적용)
        if ((store as any).status === 'rejected') {
          throw new TRPCError({
            code: 'FORBIDDEN',
            message: '거절된 가게에는 쿠폰을 등록할 수 없습니다. 재신청 후 승인을 받아주세요.',
          });
        }

        // 첫 쿠폰 여부 판정 — 가상 trial 주입(create 통과) 가드.
        // 2026-04-23 정책 보강: 유료 이력이 **한 번이라도** 있는 유저는 제외.
        // 이유: "유료 끝나면 무조건 휴면 + 무료 자동 재부여 없음" 원칙 엄수.
        //        (유료 끝난 자가 FREE 복귀해도 create 통과 불가 → 휴면 확정)
        const _isFirstCouponCandidate =
          !ctx.user.trialEndsAt &&
          ctx.user.role !== 'admin' &&
          !(ctx.user as any).isFranchise;

        let _hasEverHadPaidPlan = false;
        if (_isFirstCouponCandidate) {
          try {
            const dbCheck = await db.getDb();
            if (!dbCheck) throw new Error('DB connection unavailable');
            const result = await dbCheck.execute(
              sql`SELECT 1 FROM user_plans
                  WHERE user_id = ${ctx.user.id} AND tier != 'FREE'
                  LIMIT 1`
            );
            _hasEverHadPaidPlan = ((result as any)?.rows?.length ?? 0) > 0;
          } catch (paidCheckErr) {
            // throw fallback: 애매한 기본값보다 재시도 유도가 안전.
            console.error('[coupons.create] hasEverHadPaidPlan query failed:', paidCheckErr);
            throw new TRPCError({
              code: 'INTERNAL_SERVER_ERROR',
              message: '일시적 오류가 발생했습니다. 잠시 후 다시 시도해주세요.',
            });
          }
        }

        const _isFirstCoupon = _isFirstCouponCandidate && !_hasEverHadPaidPlan;

        // ── Effective Plan 조회 + 서버 강제 정책 (어드민은 bypass) ─────────────
        //
        // 2026-04-18 패키지 고정 정책:
        //   A) create 시점에는 **누적 quota 선차감/검증을 하지 않는다**.
        //      쿠폰은 pending 상태로 저장만 한다. 한도 체크는 admin approveCoupon 시점에서
        //      approved 기준으로만 수행된다. ("남은 수량" "다음 멤버십" 같은 문구도 여기 없음)
        //   B) 비관리자의 input.totalQuantity / input.startDate / input.endDate는
        //      "검증"이 아니라 "무시하고 서버 값으로 override"한다. (개발자도구/프록시 우회 차단)
        //        - totalQuantity → plan.defaultCouponQuota
        //        - startDate     → 오늘 (등록일)
        //        - endDate       → computeCouponEndDate(오늘, plan)
        const planRow = ctx.user.role === 'admin' ? null : await db.getEffectivePlan(ctx.user.id);
        const plan = db.resolveEffectivePlan(planRow);

        // 서버 최종 적용값 (어드민은 클라이언트 값 그대로 사용)
        let enforcedTotalQuantity: number = input.totalQuantity;
        let enforcedDailyLimit: number | null | undefined = input.dailyLimit;
        let enforcedStartDate: Date = input.startDate instanceof Date
          ? input.startDate
          : new Date(input.startDate as any);

        if (ctx.user.role !== 'admin') {
          // 첫 쿠폰: trialEndsAt=NULL → 가상(in-memory) effective 값으로 accountState 판정
          // 실제 trial_ends_at DB 저장은 coupon insert 성공 직후 (아래) — 실패 시 trial 미시작
          const effectiveTrialEndsAt = _isFirstCoupon
            ? new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
            : ctx.user.trialEndsAt;

          // FRANCHISE 계정은 무조건 'paid' → 체험 만료 관계없이 쿠폰 등록 가능 (무적)
          const accountState = db.resolveAccountState(
            effectiveTrialEndsAt, plan.tier, !!(ctx.user as any).isFranchise
          );

          if (accountState === 'non_trial_free') {
            throw new TRPCError({
              code: 'FORBIDDEN',
              message: '무료 체험이 종료되었습니다. 유료 구독팩을 신청해 주세요.',
            });
          }

          // 활성 패키지 부재 (quota=0) — 등록 자체를 차단
          if (plan.defaultCouponQuota <= 0) {
            throw new TRPCError({
              code: 'FORBIDDEN',
              message: '현재 부여된 패키지가 없어 쿠폰을 등록할 수 없습니다. 관리자에게 문의하세요.',
            });
          }

          // 비관리자: 클라이언트 값 전부 무시 → 패키지 기본값으로 강제
          enforcedTotalQuantity = plan.defaultCouponQuota;
          enforcedStartDate = new Date();
          // 일 소비수량(dailyLimit) 최소값 강제 — tier 기준 floor 보장.
          // 사장님이 낮은 값 입력 또는 미입력 → tier 최소값으로 올림. 높은 값은 그대로 존중.
          const tierMinDaily = TIER_DEFAULTS[plan.tier]?.dailyLimit ?? TIER_DEFAULTS.FREE.dailyLimit;
          enforcedDailyLimit = Math.max(Number(input.dailyLimit ?? 0) || 0, tierMinDaily);
          // ※ 누적 quota 검증 및 "남은 수량"/"다음 멤버십" 문구는 여기서 일체 수행하지 않는다.
          //    이들은 admin approveCoupon 시점에서 approved 기준으로만 실행된다.
        }

        // ── endDate 서버 강제 계산 ────────────────────────────────────────────
        // 어드민: 클라이언트가 endDate를 지정했으면 그대로 사용 (스케줄링 편의)
        // 비관리자: enforcedStartDate 기준 plan 정책으로 항상 재계산
        const serverEndDate = ctx.user.role === 'admin' && input.endDate
          ? input.endDate
          : db.computeCouponEndDate(enforcedStartDate, plan);
        // ── 서버 강제 끝 ──────────────────────────────────────────────────────

        const couponData: any = {
          storeId: input.storeId,
          title: input.title,
          description: input.description,
          discountType: input.discountType,
          discountValue: input.discountValue,
          minPurchase: input.minPurchase,
          maxDiscount: input.maxDiscount,
          totalQuantity: enforcedTotalQuantity, // ← 서버 강제값 (non-admin = plan quota)
          dailyLimit: enforcedDailyLimit,       // ← 비관리자: max(input, tierMin) / 관리자: input 그대로
          startDate: enforcedStartDate,         // ← 서버 강제값 (non-admin = 오늘)
          endDate: serverEndDate,               // ← 서버 계산값
          remainingQuantity: enforcedTotalQuantity,
          isActive: true,
        };

        // 관리자 또는 AUTO_APPROVE=true(테스트 전용) 이면 즉시 승인
        if (ctx.user.role === 'admin' || process.env.AUTO_APPROVE === 'true') {
          couponData.approvedBy = ctx.user.id;
          couponData.approvedAt = new Date();
        }

        const coupon = await db.createCoupon(couponData);

        // 2026-04-23: trial_ends_at DB 저장은 approveCoupon 시점으로 이동됨.
        // 정책: "무료 쿠폰을 쓴 자 = FREE 등급에서 approveCoupon 완료된 자".
        // 승인 대기 기간엔 체험 시계 멈춤 → 사장님에게 공정.
        // (가상 trial 주입 로직은 유지 — 신규 유저 create 통과용 방어선)

        void db.insertAuditLog({
          adminId: ctx.user.id,
          action: 'merchant_coupon_create',
          targetType: 'coupon',
          targetId: (coupon as any)?.id,
          payload: {
            storeId: input.storeId,
            title: input.title,
            totalQuantity: enforcedTotalQuantity,
            tier: plan.tier,
            serverEndDate: serverEndDate.toISOString(),
            autoApproved: ctx.user.role === 'admin',
          },
        });

        // 관리자 아닌 사장님이 쿠폰 등록 → 승인 대기 알림 메일
        if (ctx.user.role !== 'admin' && process.env.AUTO_APPROVE !== 'true') {
          void sendAdminNotificationEmail({
            type: 'coupon_pending',
            merchantName: ctx.user.name ?? ctx.user.email ?? `ID:${ctx.user.id}`,
            merchantEmail: ctx.user.email ?? '',
            targetName: input.title,
            extraInfo: `수량: ${enforcedTotalQuantity}개`,
          });
        }

        return {
          success: true,
          message: (ctx.user.role === 'admin' || process.env.AUTO_APPROVE === 'true')
            ? '쿠폰이 등록되었습니다.'
            : '쿠폰 등록이 완료되었습니다. 관리자 승인 후 지도에 노출됩니다.',
          serverEndDate: serverEndDate.toISOString(), // 프론트가 표시할 수 있도록 반환
        };
      }),

    // 쿠폰 수정 (사장님 전용)
    //
    // 2026-04-18 패키지 고정 정책:
    //   비관리자 요청의 totalQuantity / startDate / endDate 필드는 서버에서 **완전히 무시**한다.
    //   (수량·기간은 패키지 고정값이므로 변경 자체가 허용되지 않는다.)
    //   수정 가능 필드: title / description / discountType / discountValue /
    //                  minPurchase / maxDiscount / dailyLimit
    //   어드민은 모든 필드 자유 수정 가능.
    //   ※ 누적 quota 선차감/검증은 수행하지 않는다 — 한도 체크는 admin approveCoupon 시점에서만.
    update: merchantProcedure
      .input(z.object({
        id: z.number(),
        title: z.string().optional(),
        description: z.string().optional(),
        discountType: z.enum(['fixed', 'freebie']).optional(),
        discountValue: z.number().optional(),
        minPurchase: z.number().optional(),
        maxDiscount: z.number().optional(),
        dailyLimit: z.number().optional(),
        totalQuantity: z.number().optional(), // 비관리자는 서버에서 drop
        startDate: z.date().optional(),       // 비관리자는 서버에서 drop
        endDate: z.date().optional(),         // 비관리자는 서버에서 drop (어드민만 반영)
      }).refine(
        (d) => d.discountType !== 'fixed' || d.discountValue === undefined || d.discountValue >= 1000,
        { message: '원 할인 쿠폰은 최소 1,000원 이상이어야 합니다', path: ['discountValue'] }
      ))
      .mutation(async ({ ctx, input }) => {
        const { id, ...data } = input;

        // 쿠폰 확인
        const coupon = await db.getCouponById(id);
        if (!coupon) throw new Error('Coupon not found');

        // 본인 가게의 쿠폰인지 확인
        const store = await db.getStoreById(coupon.storeId);
        if (!store) throw new Error('Store not found');
        if (store.ownerId !== ctx.user.id && ctx.user.role !== 'admin') {
          throw new Error('Unauthorized');
        }

        // ── 어드민 bypass ─────────────────────────────────────────────────────
        if (ctx.user.role === 'admin') {
          await db.updateCoupon(id, data as any);
          return { success: true };
        }

        // ── 비관리자 ──────────────────────────────────────────────────────────
        // 1) 체험 종료 계정 차단 (계정 상태 가드)
        const planRow = await db.getEffectivePlan(ctx.user.id);
        const plan = db.resolveEffectivePlan(planRow);
        const accountState = db.resolveAccountState(
          ctx.user.trialEndsAt, plan.tier, !!(ctx.user as any).isFranchise
        );
        if (accountState === 'non_trial_free') {
          throw new TRPCError({
            code: 'FORBIDDEN',
            message: '무료 체험이 종료되었습니다. 유료 구독팩을 신청해 주세요.',
          });
        }

        // 2) 수량·기간 필드 제거 (서버에서 무조건 drop — 개발자도구/프록시 우회 차단)
        const updateData: any = { ...data };
        delete updateData.totalQuantity;
        delete updateData.startDate;
        delete updateData.endDate;

        // 3) 일 소비수량(dailyLimit) 최소값 강제 — tier 기준 floor.
        //    input.dailyLimit 이 tier 최소값보다 작으면 최소값으로 올림.
        if (updateData.dailyLimit !== undefined) {
          const tierMinDaily = TIER_DEFAULTS[plan.tier]?.dailyLimit ?? TIER_DEFAULTS.FREE.dailyLimit;
          updateData.dailyLimit = Math.max(Number(updateData.dailyLimit) || 0, tierMinDaily);
        }

        await db.updateCoupon(id, updateData);
        return { success: true };
      }),

    // 쿠폰 삭제 (사장님 전용)
    delete: merchantProcedure
      .input(z.object({
        id: z.number(),
      }))
      .mutation(async ({ ctx, input }) => {
        // 쿠폰 확인
        const coupon = await db.getCouponById(input.id);
        if (!coupon) throw new Error('Coupon not found');

        // 본인 가게의 쿠폰인지 확인
        const store = await db.getStoreById(coupon.storeId);
        if (!store) throw new Error('Store not found');
        if (store.ownerId !== ctx.user.id && ctx.user.role !== 'admin') {
          throw new Error('Unauthorized');
        }

        await db.deleteCoupon(input.id);

        // 쿠폰 삭제 시 그 매장의 24h 내 알림 자동 cleanup
        // (notifications.related_id = store_id 단위 + 같은 매장 24h 가드 = 1건만 존재)
        // → 사용자가 옛 알림 클릭해도 그 쿠폰 없음 = 혼란 방지
        try {
          const dbConn = await db.getDb();
          if (dbConn) {
            await dbConn.execute(sql`
              DELETE FROM notifications
              WHERE related_id = ${coupon.storeId}
                AND type IN ('new_coupon', 'nudge_activated', 'newly_opened_nearby', 'nearby_store')
                AND created_at > NOW() - INTERVAL '24 hours'
            `);
          }
        } catch (e) {
          console.error('[deleteCoupon] notification cleanup failed (non-critical):', e);
        }

        void db.insertAuditLog({
          adminId: ctx.user.id,
          action: 'merchant_coupon_delete',
          targetType: 'coupon',
          targetId: input.id,
          payload: { storeId: coupon.storeId },
        });
        return { success: true };
      }),

    // 활성 쿠폰 목록 조회 (공개)
    listActive: publicProcedure.query(async () => {
      return await db.getActiveCoupons();
    }),

    // [SECURE] merchant 본인 소유 쿠폰 전용 조회
    // - merchantProcedure: 인증된 merchant/admin만 호출 가능
    // - 서버에서 소유권 검증 → 클라이언트 필터 불필요
    // - soft-deleted 매장 제외, 활성/비활성/만료 포함 (대시보드 전체 관리용)
    listMy: merchantProcedure.query(async ({ ctx }) => {
      return await db.getMerchantCoupons(ctx.user.id);
    }),

    // 가게별 쿠폰 목록
    listByStore: publicProcedure
      .input(z.object({
        storeId: z.number(),
      }))
      .query(async ({ input }) => {
        return await db.getCouponsByStoreId(input.storeId);
      }),

    // 쿠폰 다운로드 (🔒 Rate Limiting + Transaction Lock 적용)
    download: protectedProcedure
      .use(rateLimitCriticalAction(10, 60000)) // 분당 10회 제한 (선착순 쿠폰 봇 방지)
      .input(z.object({
        couponId: z.number(),
        deviceId: z.string().optional(), // 기기 ID (중복 다운로드 방지)
      }))
      .mutation(async ({ ctx, input }) => {
        try {
          const coupon = await db.getCouponById(input.couponId);
          if (!coupon) throw new Error('쿠폰을 찾을 수 없습니다');
          if (coupon.remainingQuantity <= 0) throw new Error('쿠폰이 모두 소진되었습니다');

          // 일 소비수량 사전 체크 (빠른 실패 — 스탈 데이터 허용, 정확한 원자 체크는 트랜잭션 내부)
          if (coupon.dailyLimit && coupon.dailyUsedCount >= coupon.dailyLimit) {
            throw new Error('오늘의 쿠폰이 모두 소진되었습니다. 내일 다시 시도해주세요.');
          }

          // 쿠폰 만료 체크 (종료일 23:59:59까지 유효)
          const endOfDay = new Date(coupon.endDate);
          endOfDay.setHours(23, 59, 59, 999);
          if (new Date() > endOfDay) throw new Error('만료된 쿠폰입니다');

          // 2026-04-24: 쿠폰 owner 의 구독 자격 실시간 체크
          // 유료 만료(isDormantMerchant=true) 시점에 쿠폰이 지도/DB 상 active 상태로 남아있어도
          // 다운로드 시점에 차단. "유료 끝나면 해당 기간 발행 쿠폰도 다운 불가" 원칙.
          // isFranchise 계정은 예외 — dormant 판정 자체가 안 나옴.
          const ownerStore = await db.getStoreById(coupon.storeId);
          if (!ownerStore) throw new Error('가게 정보를 찾을 수 없습니다');
          const ownerUser = await db.getUserById(ownerStore.ownerId);
          if (!ownerUser) throw new Error('가게 소유자 정보를 찾을 수 없습니다');
          const ownerPlanRow = await db.getEffectivePlan(ownerStore.ownerId);
          const ownerPlanForCheck = ownerPlanRow
            ? { isActive: true,
                expiresAt: (ownerPlanRow as any).expires_at ?? null,
                tier: (ownerPlanRow as any).tier ?? null }
            : null;
          const isOwnerDormant = db.isDormantMerchant(
            ownerUser.trialEndsAt,
            ownerPlanForCheck,
          );
          // 프랜차이즈는 isDormantMerchant 내부 plan 체크로 비휴면(유료 활성 플랜 유지) 또는
          // 그 외 경로로 걸러짐. 추가 안전장치로 isFranchise 직접 체크.
          const isOwnerFranchise = !!(ownerUser as any).isFranchise;
          if (isOwnerDormant && !isOwnerFranchise) {
            throw new Error(
              '이 가게는 현재 구독 기간이 종료되어 쿠폰 다운로드가 불가합니다. 가게에 문의해주세요.'
            );
          }

          // ── PENALIZED 유저 주 1회 참여 제한 (KST 기준 월~일 고정 주간) ──────
          const abuseStatus = await db.getUserAbuseStatus(ctx.user.id);
          if (abuseStatus?.status === 'PENALIZED') {
            const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
            const nowKst = new Date(Date.now() + KST_OFFSET_MS);
            const dayOfWeek = nowKst.getUTCDay(); // 0=일, 1=월 ... 6=토
            const mondayKst = new Date(nowKst);
            mondayKst.setUTCDate(nowKst.getUTCDate() - ((dayOfWeek + 6) % 7));
            mondayKst.setUTCHours(0, 0, 0, 0);
            const weekStartUtc = new Date(mondayKst.getTime() - KST_OFFSET_MS);
            const nextMondayKst = new Date(mondayKst);
            nextMondayKst.setUTCDate(mondayKst.getUTCDate() + 7);
            const nextMondayStr = nextMondayKst.toISOString().slice(0, 10);

            const dbConn = await db.getDb();
            if (dbConn) {
              const weeklyCheck = await dbConn.execute(sql`
                SELECT id FROM user_coupons
                WHERE user_id = ${ctx.user.id}
                  AND downloaded_at >= ${weekStartUtc.toISOString()}
                LIMIT 1
              `);
              const hasDownloadThisWeek = ((weeklyCheck as any)?.rows ?? []).length > 0;
              if (hasDownloadThisWeek) {
                throw new TRPCError({
                  code: 'FORBIDDEN',
                  message: `이번 주 참여 횟수를 초과하였습니다. ${nextMondayStr} (월)부터 다시 이용 가능합니다.`,
                });
              }
            }
          }
          // ─────────────────────────────────────────────────────────────────

          // 48시간 제한 확인: 동일 업장의 쿠폰을 48시간 이내에 사용한 이력 확인
          const recentUsage = await db.checkRecentStoreUsage(ctx.user.id, coupon.storeId);
          if (recentUsage && recentUsage.usedAt) {
            const hoursSinceUsage = (Date.now() - new Date(recentUsage.usedAt).getTime()) / (1000 * 60 * 60);
            const remainingHours = Math.ceil(48 - hoursSinceUsage);
            throw new Error(`이 업장의 쿠폰을 최근에 사용하셨습니다. ${remainingHours}시간 후에 다시 다운로드할 수 있습니다.`);
          }

          // [1차] userId+couponId 기준 중복 체크 — deviceId 유무 관계없이 항상 실행
          // → deviceId가 없는 클라이언트도 동일 유저의 중복 다운로드 차단
          const existingByUser = await db.checkUserCoupon(ctx.user.id, input.couponId);
          if (existingByUser) {
            console.log(JSON.stringify({
              action: 'coupon_download_blocked',
              reason: 'user_duplicate',
              userId: ctx.user.id,
              couponId: input.couponId,
              duplicateRowId: existingByUser.id,
              duplicateStatus: existingByUser.status,
            }));
            throw new Error('이미 다운로드한 쿠폰입니다');
          }

          // [2차] 기기당 1회 제한 (deviceId 있을 때 추가 확인 — 동일 유저가 여러 기기 보유 시 각 기기 1회)
          if (input.deviceId) {
            const existingByDevice = await db.checkDeviceCoupon(ctx.user.id, input.couponId, input.deviceId);
            if (existingByDevice) {
              console.log(JSON.stringify({
                action: 'coupon_download_blocked',
                reason: 'device_duplicate',
                userId: ctx.user.id,
                couponId: input.couponId,
                deviceKey: input.deviceId.substring(0, 8) + '***',
                duplicateRowId: existingByDevice.id,
              }));
              throw new Error('이미 이 기기에서 다운로드한 쿠폰입니다');
            }
          }

          // 쿠폰 코드 생성 (CPN-YYYYMMDD-XXXXXX)
          const date = new Date().toISOString().split('T')[0].replace(/-/g, '');
          const random = Math.floor(Math.random() * 1000000).toString().padStart(6, '0');
          const couponCode = `CPN-${date}-${random}`;

          // 6자리 PIN 코드 생성
          const pinCode = Math.floor(100000 + Math.random() * 900000).toString();

          // QR 코드 생성 (레거시)
          const qrCode = await QRCode.toDataURL(couponCode);

          // 🔒 쿠폰 다운로드 (Transaction Lock 내부에서 수량 차감 자동 처리)
          await db.downloadCoupon(
            ctx.user.id,
            input.couponId,
            couponCode,
            pinCode,
            input.deviceId || null,
            qrCode,
            new Date(coupon.endDate)
          );

          // 일 소비수량 증가는 downloadCoupon 트랜잭션 내부에서 원자적으로 처리됨 (BUG-1 fix)

          // 사용자 통계 업데이트
          await db.incrementCouponDownload(ctx.user.id);

          // [계측] DOWNLOAD 이벤트 로그 (fire-and-forget, 정책 변경 없음)
          void db.insertCouponEvent({
            userId: ctx.user.id,
            couponId: input.couponId,
            storeId: coupon.storeId,
            eventType: 'DOWNLOAD',
            meta: {
              remainingQtyBefore: coupon.remainingQuantity,
              remainingQtyAfter: coupon.remainingQuantity - 1,
              deviceId: input.deviceId ?? null,
              couponCode,
            },
          });

          // β (2026-04-21): 쿠폰 다운로드 시 자동 단골 등록 (fire-and-forget)
          // - notify_new_coupon=FALSE 로 알림 기본 OFF (정보통신망법 + 어뷰저 가속 방지)
          // - 유저는 /my-coupons "내 단골" 탭에서 매장 재탐색 가능
          // - 이미 단골이면 no-op
          void db.ensureFavoriteOnDownload(ctx.user.id, coupon.storeId);

          console.log(JSON.stringify({
            action: 'coupon_download_success',
            userId: ctx.user.id,
            couponId: input.couponId,
            deviceKey: input.deviceId ? input.deviceId.substring(0, 8) + '***' : null,
            couponCode,
          }));

          return { success: true, couponCode, pinCode, qrCode };

        } catch (error: any) {
          console.log(JSON.stringify({
            action: 'coupon_download_error',
            userId: ctx.user.id,
            couponId: input.couponId,
            deviceKey: input.deviceId ? input.deviceId.substring(0, 8) + '***' : null,
            errorMsg: error?.message,
          }));
          // 예상 비즈니스 에러는 Sentry 전송 제외 (노이즈 방지)
          const EXPECTED_ERRORS = [
            '쿠폰을 찾을 수 없습니다', '쿠폰이 모두 소진되었습니다', '오늘의 쿠폰이 모두 소진되었습니다',
            '만료된 쿠폰입니다', '이미 다운로드한 쿠폰입니다', '이미 이 기기에서 다운로드한 쿠폰입니다',
            '이 업장의 쿠폰을 최근에 사용하셨습니다',
          ];
          if (!EXPECTED_ERRORS.some(msg => error?.message?.startsWith(msg))) {
            captureBusinessCriticalError(error, {
              userId: ctx.user.id,
              couponId: input.couponId,
              action: 'coupon_download',
            });
          }
          throw error;
        }
      }),

    // 내 쿠폰 목록
    myCoupons: protectedProcedure.query(async ({ ctx }) => {
      const userCouponsList = await db.getUserCouponsWithDetails(ctx.user.id);
      return userCouponsList;
    }),

    // 사용자 셀프 사용 완료
    markAsUsed: protectedProcedure
      .input(z.object({
        userCouponId: z.number(),
      }))
      .mutation(async ({ ctx, input }) => {
        // 사용자 쿠폰 확인
        const userCoupon = await db.getUserCouponById(input.userCouponId);
        if (!userCoupon) throw new Error('쿠폰을 찾을 수 없습니다');
        if (userCoupon.userId !== ctx.user.id) throw new Error('권한이 없습니다');
        if (userCoupon.status === 'used') throw new Error('이미 사용된 쿠폰입니다');
        if (userCoupon.status === 'expired') throw new Error('만료된 쿠폰입니다');

        // 쿠폰 정보 가져오기 (storeId 필요)
        const coupon = await db.getCouponById(userCoupon.couponId);
        if (!coupon) throw new Error('쿠폰 정보를 찾을 수 없습니다');

        // 2026-04-24: 쿠폰 owner 의 구독 종료 시 사용 처리 차단
        // 이미 다운로드받은 쿠폰도 가게 구독이 끝나면 "소멸" 처리 (사장님 정책).
        const ownerStoreMk = await db.getStoreById(coupon.storeId);
        if (!ownerStoreMk) throw new Error('가게 정보를 찾을 수 없습니다');
        const ownerUserMk = await db.getUserById(ownerStoreMk.ownerId);
        if (ownerUserMk && !(ownerUserMk as any).isFranchise) {
          const ownerPlanRowMk = await db.getEffectivePlan(ownerStoreMk.ownerId);
          const ownerPlanForCheckMk = ownerPlanRowMk
            ? { isActive: true,
                expiresAt: (ownerPlanRowMk as any).expires_at ?? null,
                tier: (ownerPlanRowMk as any).tier ?? null }
            : null;
          const isOwnerDormantMk = db.isDormantMerchant(
            ownerUserMk.trialEndsAt,
            ownerPlanForCheckMk,
          );
          if (isOwnerDormantMk) {
            throw new Error(
              '이 쿠폰은 가게 구독 종료로 소멸되었습니다. 더 이상 사용할 수 없습니다.'
            );
          }
        }

        // 사용 완료 처리
        await db.markUserCouponAsUsed(input.userCouponId);

        // coupon_usage 테이블에 사용 내역 기록
        await db.recordCouponUsage({
          userCouponId: input.userCouponId,
          storeId: coupon.storeId,
          userId: ctx.user.id,
          verifiedBy: ctx.user.id, // 셀프 사용이므로 본인이 검증
        });

        // 사용자 통계 업데이트
        await db.incrementCouponUsage(ctx.user.id);

        // [계측] REDEEM 이벤트 로그 (셀프 사용, fire-and-forget)
        void db.insertCouponEvent({
          userId: ctx.user.id,
          couponId: userCoupon.couponId,
          storeId: coupon.storeId,
          eventType: 'REDEEM',
          meta: { userCouponId: input.userCouponId, verifiedBy: 'self' },
        });

        // 🎯 도장판 도장 자동 획득
        try {
          const { districtStampsRouter } = await import('./routers/districtStamps');
          // collectStamp 로직 직접 실행
          const { getDb: getDbForStamps } = await import('./db');
          const dbForStamps = await getDbForStamps();

          const { districtStampSlots: slots, districtStampBoards: boards, userDistrictStamps: stamps, userStampBoardProgress: progress } = await import('../drizzle/schema');
          const { eq: eqDrizzle, and: andDrizzle, sql: sqlDrizzle } = await import('drizzle-orm');

          // 해당 매장이 포함된 도장판 슬롯 찾기
          const slotsList = await dbForStamps
            .select({
              slotId: slots.id,
              boardId: slots.boardId,
              storeId: slots.storeId,
              requiredStamps: boards.requiredStamps,
            })
            .from(slots)
            .leftJoin(boards, eqDrizzle(slots.boardId, boards.id))
            .where(
              andDrizzle(
                eqDrizzle(slots.storeId, coupon.storeId),
                eqDrizzle(boards.isActive, true)
              )
            );

          for (const slot of slotsList) {
            // 이미 도장 받았는지 확인
            const existingStamp = await dbForStamps
              .select()
              .from(stamps)
              .where(
                andDrizzle(
                  eqDrizzle(stamps.userId, ctx.user.id),
                  eqDrizzle(stamps.boardId, slot.boardId),
                  eqDrizzle(stamps.slotId, slot.slotId)
                )
              )
              .limit(1);

            if (existingStamp.length === 0) {
              // 도장 추가
              await dbForStamps.insert(stamps).values({
                userId: ctx.user.id,
                boardId: slot.boardId,
                slotId: slot.slotId,
                storeId: coupon.storeId,
                userCouponId: input.userCouponId,
              });

              // 진행 상황 업데이트
              await dbForStamps
                .insert(progress)
                .values({
                  userId: ctx.user.id,
                  boardId: slot.boardId,
                  collectedStamps: 1,
                  isCompleted: false,
                  rewardClaimed: false,
                })
                .onConflictDoUpdate({
                  target: [progress.userId, progress.boardId],
                  set: {
                    collectedStamps: sqlDrizzle`${progress.collectedStamps} + 1`,
                    updatedAt: sqlDrizzle`NOW()`,
                  },
                });

              // 완성 체크
              const progressResult = await dbForStamps
                .select()
                .from(progress)
                .where(
                  andDrizzle(
                    eqDrizzle(progress.userId, ctx.user.id),
                    eqDrizzle(progress.boardId, slot.boardId)
                  )
                )
                .limit(1);

              const currentStamps = progressResult[0]?.collectedStamps || 0;

              if (currentStamps >= slot.requiredStamps) {
                await dbForStamps
                  .update(progress)
                  .set({
                    isCompleted: true,
                    completedAt: sqlDrizzle`NOW()`,
                  })
                  .where(
                    andDrizzle(
                      eqDrizzle(progress.userId, ctx.user.id),
                      eqDrizzle(progress.boardId, slot.boardId)
                    )
                  );

                console.log(`🎉 [DistrictStamp] 도장판 완성! boardId: ${slot.boardId}`);
              }
            }
          }
        } catch (stampError) {
          console.error('[DistrictStamp] 도장 획득 실패 (쿠폰 사용은 성공):', stampError);
          // 도장 획득 실패해도 쿠폰 사용은 성공 처리
        }

        return { success: true };
      }),
  }),

  couponUsage: router({
    // 쿠폰 정보 미리보기 (사장님 전용) - PIN 코드 지원
    preview: merchantProcedure
      .input(z.object({
        pinCode: z.string().optional(), // PIN 코드 (6자리)
        couponCode: z.string().optional(), // QR 코드 (레거시)
        storeId: z.number(),
      }))
      .query(async ({ ctx, input }) => {
        // PIN 코드나 QR 코드 중 하나는 필수
        if (!input.pinCode && !input.couponCode) {
          throw new Error('PIN 코드 또는 쿠폰 코드가 필요합니다');
        }

        // 본인 가게인지 확인
        const store = await db.getStoreById(input.storeId);
        if (!store) throw new Error('가게를 찾을 수 없습니다');
        if (store.ownerId !== ctx.user.id && ctx.user.role !== 'admin') {
          throw new Error('권한이 없습니다');
        }

        // 쿠폰 확인 (PIN 코드 우선)
        let userCoupon;
        if (input.pinCode) {
          userCoupon = await db.getUserCouponByPinCode(input.pinCode);
        } else if (input.couponCode) {
          userCoupon = await db.getUserCouponByCode(input.couponCode);
        }

        if (!userCoupon) throw new Error('잘못된 PIN 코드입니다');
        if (userCoupon.status === 'used') throw new Error('이미 사용된 쿠폰입니다');
        if (userCoupon.status === 'expired') throw new Error('만료된 쿠폰입니다');
        if (new Date() > new Date(userCoupon.expiresAt)) throw new Error('만료된 쿠폰입니다');

        // 쿠폰 정보 가져오기
        const coupon = await db.getCouponById(userCoupon.couponId);
        if (!coupon) throw new Error('Coupon not found');

        // 사용자 정보는 userCoupon에서 가져오기 (현재 userId만 있음)
        // TODO: users 테이블에서 사용자 이름 가져오기

        // 가게 정보 가져오기
        const couponStore = await db.getStoreById(coupon.storeId);

        return {
          couponCode: userCoupon.couponCode,
          couponTitle: coupon.title,
          description: coupon.description,
          discountType: coupon.discountType,
          discountValue: coupon.discountValue,
          minPurchase: coupon.minPurchase,
          maxDiscount: coupon.maxDiscount,
          expiresAt: userCoupon.expiresAt,
          userName: `사용자 #${userCoupon.userId}`, // TODO: users 테이블에서 실제 이름 가져오기
          status: userCoupon.status,
          // 가게 정보
          storeName: couponStore?.name || '가게',
          storeAddress: couponStore?.address || '',
          storeCategory: couponStore?.category || '',
        };
      }),

    // 쿠폰 사용 처리 (사장님 전용) - PIN 코드 방식
    verify: merchantProcedure
      .input(z.object({
        pinCode: z.string().optional(), // PIN 코드 (6자리)
        couponCode: z.string().optional(), // QR 코드 (레거시)
        storeId: z.number(),
      }))
      .mutation(async ({ ctx, input }) => {
        // PIN 코드나 QR 코드 중 하나는 필수
        if (!input.pinCode && !input.couponCode) {
          throw new Error('PIN 코드 또는 쿠폰 코드가 필요합니다');
        }

        // 본인 가게인지 확인
        const store = await db.getStoreById(input.storeId);
        if (!store) throw new Error('가게를 찾을 수 없습니다');
        if (store.ownerId !== ctx.user.id && ctx.user.role !== 'admin') {
          throw new Error('권한이 없습니다');
        }

        // 쿠폰 확인 (PIN 코드 우선)
        let userCoupon;
        if (input.pinCode) {
          userCoupon = await db.getUserCouponByPinCode(input.pinCode);
        } else if (input.couponCode) {
          userCoupon = await db.getUserCouponByCode(input.couponCode);
        }

        if (!userCoupon) throw new Error('잘못된 PIN 코드입니다');
        if (userCoupon.status === 'used') throw new Error('이미 사용된 쿠폰입니다');
        if (userCoupon.status === 'expired') throw new Error('만료된 쿠폰입니다');
        if (new Date() > new Date(userCoupon.expiresAt)) throw new Error('만료된 쿠폰입니다');

        // 부모 쿠폰 isActive 체크 — admin 삭제된 쿠폰은 사용 불가 (BUG-04 fix)
        const parentCoupon = await db.getCouponById(userCoupon.couponId);
        if (!parentCoupon || !parentCoupon.isActive) {
          throw new Error('해당 쿠폰은 운영이 중단되었습니다.');
        }

        // QA-H3 (PR-19): 쿠폰 사용 + 사용 내역 + 통계 atomic 트랜잭션
        // 이전: 3단계 분리 호출 → 중간 실패 시 상태 불일치 (status=used 인데 통계 누락 등)
        // 이후: db.markCouponUsedTx 안에서 3 작업 단일 트랜잭션 → 부분 실패 0
        await db.markCouponUsedTx(
          userCoupon.id,
          {
            userCouponId: userCoupon.id,
            storeId: input.storeId,
            userId: userCoupon.userId,
            verifiedBy: ctx.user.id,
          },
          userCoupon.userId,
        );

        // 쿠폰 정보 가져오기
        const coupon = await db.getCouponById(userCoupon.couponId);

        // [계측] REDEEM 이벤트 로그 (사장님 PIN 검증, fire-and-forget)
        void db.insertCouponEvent({
          userId: userCoupon.userId,
          couponId: userCoupon.couponId,
          storeId: input.storeId,
          eventType: 'REDEEM',
          meta: { userCouponId: userCoupon.id, verifiedBy: 'merchant', merchantId: ctx.user.id },
        });

        return {
          success: true,
          couponTitle: coupon?.title || '쿠폰'
        };
      }),

    // 가게별 쿠폰 사용 내역
    listByStore: merchantProcedure
      .input(z.object({
        storeId: z.number(),
      }))
      .query(async ({ ctx, input }) => {
        // 본인 가게인지 확인
        const store = await db.getStoreById(input.storeId);
        if (!store) throw new Error('Store not found');
        if (store.ownerId !== ctx.user.id && ctx.user.role !== 'admin') {
          throw new Error('Unauthorized');
        }

        return await db.getCouponUsageByStoreId(input.storeId);
      }),
  }),

  favorites: router({
    // 즐겨찾기 추가
    add: protectedProcedure
      .input(z.object({
        storeId: z.number(),
      }))
      .mutation(async ({ ctx, input }) => {
        // 사전 EXISTS 체크 — 중복 INSERT 시 raw DB 에러 대신 사용자 친화 메시지
        const already = await db.isFavorite(ctx.user.id, input.storeId);
        if (already) {
          throw new TRPCError({
            code: 'CONFLICT',
            message: '이미 단골손님이십니다.',
          });
        }
        try {
          await db.addFavorite(ctx.user.id, input.storeId);
        } catch (e: any) {
          // Race condition 방어 — 사전 체크 통과 후 다른 mutation 이 먼저 INSERT 한 경우
          // PostgreSQL unique_violation = 23505
          if (e?.code === '23505' || /duplicate|unique/i.test(e?.message ?? '')) {
            throw new TRPCError({
              code: 'CONFLICT',
              message: '이미 단골손님이십니다.',
            });
          }
          throw e;
        }
        return { success: true };
      }),

    // 즐겨찾기 제거
    remove: protectedProcedure
      .input(z.object({
        storeId: z.number(),
      }))
      .mutation(async ({ ctx, input }) => {
        await db.removeFavorite(ctx.user.id, input.storeId);
        return { success: true };
      }),

    // 내 즐겨찾기 목록 (경량 — storeId 만 필요한 경로용, 예: MapPage Set 구성)
    list: protectedProcedure.query(async ({ ctx }) => {
      return await db.getUserFavorites(ctx.user.id);
    }),

    // 내 즐겨찾기 목록 + 매장 기본 정보 (/my-coupons 단골 탭 카드 렌더용)
    listWithStores: protectedProcedure.query(async ({ ctx }) => {
      return await db.getUserFavoritesWithStores(ctx.user.id);
    }),

    /**
     * updateNotify — 단골 매장의 새 쿠폰 알림 수신 ON/OFF.
     * 정보통신망법 대응: 유저 명시 동의 경로. β 자동 등록된 row(notify=FALSE)를
     * 유저가 원할 때 ON 으로 전환, 또는 기존 단골 row 를 OFF 로.
     * 대상 row 없으면 no-op (우연한 storeId 조작 방어).
     */
    updateNotify: protectedProcedure
      .input(z.object({
        storeId: z.number(),
        notify: z.boolean(),
      }))
      .mutation(async ({ ctx, input }) => {
        const dbConn = await db.getDb();
        if (!dbConn) throw new Error('DB not available');
        await dbConn.execute(sql`
          UPDATE favorites
          SET notify_new_coupon = ${input.notify}
          WHERE user_id = ${ctx.user.id}
            AND store_id = ${input.storeId}
        `);
        return { success: true };
      }),

    // 즐겨찾기 여부 확인
    check: protectedProcedure
      .input(z.object({
        storeId: z.number(),
      }))
      .query(async ({ ctx, input }) => {
        return await db.isFavorite(ctx.user.id, input.storeId);
      }),
  }),

  // ── 2026-04-28: 슈퍼어드민 공지/이벤트 게시판 (additive only) ──
  // 작성/수정/삭제: admin only / 읽기: public.
  // 팝업 연동: 슈퍼어드민이 글 먼저 작성 후 `/notices/:id` 를 eventPopups.primaryButtonUrl 에 입력.
  notices: router({
    // 목록 — pinned 상단 + 최신순, cursor pagination
    list: publicProcedure
      .input(z.object({
        limit: z.number().min(1).max(50).default(20),
        cursor: z.number().optional(),
      }))
      .query(async ({ input }) => {
        const dbConn = await db.getDb();
        if (!dbConn) return { items: [] as Array<{
          id: number; title: string; preview: string;
          imageUrls: unknown; authorId: number; isPinned: boolean;
          viewCount: number; createdAt: unknown;
        }>, nextCursor: null as number | null };

        const limit = input.limit;
        const cursor = input.cursor;
        const where = cursor ? sql`id < ${cursor}` : sql`TRUE`;
        const rows = await dbConn.execute(sql`
          SELECT id, title, LEFT(body, 200) AS preview, image_urls, author_id, is_pinned, view_count, created_at
          FROM notice_posts
          WHERE ${where}
          ORDER BY is_pinned DESC, created_at DESC, id DESC
          LIMIT ${limit + 1}
        `);
        const list = (rows as any)?.rows ?? [];
        const hasMore = list.length > limit;
        const items = (hasMore ? list.slice(0, limit) : list).map((r: any) => ({
          id: Number(r.id),
          title: String(r.title),
          preview: String(r.preview ?? ''),
          imageUrls: r.image_urls ?? null,
          authorId: Number(r.author_id),
          isPinned: Boolean(r.is_pinned),
          viewCount: Number(r.view_count ?? 0),
          createdAt: r.created_at,
        }));
        const nextCursor = hasMore ? items[items.length - 1].id : null;
        return { items, nextCursor };
      }),

    // 상세 — viewCount +1 (atomic)
    get: publicProcedure
      .input(z.object({ id: z.number() }))
      .query(async ({ input }) => {
        const dbConn = await db.getDb();
        if (!dbConn) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'DB unavailable' });

        const result = await dbConn.execute(sql`
          UPDATE notice_posts
          SET view_count = view_count + 1
          WHERE id = ${input.id}
          RETURNING id, title, body, image_urls, author_id, is_pinned, view_count, created_at, updated_at
        `);
        const row = ((result as any)?.rows ?? [])[0];
        if (!row) {
          throw new TRPCError({ code: 'NOT_FOUND', message: '공지글을 찾을 수 없습니다.' });
        }
        return {
          id: Number(row.id),
          title: String(row.title),
          body: String(row.body),
          imageUrls: row.image_urls ?? null,
          authorId: Number(row.author_id),
          isPinned: Boolean(row.is_pinned),
          viewCount: Number(row.view_count ?? 0),
          createdAt: row.created_at,
          updatedAt: row.updated_at,
        };
      }),

    // 작성 — admin only
    create: adminProcedure
      .input(z.object({
        title: z.string().min(1).max(200),
        body: z.string().min(1).max(5000),
        imageUrls: z.array(z.string()).max(5).optional(),
        isPinned: z.boolean().optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        const dbConn = await db.getDb();
        if (!dbConn) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'DB unavailable' });

        const result = await dbConn
          .insert(noticePosts)
          .values({
            title: input.title,
            body: input.body,
            imageUrls: input.imageUrls ?? null,
            authorId: ctx.user.id,
            isPinned: input.isPinned ?? false,
          })
          .returning({ id: noticePosts.id });
        return { id: result[0].id };
      }),

    // 수정 — admin only
    update: adminProcedure
      .input(z.object({
        id: z.number(),
        title: z.string().min(1).max(200).optional(),
        body: z.string().min(1).max(5000).optional(),
        imageUrls: z.array(z.string()).max(5).optional(),
        isPinned: z.boolean().optional(),
      }))
      .mutation(async ({ input }) => {
        const dbConn = await db.getDb();
        if (!dbConn) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'DB unavailable' });

        const updateData: any = { updatedAt: new Date() };
        if (input.title !== undefined) updateData.title = input.title;
        if (input.body !== undefined) updateData.body = input.body;
        if (input.imageUrls !== undefined) updateData.imageUrls = input.imageUrls;
        if (input.isPinned !== undefined) updateData.isPinned = input.isPinned;

        await dbConn
          .update(noticePosts)
          .set(updateData)
          .where(eq(noticePosts.id, input.id));
        return { success: true };
      }),

    // 삭제 — admin only
    delete: adminProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ input }) => {
        const dbConn = await db.getDb();
        if (!dbConn) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'DB unavailable' });
        await dbConn.delete(noticePosts).where(eq(noticePosts.id, input.id));
        return { success: true };
      }),
  }),

  gamification: router({
    // 내 통계 조회
    myStats: protectedProcedure.query(async ({ ctx }) => {
      let stats = await db.getUserStats(ctx.user.id);

      // 통계가 없으면 생성
      if (!stats) {
        const referralCode = `REF${ctx.user.id}${Math.random().toString(36).substring(2, 8).toUpperCase()}`;
        await db.createUserStats(ctx.user.id, referralCode);
        stats = await db.getUserStats(ctx.user.id);
      }

      return stats;
    }),

    // 내 뱃지 목록
    myBadges: protectedProcedure.query(async ({ ctx }) => {
      return await db.getUserBadges(ctx.user.id);
    }),

    // 내 출석 내역
    myCheckIns: protectedProcedure.query(async ({ ctx }) => {
      return await db.getCheckInsByUserId(ctx.user.id);
    }),

    // 오늘 출석 확인
    todayCheckIn: protectedProcedure.query(async ({ ctx }) => {
      return await db.getTodayCheckIn(ctx.user.id);
    }),

    // 출석 체크
    checkIn: protectedProcedure.mutation(async ({ ctx }) => {
      // 오늘 이미 출석했는지 확인
      const todayCheckIn = await db.getTodayCheckIn(ctx.user.id);
      if (todayCheckIn) {
        throw new Error('오늘 이미 출석하셨어요!');
      }

      // 기본 포인트
      let points = 10;

      // 연속 출석 보너스
      const stats = await db.getUserStats(ctx.user.id);
      const consecutiveDays = (stats?.consecutiveCheckIns || 0) + 1;

      if (consecutiveDays === 7) points += 100;
      if (consecutiveDays === 30) points += 500;

      // 출석 기록
      await db.createCheckIn(ctx.user.id, points);

      // 통계 업데이트
      await db.updateUserStats(ctx.user.id, {
        points: (stats?.points || 0) + points,
        consecutiveCheckIns: consecutiveDays,
        totalCheckIns: (stats?.totalCheckIns || 0) + 1,
      });

      return { success: true, points };
    }),

    // 포인트 내역 조회
    pointHistory: protectedProcedure
      .input(z.object({
        limit: z.number().optional().default(50),
      }))
      .query(async ({ ctx, input }) => {
        return await db.getPointTransactions(ctx.user.id, input.limit);
      }),

    // 내 미션 목록
    myMissions: protectedProcedure.query(async ({ ctx }) => {
      return await db.getUserMissions(ctx.user.id);
    }),

    // 미션 진행도 업데이트 (내부 사용)
    updateMissionProgress: protectedProcedure
      .input(z.object({
        missionId: z.number(),
        progress: z.number(),
      }))
      .mutation(async ({ ctx, input }) => {
        await db.updateUserMissionProgress(ctx.user.id, input.missionId, input.progress);
        return { success: true };
      }),

    // 내 알림 목록 — Cursor 기반 페이징
    // cursor: 마지막으로 받은 notification.id (미전달 = 첫 페이지)
    // 반환: { items, nextCursor } — nextCursor === null 이면 마지막 페이지
    myNotifications: protectedProcedure
      .input(z.object({
        limit: z.number().int().min(1).max(50).optional().default(20),
        cursor: z.number().int().positive().optional(),
      }))
      .query(async ({ ctx, input }) => {
        return await db.getNotifications(ctx.user.id, input.limit, input.cursor);
      }),

    // 알림 읽음 처리
    markNotificationRead: protectedProcedure
      .input(z.object({
        id: z.number(),
      }))
      .mutation(async ({ ctx, input }) => {
        await db.markNotificationAsRead(input.id);
        return { success: true };
      }),

    // 랭킹 조회 (지역별 쿠폰왕)
    leaderboard: publicProcedure
      .input(z.object({
        limit: z.number().optional().default(10),
      }))
      .query(async ({ input }) => {
        return await db.getLeaderboard(input.limit);
      }),
  }),

  // ── 알림 캠페인 성과 통계 (관리자 전용) ─────────────────────────────────
  // notification_stats 기반: 발송/전달/오픈/CTR 리스트
  // 기본 필터: 최근 30일 — 전체 스캔 방지 (idx_notif_stats_created_at 권장)
  notificationCampaigns: protectedProcedure
    .use(({ ctx, next }) => {
      if (ctx.user.role !== 'admin') {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Admin access required' });
      }
      return next({ ctx });
    })
    .input(z.object({
      days: z.number().int().min(1).max(90).optional().default(30),
    }))
    .query(async ({ input }) => {
      const db_conn = await db.getDb();
      if (!db_conn) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR' });

      const rows = await db_conn.execute(`
        SELECT
          group_id        AS "groupId",
          title,
          sent_count      AS "sentCount",
          delivered_count AS "deliveredCount",
          open_count      AS "openCount",
          -- CTR: 전달된 알림 대비 오픈율 (분모 0 방지)
          CASE
            WHEN delivered_count = 0 THEN 0
            ELSE ROUND(open_count::numeric / delivered_count * 100, 2)
          END             AS "ctr",
          created_at      AS "createdAt"
        FROM notification_stats
        WHERE created_at > NOW() - INTERVAL '${input.days} days'
        ORDER BY created_at DESC
        LIMIT 200
      `);

      return (rows as any)?.rows ?? [];
    }),

  // 점주용 통계 API
  merchantAnalytics: router({
    // 내 가게 쿠폰 사용 통계
    couponStats: merchantProcedure
      .input(z.object({ storeId: z.number() }))
      .query(async ({ ctx, input }) => {
        const store = await db.getStoreById(input.storeId);
        if (!store || (store.ownerId !== ctx.user.id && ctx.user.role !== 'admin')) {
          throw new Error('Unauthorized');
        }
        return await analytics.getCouponUsageStats(input.storeId);
      }),

    // 시간대별 사용 패턴
    hourlyPattern: merchantProcedure
      .input(z.object({ storeId: z.number() }))
      .query(async ({ ctx, input }) => {
        const store = await db.getStoreById(input.storeId);
        if (!store || (store.ownerId !== ctx.user.id && ctx.user.role !== 'admin')) {
          throw new Error('Unauthorized');
        }
        return await analytics.getHourlyUsagePattern(input.storeId);
      }),

    // 최근 사용 내역
    recentUsage: merchantProcedure
      .input(z.object({
        storeId: z.number(),
        limit: z.number().optional().default(10)
      }))
      .query(async ({ ctx, input }) => {
        const store = await db.getStoreById(input.storeId);
        if (!store || (store.ownerId !== ctx.user.id && ctx.user.role !== 'admin')) {
          throw new Error('Unauthorized');
        }
        return await analytics.getRecentUsage(input.storeId, input.limit);
      }),

    // 인기 쿠폰 순위
    popularCoupons: merchantProcedure
      .input(z.object({
        storeId: z.number(),
        limit: z.number().optional().default(5)
      }))
      .query(async ({ ctx, input }) => {
        const store = await db.getStoreById(input.storeId);
        if (!store || (store.ownerId !== ctx.user.id && ctx.user.role !== 'admin')) {
          throw new Error('Unauthorized');
        }
        return await analytics.getPopularCoupons(input.storeId, input.limit);
      }),

    // 전체 통계 요약
    summary: merchantProcedure
      .input(z.object({ storeId: z.number() }))
      .query(async ({ ctx, input }) => {
        const store = await db.getStoreById(input.storeId);
        if (!store || (store.ownerId !== ctx.user.id && ctx.user.role !== 'admin')) {
          throw new Error('Unauthorized');
        }
        return await analytics.getStoreSummary(input.storeId);
      }),

    // 쿠폰별 예상 매출 통계
    revenueStats: merchantProcedure
      .input(z.object({ storeId: z.number() }))
      .query(async ({ ctx, input }) => {
        const store = await db.getStoreById(input.storeId);
        if (!store || (store.ownerId !== ctx.user.id && ctx.user.role !== 'admin')) {
          throw new Error('Unauthorized');
        }
        return await analytics.getCouponRevenueStats(input.storeId);
      }),

    // 다운로드 내역 조회 (엑셀 다운로드용)
    downloadHistory: merchantProcedure
      .input(z.object({ storeId: z.number() }))
      .query(async ({ ctx, input }) => {
        const store = await db.getStoreById(input.storeId);
        if (!store || (store.ownerId !== ctx.user.id && ctx.user.role !== 'admin')) {
          throw new Error('Unauthorized');
        }
        return await analytics.getDownloadHistory(input.storeId);
      }),

    // 사용 내역 조회 (엑셀 다운로드용)
    usageHistory: merchantProcedure
      .input(z.object({ storeId: z.number() }))
      .query(async ({ ctx, input }) => {
        const store = await db.getStoreById(input.storeId);
        if (!store || (store.ownerId !== ctx.user.id && ctx.user.role !== 'admin')) {
          throw new Error('Unauthorized');
        }
        return await analytics.getUsageHistory(input.storeId);
      }),
  }),

  dashboard: router({
    // 사장님 대시보드 (성과 확인)
    stats: merchantProcedure
      .input(z.object({
        storeId: z.number(),
      }))
      .query(async ({ ctx, input }) => {
        // 본인 가게인지 확인
        const store = await db.getStoreById(input.storeId);
        if (!store) throw new Error('Store not found');
        if (store.ownerId !== ctx.user.id && ctx.user.role !== 'admin') {
          throw new Error('Unauthorized');
        }

        const visits = await db.getVisitsByStoreId(input.storeId);
        const visitCount = visits.length;
        const adTransactions = await db.getAdTransactionsByStoreId(input.storeId);
        const totalAdCost = await db.getTotalAdCostByStoreId(input.storeId);

        // 쿠폰 통계
        const coupons = await db.getCouponsByStoreId(input.storeId);
        const totalCoupons = coupons.length;
        const totalCouponsIssued = coupons.reduce((sum, c) => sum + (c.totalQuantity - c.remainingQuantity), 0);
        const couponUsage = await db.getCouponUsageByStoreId(input.storeId);
        const totalCouponsUsed = couponUsage.length;

        return {
          store,
          visitCount,
          visits: visits.slice(0, 10), // 최근 10개만
          adTransactions: adTransactions.slice(0, 10), // 최근 10개만
          totalAdCost,
          // 쿠폰 통계
          totalCoupons,
          totalCouponsIssued,
          totalCouponsUsed,
          couponUsageRate: totalCouponsIssued > 0 ? (totalCouponsUsed / totalCouponsIssued * 100).toFixed(1) : 0,
        };
      }),
  }),

  // Admin 라우터 (운영자 전용)
  admin: router({
    // 가게 등록 (주소 → GPS 자동 변환 + 네이버 플레이스 크롤링)
    createStore: protectedProcedure
      .use(({ ctx, next }) => {
        if (ctx.user.role !== 'admin') {
          throw new Error('Admin access required');
        }
        return next({ ctx });
      })
      .input(z.object({
        name: z.string(),
        category: z.enum(['cafe', 'restaurant', 'beauty', 'hospital', 'fitness', 'other']),
        address: z.string(),
        phone: z.string().optional(),
        description: z.string().optional(),
        naverPlaceUrl: z.string().optional(), // 네이버 플레이스 링크
      }))
      .mutation(async ({ ctx, input }) => {
        // 주소를 GPS로 변환
        const { makeRequest } = await import('./_core/map');
        const response = await makeRequest('/maps/api/geocode/json', {
          address: input.address,
          language: 'ko'
        }) as any;

        if (!response.results || response.results.length === 0) {
          throw new Error('주소를 GPS 좌표로 변환할 수 없습니다.');
        }

        const location = response.results[0].geometry.location;

        // 네이버 플레이스 링크가 있으면 대표 이미지 크롤링
        let imageUrl: string | undefined;
        if (input.naverPlaceUrl) {
          const { crawlNaverPlace } = await import('./naverPlaceCrawler');
          const placeInfo = await crawlNaverPlace(input.naverPlaceUrl);
          // 여러 이미지가 있으면 JSON 배열로 저장
          if (placeInfo?.imageUrls && placeInfo.imageUrls.length > 0) {
            imageUrl = JSON.stringify(placeInfo.imageUrls);
          } else if (placeInfo?.imageUrl) {
            imageUrl = JSON.stringify([placeInfo.imageUrl]);
          }
        }

        await db.createStore({
          ...input,
          latitude: location.lat.toString(),
          longitude: location.lng.toString(),
          imageUrl: imageUrl,
          ownerId: ctx.user.id,
          isActive: true,
          status: 'approved',       // 어드민이 직접 등록 → pending 아닌 approved
          approvedBy: ctx.user.id,  // approvedBy IS NOT NULL → 지도 노출 조건 충족
          approvedAt: new Date(),
        } as any);

        return {
          success: true,
          coordinates: {
            lat: location.lat,
            lng: location.lng
          },
          imageUrl: imageUrl
        };
      }),
    // 쿠폰 등록
    createCoupon: protectedProcedure
      .use(({ ctx, next }) => {
        if (ctx.user.role !== 'admin') {
          throw new Error('Admin access required');
        }
        return next({ ctx });
      })
      .input(z.object({
        storeId: z.number(),
        title: z.string(),
        description: z.string().optional(),
        discountType: z.enum(['fixed', 'freebie']),
        discountValue: z.number(),
        minPurchase: z.number().optional(),
        maxDiscount: z.number().optional(),
        totalQuantity: z.number(),
        dailyLimit: z.number().optional(), // 일 소비수량
        startDate: z.string(), // ISO string
        endDate: z.string(), // ISO string
      }).refine(
        (d) => d.discountType !== 'fixed' || d.discountValue >= 1000,
        { message: '원 할인 쿠폰은 최소 1,000원 이상이어야 합니다', path: ['discountValue'] }
      ))
      .mutation(async ({ input, ctx }) => {
        // 거절된 가게는 어드민도 쿠폰 등록 불가
        const store = await db.getStoreById(input.storeId);
        if (!store) throw new Error('Store not found');
        if ((store as any).status === 'rejected') {
          throw new TRPCError({
            code: 'FORBIDDEN',
            message: '거절된 가게에는 쿠폰을 등록할 수 없습니다. 가게를 승인한 후 등록해주세요.',
          });
        }

        // 🔧 날짜 보정 (종료일이 시작일보다 미래여야 함)
        const start = new Date(input.startDate);
        let end = new Date(input.endDate);

        if (end.getTime() <= start.getTime()) {
          // 종료일을 시작일 23:59:59로 설정
          end = new Date(start);
          end.setHours(23, 59, 59, 999);
        }

        console.log('[Coupon Create] Input:', {
          storeId: input.storeId,
          title: input.title,
          discountValue: input.discountValue,
          minPurchase: input.minPurchase,
          maxDiscount: input.maxDiscount,
        });

        const coupon = await db.createCoupon({
          storeId: input.storeId,
          title: input.title,
          description: input.description || '',
          discountType: input.discountType,
          discountValue: input.discountValue,
          minPurchase: input.minPurchase ?? 0,
          maxDiscount: input.maxDiscount ?? null,
          totalQuantity: input.totalQuantity,
          remainingQuantity: input.totalQuantity,
          startDate: start,
          endDate: end,
          isActive: true,
          // 어드민이 직접 등록하면 즉시 승인 처리 (지도 노출 즉시 반영)
          approvedBy: ctx.user.id,
          approvedAt: new Date(),
        } as any);

        console.log('[Coupon Create] Success:', coupon);

        // 🔔 주변 유저에게 알림 전송 (백그라운드)
        setImmediate(async () => {
          try {
            const store = await db.getStoreById(input.storeId);
            if (!store || !store.latitude || !store.longitude) {
              console.log('[Coupon Notification] Store has no GPS coordinates, skipping notifications');
              return;
            }

            const db_connection = await db.getDb();
            if (!db_connection) return;

            const storeLat = parseFloat(store.latitude);
            const storeLng = parseFloat(store.longitude);

            // Bounding Box 사전 필터: max 알림 반경(500m)으로 후보 유저만 DB에서 추출
            // → 전체 유저 풀 스캔 대신 소규모 후보 집합만 처리
            const MAX_RADIUS_M = 500;
            const deltaLat = MAX_RADIUS_M / 111000;
            const deltaLng = MAX_RADIUS_M / (111000 * Math.cos(storeLat * Math.PI / 180));
            const minLat = storeLat - deltaLat;
            const maxLat = storeLat + deltaLat;
            const minLng = storeLng - deltaLng;
            const maxLng = storeLng + deltaLng;

            // ── 정책 가드: 야간 방해 금지 (21:00~08:00 KST) ──────────────────────
            if (isQuietHoursKST()) {
              console.log(`[Coupon Notification] Quiet hours KST — skip all notifications`);
              return;
            }

            // Stale 가드: 최근 6시간 내 GPS 갱신한 유저만 대상 — 이동 중 유저의 낡은 좌표 기반
            // 오발송 방지. Pull 경로(updateLocation)가 자연히 safety net 역할.
            const nearbyUsers = await db_connection.execute(`
              SELECT
                id,
                notification_radius,
                location_notifications_enabled,
                last_latitude::float  AS last_latitude,
                last_longitude::float AS last_longitude,
                name
              FROM users
              WHERE location_notifications_enabled = true
                AND marketing_agreed = true
                AND last_latitude IS NOT NULL
                AND last_longitude IS NOT NULL
                AND last_location_update >= NOW() - INTERVAL '6 hours'
                AND last_latitude::float  BETWEEN ${minLat} AND ${maxLat}
                AND last_longitude::float BETWEEN ${minLng} AND ${maxLng}
            `);

            const users = (nearbyUsers as any)?.rows ?? (nearbyUsers as any)[0] ?? [];
            console.log(`[Coupon Notification] Bounding box candidates: ${users.length}`);

            // Haversine: 후보 내 각 유저의 개별 반경(notification_radius) 정확 검증
            const calculateDistance = (lat1: number, lon1: number, lat2: number, lon2: number): number => {
              const R = 6371000;
              const dLat = (lat2 - lat1) * Math.PI / 180;
              const dLon = (lon2 - lon1) * Math.PI / 180;
              const a =
                Math.sin(dLat / 2) * Math.sin(dLat / 2) +
                Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
                Math.sin(dLon / 2) * Math.sin(dLon / 2);
              return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
            };

            // ── Phase 1: CPU 전용 필터링 (DB I/O 없음) ──────────────────────────
            // 개별 반경 검증 후 발송 대상만 추출 → eligible 배열에 적재
            type EligibleUser = { id: number; distanceText: string };
            const eligible: EligibleUser[] = [];
            for (const user of users) {
              // 🛡 가드: 유저가 위치 알림 설정을 비활성화했다면 즉시 제외
              // Bounding Box SQL WHERE 이 이미 location_notifications_enabled=true 를 걸지만,
              // SQL 실행 후 설정 변경이 경쟁적으로 발생할 수 있으므로 SELECT 값으로 재검증
              // → '0.1초의 오차' 없이 DB의 최신 설정값 반영 (Defense in Depth)
              if (!user.location_notifications_enabled) continue;

              const distance = calculateDistance(
                storeLat, storeLng,
                user.last_latitude, user.last_longitude,
              );
              if (distance <= user.notification_radius) {
                eligible.push({
                  id: user.id,
                  distanceText: distance < 1000
                    ? `${Math.round(distance)}m`
                    : `${(distance / 1000).toFixed(1)}km`,
                });
              }
            }

            // ── Phase 2c (G4=a): notify() wrapper 가 cap/cooldown 단일 책임 ──
            // 기존 Phase 1.5 Dual Cool-down (1h user + 24h store) + Daily Cap (3/24h) 코드 제거.
            //   → notify() 의 CATEGORY_COOLDOWN_MINUTES (newly_opened_nearby = 60min)
            //     + USER_MARKETING_DAILY_CAP (5건/일) 로 통합. dispatch_log 추적.
            // 변경 의도: 단일 책임 (cap/cooldown 룰을 한 곳에서 관리), 통계 정확성 (dispatch_log).
            let finalEligible = eligible;

            // ── Phase 1.8: Spam Gate — "신규 오픈" 맥락이 아닌 쿠폰에는 대량 알림 금지 ──
            // 정책: 근처 유저에게 bulk insert 되는 알림은 오직 "매장이 방금 새로 오픈했고
            //       그 매장의 첫 쿠폰일 때" 만 발송. 그 외 쿠폰은 이미 조르기 유저에게
            //       nudge_activated 로 전달되므로 중복 발송 불필요.
            // 판정:
            //   isNewlyOpened   = 매장 approved_at 이 NEW_OPEN_WINDOW_DAYS(14) 이내
            //   isFirstCoupon   = 이 매장의 approved 쿠폰이 이번 쿠폰이 유일
            const freshnessRes = await db_connection.execute(`
              SELECT
                s.approved_at AS store_approved_at,
                (SELECT COUNT(*) FROM coupons
                 WHERE store_id = ${store.id}
                   AND is_active = TRUE
                   AND approved_by IS NOT NULL
                   AND approved_at IS NOT NULL
                   AND id != ${coupon.id}) AS prior_coupon_count
              FROM stores s
              WHERE s.id = ${store.id}
            `);
            const freshnessRow = ((freshnessRes as any)?.rows ?? [])[0];
            const storeApprovedAtRaw = freshnessRow?.store_approved_at ?? null;
            const storeApprovedAt = storeApprovedAtRaw ? new Date(storeApprovedAtRaw) : null;
            const priorCouponCount = Number(freshnessRow?.prior_coupon_count ?? 0);
            const NEW_OPEN_WINDOW_MS = 14 * 24 * 60 * 60 * 1000;
            const isNewlyOpened = !!storeApprovedAt && (Date.now() - storeApprovedAt.getTime()) <= NEW_OPEN_WINDOW_MS;
            const isFirstCoupon = priorCouponCount === 0;

            // 사장님 의도: 14일 이내 오픈 매장의 "모든 신규 쿠폰" 마다 push.
            // isFirstCoupon 가드 제거 — notify wrapper 의 cap(5/일) + cooldown(60min) 으로 spam 자동 제한.
            if (!isNewlyOpened) {
              console.log(`[Coupon Notification] Skipped — isNewlyOpened=${isNewlyOpened} priorCouponCount=${priorCouponCount} (14일 초과 매장)`);
              return;
            }
            console.log(`[Coupon Notification] Proceeding — priorCouponCount=${priorCouponCount} isFirstCoupon=${isFirstCoupon} (cap+cooldown 으로 spam 제한)`);

            // ── Phase 2: 통계 그룹 생성 → Chunk 병렬 INSERT + deliveredCount 누적 ──
            const CHUNK_SIZE = 200;
            // (광고) 문구 강제 삽입 — 정보통신망법 제50조
            const notifTitle = makeAdPushTitle('✨ 근처에 새 매장이 오픈했어요!');
            const groupId = crypto.randomUUID();
            await db.createNotificationGroup(groupId, notifTitle, finalEligible.length);

            let notificationsSent = 0;
            for (let i = 0; i < finalEligible.length; i += CHUNK_SIZE) {
              const chunk = finalEligible.slice(i, i + CHUNK_SIZE);
              // Phase 2c (Edit D + H2=γ): notify() wrapper 사용 + inapp success 만 deliveredCount 누적.
              // chunk Promise.all 그대로 (P2 결정 보존). cap/cooldown 차단은 notify() 내부 처리.
              const results = await Promise.all(
                chunk.map(u => notify(u.id, 'newly_opened_nearby', {
                  title: notifTitle,
                  message: `${u.distanceText} 떨어진 ${store.name}이(가) 새로 오픈했어요!`,
                  relatedId: store.id,
                  targetUrl: `/store/${store.id}`,
                  groupId,
                }))
              );
              const inappSuccess = results.reduce(
                (sum, r) => sum + (r.channelResults.find(c => c.channel === 'inapp')?.success ?? 0),
                0,
              );
              if (inappSuccess > 0) {
                await db.incrementDeliveredCount(groupId, inappSuccess);
              }
              notificationsSent += inappSuccess;
            }

            console.log(`[Coupon Notification] newly_opened_nearby groupId=${groupId} sent=${notificationsSent}/${users.length} [notify-managed] (chunk=${CHUNK_SIZE})`);
          } catch (error) {
            console.error('[Coupon Notification] Error sending notifications:', error);
          }
        });

        return { success: true, couponId: coupon.id };
      }),

    // 휴면 사장 조르기 (어드민 전용, 계정당 1회)
    nudgeMerchant: protectedProcedure
      .use(({ ctx, next }) => {
        if (ctx.user.role !== 'admin') throw new TRPCError({ code: 'FORBIDDEN', message: 'Admin access required' });
        return next({ ctx });
      })
      .input(z.object({ userId: z.number() }))
      .mutation(async ({ ctx, input }) => {
        const dbConn = await db.getDb();
        if (!dbConn) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'DB unavailable' });

        // 이미 조르기 했는지 확인 (1회 제한) + 누적 횟수 조회
        const nudgeHistory = await dbConn.execute(
          `SELECT id FROM admin_audit_logs WHERE action = 'MERCHANT_NUDGE' AND target_id = ${input.userId}`
        );
        const nudgeRows = (nudgeHistory as any)?.rows ?? [];
        const nudgeCount = nudgeRows.length; // 이전 누적 횟수
        if (nudgeCount > 0) {
          throw new TRPCError({ code: 'CONFLICT', message: '이미 조르기한 계정입니다.' });
        }

        // 대상 유저 조회
        const targetUser = await db.getUserById(input.userId);
        if (!targetUser) throw new TRPCError({ code: 'NOT_FOUND', message: '유저를 찾을 수 없습니다.' });

        // 휴면 여부 서버 확인
        const activePlan = await db.getEffectivePlan(input.userId);
        const planForCheck = activePlan
          ? { isActive: true,
              expiresAt: (activePlan as any).expires_at ?? null,
              tier: (activePlan as any).tier ?? null }
          : null;
        const dormant = db.isDormantMerchant(targetUser.trialEndsAt, planForCheck);
        if (!dormant) {
          throw new TRPCError({ code: 'BAD_REQUEST', message: '활동 중인 계정에는 조르기할 수 없습니다.' });
        }

        // 사장의 가게 + 쿠폰 URL 조회 (이메일에 포함)
        const merchantStores = await db.getStoresByOwnerId(input.userId);
        const appUrl = process.env.VITE_APP_URL || 'https://my-coupon-bridge.com';
        const couponUrl = merchantStores.length > 0
          ? `${appUrl}/store/${merchantStores[0].id}`
          : `${appUrl}/map`;
        const storeName = merchantStores[0]?.name ?? '매장';

        // audit log 기록 (이메일 발송 전에 기록)
        void db.insertAuditLog({
          adminId: ctx.user.id,
          action: 'MERCHANT_NUDGE',
          targetType: 'user',
          targetId: input.userId,
          payload: {
            userId: input.userId,
            merchantEmail: targetUser.email ?? null,
            actorAdminId: ctx.user.id,
            nudgeCount: nudgeCount + 1,
            storeName,
            couponUrl,
          },
        });

        // 이메일 발송 — 사장에게 "고객이 쿠폰 더 달라고 조릅니다" 안내
        let mailSent = false;
        if (targetUser.email) {
          try {
            mailSent = await sendEmail({
              userId: input.userId,
              email: targetUser.email,
              subject: `[마이쿠폰] 고객이 "${storeName}" 쿠폰을 더 달라고 합니다!`,
              html: getMerchantRenewalNudgeEmailTemplate(targetUser.name, nudgeCount + 1, storeName, couponUrl),
              type: 'merchant_renewal_nudge',
            });
          } catch (e) {
            console.error('[nudgeMerchant] email failed (non-critical):', e);
          }
        }

        return { success: true, mailSent };
      }),

    // 유저 계정 삭제 (어드민 전용) — cascade로 관련 데이터 함께 삭제
    deleteUser: protectedProcedure
      .use(({ ctx, next }) => {
        if (ctx.user.role !== 'admin') throw new Error('Admin access required');
        return next({ ctx });
      })
      .input(z.object({ userId: z.number() }))
      .mutation(async ({ ctx, input }) => {
        if (input.userId === ctx.user.id) {
          throw new Error('자기 자신은 삭제할 수 없습니다.');
        }
        const dbConn = await db.getDb();
        if (!dbConn) throw new Error('DB unavailable');
        // users 테이블 cascade 삭제 (user_coupons, user_plans 등 모두 cascade)
        await dbConn.delete(users).where(eq(users.id, input.userId));
        void db.insertAuditLog({
          adminId: ctx.user.id,
          action: 'ADMIN_DELETE_USER',
          targetType: 'user',
          targetId: input.userId,
          payload: { actorAdminId: ctx.user.id },
        });
        return { success: true };
      }),

    // 프랜차이즈 권한 부여/해제 (어드민 전용)
    // isFranchise=true → 1계정 1가게 제한 bypass
    setFranchise: protectedProcedure
      .use(({ ctx, next }) => {
        if (ctx.user.role !== 'admin') throw new Error('Admin access required');
        return next({ ctx });
      })
      .input(z.object({
        userId: z.number(),
        isFranchise: z.boolean(),
      }))
      .mutation(async ({ ctx, input }) => {
        const dbConn = await db.getDb();
        if (!dbConn) throw new Error('DB not available');

        // FRANCHISE 부여 시: 유료 플랜(non-FREE) 이력 존재 여부 확인
        if (input.isFranchise) {
          const premiumCheck = await dbConn.execute(
            `SELECT 1 FROM user_plans
             WHERE user_id = ${input.userId}
               AND tier != 'FREE'
             LIMIT 1`
          );
          if (((premiumCheck as any)?.rows ?? []).length > 0) {
            throw new TRPCError({
              code: 'FORBIDDEN',
              message: '유료 플랜(PREMIUM) 이력이 있는 계정에는 FRANCHISE를 부여할 수 없습니다. FREE 계정에만 부여 가능합니다.',
            });
          }
        }

        await dbConn.execute(
          `UPDATE users SET is_franchise = ${input.isFranchise}::boolean, updated_at = NOW() WHERE id = ${input.userId}`
        );
        void db.insertAuditLog({
          adminId: ctx.user.id,
          action: input.isFranchise ? 'FRANCHISE_GRANT' : 'FRANCHISE_REVOKE',
          targetType: 'user',
          targetId: input.userId,
          payload: {
            userId: input.userId,
            isFranchise: input.isFranchise,
            actorAdminId: ctx.user.id,
            actorEmail: ctx.user.email ?? null,
          },
        });
        return { success: true };
      }),

    // 쿠폰 이벤트 통계 (계측 목적, admin 전용)
    // last7d: 다운로드/리딤/미사용(다운로드-리딤 미매칭) 수
    getCouponEventStats: protectedProcedure
      .use(({ ctx, next }) => {
        if (ctx.user.role !== 'admin') throw new Error('Admin access required');
        return next({ ctx });
      })
      .query(async () => {
        const dbConn = await db.getDb();
        if (!dbConn) throw new Error('DB not available');
        const result = await dbConn.execute(`
          SELECT
            COUNT(*) FILTER (WHERE event_type = 'DOWNLOAD') AS downloads,
            COUNT(*) FILTER (WHERE event_type = 'REDEEM')   AS redeems,
            SUM(CASE WHEN event_type = 'EXPIRE'
                THEN COALESCE((meta->>'unusedCount')::int, 1) ELSE 0 END
            ) AS expires,
            COUNT(*) FILTER (WHERE event_type = 'DOWNLOAD'
              AND NOT EXISTS (
                SELECT 1 FROM coupon_events e2
                WHERE e2.event_type = 'REDEEM'
                  AND e2.user_id = coupon_events.user_id
                  AND e2.coupon_id = coupon_events.coupon_id
              )
            ) AS unused_downloads
          FROM coupon_events
          WHERE created_at >= NOW() - INTERVAL '7 days'
        `);
        const row = (result as any)?.rows?.[0] ?? {};
        return {
          last7d: {
            downloads: Number(row.downloads ?? 0),
            redeems: Number(row.redeems ?? 0),
            expires: Number(row.expires ?? 0),
            unusedDownloads: Number(row.unused_downloads ?? 0),
          },
        };
      }),

    // 사장별 미사용 만료 누적 통계 (어드민 전용)
    getMerchantUnusedExpiryStats: protectedProcedure
      .use(({ ctx, next }) => {
        if (ctx.user.role !== 'admin') throw new Error('Admin access required');
        return next({ ctx });
      })
      .query(async () => {
        const dbConn = await db.getDb();
        if (!dbConn) throw new Error('DB not available');
        const result = await dbConn.execute(`
          SELECT
            mues.merchant_id,
            u.name          AS merchant_name,
            u.email         AS merchant_email,
            mues.total_unused_expired,
            mues.last_computed_at,
            up.tier         AS plan_tier,
            up.expires_at   AS plan_expires_at,
            (SELECT COUNT(*) FROM stores
              WHERE owner_id = mues.merchant_id
                AND deleted_at IS NULL) AS store_count
          FROM merchant_unused_expiry_stats mues
          JOIN users u ON u.id = mues.merchant_id
          LEFT JOIN user_plans up
            ON  up.user_id = mues.merchant_id
            AND up.is_active = TRUE
          WHERE mues.total_unused_expired > 0
          ORDER BY mues.total_unused_expired DESC
          LIMIT 200
        `);
        const rows = (result as any)?.rows ?? [];
        return rows.map((r: any) => ({
          merchantId: Number(r.merchant_id),
          merchantName: r.merchant_name as string | null,
          merchantEmail: r.merchant_email as string | null,
          totalUnusedExpired: Number(r.total_unused_expired),
          lastComputedAt: r.last_computed_at as string | null,
          planTier: r.plan_tier as string | null,
          planExpiresAt: r.plan_expires_at as string | null,
          storeCount: Number(r.store_count ?? 0),
        }));
      }),

    // 등록된 가게 목록 (관리자용: 승인 대기/승인됨/거부됨 모두 포함)
    listStores: protectedProcedure
      .use(({ ctx, next }) => {
        if (ctx.user.role !== 'admin') {
          throw new Error('Admin access required');
        }
        return next({ ctx });
      })
      .query(async () => {
        return await db.getAllStoresForAdmin(500);
      }),

    /**
     * getStoreFavoriteCounts — Phase C3-1
     *   매장별 단골(favorites) 수 집계. admin 매장 리스트에 부가 컬럼으로 표시.
     *   기존 listStores 를 확장하지 않고 별도 쿼리로 분리 (리스크 최소화).
     */
    getStoreFavoriteCounts: protectedProcedure
      .use(({ ctx, next }) => {
        if (ctx.user.role !== 'admin') {
          throw new Error('Admin access required');
        }
        return next({ ctx });
      })
      .query(async () => {
        const dbConn = await db.getDb();
        if (!dbConn) return [];
        const result = await dbConn.execute(sql`
          SELECT store_id AS "storeId", COUNT(*)::int AS "favoriteCount"
          FROM favorites
          GROUP BY store_id
        `);
        const rows = ((result as any)?.rows ?? []) as Array<{ storeId: number; favoriteCount: number }>;
        return rows.map(r => ({ storeId: Number(r.storeId), favoriteCount: Number(r.favoriteCount) }));
      }),

    // 등록된 쿠폰 목록 (관리자용: 승인 대기/승인됨 모두 포함)
    listCoupons: protectedProcedure
      .use(({ ctx, next }) => {
        if (ctx.user.role !== 'admin') {
          throw new Error('Admin access required');
        }
        return next({ ctx });
      })
      .query(async () => {
        return await db.getAllCouponsForAdmin(100);
      }),

    // ── 신규 요청 확인 상태 관리 ─────────────────────────────────
    /** 항목을 "확인 완료"로 표시 */
    markChecked: protectedProcedure
      .use(({ ctx, next }) => {
        if (ctx.user.role !== 'admin') throw new Error('Admin access required');
        return next({ ctx });
      })
      .input(z.object({
        itemType: z.enum(['store', 'coupon', 'pack_order', 'plan_user']),
        itemId: z.number(),
      }))
      .mutation(async ({ ctx, input }) => {
        const dbConn = await db.getDb();
        if (!dbConn) throw new Error('DB connection failed');
        await dbConn.execute(
          sql`INSERT INTO admin_checked_items (item_type, item_id, checked_by)
              VALUES (${input.itemType}, ${input.itemId}, ${ctx.user.id})
              ON CONFLICT (item_type, item_id)
              DO UPDATE SET checked_by = ${ctx.user.id}, checked_at = NOW()`
        );
        return { success: true };
      }),

    /** 확인 완료된 항목 ID 목록 조회 (타입별) */
    getCheckedIds: protectedProcedure
      .use(({ ctx, next }) => {
        if (ctx.user.role !== 'admin') throw new Error('Admin access required');
        return next({ ctx });
      })
      .input(z.object({
        itemType: z.enum(['store', 'coupon', 'pack_order', 'plan_user']),
      }))
      .query(async ({ input }) => {
        const dbConn = await db.getDb();
        if (!dbConn) return [];
        const result = await dbConn.execute(
          sql`SELECT item_id FROM admin_checked_items WHERE item_type = ${input.itemType}`
        );
        return ((result as any)?.rows ?? []).map((r: any) => Number(r.item_id));
      }),

    // 가게 수정 (네이버 플레이스 크롤링 포함)
    updateStore: protectedProcedure
      .use(({ ctx, next }) => {
        if (ctx.user.role !== 'admin') {
          throw new Error('Admin access required');
        }
        return next({ ctx });
      })
      .input(z.object({
        id: z.number(),
        name: z.string(),
        category: z.enum(['cafe', 'restaurant', 'beauty', 'hospital', 'fitness', 'other']),
        address: z.string(),
        phone: z.string().optional(),
        description: z.string().optional(),
        naverPlaceUrl: z.string().optional(), // 네이버 플레이스 링크
        rating: z.number().min(0).max(5).optional(), // 별점 (0~5)
        ratingCount: z.number().min(0).optional(), // 별점 개수
      }))
      .mutation(async ({ input }) => {
        // 주소가 변경되었으면 GPS 좌표 재계산
        const { makeRequest } = await import('./_core/map');
        const response = await makeRequest('/maps/api/geocode/json', {
          address: input.address,
          language: 'ko'
        }) as any;

        if (!response.results || response.results.length === 0) {
          throw new Error('주소를 GPS 좌표로 변환할 수 없습니다.');
        }

        const location = response.results[0].geometry.location;

        // 네이버 플레이스 링크가 있으면 대표 이미지 크롤링
        let imageUrl: string | undefined;
        if (input.naverPlaceUrl) {
          const { crawlNaverPlace } = await import('./naverPlaceCrawler');
          const placeInfo = await crawlNaverPlace(input.naverPlaceUrl);
          // 여러 이미지가 있으면 JSON 배열로 저장
          if (placeInfo?.imageUrls && placeInfo.imageUrls.length > 0) {
            imageUrl = JSON.stringify(placeInfo.imageUrls);
          } else if (placeInfo?.imageUrl) {
            imageUrl = JSON.stringify([placeInfo.imageUrl]);
          }
        }

        await db.updateStore(input.id, {
          name: input.name,
          category: input.category,
          address: input.address,
          phone: input.phone,
          description: input.description,
          naverPlaceUrl: input.naverPlaceUrl,
          latitude: location.lat.toString(),
          longitude: location.lng.toString(),
          ...(imageUrl && { imageUrl }), // 이미지가 있을 때만 업데이트
          ...(input.rating !== undefined && { rating: input.rating.toString() }), // 별점 수동 조정
          ...(input.ratingCount !== undefined && { ratingCount: input.ratingCount }), // 별점 개수 수동 조정
        });

        return {
          success: true,
          coordinates: {
            lat: location.lat,
            lng: location.lng
          },
          imageUrl: imageUrl
        };
      }),

    // 가게 삭제
    deleteStore: protectedProcedure
      .use(({ ctx, next }) => {
        if (ctx.user.role !== 'admin') {
          throw new Error('Admin access required');
        }
        return next({ ctx });
      })
      .input(z.object({
        id: z.number(),
      }))
      .mutation(async ({ ctx, input }) => {
        // 1) 연관 쿠폰 먼저 비활성화 (삭제 전)
        const deactivatedCoupons = await db.deactivateCouponsByStoreId(input.id);

        // 2) 가게 소프트 삭제 (isActive=false, deletedAt 세팅)
        await db.updateStore(input.id, {
          isActive: false,
          deletedAt: new Date(),
          deletedBy: ctx.user.id,
        } as any);

        void db.insertAuditLog({
          adminId: ctx.user.id,
          action: 'admin_store_delete',
          targetType: 'store',
          targetId: input.id,
          payload: { storeId: input.id, deactivatedCoupons },
        });
        return { success: true, deactivatedCoupons };
      }),

    // 2026-04-25: 쿠폰 미등록 장기 매장 리스트 (승인 후 14일+ / lifetime 쿠폰 0 / 프랜차이즈 제외)
    // 어드민이 대시보드에서 조회 후 [삭제] 버튼으로 수동 처리
    listNoCouponStores: protectedProcedure
      .use(({ ctx, next }) => {
        if (ctx.user.role !== 'admin') throw new Error('Admin access required');
        return next({ ctx });
      })
      .query(async () => {
        const dbConn = await db.getDb();
        if (!dbConn) return [];

        const result = await dbConn.execute(sql`
          SELECT
            s.id,
            s.name,
            s.address,
            s.approved_at,
            FLOOR(EXTRACT(EPOCH FROM (NOW() - s.approved_at)) / 86400)::int AS days_since,
            u.id AS owner_id,
            u.email AS owner_email,
            u.name AS owner_name
          FROM stores s
          JOIN users u ON u.id = s.owner_id
          WHERE s.approved_at IS NOT NULL
            AND s.approved_at <= NOW() - INTERVAL '14 days'
            AND s.deleted_at IS NULL
            AND u.is_franchise = FALSE
            AND NOT EXISTS (
              SELECT 1 FROM coupons c
              WHERE c.store_id = s.id AND c.approved_at IS NOT NULL
            )
          ORDER BY s.approved_at ASC
          LIMIT 200
        `);

        const rows = (result as any)?.rows ?? [];
        return rows.map((r: any) => ({
          id: Number(r.id),
          name: r.name as string,
          address: r.address as string,
          approvedAt: r.approved_at ? new Date(r.approved_at as string) : null,
          daysSince: Number(r.days_since ?? 0),
          ownerId: Number(r.owner_id),
          ownerEmail: r.owner_email as string | null,
          ownerName: r.owner_name as string | null,
        }));
      }),

    // 가게 승인
    approveStore: protectedProcedure
      .use(({ ctx, next }) => {
        if (ctx.user.role !== 'admin') {
          throw new Error('Admin access required');
        }
        return next({ ctx });
      })
      .input(z.object({
        id: z.number(),
      }))
      .mutation(async ({ ctx, input }) => {
        const store = await db.getStoreById(input.id);
        if (!store) throw new Error('Store not found');

        const updateData: any = {
          isActive: true,
          approvedBy: ctx.user.id,
          approvedAt: new Date(),
          status: 'approved',   // dual-write: 기존 is_active/approvedBy와 함께 유지
          rejectionReason: null, // 재승인 시 이전 거절 사유 초기화
        };

        // 좌표(lat/lng) 없으면 승인 시점에 geocoding — 지도 노출 보장
        if (!store.latitude || !store.longitude) {
          try {
            const { makeRequest } = await import('./_core/map');
            const response = await makeRequest('/maps/api/geocode/json', {
              address: store.address,
              language: 'ko',
            }) as any;
            if (response.results?.[0]?.geometry?.location) {
              const loc = response.results[0].geometry.location;
              updateData.latitude = loc.lat.toString();
              updateData.longitude = loc.lng.toString();
              console.log(`[approveStore] Geocoded "${store.address}" → ${loc.lat}, ${loc.lng}`);
            }
          } catch (geocodeError) {
            // geocoding 실패해도 승인 자체는 계속 (non-critical)
            console.error('[approveStore] Geocoding failed (non-critical):', geocodeError);
          }
        }

        await db.updateStore(input.id, updateData);
        void db.insertAuditLog({
          adminId: ctx.user.id,
          action: 'admin_store_approve',
          targetType: 'store',
          targetId: input.id,
          payload: { geocoded: !!(updateData.latitude) },
        });
        return { success: true };
      }),

    // 가게 승인 거부 (isActive=false, approvedBy=null 유지)
    rejectStore: protectedProcedure
      .use(({ ctx, next }) => {
        if (ctx.user.role !== 'admin') {
          throw new Error('Admin access required');
        }
        return next({ ctx });
      })
      .input(z.object({
        id: z.number(),
        reason: z.string().optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        await db.updateStore(input.id, {
          isActive: false,
          status: 'rejected' as any,          // dual-write: 기존 is_active와 함께 유지
          rejectionReason: input.reason ?? null, // 사장님에게 표시할 거절 사유
        });
        void db.insertAuditLog({
          adminId: ctx.user.id,
          action: 'admin_store_reject',
          targetType: 'store',
          targetId: input.id,
          payload: { reason: input.reason ?? null },
        });
        return { success: true };
      }),

    // 가게 재신청 (사장님 전용 — 거절 상태인 가게만 가능)
    reapply: merchantProcedure
      .input(z.object({
        id: z.number(),
      }))
      .mutation(async ({ ctx, input }) => {
        const store = await db.getStoreById(input.id);
        if (!store) throw new Error('Store not found');
        if (store.ownerId !== ctx.user.id) throw new Error('권한이 없습니다.');
        if ((store as any).status !== 'rejected') throw new Error('거절된 가게만 재신청할 수 있습니다.');

        await db.updateStore(input.id, {
          isActive: true,
          approvedBy: null,
          approvedAt: null,
          status: 'pending' as any,
          rejectionReason: null,
        } as any);

        void db.insertAuditLog({
          adminId: ctx.user.id,
          action: 'merchant_store_reapply',
          targetType: 'store',
          targetId: input.id,
          payload: {},
        });

        // 가게 재신청 → 관리자 알림 메일
        void sendAdminNotificationEmail({
          type: 'store_reapply',
          merchantName: ctx.user.name ?? ctx.user.email ?? `ID:${ctx.user.id}`,
          merchantEmail: ctx.user.email ?? '',
          targetName: store.name ?? `가게 ID:${input.id}`,
        });

        return { success: true, message: '재신청이 완료되었습니다. 관리자 검토 후 승인됩니다.' };
      }),

    // 쿠폰 수정
    updateCoupon: protectedProcedure
      .use(({ ctx, next }) => {
        if (ctx.user.role !== 'admin') {
          throw new Error('Admin access required');
        }
        return next({ ctx });
      })
      .input(z.object({
        id: z.number(),
        title: z.string(),
        description: z.string().optional(),
        discountType: z.enum(['percentage', 'fixed', 'freebie']),
        discountValue: z.number(),
        totalQuantity: z.number(),
        remainingQuantity: z.number().optional(), // 남은 수량 수동 조정 가능
        startDate: z.string(),
        endDate: z.string(),
      }))
      .mutation(async ({ input }) => {
        await db.updateCoupon(input.id, {
          title: input.title,
          description: input.description,
          discountType: input.discountType,
          discountValue: input.discountValue,
          totalQuantity: input.totalQuantity,
          remainingQuantity: input.remainingQuantity, // 남은 수량도 업데이트
          startDate: new Date(input.startDate),
          endDate: new Date(input.endDate),
        });
        return { success: true };
      }),

    // 쿠폰 삭제
    deleteCoupon: protectedProcedure
      .use(({ ctx, next }) => {
        if (ctx.user.role !== 'admin') {
          throw new Error('Admin access required');
        }
        return next({ ctx });
      })
      .input(z.object({
        id: z.number(),
      }))
      .mutation(async ({ ctx, input }) => {
        await db.deleteCoupon(input.id);
        void db.insertAuditLog({
          adminId: ctx.user.id,
          action: 'admin_coupon_delete',
          targetType: 'coupon',
          targetId: input.id,
        });
        return { success: true };
      }),

    // 쿠폰 승인
    //
    // 2026-04-18 패키지 고정 정책:
    //   - 이 지점이 유일한 quota 소비 시점 (create/update는 quota 검증하지 않음).
    //   - 집계 window 축: approved_at >= windowStart
    //     (created_at 기준으로 하면 멤버십 경계를 넘나드는 pending→approve 시
    //      이전/신규 어느 기간에도 잡히지 않는 "공짜 승인" 구멍 발생 → 금지)
    //   - 승인 전 가드:
    //       (G1) 이미 approvedAt 존재 → idempotent no-op
    //       (G2) isActive=false (reject/soft-delete) → 승인 불가
    //       (G3) merchant에 활성 패키지가 없거나 plan.defaultCouponQuota <= 0 → 승인 불가
    //   - 동시성 보호:
    //       (a) 트랜잭션으로 집계 SQL + update 묶음 (실패 시 rollback)
    //       (b) pg_advisory_xact_lock(owner_id) → 같은 merchant의 승인을 직렬화
    //       (c) 대상 쿠폰 SELECT FOR UPDATE + 재조회로 stale read / 더블클릭 방어
    //   - 한도 초과 메시지(유일 허용 문구):
    //       `현재 등급({tierName}) 누적 쿠폰 한도({quota}개)에 도달했습니다.`
    approveCoupon: protectedProcedure
      .use(({ ctx, next }) => {
        if (ctx.user.role !== 'admin') {
          throw new Error('Admin access required');
        }
        return next({ ctx });
      })
      .input(z.object({
        id: z.number(),
      }))
      .mutation(async ({ ctx, input }) => {
        const dbConn = await db.getDb();
        if (!dbConn) {
          throw new TRPCError({
            code: 'INTERNAL_SERVER_ERROR',
            message: '서버 연결 오류로 쿠폰 승인을 처리할 수 없습니다.',
          });
        }

        const txResult = await dbConn.transaction(async (tx) => {
          // 1) 대상 쿠폰 + 소유 owner_id 파악 (락 이전에 owner_id 확보)
          const preResult = await tx.execute(sql`
            SELECT c.id, c.store_id, s.owner_id
            FROM coupons c
            JOIN stores s ON s.id = c.store_id
            WHERE c.id = ${input.id}
          `);
          const preRow = (preResult as any)?.rows?.[0];
          if (!preRow) {
            throw new TRPCError({ code: 'NOT_FOUND', message: '쿠폰을 찾을 수 없습니다.' });
          }
          const ownerId = Number(preRow.owner_id);

          // 2) merchant 단위 advisory lock (tx 종료 시 자동 해제)
          //    같은 owner의 다른 승인 트랜잭션은 여기서 대기 → 중복 집계 방지
          await tx.execute(sql`SELECT pg_advisory_xact_lock(${ownerId})`);

          // 3) 대상 쿠폰 row lock + stale read 재조회
          const lockedResult = await tx.execute(sql`
            SELECT id, total_quantity, is_active, approved_at, store_id, title
            FROM coupons
            WHERE id = ${input.id}
            FOR UPDATE
          `);
          const row = (lockedResult as any)?.rows?.[0];
          if (!row) {
            throw new TRPCError({ code: 'NOT_FOUND', message: '쿠폰을 찾을 수 없습니다.' });
          }

          // (G1) 이미 승인됨 → idempotent no-op (더블클릭 안전)
          if (row.approved_at) {
            return {
              alreadyApproved: true,
              ownerId,
              tier: null as string | null,
              totalQuantity: Number(row.total_quantity),
              storeId: Number(row.store_id),
              couponTitle: String(row.title ?? ''),
            };
          }

          // (G2) 비활성(reject/soft-delete) 쿠폰은 승인 불가
          if (!row.is_active) {
            throw new TRPCError({
              code: 'BAD_REQUEST',
              message: '비활성 쿠폰은 승인할 수 없습니다.',
            });
          }

          // 4) merchant effective plan
          const planRow = await db.getEffectivePlan(ownerId);
          const plan = db.resolveEffectivePlan(planRow);

          // (G3) 활성 패키지 부재 또는 quota=0 → 승인 자체 차단
          //      (레거시 pending이 쌓여 있어도 패키지 없는 merchant에게 승인 금지)
          if (!planRow || plan.defaultCouponQuota <= 0) {
            throw new TRPCError({
              code: 'FORBIDDEN',
              message: '현재 활성 패키지가 없어 쿠폰을 승인할 수 없습니다.',
            });
          }

          // 5) 한도 체크 (같은 tx 내에서 approved 기준 합산)
          // windowStart = MAX(plan.created_at, plan.starts_at, POLICY_CUTOVER_AT)
          // - created_at: setUserPlan INSERT 시점(불변 anchor) — 슈퍼어드민 신규 부여 = 새 창
          // - starts_at: 명시적 시작(레거시/수동 UPDATE로 과거일 수 있어 MAX 병용)
          // 근거: packages-coupon 재부여 시 이전 기간 approved 쿠폰이 새 창에 섞이지 않도록 보장
          const POLICY_CUTOVER_AT = '2026-03-18T00:00:00Z';
          const rawStartsAt  = (planRow as any)?.starts_at;
          const rawCreatedAt = (planRow as any)?.created_at;
          const startsAtIso  = rawStartsAt  ? new Date(rawStartsAt  as string).toISOString() : null;
          const createdAtIso = rawCreatedAt ? new Date(rawCreatedAt as string).toISOString() : null;
          const candidates: string[] = [POLICY_CUTOVER_AT];
          if (startsAtIso)  candidates.push(startsAtIso);
          if (createdAtIso) candidates.push(createdAtIso);
          const windowStart = candidates.reduce((a, b) => (a > b ? a : b));

          const quotaResult = await tx.execute(sql`
            SELECT COALESCE(SUM(total_quantity), 0) AS used_quota
            FROM coupons
            WHERE store_id IN (
              SELECT id FROM stores WHERE owner_id = ${ownerId} AND deleted_at IS NULL
            )
            AND is_active = TRUE
            AND approved_at IS NOT NULL
            AND approved_by IS NOT NULL
            AND approved_at >= ${windowStart}
          `);
          const usedQuota = Number((quotaResult as any)?.rows?.[0]?.used_quota ?? 0);

          if (usedQuota + Number(row.total_quantity) > plan.defaultCouponQuota) {
            const tierName = plan.tier === 'FREE' ? '무료(7일 체험)' :
              plan.tier === 'WELCOME' ? '손님마중' :
                plan.tier === 'REGULAR' ? '단골손님' :
                  plan.tier === 'BUSY' ? '북적북적' : plan.tier;
            // 한도 초과 거부 audit (탐지용) — tx 외부에 영향 없도록 fire-and-forget
            // 주) tx 안에서 insertAuditLog가 별도 connection 쓰는 경우가 있어 throw 전 호출.
            void db.insertAuditLog({
              adminId: ctx.user.id,
              action: 'admin_coupon_approve_rejected_quota',
              targetType: 'coupon',
              targetId: input.id,
              payload: {
                ownerId,
                tier: plan.tier,
                usedQuota,
                quota: plan.defaultCouponQuota,
                requestedQuantity: Number(row.total_quantity),
                reason: 'quota_exceeded',
              },
            });
            throw new TRPCError({
              code: 'BAD_REQUEST',
              message: `현재 등급(${tierName}) 누적 쿠폰 한도(${plan.defaultCouponQuota}개)에 도달했습니다.`,
            });
          }

          // 6) 승인 처리 (같은 tx — 예외 시 rollback)
          await tx.execute(sql`
            UPDATE coupons
            SET approved_by = ${ctx.user.id},
                approved_at = NOW(),
                updated_at  = NOW()
            WHERE id = ${input.id}
          `);

          // 7) 2026-04-23: "FREE 등급에서 쿠폰 승인까지 완료" = 무료 쿠폰 사용.
          //    이 시점에만 trial_ends_at 세팅 (idempotent: IS NULL 일 때만).
          //    유료 승인(plan.tier !== 'FREE')은 무료 쿠폰 사용이 아니므로 trial 미변경.
          //    is_franchise = FALSE: 프랜차이즈는 trial 개념 없음.
          //    같은 tx 내 → 승인 실패 시 자동 rollback → trial/쿠폰 일관성 보장.
          if (plan.tier === 'FREE') {
            await tx.execute(sql`
              UPDATE users
              SET trial_ends_at = NOW() + INTERVAL '7 days', updated_at = NOW()
              WHERE id = ${ownerId}
                AND trial_ends_at IS NULL
                AND is_franchise = FALSE
            `);
          }

          return {
            alreadyApproved: false,
            ownerId,
            tier: plan.tier,
            totalQuantity: Number(row.total_quantity),
            storeId: Number(row.store_id),
            couponTitle: String(row.title ?? ''),
          };
        });

        // audit log는 tx 외부 (실패해도 승인 성공 자체엔 영향 없음)
        void db.insertAuditLog({
          adminId: ctx.user.id,
          action: 'admin_coupon_approve',
          targetType: 'coupon',
          targetId: input.id,
          payload: {
            ownerId:         txResult.ownerId,
            tier:            txResult.tier,
            totalQuantity:   txResult.totalQuantity,
            alreadyApproved: txResult.alreadyApproved,
            storeId:         txResult.storeId,
          },
        });

        // ── 조르기한 유저들에게 알림 일괄 insert (tx 외부 — 실패해도 승인은 유지) ──
        // 첫 승인(alreadyApproved=false) + storeId 확보 시에만 실행.
        // type='nudge_activated' 는 이미 notification_type enum 에 정의되어 있음.
        if (!txResult.alreadyApproved && txResult.storeId) {
          try {
            const dbOuter = await db.getDb();
            if (dbOuter) {
              const storeInfoRes = await dbOuter.execute(sql`
                SELECT name FROM stores WHERE id = ${txResult.storeId}
              `);
              const storeName = String(((storeInfoRes as any)?.rows?.[0]?.name) ?? '매장');
              const title  = '조르기한 매장의 쿠폰이 활성화됐어요';
              const msg    = `${storeName} 에서 "${txResult.couponTitle}" 쿠폰이 열렸어요!`;
              const target = `/map?tab=nudge`;
              // 같은 매장×같은 유저 24h 중복 제거:
              //   유저가 매장 B 에 조르기 → 쿠폰 승인 → 알림 받음 → 24h 뒤 재조르기 후 추가 쿠폰 승인 시
              //   또 알림이 가면 과잉. "유저×매장" 쌍당 24h 내 1회 만 발송.
              //   (매장별 총량 제한이 아니므로 유저는 여러 매장을 조르기했을 경우 각각 받음 → cap 없음)
              const nudgeIns = await dbOuter.execute(sql`
                INSERT INTO notifications
                  (user_id, type, title, message, related_id, target_url, is_read, created_at)
                SELECT DISTINCT cer.user_id,
                       'nudge_activated'::notification_type,
                       ${title},
                       ${msg},
                       ${txResult.storeId}::integer,
                       ${target},
                       FALSE,
                       NOW()
                FROM coupon_extension_requests cer
                WHERE (
                    cer.store_id = ${txResult.storeId}
                    OR (cer.store_id IS NULL AND cer.owner_id = ${txResult.ownerId})
                  )
                  AND cer.user_id IS NOT NULL
                  AND cer.user_id != ${txResult.ownerId}
                  AND NOT EXISTS (
                    SELECT 1 FROM notifications n
                    WHERE n.user_id = cer.user_id
                      AND n.type = 'nudge_activated'::notification_type
                      AND n.related_id = ${txResult.storeId}
                      AND n.created_at > NOW() - INTERVAL '24 hours'
                  )
                RETURNING user_id
              `);
              // OS status bar push 발송 (카톡/네이버 패턴) — raw INSERT 의 inapp 과 별도 채널
              const nudgeUids = ((nudgeIns as any)?.rows ?? []).map((r: any) => Number(r.user_id));
              for (const uid of nudgeUids) {
                void db.sendRealPush({
                  userId: uid,
                  title,
                  message: msg,
                  targetUrl: target,
                }).catch((err) => console.error(`[nudge_activated push] uid=${uid} failed:`, err));
              }
            }
          } catch (notifErr) {
            console.error('[approveCoupon] nudge_activated notification insert failed (non-critical):', notifErr);
          }
        }

        // ── C2b-2: 단골(favorites) 유저에게 새 쿠폰 알림 일괄 insert ──
        // 조르기 패턴과 병행. 차이점:
        //   - 대상: favorites.notify_new_coupon = TRUE 인 유저
        //   - type: 'new_coupon' (기존 enum 값 재사용)
        //   - 중복 방지 A: 같은 매장 24h 내 같은 type 알림 있으면 skip
        //   - 중복 방지 B: 같은 매장에 방금(5분 내) nudge_activated 알림 받은 유저는 skip
        //     (조르기+단골 동시 등록 유저의 이중 발송 방지)
        if (!txResult.alreadyApproved && txResult.storeId) {
          try {
            const dbOuter = await db.getDb();
            if (dbOuter) {
              const storeInfoRes2 = await dbOuter.execute(sql`
                SELECT name FROM stores WHERE id = ${txResult.storeId}
              `);
              const storeName2 = String(((storeInfoRes2 as any)?.rows?.[0]?.name) ?? '매장');
              const fTitle   = '단골 매장의 새 쿠폰이 열렸어요';
              const fMsg     = `${storeName2} 에서 "${txResult.couponTitle}" 쿠폰이 열렸어요!`;
              const fTarget  = `/map?store=${txResult.storeId}`;
              const favIns = await dbOuter.execute(sql`
                INSERT INTO notifications
                  (user_id, type, title, message, related_id, target_url, is_read, created_at)
                SELECT f.user_id,
                       'new_coupon'::notification_type,
                       ${fTitle},
                       ${fMsg},
                       ${txResult.storeId}::integer,
                       ${fTarget},
                       FALSE,
                       NOW()
                FROM favorites f
                WHERE f.store_id = ${txResult.storeId}
                  AND f.notify_new_coupon = TRUE
                  AND f.user_id != ${txResult.ownerId}
                  AND NOT EXISTS (
                    SELECT 1 FROM notifications n
                    WHERE n.user_id = f.user_id
                      AND n.type = 'new_coupon'::notification_type
                      AND n.related_id = ${txResult.storeId}
                      AND n.created_at > NOW() - INTERVAL '24 hours'
                  )
                  AND NOT EXISTS (
                    SELECT 1 FROM notifications n2
                    WHERE n2.user_id = f.user_id
                      AND n2.type = 'nudge_activated'::notification_type
                      AND n2.related_id = ${txResult.storeId}
                      AND n2.created_at > NOW() - INTERVAL '5 minutes'
                  )
                RETURNING user_id
              `);
              // OS status bar push 발송 (카톡/네이버 패턴) — raw INSERT 의 inapp 과 별도 채널
              const favUids = ((favIns as any)?.rows ?? []).map((r: any) => Number(r.user_id));
              console.log(`[approveCoupon:new_coupon] storeId=${txResult.storeId} favUids count=${favUids.length} uids=[${favUids.join(',')}]`);
              for (const uid of favUids) {
                void db.sendRealPush({
                  userId: uid,
                  title: fTitle,
                  message: fMsg,
                  targetUrl: fTarget,
                }).then(async (res) => {
                  // sendRealPush 결과를 dispatch_log 에 기록 (SQL 로 즉시 진단 가능)
                  try {
                    await dbOuter.execute(sql`
                      INSERT INTO notification_dispatch_log
                        (user_id, category, channel, success_count, failure_count, invalid_count, sent_at)
                      VALUES (${uid}, 'new_coupon', 'push', ${res.success}, ${res.failure}, ${res.invalid}, NOW())
                    `);
                  } catch (logErr) {
                    console.error(`[new_coupon push log] uid=${uid} log insert failed:`, logErr);
                  }
                }).catch((err) => console.error(`[new_coupon push] uid=${uid} failed:`, err));
              }
            }
          } catch (notifErr) {
            console.error('[approveCoupon] favorites new_coupon notification insert failed (non-critical):', notifErr);
          }
        }

        return { success: true };
      }),

    // 쿠폰 거부 (삭제하지 않고 비활성화)
    rejectCoupon: protectedProcedure
      .use(({ ctx, next }) => {
        if (ctx.user.role !== 'admin') {
          throw new Error('Admin access required');
        }
        return next({ ctx });
      })
      .input(z.object({
        id: z.number(),
      }))
      .mutation(async ({ ctx, input }) => {
        await db.updateCoupon(input.id, { isActive: false });
        void db.insertAuditLog({
          adminId: ctx.user.id,
          action: 'admin_coupon_reject',
          targetType: 'coupon',
          targetId: input.id,
        });
        return { success: true };
      }),
  }),
  // --- [여기가 admin 구역 밖, 사장님 전용 구역입니다] ---
  reapply: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const store = await db.getStoreById(input.id);
      
      if (!store) throw new TRPCError({ code: 'NOT_FOUND', message: '가게를 찾을 수 없습니다.' });
      
      // 타입 불일치 방지를 위해 Number() 처리 (빨간 줄 방지용)
      if (Number(store.ownerId) !== Number(ctx.user.id)) {
        throw new TRPCError({ code: 'FORBIDDEN', message: '본인의 가게만 재신청할 수 있습니다.' });
      }
      
      if ((store as any).status !== 'rejected') {
        throw new TRPCError({ code: 'BAD_REQUEST', message: '거절된 상태의 가게만 재신청할 수 있습니다.' });
      }
      // 2969번 줄 시작: 5분 쿨타임 체크 (as any로 타입 에러 방지)
      const lastUpdate = (store as any).updatedAt;
      if (lastUpdate && (new Date().getTime() - new Date(lastUpdate).getTime() < 5 * 60 * 1000)) {
        throw new TRPCError({ 
          code: 'TOO_MANY_REQUESTS', 
          message: '재신청은 5분 간격으로 가능합니다. 잠시 후 다시 시도해 주세요.' 
        });
      }
      await db.updateStore(input.id, {
        isActive: true, 
        approvedBy: null,   // 이전 승인자 초기화
        approvedAt: null,   // 이전 승인 시간 초기화
        status: 'pending' as any, 
        rejectionReason: null,
        updatedAt: new Date(), // <--- 여기에 딱 넣어주면 쿨타임 기준점이 갱신됩니다! 
      });

      // 운영을 위한 감사 로그 기록
      void db.insertAuditLog({
        adminId: ctx.user.id,
        action: 'merchant_store_reapply',
        targetType: 'store',
        targetId: input.id,
        payload: { previousStatus: 'rejected' },
      });

      // 가게 재신청 → 관리자 알림 메일
      void sendAdminNotificationEmail({
        type: 'store_reapply',
        merchantName: ctx.user.name ?? ctx.user.email ?? `ID:${ctx.user.id}`,
        merchantEmail: ctx.user.email ?? '',
        targetName: store.name ?? `가게 ID:${input.id}`,
      });

      return { success: true, message: '재신청 완료!' };
    }),

  analytics: analyticsRouter,

  districtStamps: districtStampsRouter,

  _oldAnalytics: router({
    // 일별 신규 가입자 통계
    dailySignups: protectedProcedure
      .use(({ ctx, next }) => {
        if (ctx.user.role !== 'admin') {
          throw new Error('Admin access required');
        }
        return next({ ctx });
      })
      .input(z.object({
        days: z.number().default(30), // 기본 30일
      }))
      .query(async ({ input }) => {
        const db_connection = await db.getDb();
        if (!db_connection) throw new Error('Database connection failed');

        const result = await db_connection.execute(`
          SELECT 
            created_at::date as date,
            COUNT(*) as count
          FROM users
          WHERE created_at >= CURRENT_DATE - INTERVAL '${input.days} days'
          GROUP BY created_at::date
          ORDER BY date ASC
        `);

        return (result as any)[0];
      }),

    // DAU (Daily Active Users) 통계
    dailyActiveUsers: protectedProcedure
      .use(({ ctx, next }) => {
        if (ctx.user.role !== 'admin') {
          throw new Error('Admin access required');
        }
        return next({ ctx });
      })
      .input(z.object({
        days: z.number().default(30),
      }))
      .query(async ({ input }) => {
        const db_connection = await db.getDb();
        if (!db_connection) throw new Error('Database connection failed');

        const result = await db_connection.execute(`
          SELECT 
            last_signed_in::date as date,
            COUNT(DISTINCT id) as count
          FROM users
          WHERE last_signed_in >= CURRENT_DATE - INTERVAL '${input.days} days'
          GROUP BY last_signed_in::date
          ORDER BY date ASC
        `);

        return (result as any)[0];
      }),

    // 누적 가입자 통계
    cumulativeUsers: protectedProcedure
      .use(({ ctx, next }) => {
        if (ctx.user.role !== 'admin') {
          throw new Error('Admin access required');
        }
        return next({ ctx });
      })
      .input(z.object({
        days: z.number().default(30),
      }))
      .query(async ({ input }) => {
        const db_connection = await db.getDb();
        if (!db_connection) throw new Error('Database connection failed');

        const result = await db_connection.execute(`
          SELECT 
            created_at::date as date,
            COUNT(*) as daily_count,
            SUM(COUNT(*)) OVER (ORDER BY created_at::date) as cumulative_count
          FROM users
          WHERE created_at >= CURRENT_DATE - INTERVAL '${input.days} days'
          GROUP BY created_at::date
          ORDER BY date ASC
        `);

        return (result as any)[0];
      }),

    // 연령/성별 분포 통계
    demographicDistribution: protectedProcedure
      .use(({ ctx, next }) => {
        if (ctx.user.role !== 'admin') {
          throw new Error('Admin access required');
        }
        return next({ ctx });
      })
      .query(async () => {
        const db_connection = await db.getDb();
        if (!db_connection) throw new Error('Database connection failed');

        // 연령대 분포
        const ageDistribution = await db_connection.execute(`
          SELECT 
            age_group,
            COUNT(*) as count
          FROM users
          WHERE age_group IS NOT NULL
          GROUP BY age_group
          ORDER BY age_group
        `);

        // 성별 분포
        const genderDistribution = await db_connection.execute(`
          SELECT 
            gender,
            COUNT(*) as count
          FROM users
          WHERE gender IS NOT NULL
          GROUP BY gender
        `);

        // 프로필 완성률
        const profileCompletion = await db_connection.execute(`
          SELECT 
            COUNT(*) as total,
            SUM(CASE WHEN profileCompletedAt IS NOT NULL THEN 1 ELSE 0 END) as completed
          FROM users
        `);

        return {
          ageDistribution: (ageDistribution as any)[0],
          genderDistribution: (genderDistribution as any)[0],
          profileCompletion: (profileCompletion as any)[0][0],
        };
      }),

    // 전체 통계 (운영자 전용)
    _overview_old: protectedProcedure
      .use(({ ctx, next }) => {
        if (ctx.user.role !== 'admin') {
          throw new Error('Admin access required');
        }
        return next({ ctx });
      })
      .query(async () => {
        const db_connection = await db.getDb();
        if (!db_connection) throw new Error('Database connection failed');

        // 오늘 사용량
        const todayUsage = await db_connection.execute(
          `SELECT COUNT(*) as count FROM coupon_usage 
           WHERE used_at::date = CURRENT_DATE`
        );

        // 전체 다운로드 수
        const totalDownloads = await db_connection.execute(
          `SELECT COUNT(*) as count FROM user_coupons`
        );

        // 전체 사용 수
        const totalUsage = await db_connection.execute(
          `SELECT COUNT(*) as count FROM coupon_usage`
        );

        // 활성 가게 수
        const activeStores = await db_connection.execute(
          `SELECT COUNT(*) as count FROM stores`
        );

        // 전체 할인 제공액 (사용된 쿠폰의 할인금액 합계)
        const totalDiscount = await db_connection.execute(
          `SELECT SUM(c.discount_value) as total
           FROM user_coupons uc
           JOIN coupons c ON uc.coupon_id = c.id
           WHERE uc.status = 'used'`
        );

        return {
          todayUsage: (todayUsage as any)[0][0].count,
          totalDownloads: (totalDownloads as any)[0][0].count,
          totalUsage: (totalUsage as any)[0][0].count,
          activeStores: (activeStores as any)[0][0].count,
          totalDiscountAmount: (totalDiscount as any)[0][0].total || 0,
        };
      }),

    // 일별/주별/월별 사용 통계
    usageTrend: protectedProcedure
      .use(({ ctx, next }) => {
        if (ctx.user.role !== 'admin') {
          throw new Error('Admin access required');
        }
        return next({ ctx });
      })
      .input(z.object({
        period: z.enum(['daily', 'weekly', 'monthly']),
      }))
      .query(async ({ input }) => {
        const db_connection = await db.getDb();
        if (!db_connection) throw new Error('Database connection failed');

        let query = '';
        if (input.period === 'daily') {
          query = `
            SELECT used_at::date as date, COUNT(*) as count
            FROM coupon_usage
            WHERE used_at >= CURRENT_DATE - INTERVAL '30 days'
            GROUP BY used_at::date
            ORDER BY date DESC
          `;
        } else if (input.period === 'weekly') {
          query = `
            SELECT TO_CHAR(used_at, 'IYYY-IW') as week, COUNT(*) as count
            FROM coupon_usage
            WHERE used_at >= CURRENT_DATE - INTERVAL '12 weeks'
            GROUP BY TO_CHAR(used_at, 'IYYY-IW')
            ORDER BY week DESC
          `;
        } else {
          query = `
            SELECT TO_CHAR(used_at, 'YYYY-MM') as month, COUNT(*) as count
            FROM coupon_usage
            WHERE used_at >= CURRENT_DATE - INTERVAL '12 months'
            GROUP BY TO_CHAR(used_at, 'YYYY-MM')
            ORDER BY month DESC
          `;
        }

        const result = await db_connection.execute(query);
        return (result as any)[0];
      }),

    // 가게별 인기도 순위
    topStores: protectedProcedure
      .use(({ ctx, next }) => {
        if (ctx.user.role !== 'admin') {
          throw new Error('Admin access required');
        }
        return next({ ctx });
      })
      .query(async () => {
        const db_connection = await db.getDb();
        if (!db_connection) throw new Error('Database connection failed');

        const result = await db_connection.execute(`
          SELECT 
            s.id,
            s.name,
            s.category,
            s.address,
            COUNT(DISTINCT cu.id) as usage_count,
            COUNT(DISTINCT uc.user_id) as unique_users
          FROM stores s
          LEFT JOIN coupons c ON c.store_id = s.id
          LEFT JOIN user_coupons uc ON uc.coupon_id = c.id
          LEFT JOIN coupon_usage cu ON cu.user_coupon_id = uc.id
          GROUP BY s.id, s.name, s.category, s.address
          ORDER BY usage_count DESC
          LIMIT 10
        `);

        return (result as any)[0];
      }),

    // 시간대별 사용 패턴
    hourlyPattern: protectedProcedure
      .use(({ ctx, next }) => {
        if (ctx.user.role !== 'admin') {
          throw new Error('Admin access required');
        }
        return next({ ctx });
      })
      .query(async () => {
        const db_connection = await db.getDb();
        if (!db_connection) throw new Error('Database connection failed');

        const result = await db_connection.execute(`
          SELECT 
            EXTRACT(HOUR FROM used_at)::integer as hour,
            COUNT(*) as count
          FROM coupon_usage
          WHERE used_at >= NOW() - INTERVAL '30 days'
          GROUP BY EXTRACT(HOUR FROM used_at)
          ORDER BY hour
        `);

        return (result as any)[0];
      }),

    // 카테고리별 사용 비율
    categoryDistribution: protectedProcedure
      .use(({ ctx, next }) => {
        if (ctx.user.role !== 'admin') {
          throw new Error('Admin access required');
        }
        return next({ ctx });
      })
      .query(async () => {
        const db_connection = await db.getDb();
        if (!db_connection) throw new Error('Database connection failed');

        const result = await db_connection.execute(`
          SELECT 
            s.category,
            COUNT(cu.id) as count
          FROM coupon_usage cu
          JOIN user_coupons uc ON uc.id = cu.user_coupon_id
          JOIN coupons c ON c.id = uc.coupon_id
          JOIN stores s ON s.id = c.store_id
          GROUP BY s.category
          ORDER BY count DESC
        `);

        return (result as any)[0];
      }),

    // 100m 반경 내 업장 랭킹 (쿠폰 발행량 기준)
    nearbyStoreRanking: protectedProcedure
      .use(({ ctx, next }) => {
        if (ctx.user.role !== 'admin') {
          throw new Error('Admin access required');
        }
        return next({ ctx });
      })
      .input(z.object({
        latitude: z.number(),
        longitude: z.number(),
        radius: z.number().default(100), // 기본 100m
      }))
      .query(async ({ input }) => {
        const db_connection = await db.getDb();
        if (!db_connection) throw new Error('Database connection failed');

        // Haversine 공식 — 반경 내 업장 + 쿠폰 소비량 기준 랭킹
        // 수정: remaining_quantity(snake_case), HAVING→서브쿼리, result.rows
        const result = await db_connection.execute(
          `SELECT * FROM (
            SELECT
              s.id,
              s.name,
              s.category,
              s.address,
              s.latitude,
              s.longitude,
              COUNT(DISTINCT c.id)                                       AS "totalCoupons",
              COALESCE(SUM(c.total_quantity - c.remaining_quantity), 0)  AS "totalIssued",
              COALESCE(SUM(CASE WHEN uc.status='used' THEN 1 ELSE 0 END), 0) AS "totalUsed",
              (
                6371000 * acos(
                  LEAST(1.0,
                    cos(radians(${input.latitude})) * cos(radians(CAST(s.latitude AS DECIMAL(10,8)))) *
                    cos(radians(CAST(s.longitude AS DECIMAL(11,8))) - radians(${input.longitude})) +
                    sin(radians(${input.latitude})) * sin(radians(CAST(s.latitude AS DECIMAL(10,8))))
                  )
                )
              ) AS distance
            FROM stores s
            LEFT JOIN coupons c ON s.id = c.store_id AND c.is_active = true
            LEFT JOIN user_coupons uc ON uc.coupon_id = c.id
            WHERE s.latitude IS NOT NULL AND s.longitude IS NOT NULL
              AND s.is_active = true AND s.deleted_at IS NULL
            GROUP BY s.id, s.name, s.category, s.address, s.latitude, s.longitude
          ) sub
          WHERE distance <= ${input.radius}
          ORDER BY "totalUsed" DESC, distance ASC
          LIMIT 20`
        );

        return (result as any)?.rows ?? [];
      }),

    // 업장별 통계 데이터
    storeStats: protectedProcedure
      .use(({ ctx, next }) => {
        if (ctx.user.role !== 'admin') {
          throw new Error('Admin access required');
        }
        return next({ ctx });
      })
      .query(async () => {
        const db_connection = await db.getDb();
        if (!db_connection) throw new Error('Database connection failed');

        const result = await db_connection.execute(`
          SELECT 
            s.id,
            s.name,
            s.category,
            s.address,
            COUNT(DISTINCT c.id) as coupon_count,
            COUNT(DISTINCT uc.id) as download_count,
            COUNT(DISTINCT cu.id) as usage_count,
            COALESCE(SUM(CASE 
              WHEN c.discountType = 'fixed' THEN c.discount_value
              ELSE 0
            END), 0) as total_discount_amount
          FROM stores s
          LEFT JOIN coupons c ON c.store_id = s.id
          LEFT JOIN user_coupons uc ON uc.coupon_id = c.id
          LEFT JOIN coupon_usage cu ON cu.user_coupon_id = uc.id
          WHERE s.is_active = true
          GROUP BY s.id, s.name, s.category, s.address
          ORDER BY usage_count DESC
        `);

        return (result as any)[0];
      }),

    // 경쟁 구도 분석 (Competition Analysis)
    competition: protectedProcedure
      .use(({ ctx, next }) => {
        if (ctx.user.role !== 'admin') {
          throw new Error('Admin access required');
        }
        return next({ ctx });
      })
      .query(async () => {
        const db_connection = await db.getDb();
        if (!db_connection) throw new Error('Database connection failed');

        // 전체 업장 경쟁 순위 (다운로드, 사용률, 별점 기준)
        const rankings = await db_connection.execute(`
          SELECT 
            s.id,
            s.name,
            s.category,
            s.rating,
            s.rating_count,
            COUNT(DISTINCT uc.id) as download_count,
            SUM(CASE WHEN uc.status = 'used' THEN 1 ELSE 0 END) as usage_count,
            ROUND(
              CASE 
                WHEN COUNT(DISTINCT uc.id) > 0 
                THEN (SUM(CASE WHEN uc.status = 'used' THEN 1 ELSE 0 END) * 100.0 / COUNT(DISTINCT uc.id))
                ELSE 0 
              END, 1
            ) as usage_rate,
            RANK() OVER (ORDER BY COUNT(DISTINCT uc.id) DESC) as download_rank,
            RANK() OVER (ORDER BY SUM(CASE WHEN uc.status = 'used' THEN 1 ELSE 0 END) DESC) as usage_rank,
            RANK() OVER (ORDER BY CAST(s.rating AS DECIMAL(3,2)) DESC) as rating_rank
          FROM stores s
          LEFT JOIN coupons c ON c.store_id = s.id
          LEFT JOIN user_coupons uc ON uc.coupon_id = c.id
          WHERE s.is_active = true
          GROUP BY s.id, s.name, s.category, s.rating, s.rating_count
          ORDER BY download_count DESC
        `);

        // 카테고리별 상위 3개 업장 — window alias는 서브쿼리로 감싸서 필터
        const categoryLeaders = await db_connection.execute(`
          SELECT * FROM (
            SELECT 
              s.category,
              s.id,
              s.name,
              s.rating,
              COUNT(DISTINCT uc.id) as download_count,
              SUM(CASE WHEN uc.status = 'used' THEN 1 ELSE 0 END) as usage_count,
              ROW_NUMBER() OVER (PARTITION BY s.category ORDER BY COUNT(DISTINCT uc.id) DESC) as category_rank
            FROM stores s
            LEFT JOIN coupons c ON c.store_id = s.id
            LEFT JOIN user_coupons uc ON uc.coupon_id = c.id
            WHERE s.is_active = true
            GROUP BY s.category, s.id, s.name, s.rating
          ) ranked
          WHERE category_rank <= 3
          ORDER BY category, category_rank
        `);

        // 전체 통계 요약
        const summary = await db_connection.execute(`
          SELECT 
            COUNT(DISTINCT s.id) as total_stores,
            COUNT(DISTINCT uc.id) as total_downloads,
            SUM(CASE WHEN uc.status = 'used' THEN 1 ELSE 0 END) as total_usages,
            ROUND(AVG(CAST(s.rating AS DECIMAL(3,2))), 2) as avg_rating
          FROM stores s
          LEFT JOIN coupons c ON c.store_id = s.id
          LEFT JOIN user_coupons uc ON uc.coupon_id = c.id
          WHERE s.is_active = true
        `);

        return {
          rankings: (rankings as any)?.rows ?? (rankings as any)?.[0] ?? [],
          categoryLeaders: (categoryLeaders as any)?.rows ?? (categoryLeaders as any)?.[0] ?? [],
          summary: (summary as any)?.rows?.[0] ?? (summary as any)?.[0]?.[0] ?? {},
        };
      }),

    // 개별 업장 경쟁 현황
    storeCompetition: protectedProcedure
      .use(({ ctx, next }) => {
        if (ctx.user.role !== 'admin') {
          throw new Error('Admin access required');
        }
        return next({ ctx });
      })
      .input(z.object({ storeId: z.number() }))
      .query(async ({ input }) => {
        const db_connection = await db.getDb();
        if (!db_connection) throw new Error('Database connection failed');

        // 해당 업장 정보 및 순위
        const storeRank = await db_connection.execute(`
          WITH store_stats AS (
            SELECT 
              s.id,
              s.name,
              s.category,
              s.rating,
              s.rating_count,
              COUNT(DISTINCT uc.id) as download_count,
              SUM(CASE WHEN uc.status = 'used' THEN 1 ELSE 0 END) as usage_count,
              ROUND(
                CASE 
                  WHEN COUNT(DISTINCT uc.id) > 0 
                  THEN (SUM(CASE WHEN uc.status = 'used' THEN 1 ELSE 0 END) * 100.0 / COUNT(DISTINCT uc.id))
                  ELSE 0 
                END, 1
              ) as usage_rate
            FROM stores s
            LEFT JOIN coupons c ON c.store_id = s.id
            LEFT JOIN user_coupons uc ON uc.coupon_id = c.id
            WHERE s.is_active = true
            GROUP BY s.id, s.name, s.category, s.rating, s.rating_count
          )
          SELECT 
            ss.*,
            RANK() OVER (ORDER BY download_count DESC) as overall_download_rank,
            RANK() OVER (ORDER BY usage_count DESC) as overall_usage_rank,
            RANK() OVER (ORDER BY CAST(rating AS DECIMAL(3,2)) DESC) as overall_rating_rank,
            RANK() OVER (PARTITION BY category ORDER BY download_count DESC) as category_download_rank,
            RANK() OVER (PARTITION BY category ORDER BY usage_count DESC) as category_usage_rank,
            (SELECT COUNT(DISTINCT id) FROM stores WHERE is_active = true) as total_stores,
            (SELECT COUNT(DISTINCT id) FROM stores WHERE is_active = true AND category = ss.category) as category_stores
          FROM store_stats ss
          WHERE ss.id = ${input.storeId}
        `);

        // 동일 카테고리 경쟁 업장들
        const competitors = await db_connection.execute(`
          SELECT 
            s.id,
            s.name,
            s.rating,
            s.rating_count,
            COUNT(DISTINCT uc.id) as download_count,
            SUM(CASE WHEN uc.status = 'used' THEN 1 ELSE 0 END) as usage_count
          FROM stores s
          LEFT JOIN coupons c ON c.store_id = s.id
          LEFT JOIN user_coupons uc ON uc.coupon_id = c.id
          WHERE s.is_active = true 
            AND s.category = (SELECT category FROM stores WHERE id = ${input.storeId})
            AND s.id != ${input.storeId}
          GROUP BY s.id, s.name, s.rating, s.rating_count
          ORDER BY download_count DESC
          LIMIT 5
        `);

        return {
          storeRank: (storeRank as any)[0][0],
          competitors: (competitors as any)[0],
        };
      }),

    // 업장별 상세 내역
    storeDetails: protectedProcedure
      .use(({ ctx, next }) => {
        if (ctx.user.role !== 'admin') {
          throw new Error('Admin access required');
        }
        return next({ ctx });
      })
      .input(z.object({ storeId: z.number() }))
      .query(async ({ input }) => {
        const db_connection = await db.getDb();
        if (!db_connection) throw new Error('Database connection failed');

        // 쿠폰 다운로드 내역
        const downloads = await db_connection.execute(`
          SELECT 
            u.name as userName,
            u.email as userEmail,
            c.title as couponTitle,
            uc.downloaded_at,
            uc.status,
            uc.couponCode
          FROM user_coupons uc
          JOIN users u ON u.id = uc.userId
          JOIN coupons c ON c.id = uc.coupon_id
          WHERE c.store_id = ${input.storeId}
          ORDER BY uc.downloaded_at DESC
          LIMIT 100
        `);

        // 쿠폰 사용 내역 (user_coupons 테이블에서 status='used'인 것 조회)
        const usages = await db_connection.execute(`
          SELECT 
            u.name as userName,
            u.email as userEmail,
            c.title as couponTitle,
            c.discountType,
            c.discount_value,
            uc.used_at,
            uc.couponCode
          FROM user_coupons uc
          JOIN users u ON u.id = uc.userId
          JOIN coupons c ON c.id = uc.coupon_id
          WHERE c.store_id = ${input.storeId} AND uc.status = 'used'
          ORDER BY uc.used_at DESC
          LIMIT 100
        `);

        // 100m 반경 내 경쟁 업장 조회
        const storeInfo = await db_connection.execute(`
          SELECT latitude, longitude FROM stores WHERE id = ${input.storeId}
        `);
        const storeData = (storeInfo as any)[0]?.[0];

        let nearbyStores: any[] = [];
        if (storeData && storeData.latitude && storeData.longitude) {
          const lat = parseFloat(storeData.latitude);
          const lon = parseFloat(storeData.longitude);
          const radiusInKm = 0.1; // 100m

          // Haversine 공식을 사용하여 100m 반경 내 업장 조회
          const nearby = await db_connection.execute(`
            SELECT 
              s.id,
              s.name,
              s.latitude,
              s.longitude,
              s.category,
              s.address,
              (
                6371 * acos(
                  cos(radians(${lat})) * cos(radians(CAST(s.latitude AS DECIMAL(10,8)))) *
                  cos(radians(CAST(s.longitude AS DECIMAL(11,8))) - radians(${lon})) +
                  sin(radians(${lat})) * sin(radians(CAST(s.latitude AS DECIMAL(10,8))))
                )
              ) * 1000 AS distance,
              (
                SELECT COALESCE(SUM(c.totalIssued), 0)
                FROM coupons c
                WHERE c.store_id = s.id
              ) as totalIssued,
              (
                SELECT COUNT(*)
                FROM coupons c
                WHERE c.store_id = s.id
              ) as totalCoupons
            FROM stores s
            WHERE s.id != ${input.storeId}
              AND s.latitude IS NOT NULL
              AND s.longitude IS NOT NULL
            HAVING distance <= ${radiusInKm * 1000}
            ORDER BY totalIssued DESC
            LIMIT 10
          `);
          nearbyStores = (nearby as any)[0];
        }

        return {
          downloads: (downloads as any)[0],
          usages: (usages as any)[0],
          nearbyStores,
        };
      }),

  }),

  // 구독팩 / 발주요청 / 유저 플랜 API (별도 파일로 관리)
  packOrders: packOrdersRouter,

  // 어뷰저 탐지 & 패널티 관리 API
  abuse: abuseRouter,

  // 쿠폰찾기 "조르기 확인하기 / 새로 오픈했어요" 필터 탭 + 반경 조회 API
  // 설계 문서: docs/2026-04-17-user-notification-coupon-finder-design.md (Phase 2)
  finder: finderRouter,

  // 알림 관련 API
  notifications: router({
    // 읽지 않은 알림 개수 조회
    getUnreadCount: protectedProcedure
      .query(async ({ ctx }) => {
        const db_connection = await db.getDb();
        if (!db_connection) throw new Error('Database connection failed');

        // KST 오늘 00:00 이전 unread 알림 자동 read 처리 — 사장님 의도 "자정 리셋"
        // background fire-and-forget — 응답 latency 영향 0 + DB 정합성 다음 호출에 반영.
        void db_connection.execute(sql`
          UPDATE notifications SET is_read = TRUE
          WHERE user_id = ${ctx.user.id}
            AND is_read = FALSE
            AND created_at < (NOW() AT TIME ZONE 'Asia/Seoul')::date AT TIME ZONE 'Asia/Seoul'
        `).catch((err) => console.error(`[getUnreadCount:midnight-reset] uid=${ctx.user.id} failed:`, err));

        const result = await db_connection
          .select({ count: sql<number>`COUNT(*)` })
          .from(notifications)
          .where(and(
            eq(notifications.userId, ctx.user.id),
            eq(notifications.isRead, false),
          ));

        return Number(result[0]?.count ?? 0);
      }),

    // 알림 목록 조회 — 최신순 최대 30개. 드롭다운 UI 렌더링용.
    //   role 무관 — 사업주/유저/관리자 전부 본인 수신 알림만 반환 (본인 소유 필터 user_id=ctx.user.id)
    list: protectedProcedure
      .input(z.object({ limit: z.number().int().positive().max(100).optional() }).optional())
      .query(async ({ ctx, input }) => {
        const dbConn = await db.getDb();
        if (!dbConn) return [];
        const limit = input?.limit ?? 30;
        const result = await dbConn.execute(sql`
          SELECT id, type, title, message, is_read AS "isRead",
                 related_id AS "relatedId", target_url AS "targetUrl",
                 created_at AS "createdAt"
          FROM notifications
          WHERE user_id = ${ctx.user.id}
          ORDER BY created_at DESC
          LIMIT ${limit}
        `);
        return ((result as any)?.rows ?? []) as Array<{
          id: number; type: string; title: string | null; message: string | null;
          isRead: boolean; relatedId: number | null; targetUrl: string | null;
          createdAt: Date;
        }>;
      }),

    // 알림 읽음 처리 — DB notifications.is_read = true 업데이트
    markAsRead: protectedProcedure
      .mutation(async ({ ctx }) => {
        const db_connection = await db.getDb();
        if (!db_connection) throw new Error('Database connection failed');

        await db_connection
          .update(notifications)
          .set({ isRead: true })
          .where(and(
            eq(notifications.userId, ctx.user.id),
            eq(notifications.isRead, false),
          ));

        return { success: true };
      }),

    // 개별 알림 읽음 처리 — 드롭다운에서 항목 클릭 시 호출
    markOneAsRead: protectedProcedure
      .input(z.object({ id: z.number().int().positive() }))
      .mutation(async ({ ctx, input }) => {
        const dbConn = await db.getDb();
        if (!dbConn) throw new Error('Database connection failed');
        await dbConn.execute(sql`
          UPDATE notifications SET is_read = TRUE
          WHERE id = ${input.id} AND user_id = ${ctx.user.id}
        `);
        return { success: true };
      }),

    // 알림 클릭 트래킹 — openCount Atomic Increment
    // 반환: DeepLinkResponse — 네이티브 앱이 직접 해석 가능한 구조화 JSON
    // deepLink.scheme: 'web' | 'mycoupon' | 'https' 등
    // deepLink.path:   '/store/123' | '/my-coupons' 등 앱 내 라우트
    // deepLink.params: { id: '123', tab: 'coupon' } 등 쿼리스트링
    trackClick: protectedProcedure
      .input(z.object({ notificationId: z.number().int().positive() }))
      .mutation(async ({ ctx, input }) => {
        const targetUrl = await db.trackNotificationClick(input.notificationId, ctx.user.id);

        if (!targetUrl) return { targetUrl: null, deepLink: null };

        // targetUrl → DeepLink 파싱
        // 커스텀 스킴(mycoupon://…) 또는 상대 경로(/store/123) 모두 처리
        let deepLink: { scheme: string; path: string; params: Record<string, string> };
        try {
          const url = new URL(targetUrl, 'https://placeholder.invalid');
          const params: Record<string, string> = {};
          url.searchParams.forEach((v, k) => { params[k] = v; });
          deepLink = {
            scheme: url.protocol.replace(':', ''), // 'https' | 'mycoupon' | 'http'
            path: url.pathname,
            params,
          };
        } catch {
          // 파싱 실패 → 상대 경로 그대로 path 처리
          const [path, qs = ''] = targetUrl.split('?');
          const params: Record<string, string> = {};
          new URLSearchParams(qs).forEach((v, k) => { params[k] = v; });
          deepLink = { scheme: 'web', path, params };
        }

        return { targetUrl, deepLink };
      }),

    // 푸시 토큰 등록/갱신 — protectedProcedure: 인증된 세션 userId만 허용
    // deviceId 소유권 이전 감지는 upsertPushToken 내부에서 처리됨
    registerToken: protectedProcedure
      .input(z.object({
        deviceToken: z.string().min(1),
        osType: z.enum(['android', 'ios']),
        deviceId: z.string().min(1),
      }))
      .mutation(async ({ ctx, input }) => {
        console.log(`[registerToken:CALLED] userId=${ctx.user.id} osType=${input.osType} deviceId=${input.deviceId.slice(0, 12)} tokenLen=${input.deviceToken.length}`);
        try {
          await db.upsertPushToken({
            userId: ctx.user.id,
            deviceToken: input.deviceToken,
            osType: input.osType,
            deviceId: input.deviceId,
            updatedAt: new Date(),
          });
          console.log(`[registerToken:UPSERT_OK] userId=${ctx.user.id}`);
        } catch (e) {
          console.error(`[registerToken:UPSERT_FAIL] userId=${ctx.user.id} error:`, e);
          throw e;
        }
        return { success: true };
      }),
  }),

  // ── 이벤트 팝업 ──────────────────────────────────────────────────────────
  popup: router({
    /** 공개 쿼리: 현재 노출할 팝업 목록 (비로그인 포함, target/기간 필터) */
    getActive: publicProcedure.query(async ({ ctx }) => {
      const dbConn = await db.getDb();
      if (!dbConn) return [];
      const now = new Date();
      // isActive + 기간 필터 (startsAt/endsAt null이면 통과)
      // KST(UTC+9) 기준으로 입력된 starts_at/ends_at을 UTC NOW()와 비교할 때
      // +9시간 오프셋 적용: NOW() + INTERVAL '9 hours' = 현재 한국 시간
      const rows = await dbConn.execute(`
        SELECT id, target, title, body, image_data_url AS "imageDataUrl",
               primary_button_text AS "primaryButtonText",
               primary_button_url AS "primaryButtonUrl",
               dismissible, priority, starts_at AS "startsAt", ends_at AS "endsAt"
        FROM event_popups
        WHERE is_active = TRUE
          AND (starts_at IS NULL OR starts_at <= NOW() + INTERVAL '9 hours')
          AND (ends_at   IS NULL OR ends_at   >= NOW() + INTERVAL '9 hours')
        ORDER BY priority DESC, updated_at DESC
        LIMIT 10
      `);
      const all = (rows as any)?.rows ?? [];
      // target 필터: 비로그인=ALL만, 로그인=ALL+dormant/active 조건
      const user = ctx.user;
      let dormant: boolean | null = null;
      if (user) {
        const plan = await db.getEffectivePlan(user.id);
        const planForCheck = plan
          ? { isActive: true,
              expiresAt: (plan as any).expires_at ?? null,
              tier: (plan as any).tier ?? null }
          : null;
        dormant = db.isDormantMerchant(user.trialEndsAt, planForCheck);
      }
      return all.filter((p: any) => {
        if (p.target === 'ALL') return true;
        if (!user) return false;            // 비로그인은 ALL만
        if (p.target === 'DORMANT_ONLY') return dormant === true;
        if (p.target === 'ACTIVE_ONLY') return dormant === false;
        return false;
      }).slice(0, 3);
    }),

    /** 어드민 전용 CRUD */
    list: protectedProcedure
      .use(({ ctx, next }) => {
        if (ctx.user.role !== 'admin') throw new Error('Admin access required');
        return next({ ctx });
      })
      .query(async () => {
        const dbConn = await db.getDb();
        if (!dbConn) return [];
        const rows = await dbConn.execute(
          `SELECT * FROM event_popups ORDER BY priority DESC, updated_at DESC`
        );
        return (rows as any)?.rows ?? [];
      }),

    create: protectedProcedure
      .use(({ ctx, next }) => {
        if (ctx.user.role !== 'admin') throw new Error('Admin access required');
        return next({ ctx });
      })
      .input(z.object({
        title: z.string().min(1),
        body: z.string().optional(),
        target: z.enum(['ALL', 'DORMANT_ONLY', 'ACTIVE_ONLY']).default('ALL'),
        imageDataUrl: z.string().optional(),
        primaryButtonText: z.string().optional(),
        primaryButtonUrl: z.string().optional(),
        dismissible: z.boolean().default(true),
        priority: z.number().int().default(0),
        startsAt: z.string().optional(),
        endsAt: z.string().optional(),
      }))
      .mutation(async ({ input }) => {
        const dbConn = await db.getDb();
        if (!dbConn) throw new Error('DB unavailable');
        // Drizzle ORM insert — parameterized, DataURL 등 긴 문자열 안전 처리
        await dbConn.insert(eventPopups).values({
          title: input.title,
          body: input.body ?? null,
          target: input.target as any,
          imageDataUrl: input.imageDataUrl ?? null,
          primaryButtonText: input.primaryButtonText ?? null,
          primaryButtonUrl: input.primaryButtonUrl ?? null,
          dismissible: input.dismissible,
          priority: input.priority,
          startsAt: input.startsAt ? new Date(input.startsAt) : null,
          endsAt: input.endsAt ? new Date(input.endsAt) : null,
          isActive: true,
        } as any);
        return { success: true };
      }),

    update: protectedProcedure
      .use(({ ctx, next }) => {
        if (ctx.user.role !== 'admin') throw new Error('Admin access required');
        return next({ ctx });
      })
      .input(z.object({
        id: z.number(),
        title: z.string().min(1).optional(),
        body: z.string().optional(),
        target: z.enum(['ALL', 'DORMANT_ONLY', 'ACTIVE_ONLY']).optional(),
        imageDataUrl: z.string().optional(),
        primaryButtonText: z.string().optional(),
        primaryButtonUrl: z.string().optional(),
        dismissible: z.boolean().optional(),
        priority: z.number().int().optional(),
        startsAt: z.string().nullable().optional(),
        endsAt: z.string().nullable().optional(),
      }))
      .mutation(async ({ input }) => {
        const dbConn = await db.getDb();
        if (!dbConn) throw new Error('DB unavailable');
        const { id, ...patch } = input;
        // Drizzle ORM update — parameterized, DataURL 안전 처리
        const updateData: Record<string, unknown> = { updatedAt: new Date() };
        if (patch.title !== undefined) updateData.title = patch.title;
        if (patch.body !== undefined) updateData.body = patch.body ?? null;
        if (patch.target !== undefined) updateData.target = patch.target;
        if (patch.imageDataUrl !== undefined) updateData.imageDataUrl = patch.imageDataUrl ?? null;
        if (patch.primaryButtonText !== undefined) updateData.primaryButtonText = patch.primaryButtonText ?? null;
        if (patch.primaryButtonUrl !== undefined) updateData.primaryButtonUrl = patch.primaryButtonUrl ?? null;
        if (patch.dismissible !== undefined) updateData.dismissible = patch.dismissible;
        if (patch.priority !== undefined) updateData.priority = patch.priority;
        if (patch.startsAt !== undefined) updateData.startsAt = patch.startsAt ? new Date(patch.startsAt) : null;
        if (patch.endsAt !== undefined) updateData.endsAt = patch.endsAt ? new Date(patch.endsAt) : null;
        await dbConn.update(eventPopups).set(updateData as any).where(eq(eventPopups.id, id));
        return { success: true };
      }),

    toggleActive: protectedProcedure
      .use(({ ctx, next }) => {
        if (ctx.user.role !== 'admin') throw new Error('Admin access required');
        return next({ ctx });
      })
      .input(z.object({ id: z.number(), isActive: z.boolean() }))
      .mutation(async ({ input }) => {
        const dbConn = await db.getDb();
        if (!dbConn) throw new Error('DB unavailable');
        await dbConn.execute(
          `UPDATE event_popups SET is_active = ${input.isActive}, updated_at = NOW() WHERE id = ${input.id}`
        );
        return { success: true };
      }),

    delete: protectedProcedure
      .use(({ ctx, next }) => {
        if (ctx.user.role !== 'admin') throw new Error('Admin access required');
        return next({ ctx });
      })
      .input(z.object({ id: z.number() }))
      .mutation(async ({ input }) => {
        const dbConn = await db.getDb();
        if (!dbConn) throw new Error('DB unavailable');
        await dbConn.delete(eventPopups).where(eq(eventPopups.id, input.id));
        return { success: true };
      }),
  }),
});

export type AppRouter = typeof appRouter;
