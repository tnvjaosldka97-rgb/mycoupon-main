import cron from "node-cron";
import { getDb } from "./db";
import { users, coupons, userCoupons, stores } from "../drizzle/schema";
import { sendEmail, getNewCouponEmailTemplate, getExpiryReminderEmailTemplate } from "./email";
import { eq, and, gte, lte, isNull } from "drizzle-orm";

/**
 * 신규 쿠폰 알림 스케줄러
 * 매일 오전 9시에 실행
 * 최근 24시간 내 등록된 쿠폰을 사용자에게 알림
 */
export function startNewCouponNotificationScheduler() {
  // 매일 오전 9시 실행 (0 9 * * *)
  cron.schedule("0 9 * * *", async () => {
    console.log("🔔 신규 쿠폰 알림 스케줄러 시작...");

    try {
      // 최근 24시간 내 등록된 쿠폰 조회
      const db = await getDb();
      if (!db) {
        console.error("❌ 데이터베이스 연결 실패");
        return;
      }

      const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const newCoupons = await db
        .select({
          couponId: coupons.id,
          couponTitle: coupons.title,
          discountType: coupons.discountType,
          discountValue: coupons.discountValue,
          endDate: coupons.endDate,
          storeId: coupons.storeId,
          storeName: stores.name,
          district: stores.district,
        })
        .from(coupons)
        .innerJoin(stores, eq(coupons.storeId, stores.id))
        .where(
          and(
            gte(coupons.createdAt, yesterday),
            eq(coupons.isActive, true)
          )
        );

      if (newCoupons.length === 0) {
        console.log("✅ 신규 쿠폰 없음");
        return;
      }

      console.log(`📦 신규 쿠폰 ${newCoupons.length}개 발견`);

      // 알림 수신 설정한 사용자 조회
      const notificationUsers = await db
        .select({
          id: users.id,
          name: users.name,
          email: users.email,
          preferredDistrict: users.preferredDistrict,
        })
        .from(users)
        .where(
          and(
            eq(users.emailNotificationsEnabled, true),
            eq(users.newCouponNotifications, true)
          )
        );

      console.log(`👥 알림 수신 사용자 ${notificationUsers.length}명`);

      // 각 사용자에게 선호 지역 쿠폰 알림 발송
      for (const user of notificationUsers) {
        if (!user.email) continue;

        // 사용자 선호 지역에 해당하는 쿠폰 필터링
        const relevantCoupons = user.preferredDistrict
          ? newCoupons.filter((c: any) => c.district === user.preferredDistrict)
          : newCoupons;

        if (relevantCoupons.length === 0) continue;

        // 각 쿠폰에 대해 이메일 발송
        for (const coupon of relevantCoupons) {
          const discountText =
            coupon.discountType === "percentage"
              ? `${coupon.discountValue}% 할인`
              : coupon.discountType === "fixed"
              ? `${coupon.discountValue.toLocaleString()}원 할인`
              : "무료 증정";

          const emailHtml = getNewCouponEmailTemplate({
            userName: user.name || "고객",
            storeName: coupon.storeName,
            couponTitle: coupon.couponTitle,
            discountValue: discountText,
            endDate: new Date(coupon.endDate).toLocaleDateString("ko-KR"),
            couponUrl: `${process.env.VITE_APP_URL || "https://my-coupon-bridge.com"}/map`,
          });

          await sendEmail({
            userId: user.id,
            email: user.email,
            subject: `🎉 ${coupon.storeName}에 새로운 쿠폰이 등록되었어요!`,
            html: emailHtml,
            type: "new_coupon",
          });
        }
      }

      console.log("✅ 신규 쿠폰 알림 발송 완료");
    } catch (error) {
      console.error("❌ 신규 쿠폰 알림 스케줄러 오류:", error);
    }
  });

  console.log("✅ 신규 쿠폰 알림 스케줄러 등록 완료 (매일 오전 9시)");
}

/**
 * 마감 임박 쿠폰 알림 스케줄러
 * 매일 오전 10시에 실행
 * 24시간 내 만료되는 쿠폰을 사용자에게 알림
 */
