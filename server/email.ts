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
  type: "new_coupon" | "expiry_reminder";
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
