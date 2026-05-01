import cron from "node-cron";
import { getDb, insertCouponEvent, createNotification, sendRealPush, insertAuditLog } from "./db";
import { users, coupons, userCoupons, stores, notificationSendLogs, jobRuns, notificationPendingQueue } from "../drizzle/schema";
import {
  sendEmail,
  getNewCouponEmailTemplate,
  getExpiryReminderEmailTemplate,
  sendCouponReminderEmail,
  sendPlanExpiryReminderEmail,
} from "./email";
import { eq, and, gte, lte, sql as drizzleSql, isNull } from "drizzle-orm";
import { notify } from "./_core/notify";
import { makeAdEmailSubject } from "./notificationPolicy";

// ── KST 기준 날짜 문자열 (YYYY-MM-DD) 생성 ─────────────────────────────────
function getTodayKST(): string {
  const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
  const kstNow = new Date(Date.now() + KST_OFFSET_MS);
  return kstNow.toISOString().slice(0, 10); // "YYYY-MM-DD"
}

/**
 * tryAcquireJobLock — DB 기반 Job Lock (멀티 인스턴스 중복 실행 방어)
 * UNIQUE(job_name, run_date) INSERT로 선착순 1 인스턴스만 통과.
 * true  = 락 획득 성공 → 실행 진행
 * false = 이미 다른 인스턴스가 실행 중/완료 → 즉시 skip
 */
async function tryAcquireJobLock(jobName: string, runDate: string): Promise<boolean> {
  const db = await getDb();
  if (!db) {
    console.warn(`[job-lock] DB 없음, 락 없이 진행: ${jobName} ${runDate}`);
    return true; // DB 없으면 일단 실행 허용 (기존 dedup이 방어)
  }
  // QA-H7 (PR-19): DB 일시 장애 시 retry — 영구 실패만 bypass
  // 이전: 첫 시도 실패 → 즉시 bypass → 멀티 인스턴스 환경에서 중복 실행 위험 노출
  // 이후: 최대 3회 재시도 (1초/2초 backoff) → 실패 시에만 bypass + FATAL 로그
  const MAX_RETRIES = 3;
  for (let i = 0; i < MAX_RETRIES; i++) {
    try {
      const result = await db.insert(jobRuns)
        .values({ jobName, runDate })
        .onConflictDoNothing();
      const acquired = ((result as any)?.rowCount ?? 0) > 0;
      const tag = i > 0 ? ` (retry=${i})` : '';
      if (acquired) {
        console.log(`[job-lock] acquired ${jobName} ${runDate}${tag}`);
      } else {
        console.log(`[job-lock] skip (already ran) ${jobName} ${runDate}${tag}`);
      }
      return acquired;
    } catch (e) {
      if (i < MAX_RETRIES - 1) {
        console.warn(`[job-lock] DB error retry ${i + 1}/${MAX_RETRIES}: ${jobName} ${runDate}`, e);
        await new Promise(r => setTimeout(r, 1000 * (i + 1)));
        continue;
      }
      // 영구 실패: 락 없이 진행 (기존 dedup이 방어). FATAL 로그로 모니터링 알림 가능.
      console.error(`[job-lock] FATAL — DB error after ${MAX_RETRIES} retries (proceeding without lock): ${jobName} ${runDate}`, e);
      return true;
    }
  }
  return true; // unreachable
}

