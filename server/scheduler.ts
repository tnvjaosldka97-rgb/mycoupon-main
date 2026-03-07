import cron from "node-cron";
import { getDb } from "./db";
import { users, coupons, userCoupons, stores } from "../drizzle/schema";
import { sendEmail, getNewCouponEmailTemplate, getExpiryReminderEmailTemplate } from "./email";
import { eq, and, gte, lte } from "drizzle-orm";

// ────────────────────────────────────────────────────────────
// 헬퍼: 현재 UTC / KST 시각 로그
// ────────────────────────────────────────────────────────────
function logJobStart(jobName: string) {
  const nowUtc = new Date();
  const kstOffset = 9 * 60 * 60 * 1000; // UTC+9
  const nowKst = new Date(nowUtc.getTime() + kstOffset);
  console.log(`\n${"=".repeat(60)}`);
  console.log(`🔔 [JOB START] ${jobName}`);
  console.log(`   UTC : ${nowUtc.toISOString()}`);
  console.log(`   KST : ${nowKst.toISOString().replace("T", " ").replace("Z", "")} (Asia/Seoul)`);
  console.log(`${"=".repeat(60)}`);
}

// ────────────────────────────────────────────────────────────
// Job 1: 신규 쿠폰 알림 (매일 09:00 KST = 00:00 UTC)
// ────────────────────────────────────────────────────────────

/**
 * 신규 쿠폰 알림 실제 로직 (스케줄러/수동 실행 공통 사용)
 * @param testEmail 지정 시 해당 이메일에만 발송 (테스트 모드)
 */
export async function runNewCouponJob(options?: { testEmail?: string }) {
  logJobStart("신규 쿠폰 알림");

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
    console.log("✅ 신규 쿠폰 없음 — 발송 생략");
    return;
  }
  console.log(`📦 신규 쿠폰 ${newCoupons.length}개 발견`);

  // 알림 수신 사용자 조회
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

  // 테스트 모드: 지정 이메일만 발송
  const targetUsers = options?.testEmail
    ? notificationUsers.filter(u => u.email === options.testEmail)
    : notificationUsers;

  if (options?.testEmail) {
    console.log(`🧪 [TEST MODE] 대상: ${options.testEmail}`);
  }
  console.log(`👥 알림 대상 사용자 ${targetUsers.length}명`);

  let sentCount = 0;
  for (const user of targetUsers) {
    if (!user.email) continue;

    const relevantCoupons = user.preferredDistrict
      ? newCoupons.filter((c: any) => c.district === user.preferredDistrict)
      : newCoupons;

    if (relevantCoupons.length === 0) continue;

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
      sentCount++;
    }
  }

  console.log(`✅ 신규 쿠폰 알림 발송 완료 (${sentCount}건 발송)`);
}

/**
 * 스케줄 등록: 매일 00:00 UTC = 09:00 KST
 * cron: "0 0 * * *" (UTC 기준)
 */
export function startNewCouponNotificationScheduler() {
  // 09:00 KST = 00:00 UTC  →  "0 0 * * *" UTC 기준 (timezone 옵션 없음)
  cron.schedule("0 0 * * *", () => runNewCouponJob());
  console.log("✅ 신규 쿠폰 알림 스케줄러 등록 완료 [00:00 UTC = 09:00 KST]");
}

// ────────────────────────────────────────────────────────────
// Job 2: 마감 임박 알림 (매일 10:00 KST = 01:00 UTC)
// ────────────────────────────────────────────────────────────

/**
 * 마감 임박 알림 실제 로직 (스케줄러/수동 실행 공통 사용)
 * @param testEmail 지정 시 해당 이메일에만 발송 (테스트 모드)
 */
export async function runExpiryReminderJob(options?: { testEmail?: string }) {
  logJobStart("마감 임박 쿠폰 알림");

  const db = await getDb();
  if (!db) {
    console.error("❌ 데이터베이스 연결 실패");
    return;
  }

  const now = new Date();
  const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);

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
    console.log("✅ 마감 임박 쿠폰 없음 — 발송 생략");
    return;
  }
  console.log(`⏰ 마감 임박 쿠폰 ${expiringCoupons.length}개 발견`);

  // 사용자별 그룹화
  type CouponItem = { storeName: string; couponTitle: string; expiresAt: string; couponCode: string; userCouponId: number };
  const couponsByUser: Record<number, { userName: string; userEmail: string; coupons: CouponItem[] }> = {};

  for (const coupon of expiringCoupons) {
    if (!coupon.userEmail) continue;
    // 테스트 모드 필터
    if (options?.testEmail && coupon.userEmail !== options.testEmail) continue;

    if (!couponsByUser[coupon.userId]) {
      couponsByUser[coupon.userId] = {
        userName: coupon.userName || "고객",
        userEmail: coupon.userEmail,
        coupons: [],
      };
    }
    couponsByUser[coupon.userId].coupons.push({
      storeName: coupon.storeName,
      couponTitle: coupon.couponTitle,
      expiresAt: new Date(coupon.expiresAt).toLocaleString("ko-KR"),
      couponCode: coupon.couponCode,
      userCouponId: coupon.userCouponId,
    });
  }

  if (options?.testEmail) {
    console.log(`🧪 [TEST MODE] 대상: ${options.testEmail}`);
  }

  let sentCount = 0;
  for (const [userIdStr, userData] of Object.entries(couponsByUser)) {
    const userId = parseInt(userIdStr);
    const emailHtml = getExpiryReminderEmailTemplate({
      userName: userData.userName,
      coupons: userData.coupons,
      myCouponsUrl: `${process.env.VITE_APP_URL || "https://my-coupon-bridge.com"}/my-coupons`,
    });

    const success = await sendEmail({
      userId,
      email: userData.userEmail,
      subject: `⏰ 쿠폰이 곧 만료됩니다! (${userData.coupons.length}개)`,
      html: emailHtml,
      type: "expiry_reminder",
    });

    if (success) {
      for (const coupon of userData.coupons) {
        await db
          .update(userCoupons)
          .set({ expiryNotificationSent: true })
          .where(eq(userCoupons.id, coupon.userCouponId));
      }
      sentCount++;
    }
  }

  console.log(`✅ 마감 임박 알림 발송 완료 (${sentCount}명에게 발송)`);
}

