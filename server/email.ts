import nodemailer from "nodemailer";
import { getDb } from "./db";
import { emailLogs } from "../drizzle/schema";
import { eq } from "drizzle-orm";

/**
 * 이메일 발송 설정
 * Gmail SMTP 사용 (무료)
 * 
 * 환경 변수 필요:
 * - EMAIL_USER: Gmail 주소
 * - EMAIL_PASS: Gmail 앱 비밀번호 (2단계 인증 필요)
 */

// Nodemailer transporter 생성
const createTransporter = () => {
  const emailUser = process.env.EMAIL_USER;
  const emailPass = process.env.EMAIL_PASS;

  if (!emailUser || !emailPass) {
    console.warn("⚠️ EMAIL_USER 또는 EMAIL_PASS 환경 변수가 설정되지 않았습니다.");
    return null;
  }

  return nodemailer.createTransport({
    service: "gmail",
    auth: {
      user: emailUser,
      pass: emailPass,
    },
  });
};

/**
 * 이메일 발송 함수
 */
export async function sendEmail(params: {
  userId: number;
  email: string;
  subject: string;
  html: string;
  type:
    | "new_coupon"
    | "expiry_reminder"
    | "merchant_renewal_nudge"
    | "merchant_coupon_reminder"        // 2026-04-25: 가게 승인 후 쿠폰 미등록 독려
    | "merchant_plan_expiry_reminder"   // 2026-04-25: 유료 만료 임박 독려
    | "general";                        // PR-30 (2026-05-01): 분류 불가 시스템 알림 (쿠폰 무효화 등)
}) {
  const { userId, email, subject, html, type } = params;

  // 이메일 로그 생성
  const db = await getDb();
  if (!db) {
    console.error("❌ 데이터베이스 연결 실패");
    return false;
  }

  const logResult = await db.insert(emailLogs).values({
    userId,
    email,
    type,
    subject,
    content: html,
    status: "pending",
  });
  const logId = logResult[0].insertId;

  const transporter = createTransporter();

  if (!transporter) {
    // 환경 변수 미설정 시 로그만 기록하고 실패 처리
    await db.update(emailLogs).set({
      status: "failed",
      errorMessage: "EMAIL_USER 또는 EMAIL_PASS 환경 변수가 설정되지 않았습니다.",
    }).where(eq(emailLogs.id, logId));
    return false;
  }

  try {
    await transporter.sendMail({
      from: `"지금쿠폰" <${process.env.EMAIL_USER}>`,
      to: email,
      subject,
      html,
    });

    // 발송 성공 로그 업데이트
    await db.update(emailLogs).set({
      status: "sent",
      sentAt: new Date(),
    }).where(eq(emailLogs.id, logId));

    console.log(`✅ 이메일 발송 성공: ${email} (${type})`);
    return true;
  } catch (error: any) {
    // 발송 실패 로그 업데이트
    await db.update(emailLogs).set({
      status: "failed",
      errorMessage: error.message,
    }).where(eq(emailLogs.id, logId));

    console.error(`❌ 이메일 발송 실패: ${email} (${type})`, error);
    return false;
  }
}

/**
 * 신규 쿠폰 알림 이메일 템플릿
 */