// ── favoriteFoodTop3(음식명) → store.category enum 매핑 ──────────────────────
// 완전 일치(string match) 기반. 추가 음식명은 여기에만 추가하면 됨.
const FOOD_TO_CATEGORY: Record<string, string> = {
  // cafe
  "커피":          "cafe",
  "카페/음료":      "cafe",
  "디저트/케이크":  "cafe",
  // restaurant
  "제육볶음":       "restaurant",
  "돈까스":        "restaurant",
  "백반":          "restaurant",
  "햄버거":        "restaurant",
  "치킨":          "restaurant",
  "피자":          "restaurant",
  "국밥":          "restaurant",
  "초밥/일식":      "restaurant",
  "라멘":          "restaurant",
  "분식":          "restaurant",
  "파스타":        "restaurant",
  "샌드위치":       "restaurant",
  "쌀국수/베트남":  "restaurant",
  "마라탕":        "restaurant",
  "순대국":        "restaurant",
  "냉면":          "restaurant",
  "삼겹살/고기":    "restaurant",
  "짜장면/중식":    "restaurant",
  "닭발/포차":      "restaurant",
};

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

  // Job Lock: 같은 날 멀티 인스턴스 중복 실행 방지 (테스트 모드는 락 우회)
  if (!options?.testEmail) {
    if (!(await tryAcquireJobLock("new_coupon_daily", getTodayKST()))) return;
  }

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
      storeCategory: stores.category,   // food_recommendation 매칭용
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

  // 알림 수신 사용자 조회 (favoriteFoodTop3 포함)
  const notificationUsers = await db
    .select({
      id: users.id,
      name: users.name,
      email: users.email,
      preferredDistrict: users.preferredDistrict,
      favoriteFoodTop3: users.favoriteFoodTop3,  // food_recommendation 매칭용
    })
    .from(users)
    .where(
      and(
        eq(users.emailNotificationsEnabled, true),
        eq(users.newCouponNotifications, true),
        eq(users.marketingAgreed, true),
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

  // ── 선호지역 신규쿠폰 이메일 (notification_send_logs dedup 적용) ─────────────
  let sentCount = 0;
  for (const user of targetUsers) {
    if (!user.email) continue;

    const relevantCoupons = user.preferredDistrict
      ? newCoupons.filter((c: any) => c.district === user.preferredDistrict)
      : newCoupons;

    if (relevantCoupons.length === 0) continue;

    for (const coupon of relevantCoupons) {
      // 중복방지: 발송 전 insert → UNIQUE 위반 시 멀티인스턴스 레이스 방어
      try {
        await db.insert(notificationSendLogs).values({
          userId: user.id,
          type: 'new_coupon',
          couponId: coupon.couponId,
        });
      } catch {
        console.log(`[new_coupon] dedup skip: userId=${user.id} couponId=${coupon.couponId}`);
        continue;
      }

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
        subject: makeAdEmailSubject(`🎉 ${coupon.storeName}에 새로운 쿠폰이 등록되었어요!`),
        html: emailHtml,
        type: "new_coupon",
      });

      // 2026-04-28: 선호 지역 매칭 시 푸시도 발송 (사장님 결정 — 푸시 연결).
      // - push_tokens 0건이면 sendRealPush 가 success/failure/invalid 0 으로 early return (silent skip)
      // - notificationSendLogs UNIQUE (user, type, coupon) 가 이미 dedup 보장
      // - try-catch 로 push 실패가 본 cron 전체 fail 로 전파되지 않음
      try {
        const pushResult = await sendRealPush({
          userId: user.id,
          type: 'new_coupon',
          title: `🎁 ${coupon.storeName}`,
          message: `${coupon.couponTitle} 새 쿠폰이 등록되었어요!`,
          targetUrl: `${process.env.VITE_APP_URL || "https://my-coupon-bridge.com"}/map`,
        });
        if (pushResult.success > 0) {
          console.log(`[new_coupon:push] userId=${user.id} couponId=${coupon.couponId} success=${pushResult.success}`);
        }
      } catch (e) {
        console.warn(`[new_coupon:push] userId=${user.id} couponId=${coupon.couponId} error:`, e);
      }

      sentCount++;
    }
  }

  console.log(`✅ 신규 쿠폰 알림 발송 완료 (${sentCount}건 발송)`);

  // ── [P2-3-2] favoriteFoodTop3 취향저격 추천 이메일 ────────────────────────
  // ※ 선호지역(targetUsers)과 완전 독립: notificationUsers 전체에서 top3 보유자만 대상
  // ※ 위치/선호지역 무관, notification_send_logs(food_recommendation) 중복방지
  const foodUsers = notificationUsers.filter(u => u.email && u.favoriteFoodTop3);

  let foodSentCount = 0;
  for (const user of foodUsers) {
    // favoriteFoodTop3 normalize: null/"[]"/"" 모두 처리
    let foodPicks: string[] = [];
    try {
      const raw = user.favoriteFoodTop3 as string;
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) {
        foodPicks = parsed.filter((f: unknown) => typeof f === 'string' && f.trim());
      }
    } catch { continue; }
    if (foodPicks.length === 0) continue;

    // 음식명 → store.category 집합 (매핑 실패는 조용히 skip)
    const preferredCategories = new Set(
      foodPicks.map(f => FOOD_TO_CATEGORY[f]).filter((v): v is string => !!v)
    );
    if (preferredCategories.size === 0) continue;

    const matchedCoupons = newCoupons.filter(
      c => preferredCategories.has(c.storeCategory as string)
    );
    if (matchedCoupons.length === 0) continue;

    for (const coupon of matchedCoupons) {
      // 발송 전 insert → UNIQUE 위반 시 멀티인스턴스/재실행 방어
      try {
        await db.insert(notificationSendLogs).values({
          userId: user.id,
          type: 'food_recommendation',
          couponId: coupon.couponId,
        });
      } catch {
        console.log(`[food_recommendation] dedup skip: userId=${user.id} couponId=${coupon.couponId}`);
        continue;
      }

      const discountText =
        coupon.discountType === "percentage" ? `${coupon.discountValue}% 할인`
        : coupon.discountType === "fixed"    ? `${coupon.discountValue.toLocaleString()}원 할인`
        : "무료 증정";

      const emailHtml = getNewCouponEmailTemplate({
        userName: user.name || "고객",
        storeName: coupon.storeName,
        couponTitle: `[취향저격 추천] ${coupon.couponTitle}`,
        discountValue: discountText,
        endDate: new Date(coupon.endDate).toLocaleDateString("ko-KR"),
        couponUrl: `${process.env.VITE_APP_URL || "https://my-coupon-bridge.com"}/map`,
      });

      await sendEmail({
        userId: user.id,
        email: user.email!,
        subject: makeAdEmailSubject(`🍽️ ${user.name || "고객"}님 취향저격 쿠폰이 등록되었어요!`),
        html: emailHtml,
        type: "new_coupon",
      });
      foodSentCount++;
    }
  }
  if (foodSentCount > 0) {
    console.log(`🍽️ 취향저격 추천 이메일 발송 완료 (${foodSentCount}건)`);
  }
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

  // Job Lock: 같은 날 멀티 인스턴스 중복 실행 방지 (테스트 모드는 락 우회)
  if (!options?.testEmail) {
    if (!(await tryAcquireJobLock("expiry_reminder_daily", getTodayKST()))) return;
  }

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

      // 1) 만료 대상 plan 선취득 — 재정렬 + audit log payload 용
      // 2026-04-28: tier 컬럼 함께 SELECT (audit log payload prevTier 매핑)
      const expiredPlansResult = await dbConn.execute(
        `SELECT id, user_id, tier, expires_at FROM user_plans
         WHERE is_active = TRUE
           AND expires_at IS NOT NULL
           AND expires_at < NOW()`
      );
      const expiredPlans: Array<{ id: number; user_id: number; tier: string; expires_at: Date | null }> =
        ((expiredPlansResult as any)?.rows ?? []).map((r: any) => ({
          id: Number(r.id),
          user_id: Number(r.user_id),
          tier: String(r.tier),
          expires_at: r.expires_at ? new Date(r.expires_at) : null,
        }));
      const expiredUserIds: number[] = Array.from(new Set(expiredPlans.map(p => p.user_id)));

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

      // 2-b) 2026-04-28: 자동 만료 audit log INSERT — read-only 로깅 (비즈니스 흐름 변경 0).
      //      AdminDashboard 의 plan history 모달에서 "무료 전환 (자동 만료)" 이력 표시용.
      //      adminId = 0 (system action — cron 자동 처리 표식)
      for (const plan of expiredPlans) {
        try {
          await insertAuditLog({
            adminId: 0,
            action: 'auto_plan_expired',
            targetType: 'user',
            targetId: plan.user_id,
            payload: {
              planId: plan.id,
              prevTier: plan.tier,
              expiredAt: plan.expires_at?.toISOString() ?? null,
              autoTriggered: true,
            },
          });
        } catch (e) {
          // 로깅 실패가 cron 전체를 깨지 않도록 catch — fire-and-forget 안전성
          console.warn(`[auto_plan_expired:audit] userId=${plan.user_id} planId=${plan.id} error:`, e);
        }
      }

      // 3) 만료된 각 유저의 쿠폰 재정렬
      // - 체험 종료 유저(non_trial_free): effectiveQuota=0 → 전체 비활성화
      // - 체험 활성 유저(edge case): effectiveQuota=10 → 10개 이내 유지
      const { reclaimCouponsToFreeTier, PLAN_POLICY } = await import('./db');

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
        // reclaim은 항상 FREE_MAX_ACTIVE_COUPONS(10) 기준
        // non_trial_free 제한(0/0)은 신규 생성/수정 차단에만 적용 — 기존 쿠폰 전체 삭제 금지
        // (cron quota=10 vs PR-28 setUserPlan FREE quota=0 정책 충돌 — followup_cron_reclaim_quota_policy.md 참조)
        const r = await reclaimCouponsToFreeTier(userId, PLAN_POLICY.FREE_MAX_ACTIVE_COUPONS);
        totalReclaimed += r.deactivated;
        // PR-28.1 (사장님 결정 2026-05-01): user_coupons.status 도 'expired' 동기화 (B scope)
        // 자연 만료 시 사용자 마이쿠폰 페이지 자력 감지 OK 지만:
        //   - expiry_reminder cron (line 382) 의 status='active' 필터 spam 차단
        //   - DB 정합성 (analytics 등 status 직접 참조 site 일관)
        // 가드: AND status='active' — 'used'/'expired' 쿠폰 영향 0
        // packOrders.ts setUserPlan FREE 분기와 동일 SQL
        // PR-28.1 hotfix (2026-05-01): user_coupons 에 updated_at 컬럼 없음 (information_schema raw 검증)
        // 제거: ", updated_at=NOW()" — schema 정합 (status 컬럼만 UPDATE)
        await dbConn.execute(
          `UPDATE user_coupons SET status='expired'
           WHERE coupon_id IN (
             SELECT c.id FROM coupons c
             INNER JOIN stores s ON c.store_id = s.id
             WHERE s.owner_id = ${userId}
           ) AND status='active'`
        );
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
// ────────────────────────────────────────────────────────────
// startUserCouponExpiryScheduler
//
// 만료 처리 + 미사용 만료 누적 집계 (환원 없음)
//
// 핵심 설계:
// - Step1: status='active' AND expires_at<NOW() → 'expired' (기존 그대로)
// - Step2: 방금 만료된 행 중 used_at IS NULL(미사용)을 merchantId별 집계
// - Step3: merchant_unused_expiry_stats에 UPSERT (totalUnusedExpired 누적)
// - remainingQuantity 변경 없음 (환원 금지)
// - 중복 방지: WHERE status='active' → 이미 'expired' 행은 재처리 불가
// ────────────────────────────────────────────────────────────
export function startUserCouponExpiryScheduler() {
  cron.schedule("*/30 * * * *", async () => {
    try {
      const dbConn = await getDb();
      if (!dbConn) return;

      // Step1: 만료 처리 + 방금 만료된 미사용 행의 merchantId별 집계 (단일 CTE)
      // - remainingQuantity 변경 없음
      // - used_at IS NULL = 미사용 (used = status='used'로 별도 처리됨)
      const expireResult = await dbConn.execute(`
        WITH just_expired AS (
          UPDATE user_coupons
          SET    status = 'expired'
          WHERE  status = 'active'
            AND  expires_at < NOW()
          RETURNING coupon_id, used_at, user_id
        )
        SELECT
          s.owner_id     AS merchant_id,
          c.store_id,
          COUNT(*)       AS unused_cnt
        FROM just_expired je
        JOIN coupons c ON c.id = je.coupon_id
        JOIN stores  s ON s.id = c.store_id
        WHERE je.used_at IS NULL
        GROUP BY s.owner_id, c.store_id
      `);

      const merchantRows = (expireResult as any)?.rows ?? [];
      const totalExpired = merchantRows.reduce((s: number, r: any) => s + Number(r.unused_cnt ?? 0), 0);

      if (totalExpired > 0) {
        console.log(JSON.stringify({
          action: 'user_coupon_expiry_batch',
          expired_unused: totalExpired,
          merchant_count: merchantRows.length,
          timestamp: new Date().toISOString(),
        }));

        // Step2: merchant_unused_expiry_stats에 누적 UPSERT
        // merchantId별 totalUnusedExpired += unused_cnt
        for (const row of merchantRows) {
          const merchantId = Number(row.merchant_id);
          const unusedCnt = Number(row.unused_cnt);
          await dbConn.execute(`
            INSERT INTO merchant_unused_expiry_stats
              (merchant_id, total_unused_expired, last_computed_at, updated_at)
            VALUES
              (${merchantId}::int, ${unusedCnt}::int, NOW(), NOW())
            ON CONFLICT (merchant_id) DO UPDATE
              SET total_unused_expired = merchant_unused_expiry_stats.total_unused_expired + ${unusedCnt}::int,
                  last_computed_at     = NOW(),
                  updated_at           = NOW()
          `);

          // Step3: [계측] coupon_events에 EXPIRE_UNUSED 이벤트 (per-merchant 집계, fire-and-forget)
          void insertCouponEvent({
            userId: null,
            couponId: -1,   // merchantId 집계 이벤트 (-1 = 특정 쿠폰 없음)
            storeId: Number(row.store_id),
            eventType: 'EXPIRE',
            meta: {
              merchantId,
              unusedCount: unusedCnt,
              batchAt: new Date().toISOString(),
            },
          });
        }
      }
    } catch (error) {
      console.error("❌ user_coupon 만료 집계 오류:", error);
    }
  });
  console.log("✅ user_coupon 만료+미사용 집계 스케줄러 등록 완료 [매 30분]");
}

