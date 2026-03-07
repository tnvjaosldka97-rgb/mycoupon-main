/**
 * 수동 잡 실행 스크립트 (ESM 호환)
 *
 * 사용법:
 *   JOB=new-coupon pnpm tsx server/jobs/runJob.ts
 *   JOB=expiry     pnpm tsx server/jobs/runJob.ts
 *   JOB=new-coupon TEST_EMAIL=your@email.com pnpm tsx server/jobs/runJob.ts
 *   JOB=expiry     TEST_EMAIL=your@email.com pnpm tsx server/jobs/runJob.ts
 */
import { runNewCouponJob, runExpiryReminderJob } from "../scheduler.js";

const job = process.env.JOB;
const testEmail = process.env.TEST_EMAIL;

if (!job) {
  console.log("사용법: JOB=<new-coupon|expiry> [TEST_EMAIL=email] pnpm tsx server/jobs/runJob.ts");
  process.exit(1);
}

(async () => {
  if (job === "new-coupon") {
    await runNewCouponJob({ testEmail });
  } else if (job === "expiry") {
    await runExpiryReminderJob({ testEmail });
  } else {
    console.error(`❌ 알 수 없는 JOB: ${job} (new-coupon | expiry)`);
    process.exit(1);
  }
  process.exit(0);
})();