export function startExpiryReminderScheduler() {
  // 매일 오전 10시 실행 (0 10 * * *)
  cron.schedule("0 10 * * *", async () => {
    console.log("🔔 마감 임박 쿠폰 알림 스케줄러 시작...");

    try {
      const db = await getDb();
      if (!db) {
        console.error("❌ 데이터베이스 연결 실패");
        return;
      }

      const now = new Date();
      const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);

      // 24시간 내 만료되는 쿠폰 조회 (알림 미발송 건만)
      const expiringCoupons = await db
        .select({
          userCouponId: userCoupons.id,
          userId: userCoupons.userId,
          couponCode: userCoupons.couponCode,
          expiresAt: userCoupons.expiresAt,
          couponTitle: coupons.title,
          storeName: stores.name,
          userName: users.name,
          userEmail: users.email,
        })
        .from(userCoupons)
        .innerJoin(coupons, eq(userCoupons.couponId, coupons.id))
        .innerJoin(stores, eq(coupons.storeId, stores.id))
        .innerJoin(users, eq(userCoupons.userId, users.id))
        .where(
          and(
            eq(userCoupons.status, "active"),
            lte(userCoupons.expiresAt, tomorrow),
            gte(userCoupons.expiresAt, now),
            eq(userCoupons.expiryNotificationSent, false),
            eq(users.emailNotificationsEnabled, true),
            eq(users.expiryNotifications, true)
          )
        );

      if (expiringCoupons.length === 0) {
        console.log("✅ 마감 임박 쿠폰 없음");
        return;
      }

      console.log(`⏰ 마감 임박 쿠폰 ${expiringCoupons.length}개 발견`);

      // 사용자별로 그룹화
      const couponsByUser = expiringCoupons.reduce((acc: any, coupon: any) => {
        if (!acc[coupon.userId]) {
          acc[coupon.userId] = {
            userName: coupon.userName || "고객",
            userEmail: coupon.userEmail!,
            coupons: [],
          };
        }
        acc[coupon.userId].coupons.push({
          storeName: coupon.storeName,
          couponTitle: coupon.couponTitle,
          expiresAt: new Date(coupon.expiresAt).toLocaleString("ko-KR"),
          couponCode: coupon.couponCode,
          userCouponId: coupon.userCouponId,
        });
        return acc;
      }, {} as Record<number, { userName: string; userEmail: string; coupons: Array<{ storeName: string; couponTitle: string; expiresAt: string; couponCode: string; userCouponId: number }> }>);

      // 각 사용자에게 이메일 발송
      for (const [userIdStr, userData] of Object.entries(couponsByUser)) {
        const userId = parseInt(userIdStr);
        const data = userData as { userName: string; userEmail: string; coupons: Array<{ storeName: string; couponTitle: string; expiresAt: string; couponCode: string; userCouponId: number }> };
        const emailHtml = getExpiryReminderEmailTemplate({
          userName: data.userName,
          coupons: data.coupons,
          myCouponsUrl: `${process.env.VITE_APP_URL || "https://my-coupon-bridge.com"}/my-coupons`,
        });

        const success = await sendEmail({
          userId: userId,
          email: data.userEmail,
          subject: `⏰ 쿠폰이 곧 만료됩니다! (${data.coupons.length}개)`,
          html: emailHtml,
          type: "expiry_reminder",
        });

        // 발송 성공 시 알림 플래그 업데이트
        if (success) {
          for (const coupon of data.coupons) {
            await db
              .update(userCoupons)
              .set({ expiryNotificationSent: true })
              .where(eq(userCoupons.id, coupon.userCouponId));
          }
        }
      }

      console.log("✅ 마감 임박 쿠폰 알림 발송 완료");
    } catch (error) {
      console.error("❌ 마감 임박 쿠폰 알림 스케줄러 오류:", error);
    }
  });

  console.log("✅ 마감 임박 쿠폰 알림 스케줄러 등록 완료 (매일 오전 10시)");
}

/**
 * 오래된 쿠폰 사용 데이터 정리 스케줄러
 * 매월 1일 새벽 3시에 실행
 * 1년 이상 된 coupon_usage, user_coupons (사용 완료) 데이터 삭제
 */
export function startOldDataCleanupScheduler() {
  // 매월 1일 새벽 3시 실행 (0 3 1 * *)
  cron.schedule("0 3 1 * *", async () => {
    console.log("🗑️ 오래된 데이터 정리 스케줄러 시작...");

    try {
      const db = await getDb();
      if (!db) {
        console.error("❌ 데이터베이스 연결 실패");
        return;
      }

      const oneYearAgo = new Date();
      oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);

      // 1년 이상 된 사용 완료된 쿠폰 삭제
      const deletedUserCoupons = await db
        .delete(userCoupons)
        .where(
          and(
            eq(userCoupons.status, 'used'),
            lte(userCoupons.usedAt, oneYearAgo)
          )
        );

      console.log(`✅ 1년 이상 된 사용 완료 쿠폰 ${deletedUserCoupons} 개 삭제 완료`);
      console.log(`📊 정리 기준: ${oneYearAgo.toISOString()}`);
    } catch (error) {
      console.error("❌ 데이터 정리 스케줄러 오류:", error);
    }
  });

  console.log("✅ 오래된 데이터 정리 스케줄러 등록 완료 (매월 1일 새벽 3시)");
}

/**
 * 쿠폰 일 소비수량 자정 리셋 스케줄러
 * 매일 00:00에 실행
 * 모든 쿠폰의 dailyUsedCount를 0으로 리셋
 */
export function startDailyLimitResetScheduler() {
  // 매일 자정 실행 (0 0 * * *)
  cron.schedule("0 0 * * *", async () => {
    console.log("🔄 일 소비수량 리셋 스케줄러 시작...");

    try {
      const db = await getDb();
      if (!db) {
        console.error("❌ 데이터베이스 연결 실패");
        return;
      }

      // 모든 활성 쿠폰의 dailyUsedCount를 0으로 리셋
      const result = await db
        .update(coupons)
        .set({ 
          dailyUsedCount: 0,
          lastResetDate: new Date()
        })
        .where(eq(coupons.isActive, true));

      console.log(`✅ 일 소비수량 리셋 완료 (모든 활성 쿠폰)`);
      console.log(`📊 리셋 시간: ${new Date().toISOString()}`);
    } catch (error) {
      console.error("❌ 일 소비수량 리셋 오류:", error);
    }
  });

  console.log("✅ 일 소비수량 리셋 스케줄러 등록 완료 (매일 자정)");
}

/**
 * 모든 스케줄러 시작
 */
export function startAllSchedulers() {
  startNewCouponNotificationScheduler();
  startExpiryReminderScheduler();
  startOldDataCleanupScheduler();
  startDailyLimitResetScheduler(); // ✅ 일 소비수량 리셋 추가
  console.log("✅ 모든 스케줄러 시작됨 (이메일 알림 + 데이터 정리 + 일 소비수량 리셋)");
}