// ────────────────────────────────────────────────────────────
// Job 7: 만료된 쿠폰 isActive 일괄 비활성화
// KST 자정(00:00 KST) 직후 = 15:05 UTC 실행
// endDate < NOW() AND isActive = TRUE 인 coupons 를 isActive=FALSE로 일괄 전환
// 이미 getMerchantCoupons / getActiveCoupons 에서 endDate 필터가 적용되므로
// 이 Job 은 DB 정합성 및 불필요한 쿼리 부하 감소 목적
// ────────────────────────────────────────────────────────────
export function startExpiredCouponDeactivationScheduler() {
  // 15:05 UTC = 00:05 KST (KST 자정 직후 5분 여유)
  cron.schedule("5 15 * * *", async () => {
    logJobStart("만료 쿠폰 isActive 일괄 비활성화");
    try {
      const dbConn = await getDb();
      if (!dbConn) { console.error("❌ DB 연결 실패"); return; }

      const result = await dbConn.execute(
        `UPDATE coupons
         SET    is_active  = FALSE,
                updated_at = NOW()
         WHERE  is_active  = TRUE
           AND  end_date   < NOW()`
      );
      const count = (result as any)?.rowCount ?? 0;
      console.log(JSON.stringify({
        action: 'expired_coupon_deactivation',
        deactivated: count,
        timestamp: new Date().toISOString(),
      }));
    } catch (error) {
      console.error("❌ 만료 쿠폰 비활성화 오류:", error);
    }
  });
  console.log("✅ 만료 쿠폰 비활성화 스케줄러 등록 완료 [15:05 UTC = 00:05 KST]");
}

