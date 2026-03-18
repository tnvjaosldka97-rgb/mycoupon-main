import { TRPCError } from "@trpc/server";
import { sql } from "drizzle-orm";
import { COOKIE_NAME } from "@shared/const";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { publicProcedure, protectedProcedure, router } from "./_core/trpc";
import { z } from "zod";
import * as db from "./db";
import { APP_VERSION, isVersionLower } from "../shared/version";
import { invokeLLM } from "./_core/llm";
import { analyticsRouter } from "./analytics";
import QRCode from 'qrcode';
import { deploymentRouter } from "./routers/deployment";
import { districtStampsRouter } from "./routers/districtStamps";
import { packOrdersRouter } from "./routers/packOrders";
import { sendEmail, getMerchantRenewalNudgeEmailTemplate } from "./email";
import { eventPopups, notifications } from "../drizzle/schema";
import { desc, lt, gt, isNull, or, eq, and } from "drizzle-orm";
import { rateLimitByIP, rateLimitByUser, rateLimitCriticalAction } from "./_core/rateLimit";
import { isQuietHoursKST, makeAdPushTitle, isPromotionalType } from "./notificationPolicy";
import { captureBusinessCriticalError } from "./_core/sentry";


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
    logout: publicProcedure.mutation(({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      return {
        success: true,
      } as const;
    }),
    // 테스트용 간단 로그인 (임시)
    devLogin: publicProcedure
      .input(z.object({
        userId: z.number().optional().default(1),
      }))
      .mutation(async ({ ctx, input }) => {
        // DB에서 사용자 조회
        const db_connection = await db.getDb();
        if (!db_connection) throw new Error('Database connection failed');

        const result = await db_connection.execute(
          `SELECT id, openId, name, email, role FROM users WHERE id = ${input.userId} LIMIT 1`
        );

        const user = (result[0] as any)[0];
        if (!user) {
          throw new Error('User not found');
        }

        // JWT 토큰 생성 (jose 라이브러리 사용)
        const { SignJWT } = await import('jose');
        const secret = new TextEncoder().encode(process.env.JWT_SECRET || 'default-secret-key');

        const token = await new SignJWT({
          openId: user.openId,
          appId: process.env.VITE_APP_ID || '',
          name: user.name
        })
          .setProtectedHeader({ alg: 'HS256' })
          .setExpirationTime('7d')
          .sign(secret);

        const cookieOptions = getSessionCookieOptions(ctx.req);
        ctx.res.cookie(COOKIE_NAME, token, cookieOptions);

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
        termsAgreed: z.boolean(),        // 필수: 이용약관
        privacyAgreed: z.boolean(),      // 필수: 개인정보 처리방침
        marketingAgreed: z.boolean(),    // 선택: 마케팅 동의
      }))
      .mutation(async ({ ctx, input }) => {
        if (!input.termsAgreed || !input.privacyAgreed) {
          throw new TRPCError({ code: 'BAD_REQUEST', message: '필수 약관에 동의해야 합니다.' });
        }
        await db.completeUserSignup(ctx.user.id, input.marketingAgreed);
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
          newCouponNotifications: user.newCouponNotifications ?? true,
          expiryNotifications: user.expiryNotifications ?? true,
          preferredDistrict: user.preferredDistrict ?? null,
          locationNotificationsEnabled: user.locationNotificationsEnabled ?? false,
          notificationRadius: user.notificationRadius ?? 200,
          favoriteFoodTop3,  // 선호 음식 Top3 (순서 = 1픽/2픽/3픽)
        };
      }),

    // 이메일 알림 설정 업데이트
    updateNotificationSettings: protectedProcedure
      .input(z.object({
        emailNotificationsEnabled: z.boolean().optional(),
        newCouponNotifications: z.boolean().optional(),
        expiryNotifications: z.boolean().optional(),
        preferredDistrict: z.string().nullable().optional(),
        locationNotificationsEnabled: z.boolean().optional(),
        notificationRadius: z.union([z.literal(100), z.literal(200), z.literal(500)]).optional(),
        favoriteFoodTop3: z.array(z.string().max(30)).max(3).optional(), // 선호 음식 Top3 (최대 3개)
      }))
      .mutation(async ({ ctx, input }) => {
        // Drizzle ORM 사용 (PostgreSQL boolean 타입 안전하게 처리)
        const updateData: any = {};

        if (input.emailNotificationsEnabled !== undefined) {
          updateData.emailNotificationsEnabled = input.emailNotificationsEnabled;
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
     * nudgeDormant — 로그인한 모든 유저가 휴면 사장에게 "쿠폰 더 달라"고 조르기
     * - 유저 1인당 특정 가게 오너에게 1회만 조르기 가능
     * - 누적 횟수가 5회 될 때마다 사장에게 이메일 발송
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

        // coupon_extension_requests 에 기록 (sql 태그드 템플릿 → 파라미터 바인딩)
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

        // 감사 로그 (보조 기록)
        void db.insertAuditLog({
          adminId: ctx.user.id,
          action: 'USER_NUDGE',
          targetType: 'user',
          targetId: input.ownerId,
          payload: { nudgeCount, storeName: input.storeName, actorUserId: ctx.user.id },
        });

        // 5배수마다 사장에게 이메일
        let mailSent = false;
        if (nudgeCount % 5 === 0) {
          const merchant = await db.getUserById(input.ownerId);
          const merchantStores = await db.getStoresByOwnerId(input.ownerId);
          const appUrl = process.env.VITE_APP_URL || 'https://my-coupon-bridge.com';
          const couponUrl = merchantStores.length > 0
            ? `${appUrl}/store/${merchantStores[0].id}`
            : `${appUrl}/map`;
          if (merchant?.email) {
            const { sendEmail, getMerchantRenewalNudgeEmailTemplate } = await import('./email');
            mailSent = await sendEmail({
              userId: input.ownerId,
              email: merchant.email,
              subject: `[마이쿠폰] "${input.storeName}" 쿠폰을 기다리는 고객이 ${nudgeCount}명!`,
              html: getMerchantRenewalNudgeEmailTemplate(merchant.name, nudgeCount, input.storeName, couponUrl),
              type: 'merchant_renewal_nudge',
            });
          }
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

        // 관리자가 등록하면 자동 승인
        if (ctx.user.role === 'admin') {
          storeData.approvedBy = ctx.user.id;
          storeData.approvedAt = new Date();
        }

        await db.createStore(storeData);

        return {
          success: true,
          message: ctx.user.role === 'admin'
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
              .map(uc => uc.coupon_id)
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
            used.filter(uc => uc.status === 'used').map(uc => uc.coupon_id)
          );
        }

        // 배치 단일 쿼리 — N+1 제거 (buildStoreCouponFilter 동일 조건 일괄 적용)
        const couponsByStore = await db.getCouponsByStoreIds(approvedStores.map(s => s.id));
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
    myStores: merchantProcedure.query(async ({ ctx }) => {
      return await db.getStoresByOwnerId(ctx.user.id);
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
      .input(z.object({
        storeId: z.number(),
        title: z.string(),
        description: z.string().optional(),
        discountType: z.enum(['percentage', 'fixed', 'freebie']),
        discountValue: z.number(),
        minPurchase: z.number().optional(),
        maxDiscount: z.number().optional(),
        totalQuantity: z.number(),
        dailyLimit: z.number().optional(),
        startDate: z.date(),
        endDate: z.date().optional(), // 클라이언트 전송값은 무시, 서버가 재계산 (하위 호환 유지)
      }))
      .mutation(async ({ ctx, input }) => {
        // 본인 가게인지 확인
        const store = await db.getStoreById(input.storeId);
        if (!store) throw new Error('Store not found');
        if (store.ownerId !== ctx.user.id && ctx.user.role !== 'admin') {
          throw new Error('Unauthorized');
        }

        // 거절된 가게는 쿠폰 등록 불가 (사장님 + 어드민 동일 적용)
        if ((store as any).status === 'rejected') {
          throw new TRPCError({
            code: 'FORBIDDEN',
            message: '거절된 가게에는 쿠폰을 등록할 수 없습니다. 재신청 후 승인을 받아주세요.',
          });
        }

        // ── Effective Plan 조회 + 서버 강제 정책 적용 (어드민은 bypass) ────────
        const planRow = ctx.user.role === 'admin' ? null : await db.getEffectivePlan(ctx.user.id);
        const plan = db.resolveEffectivePlan(planRow);

        if (ctx.user.role !== 'admin') {
          // 프랜차이즈도 일반 free trial과 동일한 쿠폰 정책 적용
          // (franchise 특권은 1가게 제한 bypass만. 쿠폰 정책은 동일)
          const accountState = db.resolveAccountState(ctx.user.trialEndsAt, plan.tier);

          if (accountState === 'non_trial_free') {
            throw new TRPCError({
              code: 'FORBIDDEN',
              message: '무료 체험이 종료되었습니다. 유료 구독팩을 신청해 주세요.',
            });
          }

          const tierName = plan.tier === 'FREE' ? '무료(7일 체험)' :
            plan.tier === 'WELCOME' ? '손님마중' :
              plan.tier === 'REGULAR' ? '단골손님' :
                plan.tier === 'BUSY' ? '북적북적' : plan.tier;

          // 단일 쿠폰 수량은 플랜 quota 이내여야 함 (기존 정책 유지)
          if (input.totalQuantity > plan.defaultCouponQuota) {
            throw new TRPCError({
              code: 'BAD_REQUEST',
              message: `현재 등급(${tierName})에서는 쿠폰 1건당 수량을 ${plan.defaultCouponQuota}개 이하로 등록해야 합니다.`,
            });
          }

          // 누적 quota 검증: 현재 멤버십 시작일 or 정책 커트오버일 이후 생성된 쿠폰 합산
          // POLICY_CUTOVER_AT = 이 정책 배포일 (2026-03-18). 이전 쿠폰은 grandfathering.
          const POLICY_CUTOVER_AT = '2026-03-18T00:00:00Z';
          const dbConn = await db.getDb();
          if (!dbConn) {
            throw new TRPCError({
              code: 'INTERNAL_SERVER_ERROR',
              message: '서버 연결 오류로 쿠폰 한도를 검증할 수 없습니다. 잠시 후 다시 시도해 주세요.',
            });
          }
          const membershipStartedAt = (planRow as any)?.starts_at
            ? new Date((planRow as any).starts_at as string).toISOString()
            : POLICY_CUTOVER_AT;
          // 두 날짜 중 더 늦은 것을 window 시작점으로
          const windowStart = membershipStartedAt > POLICY_CUTOVER_AT
            ? membershipStartedAt
            : POLICY_CUTOVER_AT;

          const quotaResult = await dbConn.execute(
            `SELECT COALESCE(SUM(total_quantity), 0) AS used_quota
             FROM coupons
             WHERE store_id IN (
               SELECT id FROM stores WHERE owner_id = ${ctx.user.id} AND deleted_at IS NULL
             )
             AND created_at >= '${windowStart}'`
          );
          const usedQuota = Number(((quotaResult as any)?.rows ?? [])[0]?.used_quota ?? 0);

          if (usedQuota + input.totalQuantity > plan.defaultCouponQuota) {
            const remaining = Math.max(0, plan.defaultCouponQuota - usedQuota);
            throw new TRPCError({
              code: 'BAD_REQUEST',
              message: `현재 등급(${tierName}) 누적 쿠폰 한도(${plan.defaultCouponQuota}개)에 도달했습니다. 이번 멤버십 기간 남은 수량: ${remaining}개`,
            });
          }
        }

        // ── endDate 서버 강제 계산 ────────────────────────────────────────────
        const serverEndDate = ctx.user.role === 'admin' && input.endDate
          ? input.endDate
          : db.computeCouponEndDate(input.startDate, plan);
        // ── 서버 강제 끝 ──────────────────────────────────────────────────────

        const couponData: any = {
          storeId: input.storeId,
          title: input.title,
          description: input.description,
          discountType: input.discountType,
          discountValue: input.discountValue,
          minPurchase: input.minPurchase,
          maxDiscount: input.maxDiscount,
          totalQuantity: input.totalQuantity,
          dailyLimit: input.dailyLimit,
          startDate: input.startDate,
          endDate: serverEndDate,   // ← 서버 계산값으로 덮어씌움
          remainingQuantity: input.totalQuantity,
          isActive: true,
        };

        // 관리자가 등록하면 자동 승인
        if (ctx.user.role === 'admin') {
          couponData.approvedBy = ctx.user.id;
          couponData.approvedAt = new Date();
        }

        const coupon = await db.createCoupon(couponData);

        void db.insertAuditLog({
          adminId: ctx.user.id,
          action: 'merchant_coupon_create',
          targetType: 'coupon',
          targetId: (coupon as any)?.id,
          payload: {
            storeId: input.storeId,
            title: input.title,
            totalQuantity: input.totalQuantity,
            tier: plan.tier,
            serverEndDate: serverEndDate.toISOString(),
            autoApproved: ctx.user.role === 'admin',
          },
        });

        return {
          success: true,
          message: ctx.user.role === 'admin'
            ? '쿠폰이 등록되었습니다.'
            : '쿠폰 등록이 완료되었습니다. 관리자 승인 후 지도에 노출됩니다.',
          serverEndDate: serverEndDate.toISOString(), // 프론트가 표시할 수 있도록 반환
        };
      }),

    // 쿠폰 수정 (사장님 전용)
    // create와 동일한 서버 강제 정책 적용:
    //   - totalQuantity → plan quota 체크
    //   - endDate → 클라이언트 값 무시, startDate 기반 서버 재계산
    //   - 어드민은 endDate 직접 지정 허용
    update: merchantProcedure
      .input(z.object({
        id: z.number(),
        title: z.string().optional(),
        description: z.string().optional(),
        discountType: z.enum(['percentage', 'fixed', 'freebie']).optional(),
        discountValue: z.number().optional(),
        minPurchase: z.number().optional(),
        maxDiscount: z.number().optional(),
        totalQuantity: z.number().optional(),
        startDate: z.date().optional(),
        endDate: z.date().optional(), // 클라이언트 값은 무시 (어드민 제외)
      }))
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

        // ── create와 동일한 서버 강제 정책 (어드민 bypass) ───────────────────
        const planRow = ctx.user.role === 'admin' ? null : await db.getEffectivePlan(ctx.user.id);
        const plan = db.resolveEffectivePlan(planRow);

        if (ctx.user.role !== 'admin') {
          // 프랜차이즈도 일반 free trial과 동일한 쿠폰 정책 (체험 만료 시 휴면)
          const accountState = db.resolveAccountState(ctx.user.trialEndsAt, plan.tier);

          if (accountState === 'non_trial_free') {
            throw new TRPCError({
              code: 'FORBIDDEN',
              message: '무료 체험이 종료되었습니다. 유료 구독팩을 신청해 주세요.',
            });
          }

          // 수량 변경 시 plan quota 체크
          if (input.totalQuantity !== undefined && input.totalQuantity > plan.defaultCouponQuota) {
            const tierName = plan.tier === 'FREE' ? '무료(7일 체험)' :
              plan.tier === 'WELCOME' ? '손님마중' :
                plan.tier === 'REGULAR' ? '단골손님' :
                  plan.tier === 'BUSY' ? '북적북적' : plan.tier;
            throw new TRPCError({
              code: 'BAD_REQUEST',
              message: `현재 등급(${tierName})에서는 쿠폰 수량을 ${plan.defaultCouponQuota}개 이하로 등록해야 합니다.`,
            });
          }
        }

        // endDate 서버 재계산 (startDate 변경 시 or 기존 startDate 기준)
        // 어드민은 클라이언트 endDate 직접 허용
        const updateData: any = { ...data };
        if (ctx.user.role !== 'admin') {
          // merchant: startDate가 있으면 새로 계산, 없으면 기존 쿠폰 startDate 기준 재계산
          const baseStartDate = input.startDate ?? coupon.startDate;
          updateData.endDate = db.computeCouponEndDate(
            baseStartDate instanceof Date ? baseStartDate : new Date(baseStartDate),
            plan
          );
        }
        // ── 서버 강제 끝 ──────────────────────────────────────────────────────

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

          // ✅ 일 소비수량 체크 (dailyLimit가 설정되어 있으면)
          if (coupon.dailyLimit && coupon.dailyUsedCount >= coupon.dailyLimit) {
            throw new Error('오늘의 쿠폰이 모두 소진되었습니다. 내일 다시 시도해주세요.');
          }

          // 쿠폰 만료 체크 (종료일 23:59:59까지 유효)
          const endOfDay = new Date(coupon.endDate);
          endOfDay.setHours(23, 59, 59, 999);
          if (new Date() > endOfDay) throw new Error('만료된 쿠폰입니다');

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

          // ✅ 일 소비수량 증가
          if (coupon.dailyLimit) {
            const db_connection = await db.getDb();
            if (db_connection) {
              await db_connection.execute(`
              UPDATE coupons 
              SET daily_used_count = daily_used_count + 1 
              WHERE id = ${input.couponId}
            `);
            }
          }

          // ❌ 수량 차감 제거: downloadCoupon 내부에서 트랜잭션으로 처리됨
          // await db.updateCouponQuantity(input.couponId, coupon.remainingQuantity - 1);

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

        // 쿠폰 사용 처리
        await db.markCouponAsUsed(userCoupon.id);

        // 사용 내역 기록
        await db.createCouponUsage({
          userCouponId: userCoupon.id,
          storeId: input.storeId,
          userId: userCoupon.userId,
          verifiedBy: ctx.user.id,
        });

        // 사용자 통계 업데이트
        await db.incrementCouponUsage(userCoupon.userId);

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
        await db.addFavorite(ctx.user.id, input.storeId);
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

    // 내 즐겨찾기 목록
    list: protectedProcedure.query(async ({ ctx }) => {
      return await db.getUserFavorites(ctx.user.id);
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
        const totalCouponsIssued = coupons.reduce((sum, c) => sum + (c.total_quantity - c.remainingQuantity), 0);
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
        discountType: z.enum(['percentage', 'fixed', 'freebie']),
        discountValue: z.number(),
        minPurchase: z.number().optional(),
        maxDiscount: z.number().optional(),
        totalQuantity: z.number(),
        dailyLimit: z.number().optional(), // 일 소비수량
        startDate: z.string(), // ISO string
        endDate: z.string(), // ISO string
      }))
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

            // ── Phase 1.5: Dual-Layer Cool-down — 배치 IN 쿼리 ─────────────────────
            // notifications 테이블 단일 쿼리로 두 조건을 동시 처리:
            //   User-Level  (1h):  type='nearby_store' 알림을 1시간 내 받은 유저
            //   Store-Level (24h): 이 가게 알림을 24시간 내 받은 유저 (relatedId = store.id)
            let finalEligible = eligible;
            if (eligible.length > 0) {
              const eligibleIds = eligible.map(u => u.id).join(',');
              const cooledDown = await db_connection.execute(`
                SELECT DISTINCT user_id FROM notifications
                WHERE user_id IN (${eligibleIds})
                  AND type = 'nearby_store'
                  AND (
                    created_at > NOW() - INTERVAL '1 hour'
                    OR (
                      related_id = ${store.id}
                      AND created_at > NOW() - INTERVAL '24 hours'
                    )
                  )
              `);
              const blockedIds = new Set<number>(
                ((cooledDown as any)?.rows ?? []).map((r: any) => Number(r.user_id))
              );
              if (blockedIds.size > 0) {
                finalEligible = eligible.filter(u => !blockedIds.has(u.id));
                console.log(`[Coupon Notification] Cooldown blocked ${blockedIds.size}/${eligible.length} users`);
              }
            }

            // ── Phase 2: 통계 그룹 생성 → Chunk 병렬 INSERT + deliveredCount 누적 ──
            const CHUNK_SIZE = 200;
            // (광고) 문구 강제 삽입 — 정보통신망법 제50조
            const notifTitle = makeAdPushTitle('🎁 새로운 쿠폰!');
            const groupId = crypto.randomUUID();
            await db.createNotificationGroup(groupId, notifTitle, finalEligible.length);

            let notificationsSent = 0;
            for (let i = 0; i < finalEligible.length; i += CHUNK_SIZE) {
              const chunk = finalEligible.slice(i, i + CHUNK_SIZE);
              await Promise.all(
                chunk.map(u =>
                  db.createNotification({
                    userId: u.id,
                    title: notifTitle,
                    message: `${u.distanceText} 떨어진 ${store.name}에서 새 쿠폰이 등록됐어요!`,
                    type: 'nearby_store',   // 쿨타임 쿼리 식별자
                    relatedId: store.id,         // store.id: 가게 레벨 24h 중복 방지 기준
                    targetUrl: `/store/${store.id}`,
                    groupId,
                  })
                )
              );
              await db.incrementDeliveredCount(groupId, chunk.length);
              notificationsSent += chunk.length;
            }

            console.log(`[Coupon Notification] groupId=${groupId} sent=${notificationsSent}/${users.length} cooldown-blocked=${eligible.length - finalEligible.length} (chunk=${CHUNK_SIZE})`);
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
          ? { isActive: true, expiresAt: (activePlan as any).expires_at ?? null }
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
        await dbConn.execute(`DELETE FROM users WHERE id = ${input.userId}`);
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
        await db.updateCoupon(input.id, {
          approvedBy: ctx.user.id,
          approvedAt: new Date(),
        });
        void db.insertAuditLog({
          adminId: ctx.user.id,
          action: 'admin_coupon_approve',
          targetType: 'coupon',
          targetId: input.id,
        });
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

  // 알림 관련 API
  notifications: router({
    // 읽지 않은 알림 개수 조회
    getUnreadCount: protectedProcedure
      .query(async ({ ctx }) => {
        const db_connection = await db.getDb();
        if (!db_connection) throw new Error('Database connection failed');

        const result = await db_connection
          .select({ count: sql<number>`COUNT(*)` })
          .from(notifications)
          .where(and(
            eq(notifications.userId, ctx.user.id),
            eq(notifications.isRead, false),
          ));

        return Number(result[0]?.count ?? 0);
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
        await db.upsertPushToken({
          userId: ctx.user.id,
          deviceToken: input.deviceToken,
          osType: input.osType,
          deviceId: input.deviceId,
          updatedAt: new Date(),
        });
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
      const rows = await dbConn.execute(`
        SELECT id, target, title, body, image_data_url AS "imageDataUrl",
               primary_button_text AS "primaryButtonText",
               primary_button_url AS "primaryButtonUrl",
               dismissible, priority, starts_at AS "startsAt", ends_at AS "endsAt"
        FROM event_popups
        WHERE is_active = TRUE
          AND (starts_at IS NULL OR starts_at <= NOW())
          AND (ends_at   IS NULL OR ends_at   >= NOW())
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
          ? { isActive: true, expiresAt: (plan as any).expires_at ?? null }
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
        await dbConn.execute(`DELETE FROM event_popups WHERE id = ${input.id}`);
        return { success: true };
      }),
  }),
});

export type AppRouter = typeof appRouter;