/**
 * 스케줄 등록: 매일 01:00 UTC = 10:00 KST
 * cron: "0 1 * * *" (UTC 기준)
 */
export function startExpiryReminderScheduler() {
  // 10:00 KST = 01:00 UTC  →  "0 1 * * *" UTC 기준 (timezone 옵션 없음)
  cron.schedule("0 1 * * *", () => runExpiryReminderJob());
  console.log("✅ 마감 임박 알림 스케줄러 등록 완료 [01:00 UTC = 10:00 KST]");
}

// ────────────────────────────────────────────────────────────
// Job 3: 오래된 데이터 정리 (매월 1일 03:00 UTC)
// ────────────────────────────────────────────────────────────
export function startOldDataCleanupScheduler() {
  cron.schedule("0 3 1 * *", async () => {
    logJobStart("오래된 데이터 정리");
    try {
      const db = await getDb();
      if (!db) { console.error("❌ DB 연결 실패"); return; }

      const oneYearAgo = new Date();
      oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);

      await db
        .delete(userCoupons)
        .where(and(eq(userCoupons.status, "used"), lte(userCoupons.usedAt!, oneYearAgo)));

      console.log(`✅ 1년 이상 된 사용 완료 쿠폰 정리 (기준: ${oneYearAgo.toISOString()})`);
    } catch (error) {
      console.error("❌ 데이터 정리 오류:", error);
    }
  });
  console.log("✅ 오래된 데이터 정리 스케줄러 등록 완료 [03:00 UTC 매월 1일]");
}

// ────────────────────────────────────────────────────────────
// Job 4: 쿠폰 일 소비수량 KST 자정 리셋
// 00:00 KST = 15:00 UTC (전날)  →  cron "0 15 * * *"
// (기존 "0 0 * * *" = 09:00 KST 리셋이어서 KST 기준 자정 리셋 아님 → 수정)
// ────────────────────────────────────────────────────────────
export function startDailyLimitResetScheduler() {
  cron.schedule("0 15 * * *", async () => {
    const nowUtc = new Date();
    logJobStart("일 소비수량 리셋 (KST 자정)");
    try {
      const db = await getDb();
      if (!db) { console.error("❌ DB 연결 실패"); return; }

      await db
        .update(coupons)
        .set({ dailyUsedCount: 0, lastResetDate: nowUtc })
        .where(eq(coupons.isActive, true));

      console.log(`✅ 일 소비수량 리셋 완료 (UTC: ${nowUtc.toISOString()} = KST 00:00)`);
    } catch (error) {
      console.error("❌ 일 소비수량 리셋 오류:", error);
    }
  });
  console.log("✅ 일 소비수량 리셋 스케줄러 등록 완료 [15:00 UTC = 00:00 KST]");
}