// ────────────────────────────────────────────────────────────
// Job 8: 어뷰저 탐지 (매일 12:00 KST = 03:00 UTC)
// 매일 실행, 주간 스냅샷은 월요일에만 INSERT
// 평가 기준:
//   expired_total_count = 최근 30일 내 만료된 다운로드 쿠폰 (used + expired 모두 분모)
//   expired_unused_count = 그중 used_at IS NULL (미사용 만료)
//   expired_unused_rate = unused / total
// 제외 조건: 가입 14일 이내, expired_total_count < 5
// WATCHLIST: total>=5, unused>=4, rate>=70%
// PENALIZED: total>=8, unused>=7, rate>=85%
// 자동 패널티 확정: 주간 스냅샷 2회 연속 PENALIZED
// 자동 해제: penalized_at + 14일 이후 + 2주 연속 조건 미충족 → CLEAN
// ────────────────────────────────────────────────────────────

/** KST 기준 이번 주 월요일 YYYY-MM-DD */
function getMondayKST(fromDate?: Date): string {
  const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
  const nowKst = new Date((fromDate ?? new Date()).getTime() + KST_OFFSET_MS);
  const dayOfWeek = nowKst.getUTCDay(); // 0=일, 1=월 ... 6=토
  const mondayKst = new Date(nowKst);
  mondayKst.setUTCDate(nowKst.getUTCDate() - ((dayOfWeek + 6) % 7));
  return mondayKst.toISOString().slice(0, 10); // YYYY-MM-DD
}

