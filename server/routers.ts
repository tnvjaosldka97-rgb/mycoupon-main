import { COOKIE_NAME } from "@shared/const";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { publicProcedure, protectedProcedure, router } from "./_core/trpc";
import { z } from "zod";
import * as db from "./db";
import { APP_VERSION, isVersionLower } from "../shared/version";
import { invokeLLM } from "./_core/llm";
import * as analytics from "./analytics";
import QRCode from 'qrcode';
import { deploymentRouter } from "./routers/deployment";


const merchantProcedure = protectedProcedure.use(({ ctx, next }) => {
  if (ctx.user.role !== 'merchant' && ctx.user.role !== 'admin') {
    throw new Error('Merchant access required');
  }
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
        
        return {
          emailNotificationsEnabled: user.emailNotificationsEnabled ?? true,
          newCouponNotifications: user.newCouponNotifications ?? true,
          expiryNotifications: user.expiryNotifications ?? true,
          preferredDistrict: user.preferredDistrict ?? null,
        };
      }),

    // 이메일 알림 설정 업데이트
    updateNotificationSettings: protectedProcedure
      .input(z.object({
        emailNotificationsEnabled: z.boolean().optional(),
        newCouponNotifications: z.boolean().optional(),
        expiryNotifications: z.boolean().optional(),
        preferredDistrict: z.string().nullable().optional(),
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
        
        if (Object.keys(updateData).length > 0) {
          try {
            await db.updateUser(ctx.user.id, updateData);
            console.log('[NotificationSettings] 알림 설정 업데이트 성공');
          } catch (error) {
            console.error('[NotificationSettings] 알림 설정 업데이트 실패:', error);
            throw new Error('알림 설정 저장에 실패했습니다.');
          }
        }
        
        return { success: true };
      }),
  }),

  stores: router({
    // 가게 생성 (사장님 전용)
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
      }))
      .mutation(async ({ ctx, input }) => {
        await db.createStore({
          ...input,
          ownerId: ctx.user.id,
        });
        return { success: true };
      }),

    // 가게 목록 조회 (쿠폰 정보 포함)
    list: publicProcedure
      .input(z.object({
        limit: z.number().optional().default(50),
        userLat: z.number().optional(),
        userLon: z.number().optional(),
      }))
      .query(async ({ input }) => {
        const stores = await db.getAllStores(input.limit);
        // 각 가게의 쿠폰 정보도 함께 가져오기
        const storesWithCoupons = await Promise.all(
          stores.map(async (store) => {
            const coupons = await db.getCouponsByStoreId(store.id);
            
            // GPS 거리 계산
            let distance: number | undefined;
            if (input.userLat !== undefined && input.userLon !== undefined && store.latitude && store.longitude) {
              const { calculateDistance } = await import('../shared/geoUtils');
              distance = calculateDistance(input.userLat, input.userLon, parseFloat(store.latitude), parseFloat(store.longitude));
            }
            
            return {
              ...store,
              coupons: coupons.filter(c => c.isActive && new Date() < new Date(c.endDate)),
              distance, // 거리 정보 추가 (미터 단위)
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
        
        return {
          ...store,
          reviews,
          visitCount,
        };
      }),

    // 내 가게 목록 (사장님 전용)
    myStores: merchantProcedure.query(async ({ ctx }) => {
      return await db.getStoresByOwnerId(ctx.user.id);
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
        startDate: z.date(),
        endDate: z.date(),
      }))
      .mutation(async ({ ctx, input }) => {
        // 본인 가게인지 확인
        const store = await db.getStoreById(input.storeId);
        if (!store) throw new Error('Store not found');
        if (store.ownerId !== ctx.user.id && ctx.user.role !== 'admin') {
          throw new Error('Unauthorized');
        }

        const coupon = await db.createCoupon({
          ...input,
          remainingQuantity: input.totalQuantity,
        });
        

        
        return { success: true };
      }),

    // 활성 쿠폰 목록 조회
    listActive: publicProcedure.query(async () => {
      return await db.getActiveCoupons();
    }),

    // 가게별 쿠폰 목록
    listByStore: publicProcedure
      .input(z.object({
        storeId: z.number(),
      }))
      .query(async ({ input }) => {
        return await db.getCouponsByStoreId(input.storeId);
      }),

    // 쿠폰 다운로드
    download: protectedProcedure
      .input(z.object({
        couponId: z.number(),
        deviceId: z.string().optional(), // 기기 ID (중복 다운로드 방지)
      }))
      .mutation(async ({ ctx, input }) => {
        const coupon = await db.getCouponById(input.couponId);
        if (!coupon) throw new Error('쿠폰을 찾을 수 없습니다');
        if (coupon.remainingQuantity <= 0) throw new Error('쿠폰이 모두 소진되었습니다');
        if (new Date() > new Date(coupon.endDate)) throw new Error('만료된 쿠폰입니다');

        // 48시간 제한 확인: 동일 업장의 쿠폰을 48시간 이내에 사용한 이력 확인
        const recentUsage = await db.checkRecentStoreUsage(ctx.user.id, coupon.storeId);
        if (recentUsage && recentUsage.usedAt) {
          const hoursSinceUsage = (Date.now() - new Date(recentUsage.usedAt).getTime()) / (1000 * 60 * 60);
          const remainingHours = Math.ceil(48 - hoursSinceUsage);
          throw new Error(`이 업장의 쿠폰을 최근에 사용하셨습니다. ${remainingHours}시간 후에 다시 다운로드할 수 있습니다.`);
        }

        // 기기당 1회 제한 확인
        if (input.deviceId) {
          const existingCoupon = await db.checkDeviceCoupon(ctx.user.id, input.couponId, input.deviceId);
          if (existingCoupon) {
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

        // 쿠폰 다운로드
        await db.downloadCoupon(
          ctx.user.id,
          input.couponId,
          couponCode,
          pinCode,
          input.deviceId || null,
          qrCode,
          new Date(coupon.endDate)
        );

        // 남은 수량 감소
        await db.updateCouponQuantity(input.couponId, coupon.remainingQuantity - 1);

        // 사용자 통계 업데이트
        await db.incrementCouponDownload(ctx.user.id);

        return { success: true, couponCode, pinCode, qrCode };
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

    // 내 알림 목록
    myNotifications: protectedProcedure
      .input(z.object({
        limit: z.number().optional().default(50),
      }))
      .query(async ({ ctx, input }) => {
        return await db.getNotifications(ctx.user.id, input.limit);
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
        startDate: z.string(), // ISO string
        endDate: z.string(), // ISO string
      }))
      .mutation(async ({ input }) => {
        const coupon = await db.createCoupon({
          ...input,
          startDate: new Date(input.startDate),
          endDate: new Date(input.endDate),
          remainingQuantity: input.totalQuantity,
        });



        return { success: true };
      }),

    // 등록된 가게 목록
    listStores: protectedProcedure
      .use(({ ctx, next }) => {
        if (ctx.user.role !== 'admin') {
          throw new Error('Admin access required');
        }
        return next({ ctx });
      })
      .query(async () => {
        return await db.getAllStores(100);
      }),

    // 등록된 쿠폰 목록
    listCoupons: protectedProcedure
      .use(({ ctx, next }) => {
        if (ctx.user.role !== 'admin') {
          throw new Error('Admin access required');
        }
        return next({ ctx });
      })
      .query(async () => {
        return await db.getActiveCoupons();
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
      .mutation(async ({ input }) => {
        await db.deleteStore(input.id);
        return { success: true };
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
      .mutation(async ({ input }) => {
        await db.deleteCoupon(input.id);
        return { success: true };
      }),
  }),

  analytics: router({
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
            DATE(createdAt) as date,
            COUNT(*) as count
          FROM users
          WHERE createdAt >= DATE_SUB(CURDATE(), INTERVAL ${input.days} DAY)
          GROUP BY DATE(createdAt)
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
            DATE(lastSignedIn) as date,
            COUNT(DISTINCT id) as count
          FROM users
          WHERE lastSignedIn >= DATE_SUB(CURDATE(), INTERVAL ${input.days} DAY)
          GROUP BY DATE(lastSignedIn)
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
            DATE(createdAt) as date,
            COUNT(*) as daily_count,
            (SELECT COUNT(*) FROM users WHERE createdAt <= DATE(u.createdAt)) as cumulative_count
          FROM users u
          WHERE createdAt >= DATE_SUB(CURDATE(), INTERVAL ${input.days} DAY)
          GROUP BY DATE(createdAt)
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
            ageGroup,
            COUNT(*) as count
          FROM users
          WHERE ageGroup IS NOT NULL
          GROUP BY ageGroup
          ORDER BY ageGroup
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
    overview: protectedProcedure
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
           WHERE DATE(usedAt) = CURDATE()`
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
          `SELECT SUM(c.discountValue) as total
           FROM user_coupons uc
           JOIN coupons c ON uc.couponId = c.id
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
            SELECT DATE(usedAt) as date, COUNT(*) as count
            FROM coupon_usage
            WHERE usedAt >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)
            GROUP BY DATE(usedAt)
            ORDER BY date DESC
          `;
        } else if (input.period === 'weekly') {
          query = `
            SELECT YEARWEEK(usedAt) as week, COUNT(*) as count
            FROM coupon_usage
            WHERE usedAt >= DATE_SUB(CURDATE(), INTERVAL 12 WEEK)
            GROUP BY YEARWEEK(usedAt)
            ORDER BY week DESC
          `;
        } else {
          query = `
            SELECT DATE_FORMAT(usedAt, '%Y-%m') as month, COUNT(*) as count
            FROM coupon_usage
            WHERE usedAt >= DATE_SUB(CURDATE(), INTERVAL 12 MONTH)
            GROUP BY DATE_FORMAT(usedAt, '%Y-%m')
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
            COUNT(DISTINCT uc.userId) as unique_users
          FROM stores s
          LEFT JOIN coupons c ON c.storeId = s.id
          LEFT JOIN user_coupons uc ON uc.couponId = c.id
          LEFT JOIN coupon_usage cu ON cu.userCouponId = uc.id
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
            HOUR(usedAt) as hour,
            COUNT(*) as count
          FROM coupon_usage
          WHERE usedAt >= DATE_SUB(NOW(), INTERVAL 30 DAY)
          GROUP BY HOUR(usedAt)
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
          JOIN user_coupons uc ON uc.id = cu.userCouponId
          JOIN coupons c ON c.id = uc.couponId
          JOIN stores s ON s.id = c.storeId
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
        
        // Haversine 공식을 사용하여 100m 반경 내 업장 조회
        // 쿠폰 발행량 기준 정렬
        const result = await db_connection.execute(
          `SELECT 
            s.id,
            s.name,
            s.category,
            s.address,
            s.latitude,
            s.longitude,
            COUNT(DISTINCT c.id) as totalCoupons,
            SUM(c.totalQuantity - c.remainingQuantity) as totalIssued,
            (
              6371000 * acos(
                cos(radians(${input.latitude})) * cos(radians(CAST(s.latitude AS DECIMAL(10,8)))) *
                cos(radians(CAST(s.longitude AS DECIMAL(11,8))) - radians(${input.longitude})) +
                sin(radians(${input.latitude})) * sin(radians(CAST(s.latitude AS DECIMAL(10,8))))
              )
            ) AS distance
          FROM stores s
          LEFT JOIN coupons c ON s.id = c.storeId
          WHERE s.latitude IS NOT NULL AND s.longitude IS NOT NULL
          HAVING distance <= ${input.radius}
          ORDER BY totalIssued DESC, distance ASC
          LIMIT 20`
        );
        
        return (result as any)[0];
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
              WHEN c.discountType = 'fixed' THEN c.discountValue
              ELSE 0
            END), 0) as total_discount_amount
          FROM stores s
          LEFT JOIN coupons c ON c.storeId = s.id
          LEFT JOIN user_coupons uc ON uc.couponId = c.id
          LEFT JOIN coupon_usage cu ON cu.userCouponId = uc.id
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
            s.ratingCount,
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
          LEFT JOIN coupons c ON c.storeId = s.id
          LEFT JOIN user_coupons uc ON uc.couponId = c.id
          WHERE s.is_active = true
          GROUP BY s.id, s.name, s.category, s.rating, s.ratingCount
          ORDER BY download_count DESC
        `);
        
        // 카테고리별 상위 3개 업장
        const categoryLeaders = await db_connection.execute(`
          SELECT 
            s.category,
            s.id,
            s.name,
            s.rating,
            COUNT(DISTINCT uc.id) as download_count,
            SUM(CASE WHEN uc.status = 'used' THEN 1 ELSE 0 END) as usage_count,
            ROW_NUMBER() OVER (PARTITION BY s.category ORDER BY COUNT(DISTINCT uc.id) DESC) as category_rank
          FROM stores s
          LEFT JOIN coupons c ON c.storeId = s.id
          LEFT JOIN user_coupons uc ON uc.couponId = c.id
          WHERE s.is_active = true
          GROUP BY s.category, s.id, s.name, s.rating
          HAVING category_rank <= 3
          ORDER BY s.category, category_rank
        `);
        
        // 전체 통계 요약
        const summary = await db_connection.execute(`
          SELECT 
            COUNT(DISTINCT s.id) as total_stores,
            COUNT(DISTINCT uc.id) as total_downloads,
            SUM(CASE WHEN uc.status = 'used' THEN 1 ELSE 0 END) as total_usages,
            ROUND(AVG(CAST(s.rating AS DECIMAL(3,2))), 2) as avg_rating
          FROM stores s
          LEFT JOIN coupons c ON c.storeId = s.id
          LEFT JOIN user_coupons uc ON uc.couponId = c.id
          WHERE s.is_active = true
        `);
        
        return {
          rankings: (rankings as any)[0],
          categoryLeaders: (categoryLeaders as any)[0],
          summary: (summary as any)[0][0],
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
              s.ratingCount,
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
            LEFT JOIN coupons c ON c.storeId = s.id
            LEFT JOIN user_coupons uc ON uc.couponId = c.id
            WHERE s.is_active = true
            GROUP BY s.id, s.name, s.category, s.rating, s.ratingCount
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
            s.ratingCount,
            COUNT(DISTINCT uc.id) as download_count,
            SUM(CASE WHEN uc.status = 'used' THEN 1 ELSE 0 END) as usage_count
          FROM stores s
          LEFT JOIN coupons c ON c.storeId = s.id
          LEFT JOIN user_coupons uc ON uc.couponId = c.id
          WHERE s.is_active = true 
            AND s.category = (SELECT category FROM stores WHERE id = ${input.storeId})
            AND s.id != ${input.storeId}
          GROUP BY s.id, s.name, s.rating, s.ratingCount
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
            uc.downloadedAt,
            uc.status,
            uc.couponCode
          FROM user_coupons uc
          JOIN users u ON u.id = uc.userId
          JOIN coupons c ON c.id = uc.couponId
          WHERE c.storeId = ${input.storeId}
          ORDER BY uc.downloadedAt DESC
          LIMIT 100
        `);
        
        // 쿠폰 사용 내역 (user_coupons 테이블에서 status='used'인 것 조회)
        const usages = await db_connection.execute(`
          SELECT 
            u.name as userName,
            u.email as userEmail,
            c.title as couponTitle,
            c.discountType,
            c.discountValue,
            uc.usedAt,
            uc.couponCode
          FROM user_coupons uc
          JOIN users u ON u.id = uc.userId
          JOIN coupons c ON c.id = uc.couponId
          WHERE c.storeId = ${input.storeId} AND uc.status = 'used'
          ORDER BY uc.usedAt DESC
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
                WHERE c.storeId = s.id
              ) as totalIssued,
              (
                SELECT COUNT(*)
                FROM coupons c
                WHERE c.storeId = s.id
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

  // 알림 관련 API
  notifications: router({
    // 읽지 않은 알림 개수 조회
    getUnreadCount: protectedProcedure
      .query(async ({ ctx }) => {
        const db_connection = await db.getDb();
        if (!db_connection) throw new Error('Database connection failed');
        
        // localStorage 기반으로 마지막 확인 시간 이후 신규 쿠폰 개수 조회
        // 클라이언트에서 lastCheckedAt을 localStorage에 저장하고 있음
        const result = await db_connection.execute(
          `SELECT COUNT(*) as count
           FROM coupons
           WHERE createdAt > DATE_SUB(NOW(), INTERVAL 24 HOUR)
             AND is_active = true`
        );
        
        const count = (result as any)[0][0]?.count || 0;
        return count;
      }),

    // 알림 읽음 처리 (클라이언트에서 localStorage 업데이트)
    markAsRead: protectedProcedure
      .mutation(async ({ ctx }) => {
        // 클라이언트에서 localStorage에 현재 시간 저장
        return { success: true };
      }),
  }),
});

export type AppRouter = typeof appRouter;