export function getNewCouponEmailTemplate(params: {
  userName: string;
  storeName: string;
  couponTitle: string;
  discountValue: string;
  endDate: string;
  couponUrl: string;
}) {
  const { userName, storeName, couponTitle, discountValue, endDate, couponUrl } = params;

  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; line-height: 1.6; color: #333; background-color: #f5f5f5; margin: 0; padding: 0; }
    .container { max-width: 600px; margin: 20px auto; background: white; border-radius: 8px; overflow: hidden; box-shadow: 0 2px 8px rgba(0,0,0,0.1); }
    .header { background: linear-gradient(135deg, #FF6B35 0%, #FF8E53 100%); padding: 30px 20px; text-align: center; }
    .header h1 { color: white; margin: 0; font-size: 28px; }
    .content { padding: 30px 20px; }
    .coupon-box { background: linear-gradient(135deg, #FFF5F2 0%, #FFE8E0 100%); border-left: 4px solid #FF6B35; padding: 20px; margin: 20px 0; border-radius: 8px; }
    .coupon-title { font-size: 20px; font-weight: bold; color: #FF6B35; margin-bottom: 10px; }
    .discount { font-size: 32px; font-weight: bold; color: #FF6B35; margin: 15px 0; }
    .store-name { font-size: 18px; color: #555; margin-bottom: 10px; }
    .expiry { color: #888; font-size: 14px; }
    .cta-button { display: inline-block; background: linear-gradient(135deg, #FF6B35 0%, #FF8E53 100%); color: white; text-decoration: none; padding: 15px 40px; border-radius: 25px; font-weight: bold; margin: 20px 0; text-align: center; }
    .footer { background: #f9f9f9; padding: 20px; text-align: center; color: #888; font-size: 12px; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>🎉 새로운 쿠폰이 등록되었어요!</h1>
    </div>
    <div class="content">
      <p>안녕하세요, <strong>${userName}</strong>님!</p>
      <p>선호하시는 지역에 새로운 쿠폰이 등록되었습니다.</p>
      
      <div class="coupon-box">
        <div class="store-name">📍 ${storeName}</div>
        <div class="coupon-title">${couponTitle}</div>
        <div class="discount">${discountValue}</div>
        <div class="expiry">⏰ ${endDate}까지 사용 가능</div>
      </div>

      <p style="text-align: center;">
        <a href="${couponUrl}" class="cta-button">쿠폰 다운로드하기</a>
      </p>

      <p style="color: #888; font-size: 14px; margin-top: 30px;">
        💡 <strong>Tip:</strong> 쿠폰은 선착순이니 서둘러 다운로드하세요!
      </p>
    </div>
    <div class="footer">
      <p>이 이메일은 지금쿠폰 알림 설정에 따라 발송되었습니다.</p>
      <p>알림을 받지 않으려면 <a href="${couponUrl}/settings">설정</a>에서 변경하실 수 있습니다.</p>
    </div>
  </div>
</body>
</html>
  `;
}

/**
 * 마감 임박 쿠폰 알림 이메일 템플릿
 */
export function getExpiryReminderEmailTemplate(params: {
  userName: string;
  coupons: Array<{
    storeName: string;
    couponTitle: string;
    expiresAt: string;
    couponCode: string;
  }>;
  myCouponsUrl: string;
}) {
  const { userName, coupons, myCouponsUrl } = params;

  const couponListHtml = coupons.map(coupon => `
    <div class="coupon-box">
      <div class="store-name">📍 ${coupon.storeName}</div>
      <div class="coupon-title">${coupon.couponTitle}</div>
      <div class="expiry">⏰ ${coupon.expiresAt}에 만료</div>
      <div style="color: #888; font-size: 14px; margin-top: 10px;">쿠폰 번호: ${coupon.couponCode}</div>
    </div>
  `).join('');

  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; line-height: 1.6; color: #333; background-color: #f5f5f5; margin: 0; padding: 0; }
    .container { max-width: 600px; margin: 20px auto; background: white; border-radius: 8px; overflow: hidden; box-shadow: 0 2px 8px rgba(0,0,0,0.1); }
    .header { background: linear-gradient(135deg, #FF6B35 0%, #FF8E53 100%); padding: 30px 20px; text-align: center; }
    .header h1 { color: white; margin: 0; font-size: 28px; }
    .content { padding: 30px 20px; }
    .coupon-box { background: linear-gradient(135deg, #FFF5F2 0%, #FFE8E0 100%); border-left: 4px solid #FF6B35; padding: 20px; margin: 15px 0; border-radius: 8px; }
    .coupon-title { font-size: 18px; font-weight: bold; color: #FF6B35; margin-bottom: 10px; }
    .store-name { font-size: 16px; color: #555; margin-bottom: 5px; }
    .expiry { color: #FF6B35; font-size: 14px; font-weight: bold; }
    .cta-button { display: inline-block; background: linear-gradient(135deg, #FF6B35 0%, #FF8E53 100%); color: white; text-decoration: none; padding: 15px 40px; border-radius: 25px; font-weight: bold; margin: 20px 0; text-align: center; }
    .footer { background: #f9f9f9; padding: 20px; text-align: center; color: #888; font-size: 12px; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>⏰ 쿠폰이 곧 만료됩니다!</h1>
    </div>
    <div class="content">
      <p>안녕하세요, <strong>${userName}</strong>님!</p>
      <p>다운로드하신 쿠폰이 <strong>24시간 내</strong>에 만료됩니다. 서둘러 사용하세요!</p>
      
      ${couponListHtml}

      <p style="text-align: center;">
        <a href="${myCouponsUrl}" class="cta-button">내 쿠폰북 보기</a>
      </p>

      <p style="color: #888; font-size: 14px; margin-top: 30px;">
        💡 <strong>Tip:</strong> 쿠폰 사용 후 리뷰를 남기면 포인트를 받을 수 있어요!
      </p>
    </div>
    <div class="footer">
      <p>이 이메일은 지금쿠폰 알림 설정에 따라 발송되었습니다.</p>
      <p>알림을 받지 않으려면 <a href="${myCouponsUrl}/settings">설정</a>에서 변경하실 수 있습니다.</p>
    </div>
  </div>
</body>
</html>
  `;
}

// ══════════════════════════════════════════════════════════════════════════════
// 관리자 알림 이메일 — DB 로그 없음, MASTER_ADMIN_EMAILS 전송
// userId 불필요. fire-and-forget (void로 호출).
// ══════════════════════════════════════════════════════════════════════════════

export type AdminAlertType =
  | 'store_pending'       // 가게 승인 대기
  | 'store_reapply'       // 가게 재신청
  | 'coupon_pending'      // 쿠폰 승인 대기
  | 'pack_order_new';     // 발주 요청 신규 접수

export async function sendAdminNotificationEmail(params: {
  type: AdminAlertType;
  merchantName: string;
  merchantEmail: string;
  targetName: string;       // 가게명 또는 쿠폰명 또는 팩 코드
  extraInfo?: string;       // 추가 메모 (선택)
}): Promise<void> {
  const { type, merchantName, merchantEmail, targetName, extraInfo } = params;

  const adminEmails = (process.env.MASTER_ADMIN_EMAILS || '')
    .split(',').map(e => e.trim()).filter(Boolean);

  if (adminEmails.length === 0) {
    console.warn('[AdminAlert] MASTER_ADMIN_EMAILS 미설정 — 알림 메일 전송 스킵');
    return;
  }

  const transporter = createTransporter();
  if (!transporter) {
    console.warn('[AdminAlert] 메일 전송기 없음 — EMAIL_USER/EMAIL_PASS 미설정');
    return;
  }

  const ADMIN_URL = 'https://my-coupon-bridge.com/admin';
  const typeMap: Record<AdminAlertType, { subject: string; badge: string; tab: string; tabLabel: string; color: string }> = {
    store_pending:   { subject: '🏪 가게 승인 대기',     badge: '🏪', tab: 'stores',      tabLabel: '가게 관리',  color: '#f97316' },
    store_reapply:   { subject: '🔁 가게 재신청 접수',    badge: '🔁', tab: 'stores',      tabLabel: '가게 관리',  color: '#3b82f6' },
    coupon_pending:  { subject: '🎟 쿠폰 승인 대기',     badge: '🎟', tab: 'coupons',     tabLabel: '쿠폰 관리',  color: '#8b5cf6' },
    pack_order_new:  { subject: '📦 발주 요청 신규 접수', badge: '📦', tab: 'pack-orders', tabLabel: '발주요청',   color: '#10b981' },
  };

  const t = typeMap[type];
  const dashboardLink = `${ADMIN_URL}?tab=${t.tab}`;
  const now = new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' });

  const html = `<!DOCTYPE html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
body{font-family:'Apple SD Gothic Neo',sans-serif;background:#f3f4f6;margin:0;padding:24px}
.wrap{max-width:520px;margin:0 auto;background:#fff;border-radius:14px;overflow:hidden;box-shadow:0 2px 10px rgba(0,0,0,.08)}
.hdr{background:${t.color};padding:24px 28px;color:#fff}
.hdr h1{margin:0;font-size:19px;font-weight:700}
.body{padding:24px 28px}
.row{display:flex;gap:8px;margin-bottom:10px;font-size:14px}
.lbl{color:#6b7280;min-width:80px;flex-shrink:0}
.val{color:#111827;font-weight:600}
.cta{display:inline-block;margin-top:20px;padding:12px 28px;background:${t.color};color:#fff;text-decoration:none;border-radius:10px;font-weight:700;font-size:14px}
.foot{background:#f9fafb;padding:14px 28px;font-size:11px;color:#9ca3af;text-align:center}
</style></head><body>
<div class="wrap">
  <div class="hdr"><h1>${t.badge} ${t.subject}</h1></div>
  <div class="body">
    <p style="margin:0 0 18px;color:#374151;font-size:15px">관리자 처리가 필요한 항목이 접수되었습니다.</p>
    <div class="row"><span class="lbl">구분</span><span class="val">${t.tabLabel}</span></div>
    <div class="row"><span class="lbl">대상</span><span class="val">${targetName}</span></div>
    <div class="row"><span class="lbl">사장님</span><span class="val">${merchantName} (${merchantEmail})</span></div>
    <div class="row"><span class="lbl">접수 시각</span><span class="val">${now}</span></div>
    ${extraInfo ? `<div class="row"><span class="lbl">메모</span><span class="val" style="font-weight:400;color:#6b7280">${extraInfo}</span></div>` : ''}
    <a href="${dashboardLink}" class="cta">관리자 대시보드에서 처리 →</a>
  </div>
  <div class="foot">마이쿠폰 운영팀 자동 발송 · <a href="${ADMIN_URL}" style="color:#9ca3af">관리자 페이지</a></div>
</div>
</body></html>`;

  try {
    await transporter.sendMail({
      from: `"마이쿠폰 관리자" <${process.env.EMAIL_USER}>`,
      to: adminEmails.join(', '),
      subject: `[마이쿠폰] ${t.subject} — ${targetName}`,
      html,
    });
    console.log(`[AdminAlert] ✅ 알림 메일 전송: ${t.subject} → ${adminEmails.join(', ')}`);
  } catch (err: any) {
    console.error('[AdminAlert] ❌ 알림 메일 전송 실패:', err?.message);
  }
}

/**
 * 사장님 재구독 안내 이메일 템플릿
 * 슈퍼어드민이 "조르기" 버튼 클릭 시 1회 발송
 */
export function getMerchantRenewalNudgeEmailTemplate(
  merchantName: string | null,
  nudgeCount: number = 1,
  storeName: string = '매장',
  couponUrl: string = 'https://my-coupon-bridge.com/map',
): string {
  const name = merchantName ?? '사장님';
  const appUrl = process.env.VITE_APP_URL || 'https://my-coupon-bridge.com';
  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body { font-family: 'Apple SD Gothic Neo', sans-serif; background: #f9fafb; margin: 0; padding: 24px; }
    .container { max-width: 520px; margin: 0 auto; background: white; border-radius: 16px; overflow: hidden; box-shadow: 0 2px 12px rgba(0,0,0,0.08); }
    .header { background: linear-gradient(135deg, #EF4444, #F97316); padding: 32px 24px; text-align: center; }
    .header h1 { color: white; margin: 0; font-size: 22px; }
    .highlight { background: #fef2f2; border-left: 4px solid #ef4444; padding: 16px 18px; border-radius: 8px; margin: 16px 0; }
    .body { padding: 28px 24px; }
    .cta { display: block; margin: 24px auto 0; padding: 14px 28px; background: #EF4444; color: white; text-decoration: none; border-radius: 10px; font-weight: 700; font-size: 15px; text-align: center; }
    .footer { background: #f3f4f6; padding: 16px 24px; font-size: 12px; color: #9ca3af; text-align: center; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>📢 쿠폰 더 달라는 요청이 왔어요!</h1>
    </div>
    <div class="body">
      <p style="font-size:16px;font-weight:700;color:#1a1a1a;margin-bottom:8px">${name} 안녕하세요!</p>
      <div class="highlight">
        <p style="color:#dc2626;font-weight:700;font-size:17px;margin:0 0 6px">
          고객이 <strong>${nudgeCount}회</strong> 쿠폰을 더 달라고 조르셨습니다! 🙏
        </p>
        <p style="color:#666;font-size:13px;margin:0">"${storeName}" 매장 쿠폰을 기다리는 고객이 있습니다.</p>
      </div>
      <p style="color:#444;line-height:1.7">현재 쿠폰 운영이 일시 중단된 상태입니다.<br>구독팩을 갱신하시면 고객에게 쿠폰을 제공할 수 있습니다!</p>
      <p style="color:#444;font-size:13px">📌 쿠폰 페이지: <a href="${couponUrl}" style="color:#EF4444">${couponUrl}</a></p>
      <a href="${appUrl}/merchant" class="cta">지금 쿠폰 등록하러 가기 →</a>
    </div>
    <div class="footer">
      <p>마이쿠폰 운영팀 드림 | <a href="${appUrl}">my-coupon-bridge.com</a></p>
    </div>
  </div>
</body>
</html>
  `;
}

// ============================================================================
// 2026-04-25: 사장님 쿠폰 등록 독려 이메일 (무료/유료 분기)
// ============================================================================

/**
 * 가게 승인 후 쿠폰 미등록 사장님에게 발송.
 * tier 에 따라 메시지 분기 (FREE = 안내톤 / PAID = 경고톤).
 */
export async function sendCouponReminderEmail(params: {
  userId: number;
  email: string;
  storeName: string;
  daysSinceApproval: number;
  isPaid: boolean;  // true = 유료 active / false = 무료 or 만료
}): Promise<boolean> {
  const { userId, email, storeName, daysSinceApproval, isPaid } = params;
  const appUrl = process.env.VITE_APP_URL || "https://my-coupon-bridge.com";
  const dashboardUrl = `${appUrl}/merchant/dashboard`;
  const safeStoreName = escapeHtml(storeName);

  const subject = isPaid
    ? `[마이쿠폰] ⚠️ 유료 구독 기간이 소멸되고 있어요 (${daysSinceApproval}일째)`
    : `[마이쿠폰] 🎁 사장님, 쿠폰 등록을 기다리고 있어요! (${daysSinceApproval}일째)`;

  const heading = isPaid
    ? "⚠️ 유료 구독 기간이 소멸되고 있어요"
    : "🎁 쿠폰 등록을 기다리고 있어요";

  const bodyIntro = isPaid
    ? `${safeStoreName} 의 유료 구독을 사용 중이신데, 아직 쿠폰이 등록되지 않았어요.<br>` +
      `유료 구독 기간은 쿠폰 발행 여부와 무관하게 계속 흘러갑니다.<br>` +
      `지금 쿠폰을 등록하시면 유료 혜택을 풀로 활용하실 수 있어요!`
    : `${safeStoreName} 이(가) 마이쿠폰에 등록되었지만 아직 쿠폰이 올라가 있지 않아요.<br>` +
      `고객님들이 사장님의 첫 쿠폰을 기다리고 계세요 :)<br>` +
      `지금 쿠폰을 등록하시면 바로 지도에 노출되어 고객을 맞이할 수 있어요!`;

  const html = buildMerchantReminderTemplate({
    heading,
    bodyIntro,
    stats: [
      { label: "가게 승인 후 경과", value: `${daysSinceApproval}일` },
      { label: "등록된 쿠폰", value: "0개" },
    ],
    ctaText: "지금 쿠폰 등록하기",
    ctaUrl: dashboardUrl,
  });

  return await sendEmail({
    userId,
    email,
    subject,
    html,
    type: "merchant_coupon_reminder",
  });
}

/**
 * 유료 구독 만료 임박 알림 (만료 3일~1일 전).
 * expires_at > NOW() 인 경우에만 호출 (이미 만료된 경우엔 발송 안 함).
 */
export async function sendPlanExpiryReminderEmail(params: {
  userId: number;
  email: string;
  storeName: string;
  daysRemaining: number;
  expiresAt: Date;
}): Promise<boolean> {
  const { userId, email, storeName, daysRemaining, expiresAt } = params;
  const appUrl = process.env.VITE_APP_URL || "https://my-coupon-bridge.com";
  const dashboardUrl = `${appUrl}/merchant/dashboard`;
  const safeStoreName = escapeHtml(storeName);
  const expiryKst = expiresAt.toLocaleDateString("ko-KR", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });

  const subject = `[마이쿠폰] ⏰ 유료 구독이 ${daysRemaining}일 남았어요!`;

  const html = buildMerchantReminderTemplate({
    heading: "⏰ 유료 구독이 곧 만료돼요",
    bodyIntro:
      `${safeStoreName} 의 유료 구독이 <strong>${expiryKst}</strong> 에 만료됩니다.<br>` +
      `만료 이후에는 새 쿠폰 발행과 기존 쿠폰 다운로드가 중단됩니다.<br>` +
      `계속 운영하시려면 관리자에게 재충전을 요청해주세요!`,
    stats: [
      { label: "남은 구독", value: `${daysRemaining}일` },
      { label: "만료일", value: expiryKst },
    ],
    ctaText: "관리자에게 재충전 요청",
    ctaUrl: dashboardUrl,
  });

  return await sendEmail({
    userId,
    email,
    subject,
    html,
    type: "merchant_plan_expiry_reminder",
  });
}

/** HTML entity escape — 매장명 등 사용자 입력 방어 */
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** 공통 템플릿 — 사장님 대상 리마인더 이메일 */
function buildMerchantReminderTemplate(params: {
  heading: string;
  bodyIntro: string; // HTML allowed (escaped on caller side)
  stats: { label: string; value: string }[];
  ctaText: string;
  ctaUrl: string;
}): string {
  const { heading, bodyIntro, stats, ctaText, ctaUrl } = params;
  const statsHtml = stats
    .map(
      (s) => `
      <tr>
        <td style="padding:8px 0;color:#666;font-size:13px;">${escapeHtml(s.label)}</td>
        <td style="padding:8px 0;color:#1a1a1a;font-size:14px;font-weight:700;text-align:right;">${escapeHtml(s.value)}</td>
      </tr>
    `,
    )
    .join("");
  const appUrl = process.env.VITE_APP_URL || "https://my-coupon-bridge.com";

  return `
<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="X-UA-Compatible" content="IE=edge">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(heading)}</title>
  <style>
    body { font-family: -apple-system, "Pretendard", "Malgun Gothic", sans-serif; background:#fff7f0; margin:0; padding:20px; }
    .box { max-width:560px; margin:0 auto; background:#fff; border-radius:14px; overflow:hidden; box-shadow:0 4px 18px rgba(0,0,0,0.08); }
    .head { background:linear-gradient(135deg,#F59E0B,#EF4444); color:#fff; padding:24px; text-align:center; }
    .head h1 { margin:0; font-size:20px; font-weight:800; }
    .body { padding:24px; color:#333; font-size:15px; line-height:1.7; }
    .stats { border-top:1px solid #f0e8df; border-bottom:1px solid #f0e8df; margin:18px 0; padding:6px 0; }
    .cta { display:inline-block; margin-top:18px; background:linear-gradient(135deg,#F59E0B,#EF4444); color:#fff !important; padding:12px 22px; border-radius:10px; font-weight:700; text-decoration:none; }
    .footer { padding:16px; text-align:center; color:#999; font-size:12px; background:#faf5f0; }
    .footer a { color:#999; }
  </style>
</head>
<body>
  <div class="box">
    <div class="head">
      <h1>${escapeHtml(heading)}</h1>
    </div>
    <div class="body">
      <p style="margin:0 0 12px">${bodyIntro}</p>
      <table class="stats" width="100%" cellpadding="0" cellspacing="0">${statsHtml}</table>
      <a href="${ctaUrl}" class="cta">${escapeHtml(ctaText)} →</a>
    </div>
    <div class="footer">
      <p>이 메일은 마이쿠폰 서비스 이용 안내 목적으로 발송되었습니다.<br>
         마이쿠폰 운영팀 | <a href="${appUrl}">my-coupon-bridge.com</a></p>
    </div>
  </div>
</body>
</html>
  `;
}