export async function runAbuseDetectionJob() {
  logJobStart("어뷰저 탐지");

  const todayKST = getTodayKST();
  const acquired = await tryAcquireJobLock('abuse_detection_daily', todayKST);
  if (!acquired) return;

  const dbConn = await getDb();
  if (!dbConn) { console.error("❌ DB 연결 실패"); return; }

  const nowKst = new Date();
  const dayOfWeek = new Date(nowKst.getTime() + 9 * 60 * 60 * 1000).getUTCDay();
  const isMonday = dayOfWeek === 1;
  const currentWeekStart = getMondayKST();

  console.log(`[abuse-job] 실행일: ${todayKST}, 월요일: ${isMonday}, 주 시작: ${currentWeekStart}`);

  try {
    // ── 1. 평가 대상 유저 산출 (30일 내 만료 쿠폰 있는 유저, 가입 14일 초과) ──
    const candidatesResult = await dbConn.execute(
      `SELECT
         uc.user_id,
         COUNT(*) FILTER (
           WHERE uc.expires_at >= NOW() - INTERVAL '30 days'
             AND uc.expires_at < NOW()
         )::int AS expired_total_count,
         COUNT(*) FILTER (
           WHERE uc.expires_at >= NOW() - INTERVAL '30 days'
             AND uc.expires_at < NOW()
             AND uc.used_at IS NULL
         )::int AS expired_unused_count
       FROM user_coupons uc
       JOIN users u ON u.id = uc.user_id
       WHERE u.role = 'user'
         AND u.created_at < NOW() - INTERVAL '14 days'
         AND uc.expires_at >= NOW() - INTERVAL '30 days'
         AND uc.expires_at < NOW()
       GROUP BY uc.user_id
       HAVING COUNT(*) FILTER (
           WHERE uc.expires_at >= NOW() - INTERVAL '30 days'
             AND uc.expires_at < NOW()
         ) >= 5`
    );

    const candidates: Record<string, unknown>[] =
      (candidatesResult as any)?.rows ?? [];

    console.log(`[abuse-job] 평가 대상 ${candidates.length}명`);

    let watchlistCount = 0;
    let penalizedCount = 0;
    let cleanCount = 0;
    let newAutoPenalty = 0;
    let autoReleased = 0;

    for (const row of candidates) {
      const userId = Number(row.user_id);
      const total = Number(row.expired_total_count);
      const unused = Number(row.expired_unused_count);
      const rate = total > 0 ? unused / total : 0;

      // ── 오늘의 평가 결과 산출 ──────────────────────────────────────────────
      let todayEval: 'CLEAN' | 'WATCHLIST' | 'PENALIZED' = 'CLEAN';
      if (total >= 8 && unused >= 7 && rate >= 0.85) {
        todayEval = 'PENALIZED';
        penalizedCount++;
      } else if (total >= 5 && unused >= 4 && rate >= 0.70) {
        todayEval = 'WATCHLIST';
        watchlistCount++;
      } else {
        cleanCount++;
      }

      // ── 월요일: 주간 스냅샷 INSERT (히스토리/연속주 판단용) ──────────────
      if (isMonday) {
        await dbConn.execute(
          `INSERT INTO user_abuse_snapshots
             (user_id, week_start, expired_total_count, expired_unused_count,
              expired_unused_rate, evaluation, evaluated_at)
           VALUES ($1::int, $2, $3::int, $4::int, $5::numeric, $6, NOW())
           ON CONFLICT (user_id, week_start) DO NOTHING`,
          [userId, currentWeekStart, total, unused, rate.toFixed(4), todayEval]
        );
      }

      // ── 현재 상태 조회 ──────────────────────────────────────────────────
      const current = await dbConn.execute(
        `SELECT status, penalized_at, auto_release_eligible_at,
                consecutive_penalized_weeks, consecutive_clean_weeks,
                manually_set
         FROM user_abuse_status WHERE user_id = $1 LIMIT 1`,
        [userId]
      );
      const cur: Record<string, unknown> =
        ((current as any)?.rows ?? [])[0] ?? {};
      const curStatus = (cur.status as string) ?? 'CLEAN';
      const manuallySet = Boolean(cur.manually_set);

      // 수동 지정 계정은 자동 변경 금지
      if (manuallySet) continue;

      // ── daily status 갱신 로직 ─────────────────────────────────────────
      // consecutive_penalized_weeks / consecutive_clean_weeks 는 월요일에만 갱신.
      // 비-월요일에는 현재 값을 유지하면서 status만 즉시 반영.
      let prevPenalizedWeeks = Number(cur.consecutive_penalized_weeks ?? 0);
      let prevCleanWeeks = Number(cur.consecutive_clean_weeks ?? 0);
      let newStatus: 'CLEAN' | 'WATCHLIST' | 'PENALIZED' = curStatus as any;
      let newPenalizedWeeks = prevPenalizedWeeks;
      let newCleanWeeks = prevCleanWeeks;

      if (isMonday) {
        // 월요일: 주간 카운터 갱신 + 2주 연속 판단
        if (todayEval === 'PENALIZED') {
          newPenalizedWeeks = prevPenalizedWeeks + 1;
          newCleanWeeks = 0;
          if (newPenalizedWeeks >= 2) {
            // 2회 연속 PENALIZED → 자동 패널티 확정
            newStatus = 'PENALIZED';
            if (curStatus !== 'PENALIZED') newAutoPenalty++;
          } else {
            if (curStatus !== 'PENALIZED') newStatus = 'WATCHLIST';
          }
        } else if (todayEval === 'WATCHLIST') {
          newPenalizedWeeks = Math.max(0, prevPenalizedWeeks - 1);
          newCleanWeeks = 0;
          if (curStatus !== 'PENALIZED') newStatus = 'WATCHLIST';
          // PENALIZED 중 WATCHLIST = 아직 해제 조건 미충족 → 그대로 유지
        } else {
          // CLEAN 평가
          newPenalizedWeeks = 0;
          newCleanWeeks = prevCleanWeeks + 1;
          if (curStatus === 'PENALIZED') {
            const autoReleaseAt = cur.auto_release_eligible_at
              ? new Date(cur.auto_release_eligible_at as string) : null;
            if (autoReleaseAt && new Date() >= autoReleaseAt && newCleanWeeks >= 2) {
              newStatus = 'CLEAN';
              autoReleased++;
            }
          } else if (curStatus === 'WATCHLIST') {
            if (newCleanWeeks >= 2) newStatus = 'CLEAN';
            else newStatus = 'WATCHLIST'; // 1주만 CLEAN이면 아직 유지
          } else {
            newStatus = 'CLEAN';
          }
        }
      } else {
        // 비-월요일: 주간 카운터는 건드리지 않고 status만 즉시 반영
        if (todayEval === 'WATCHLIST') {
          if (curStatus !== 'PENALIZED') newStatus = 'WATCHLIST';
        } else if (todayEval === 'CLEAN') {
          // 비-월요일에 CLEAN 평가가 나와도 PENALIZED/WATCHLIST 자동 해제는 하지 않음.
          // 해제는 월요일 연속주 판단 후에만 가능.
          if (curStatus === 'CLEAN') newStatus = 'CLEAN';
          // PENALIZED/WATCHLIST는 월요일까지 유지
        }
        // 비-월요일에 PENALIZED 평가 → WATCHLIST로만 올림 (자동 확정은 월요일 2회 연속 기준)
        if (todayEval === 'PENALIZED' && curStatus !== 'PENALIZED') {
          newStatus = 'WATCHLIST';
          newPenalizedWeeks = prevPenalizedWeeks; // 카운터는 월요일에만 증가
        }
      }

      // ── upsert ──────────────────────────────────────────────────────────
      await dbConn.execute(
        `INSERT INTO user_abuse_status
           (user_id, status, penalized_at, consecutive_penalized_weeks, consecutive_clean_weeks,
            last_snapshot_evaluation, auto_release_eligible_at,
            manually_set, penalty_warning_shown, created_at, updated_at)
         VALUES (
           $1::int, $2,
           CASE WHEN $2 = 'PENALIZED' THEN NOW() ELSE NULL END,
           $3::int, $4::int, $5,
           CASE WHEN $2 = 'PENALIZED' THEN NOW() + INTERVAL '14 days' ELSE NULL END,
           FALSE,
           CASE WHEN $2 = 'PENALIZED' THEN FALSE ELSE TRUE END,
           NOW(), NOW()
         )
         ON CONFLICT (user_id) DO UPDATE SET
           status = EXCLUDED.status,
           penalized_at = CASE
             WHEN EXCLUDED.status = 'PENALIZED' AND user_abuse_status.penalized_at IS NULL
               THEN EXCLUDED.penalized_at
             WHEN EXCLUDED.status != 'PENALIZED' THEN NULL
             ELSE user_abuse_status.penalized_at
           END,
           consecutive_penalized_weeks = EXCLUDED.consecutive_penalized_weeks,
           consecutive_clean_weeks = EXCLUDED.consecutive_clean_weeks,
           last_snapshot_evaluation = EXCLUDED.last_snapshot_evaluation,
           auto_release_eligible_at = CASE
             WHEN EXCLUDED.status = 'PENALIZED' AND user_abuse_status.auto_release_eligible_at IS NULL
               THEN EXCLUDED.auto_release_eligible_at
             WHEN EXCLUDED.status != 'PENALIZED' THEN NULL
             ELSE user_abuse_status.auto_release_eligible_at
           END,
           penalty_warning_shown = CASE
             WHEN EXCLUDED.status = 'PENALIZED' THEN user_abuse_status.penalty_warning_shown
             ELSE FALSE
           END,
           manually_set = FALSE,
           updated_at = NOW()`,
        [userId, newStatus, newPenalizedWeeks, newCleanWeeks, todayEval]
      );
    }

    console.log(JSON.stringify({
      action: 'abuse_detection_complete',
      date: todayKST,
      isMonday,
      evaluated: candidates.length,
      watchlist: watchlistCount,
      penalized: penalizedCount,
      clean: cleanCount,
      newAutoPenalty,
      autoReleased,
    }));
  } catch (error) {
    console.error("❌ 어뷰저 탐지 오류:", error);
  }
}