// ────────────────────────────────────────────────────────────
// Job 5: 만료된 user_plans is_active → FALSE (매시간)
// - 쿼리타임 처리(expires_at > NOW())만으로는 DB 행이 계속 is_active=true로 남아
//   orphaned row 누적 및 잠재적 정합성 문제 발생
// - 실제 비즈니스 등급은 쿼리타임에 이미 FREE로 처리되므로 UX 영향 없음
// ────────────────────────────────────────────────────────────
export function startTierExpiryCleanupScheduler() {
  cron.schedule("0 * * * *", async () => {
    try {
      const dbConn = await getDb();
      if (!dbConn) return;

      // 1) 만료 대상 user_id 선취득 — 재정렬 대상 파악
      const expiredUsersResult = await dbConn.execute(
        `SELECT DISTINCT user_id FROM user_plans
         WHERE is_active = TRUE
           AND expires_at IS NOT NULL
           AND expires_at < NOW()`
      );
      const expiredUserIds: number[] = ((expiredUsersResult as any)?.rows ?? [])
        .map((r: any) => Number(r.user_id));

      if (expiredUserIds.length === 0) return;

      // 2) user_plans is_active → FALSE
      const result = await dbConn.execute(
        `UPDATE user_plans
         SET is_active = FALSE, updated_at = NOW()
         WHERE is_active = TRUE
           AND expires_at IS NOT NULL
           AND expires_at < NOW()`
      );
      const count = (result as any)?.rowCount ?? 0;

      console.log(JSON.stringify({
        action: 'tier_expiry_cleanup',
        deactivated: count,
        affectedUsers: expiredUserIds.length,
        timestamp: new Date().toISOString(),
      }));

      // 3) 만료된 각 유저의 쿠폰 재정렬
      // - 체험 종료 유저(non_trial_free): effectiveQuota=0 → 전체 비활성화
      // - 체험 활성 유저(edge case): effectiveQuota=10 → 10개 이내 유지
      const { reclaimCouponsToFreeTier, isTrialUsed, PLAN_POLICY } = await import('./db');

      // trial_ends_at 배치 조회 (N+1 방지)
      const trialBatchResult = await dbConn.execute(
        `SELECT id, trial_ends_at FROM users WHERE id = ANY(ARRAY[${expiredUserIds.join(',')}]::int[])`
      );
      const trialMap: Record<number, Date | null> = {};
      for (const row of ((trialBatchResult as any)?.rows ?? [])) {
        trialMap[Number(row.id)] = row.trial_ends_at ? new Date(row.trial_ends_at) : null;
      }

      let totalReclaimed = 0;
      for (const userId of expiredUserIds) {
        const trialUsed = isTrialUsed(trialMap[userId]);
        const effectiveQuota = trialUsed
          ? PLAN_POLICY.NON_TRIAL_COUPON_QUOTA  // 0
          : PLAN_POLICY.FREE_MAX_ACTIVE_COUPONS; // 10 (edge case)
        const r = await reclaimCouponsToFreeTier(userId, effectiveQuota);
        totalReclaimed += r.deactivated;
      }
      if (totalReclaimed > 0) {
        console.log(JSON.stringify({
          action: 'coupon_reclaim_batch',
          totalReclaimed,
          affectedUsers: expiredUserIds.length,
          timestamp: new Date().toISOString(),
        }));
      }
    } catch (error) {
      console.error("❌ tier 만료 정리 오류:", error);
    }
  });
  console.log("✅ tier 만료 정리 스케줄러 등록 완료 [매시간 정각]");
}

// ────────────────────────────────────────────────────────────
// Job 6: user_coupons 만료 자동 전환 (30분마다)
//
// 문제:
//   user_coupons.status는 다운로드 시 'active'로 저장된다.
//   expires_at이 지났어도 상태는 'active'로 남아있어 DB 정합성 훼손.
//   checkUserCoupon / checkDeviceCoupon은 이미 expiresAt > now 조건으로 올바르게 처리하지만,
//   status 컬럼이 'active'로 남으면 analytics/admin 쿼리에서 오탐 발생.
//
// 해결:
//   30분마다 expires_at < NOW() AND status = 'active' 행을 status = 'expired'로 일괄 전환.
// ────────────────────────────────────────────────────────────
export function startUserCouponExpiryScheduler() {
  cron.schedule("*/30 * * * *", async () => {
    try {
      const dbConn = await getDb();
      if (!dbConn) return;

      const result = await dbConn.execute(
        `UPDATE user_coupons
         SET status = 'expired'
         WHERE status = 'active'
           AND expires_at < NOW()`
      );
      const count = (result as any)?.rowCount ?? 0;
      if (count > 0) {
        console.log(JSON.stringify({
          action: 'user_coupon_expiry_batch',
          expired: count,
          timestamp: new Date().toISOString(),
        }));
      }
    } catch (error) {
      console.error("❌ user_coupon 만료 전환 오류:", error);
    }
  });
  console.log("✅ user_coupon 만료 전환 스케줄러 등록 완료 [매 30분]");
}

// ────────────────────────────────────────────────────────────
// 모든 스케줄러 시작
// ────────────────────────────────────────────────────────────
export function startAllSchedulers() {
  startNewCouponNotificationScheduler();   // 00:00 UTC = 09:00 KST
  startExpiryReminderScheduler();          // 01:00 UTC = 10:00 KST
  startOldDataCleanupScheduler();          // 03:00 UTC 매월 1일
  startDailyLimitResetScheduler();         // 15:00 UTC = 00:00 KST (자정 리셋)
  startTierExpiryCleanupScheduler();       // 매시간 — 만료 플랜 is_active=false
  startUserCouponExpiryScheduler();        // 매 30분 — user_coupon status=expired 자동 전환
  console.log("\n✅ 모든 스케줄러 시작됨");
  console.log("   신규쿠폰:    00:00 UTC = 09:00 KST");
  console.log("   마감임박:    01:00 UTC = 10:00 KST");
  console.log("   일소비리셋:  15:00 UTC = 00:00 KST");
  console.log("   tier만료:    매시간 정각");
  console.log("   유저쿠폰만료: 매 30분");
}

// 수동 실행은 server/jobs/runJob.ts 참고
// JOB=new-coupon pnpm tsx server/jobs/runJob.ts