export function startAbuseDetectionScheduler() {
  // 03:00 UTC = 12:00 KST
  cron.schedule("0 3 * * *", async () => {
    await runAbuseDetectionJob();
  });
  console.log("✅ 어뷰저 탐지 스케줄러 등록 완료 [03:00 UTC = 12:00 KST]");
}

// ────────────────────────────────────────────────────────────
// Job 9: app_login_tickets 만료 항목 정기 정리 (매시간 30분)
//
// 문제:
//   서버 시작 시 1회만 정리되므로, 장기간 재시작 없으면 만료 ticket이 누적됨.
//   ticket TTL=60초이므로 1시간 주기 정리로 충분.
//
// 안전성:
//   WHERE expires_at < NOW() - INTERVAL '5 minutes' 으로
//   edge case(DB 시계 오차) 대비 5분 여유 추가.
// ────────────────────────────────────────────────────────────
export function startAppTicketCleanupScheduler() {
  // 매시간 30분 (tier 만료 정리와 겹치지 않도록 분산)
  cron.schedule("30 * * * *", async () => {
    try {
      const dbConn = await getDb();
      if (!dbConn) return;

      const result = await dbConn.execute(
        `DELETE FROM app_login_tickets
         WHERE expires_at < NOW() - INTERVAL '5 minutes'`
      );
      const deleted = (result as any)?.rowCount ?? 0;
      if (deleted > 0) {
        console.log(JSON.stringify({
          action: 'app_ticket_cleanup',
          deleted,
          timestamp: new Date().toISOString(),
        }));
      }
    } catch (error) {
      console.error("❌ app_login_tickets 정리 오류:", error);
    }
  });
  console.log("✅ app_login_tickets 정리 스케줄러 등록 완료 [매시간 30분]");
}

// ────────────────────────────────────────────────────────────
// PR-32 (2026-05-01): token_blacklist 만료 row 정리 — 일 1회 03시 30분
// 만료된 row 는 jwtVerify 자체가 fail (exp 만료) — DB 에 보관 의미 X
// expires_at < NOW() 행 일괄 DELETE → DB 크기 적정 유지
// ────────────────────────────────────────────────────────────
export function startTokenBlacklistCleanupScheduler() {
  cron.schedule("30 3 * * *", async () => {
    try {
      const dbConn = await getDb();
      if (!dbConn) return;
      const result = await dbConn.execute(
        `DELETE FROM token_blacklist WHERE expires_at < NOW()`
      );
      const deleted = (result as any)?.rowCount ?? 0;
      if (deleted > 0) {
        console.log(JSON.stringify({
          action: 'token_blacklist_cleanup',
          deleted,
          timestamp: new Date().toISOString(),
        }));
      }
    } catch (error) {
      console.error("❌ token_blacklist 정리 오류:", error);
    }
  });
  console.log("✅ token_blacklist 정리 스케줄러 등록 완료 [매일 03:30]");
}

// ────────────────────────────────────────────────────────────
// 2026-04-25: 사장님 쿠폰 등록 독려 스케줄러 (D+1 ~ D+7)
// - 매일 KST 10:00 (= 01:00 UTC) 실행
// - 대상: 가게 승인 후 1~7일 / 쿠폰 lifetime 0개 / 프랜차이즈 제외
// - 당일 중복 발송 방지 (notifications KST DATE 체크)
// - 인앱 + 이메일 동시 발송, 이메일 실패해도 인앱 성공 시 계속 진행
// - 유료/무료 구분: 활성 유료 플랜 존재 여부로 판정
// ────────────────────────────────────────────────────────────
async function runCouponRegistrationReminderJob() {
  const runDate = getTodayKST();
  if (!(await tryAcquireJobLock("merchant_coupon_reminder", runDate))) {
    console.log("[merchant_coupon_reminder] already acquired by another instance, skip");
    return;
  }
  logJobStart("사장님 쿠폰 등록 독려 (D+1~D+7)");

  try {
    const db = await getDb();
    if (!db) {
      console.error("❌ DB 연결 실패");
      return;
    }

    // 대상: 가게 승인 1~7일, 쿠폰 lifetime 0, 프랜차이즈 제외, 오늘 미발송
    const candidates = await db.execute(drizzleSql`
      SELECT
        s.id AS store_id,
        s.name AS store_name,
        s.owner_id,
        u.email AS owner_email,
        u.name AS owner_name,
        FLOOR(EXTRACT(EPOCH FROM (NOW() - s.approved_at)) / 86400)::int AS days_since,
        -- 유료 active 여부 (tier != 'FREE' 활성 플랜 존재)
        EXISTS (
          SELECT 1 FROM user_plans up
          WHERE up.user_id = s.owner_id
            AND up.is_active = TRUE
            AND up.tier != 'FREE'
            AND (up.expires_at IS NULL OR up.expires_at > NOW())
        ) AS is_paid
      FROM stores s
      JOIN users u ON u.id = s.owner_id
      WHERE s.approved_at IS NOT NULL
        AND s.approved_at <= NOW() - INTERVAL '1 day'
        AND s.approved_at > NOW() - INTERVAL '8 days'  -- D+1 ~ D+7 (8일째부터 제외)
        AND s.deleted_at IS NULL
        AND u.is_franchise = FALSE
        AND NOT EXISTS (
          SELECT 1 FROM coupons c
          WHERE c.store_id = s.id AND c.approved_at IS NOT NULL
        )
        AND NOT EXISTS (
          SELECT 1 FROM notifications n
          WHERE n.user_id = s.owner_id
            AND n.type = 'merchant_coupon_reminder'
            AND n.related_id = s.id
            AND DATE(n.created_at AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Seoul')
                = DATE(NOW() AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Seoul')
        )
    `);

    const rows = ((candidates as any)?.rows ?? (candidates as any)?.[0] ?? []) as any[];
    console.log(`[merchant_coupon_reminder] candidates=${rows.length}`);

    let okCount = 0;
    let errCount = 0;
    for (const row of rows) {
      try {
        const storeId = Number(row.store_id);
        const ownerId = Number(row.owner_id);
        const storeName = String(row.store_name ?? "가게");
        const daysSince = Number(row.days_since ?? 1);
        const isPaid = row.is_paid === true || row.is_paid === "t";
        const ownerEmail = row.owner_email ? String(row.owner_email) : null;

        const title = isPaid
          ? "⚠️ 사장님, 유료 구독 기간이 소멸되고 있어요!"
          : "🎁 사장님, 쿠폰 등록을 기다리고 있어요!";
        const message = isPaid
          ? `${storeName}에 쿠폰이 등록되지 않은 채 유료 구독 기간이 하루하루 지나가고 있어요.`
          : `${storeName}에 아직 쿠폰이 등록되지 않았어요. 고객님들이 기다리고 계세요 :)`;

        // 인앱 알림 (실패 시 이메일도 skip) — Phase 2c: notify() wrapper (cap/cooldown/silent 책임)
        await notify(ownerId, 'merchant_coupon_reminder', {
          title,
          message,
          relatedId: storeId,
          targetUrl: '/merchant/dashboard',
        });

        // 이메일 (fire-and-forget, 실패해도 인앱은 이미 성공)
        if (ownerEmail) {
          await sendCouponReminderEmail({
            userId: ownerId,
            email: ownerEmail,
            storeName,
            daysSinceApproval: daysSince,
            isPaid,
          });
        }
        okCount++;
      } catch (e) {
        errCount++;
        console.error(`[merchant_coupon_reminder] failed store ${row.store_id}:`, e);
      }
    }

    console.log(`[merchant_coupon_reminder] sent=${okCount} errors=${errCount}`);
  } catch (error) {
    console.error("❌ merchant_coupon_reminder 오류:", error);
  }
}

export function startMerchantCouponReminderScheduler() {
  // 01:00 UTC = 10:00 KST
  cron.schedule("0 1 * * *", () => runCouponRegistrationReminderJob());
  console.log("✅ 사장님 쿠폰 등록 독려 스케줄러 등록 [01:00 UTC = 10:00 KST]");
}

// ────────────────────────────────────────────────────────────
// 2026-04-25: 유료 만료 임박 독려 스케줄러 (만료 3일 전 ~ 1일 전)
// - 매일 KST 10:00 (= 01:00 UTC)
// - 대상: 유료 active, expires_at NOW() ~ NOW()+3d, 이미 만료된 것 제외
// - 당일 중복 발송 방지
// - 어드민이 expires_at 연장 시 자동 대상 제외 (쿼리 WHERE 조건)
// ────────────────────────────────────────────────────────────
async function runPlanExpiryReminderJob() {
  const runDate = getTodayKST();
  if (!(await tryAcquireJobLock("merchant_plan_expiry_reminder", runDate))) {
    console.log("[merchant_plan_expiry_reminder] already acquired, skip");
    return;
  }
  logJobStart("유료 만료 임박 알림 (3일 전)");

  try {
    const db = await getDb();
    if (!db) {
      console.error("❌ DB 연결 실패");
      return;
    }

    const candidates = await db.execute(drizzleSql`
      SELECT
        up.id AS plan_id,
        up.user_id,
        up.tier,
        up.expires_at,
        CEIL(EXTRACT(EPOCH FROM (up.expires_at - NOW())) / 86400)::int AS days_remaining,
        u.email AS owner_email,
        u.name AS owner_name,
        -- 대표 가게명 (소유 매장 중 활성 1개)
        (SELECT name FROM stores s
         WHERE s.owner_id = u.id AND s.deleted_at IS NULL
         ORDER BY s.id ASC LIMIT 1) AS store_name
      FROM user_plans up
      JOIN users u ON u.id = up.user_id
      WHERE up.is_active = TRUE
        AND up.tier != 'FREE'
        AND up.expires_at IS NOT NULL
        AND up.expires_at > NOW()                            -- 아직 만료 전만
        AND up.expires_at <= NOW() + INTERVAL '3 days'       -- 3일 이내
        AND u.is_franchise = FALSE
        AND NOT EXISTS (
          SELECT 1 FROM notifications n
          WHERE n.user_id = up.user_id
            AND n.type = 'merchant_plan_expiry_reminder'
            AND DATE(n.created_at AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Seoul')
                = DATE(NOW() AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Seoul')
        )
    `);

    const rows = ((candidates as any)?.rows ?? (candidates as any)?.[0] ?? []) as any[];
    console.log(`[merchant_plan_expiry_reminder] candidates=${rows.length}`);

    let okCount = 0;
    let errCount = 0;
    for (const row of rows) {
      try {
        const userId = Number(row.user_id);
        const storeName = String(row.store_name ?? "가게");
        const daysRemaining = Number(row.days_remaining ?? 1);
        const expiresAt = row.expires_at ? new Date(row.expires_at as string) : new Date();
        const ownerEmail = row.owner_email ? String(row.owner_email) : null;

        const title = `⏰ 유료 구독이 곧 만료돼요 (남은 ${daysRemaining}일)`;
        const message = `재결제하지 않으면 새 쿠폰 발행이 중단됩니다. 관리자에게 연장을 요청하세요.`;

        // Phase 2c: notify() wrapper (cap/cooldown/silent 책임)
        await notify(userId, 'merchant_plan_expiry_reminder', {
          title,
          message,
          targetUrl: '/merchant/dashboard',
        });

        if (ownerEmail) {
          await sendPlanExpiryReminderEmail({
            userId,
            email: ownerEmail,
            storeName,
            daysRemaining,
            expiresAt,
          });
        }
        okCount++;
      } catch (e) {
        errCount++;
        console.error(`[merchant_plan_expiry_reminder] failed user ${row.user_id}:`, e);
      }
    }

    console.log(`[merchant_plan_expiry_reminder] sent=${okCount} errors=${errCount}`);
  } catch (error) {
    console.error("❌ merchant_plan_expiry_reminder 오류:", error);
  }
}

export function startPlanExpiryReminderScheduler() {
  // 01:05 UTC = 10:05 KST (쿠폰 리마인더와 5분 간격 → 로그 추적 용이)
  cron.schedule("5 1 * * *", () => runPlanExpiryReminderJob());
  console.log("✅ 유료 만료 임박 스케줄러 등록 [01:05 UTC = 10:05 KST]");
}

// ────────────────────────────────────────────────────────────
// Phase 2b-2: notification_pending_queue flush
// 야간 silent (KST 22~8) 동안 enqueue 된 알림을 KST 08:00~08:15 사이에 묶음 발송.
// scheduledFor 가 NOW() 도래한 row 만 처리 — jitter 0~15분 자동 매핑.
// processedAt = NOW() UPDATE 로 중복 처리 방지 (멱등 — 같은 row 재실행 시 0건 매칭).
// 개별 row try-catch — 한 row 실패가 전체 cron 실패로 전파되지 않음.
// ────────────────────────────────────────────────────────────
async function runPendingQueueFlushJob(): Promise<void> {
  const db = await getDb();
  if (!db) {
    console.warn("[pending_queue_flush] DB unavailable, skip");
    return;
  }

  let processed = 0;
  let failed = 0;
  try {
    const rows = await db
      .select()
      .from(notificationPendingQueue)
      .where(
        and(
          lte(notificationPendingQueue.scheduledFor, drizzleSql`NOW()`),
          isNull(notificationPendingQueue.processedAt),
        ),
      );

    for (const row of rows) {
      try {
        await notify(
          row.userId,
          row.category as any,
          row.payload as any,
        );
        await db
          .update(notificationPendingQueue)
          .set({ processedAt: new Date() })
          .where(eq(notificationPendingQueue.id, row.id));
        processed++;
      } catch (e) {
        console.error(`[pending_queue_flush] row id=${row.id} error:`, e);
        failed++;
      }
    }

    console.log(`[pending_queue_flush] processed=${processed} failed=${failed}`);
  } catch (error) {
    console.error("❌ pending_queue_flush 오류:", error);
  }
}

export function startPendingQueueFlushScheduler() {
  // 23:00, 23:05, 23:10, 23:15 UTC = 08:00, 08:05, 08:10, 08:15 KST
  // jitter 0~15분 (notification_pending_queue.scheduledFor) 자동 매핑.
  // 멱등: processedAt IS NULL 매칭만 처리 → 4번 실행해도 같은 row 1회만 처리.
  cron.schedule("0,5,10,15 23 * * *", () => runPendingQueueFlushJob());
  console.log("✅ 야간 큐 flush 스케줄러 등록 [23:00,05,10,15 UTC = 08:00~15 KST]");
}

// ────────────────────────────────────────────────────────────
// 모든 스케줄러 시작
// ────────────────────────────────────────────────────────────
export function startAllSchedulers() {
  startNewCouponNotificationScheduler();       // 00:00 UTC = 09:00 KST
  startExpiryReminderScheduler();              // 01:00 UTC = 10:00 KST
  startOldDataCleanupScheduler();              // 03:00 UTC 매월 1일
  startDailyLimitResetScheduler();             // 15:00 UTC = 00:00 KST (자정 리셋)
  startTierExpiryCleanupScheduler();           // 매시간 정각 — 만료 플랜 is_active=false
  startUserCouponExpiryScheduler();            // 매 30분 — user_coupon status=expired 자동 전환
  startExpiredCouponDeactivationScheduler();   // 15:05 UTC = 00:05 KST — 만료 쿠폰 비활성화
  startAbuseDetectionScheduler();              // 03:00 UTC = 12:00 KST — 어뷰저 탐지
  startAppTicketCleanupScheduler();            // 매시간 30분 — 만료 app_login_tickets 정리
  startTokenBlacklistCleanupScheduler();       // 03:30 UTC = 12:30 KST — PR-32 token_blacklist 만료 row 정리
  startMerchantCouponReminderScheduler();      // 01:00 UTC = 10:00 KST — 사장님 쿠폰 등록 독려
  startPlanExpiryReminderScheduler();          // 01:05 UTC = 10:05 KST — 유료 만료 임박
  startPendingQueueFlushScheduler();           // 23:00,05,10,15 UTC = 08:00~15 KST — Phase 2b-2 야간 큐 flush
  console.log("\n✅ 모든 스케줄러 시작됨");
  console.log("   신규쿠폰:         00:00 UTC = 09:00 KST");
  console.log("   마감임박:         01:00 UTC = 10:00 KST");
  console.log("   일소비리셋:       15:00 UTC = 00:00 KST");
  console.log("   만료쿠폰정리:     15:05 UTC = 00:05 KST");
  console.log("   tier만료:         매시간 정각");
  console.log("   유저쿠폰만료:     매 30분");
  console.log("   어뷰저탐지:       03:00 UTC = 12:00 KST");
  console.log("   앱티켓정리:       매시간 30분");
  console.log("   야간큐flush:      23:00,05,10,15 UTC = 08:00~15 KST");
}

// 수동 실행은 server/jobs/runJob.ts 참고
// JOB=new-coupon pnpm tsx server/jobs/runJob.ts
