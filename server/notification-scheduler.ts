/**
 * 쿠폰 만료 알림 및 새 쿠폰 알림 스케줄러
 * 
 * 이 스크립트는 주기적으로 실행되어:
 * 1. 24시간 이내 만료되는 쿠폰을 가진 사용자에게 알림 전송
 * 2. 새로 등록된 쿠폰을 관심 있는 사용자에게 알림 전송
 */

import * as db from './db';

interface NotificationPayload {
  title: string;
  body: string;
  icon?: string;
  data?: any;
}

/**
 * 웹 푸시 알림 전송 (Service Worker 사용)
 * 실제 구현에서는 Web Push API를 사용해야 하지만,
 * 여기서는 localStorage 기반으로 알림 설정을 확인합니다.
 */
async function sendWebPushNotification(userId: number, payload: NotificationPayload) {
  console.log(`📢 알림 전송 (사용자 ${userId}):`, payload.title);
  
  // 실제로는 Service Worker의 Push API를 사용해야 합니다.
  // 여기서는 로그만 출력합니다.
  // 프론트엔드에서 Service Worker를 통해 실제 알림을 받습니다.
}

/**
 * 쿠폰 만료 24시간 전 알림
 */
export async function sendExpiryNotifications() {
  console.log('🔔 쿠폰 만료 알림 체크 시작...');
  
  const db_connection = await db.getDb();
  if (!db_connection) {
    console.error('❌ 데이터베이스 연결 실패');
    return;
  }

  // 24시간 이내 만료되는 쿠폰을 가진 사용자 조회
  const query = `
    SELECT 
      uc.user_id,
      u.name as user_name,
      c.id as coupon_id,
      c.title as coupon_title,
      c.end_date,
      s.name as store_name
    FROM user_coupon uc
    JOIN coupon c ON c.id = uc.coupon_id
    JOIN store s ON s.id = c.store_id
    JOIN user u ON u.id = uc.user_id
    WHERE uc.is_used = FALSE
      AND c.end_date BETWEEN NOW() AND DATE_ADD(NOW(), INTERVAL 24 HOUR)
      AND c.is_active = TRUE
  `;

  try {
    const result = await db_connection.execute(query);
    const expiringSoon = (result as any)[0];

    console.log(`📊 24시간 이내 만료 쿠폰: ${expiringSoon.length}개`);

    for (const item of expiringSoon) {
      await sendWebPushNotification(item.user_id, {
        title: '⏰ 쿠폰이 곧 만료됩니다!',
        body: `${item.store_name}의 "${item.coupon_title}" 쿠폰이 24시간 이내에 만료됩니다.`,
        icon: '/icon-192.png',
        data: {
          type: 'expiry',
          couponId: item.coupon_id,
          storeId: item.store_id,
        },
      });
    }

    console.log(`✅ 만료 알림 ${expiringSoon.length}건 전송 완료`);
  } catch (error) {
    console.error('❌ 만료 알림 전송 실패:', error);
  }
}

/**
 * 새 쿠폰 등록 알림
 * 
 * 조건:
 * 1. 즐겨찾기한 가게에 새 쿠폰 등록
 * 2. 자주 방문하는 카테고리에 새 쿠폰 등록
 * 3. 주변 500m 이내 가게에 새 쿠폰 등록
 */
export async function sendNewCouponNotifications() {
  console.log('🔔 새 쿠폰 알림 체크 시작...');
  
  const db_connection = await db.getDb();
  if (!db_connection) {
    console.error('❌ 데이터베이스 연결 실패');
    return;
  }

  // 최근 1시간 이내 등록된 쿠폰 조회
  const query = `
    SELECT 
      c.id as coupon_id,
      c.title as coupon_title,
      c.discount_type,
      c.discount_value,
      s.id as store_id,
      s.name as store_name,
      s.category,
      s.latitude,
      s.longitude
    FROM coupon c
    JOIN store s ON s.id = c.store_id
    WHERE c.created_at >= DATE_SUB(NOW(), INTERVAL 1 HOUR)
      AND c.is_active = TRUE
  `;

  try {
    const result = await db_connection.execute(query);
    const newCoupons = (result as any)[0];

    console.log(`📊 새로 등록된 쿠폰: ${newCoupons.length}개`);

    for (const coupon of newCoupons) {
      // 1. 즐겨찾기한 사용자에게 알림
      const favoriteResult = await db_connection.execute(`
        SELECT user_id
        FROM favorite
        WHERE store_id = ${coupon.store_id}
      `);
      const favoriteUsers = (favoriteResult as any)[0];

      for (const user of favoriteUsers) {
        await sendWebPushNotification(user.user_id, {
          title: '🎁 즐겨찾기 가게에 새 쿠폰!',
          body: `${coupon.store_name}에 "${coupon.title}" 쿠폰이 새로 등록되었습니다.`,
          icon: '/icon-192.png',
          data: {
            type: 'new_coupon',
            couponId: coupon.coupon_id,
            storeId: coupon.store_id,
          },
        });
      }

      // 2. 해당 카테고리를 자주 방문하는 사용자에게 알림
      // (최근 30일 내 3회 이상 방문)
      const categoryResult = await db_connection.execute(`
        SELECT DISTINCT ci.user_id
        FROM check_in ci
        JOIN store s ON s.id = ci.store_id
        WHERE s.category = '${coupon.category}'
          AND ci.checked_in_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)
        GROUP BY ci.user_id
        HAVING COUNT(*) >= 3
      `);
      const categoryUsers = (categoryResult as any)[0];

      for (const user of categoryUsers) {
        await sendWebPushNotification(user.user_id, {
          title: '🎁 관심 카테고리에 새 쿠폰!',
          body: `${coupon.store_name}에 "${coupon.title}" 쿠폰이 새로 등록되었습니다.`,
          icon: '/icon-192.png',
          data: {
            type: 'new_coupon',
            couponId: coupon.coupon_id,
            storeId: coupon.store_id,
          },
        });
      }
    }

    console.log(`✅ 새 쿠폰 알림 전송 완료`);
  } catch (error) {
    console.error('❌ 새 쿠폰 알림 전송 실패:', error);
  }
}

/**
 * 스케줄러 메인 함수
 * 
 * 실행 주기:
 * - 만료 알림: 매일 오전 9시, 오후 6시
 * - 새 쿠폰 알림: 매시간
 */
export async function runScheduler() {
  console.log('🚀 알림 스케줄러 시작');

  // 만료 알림 (매일 2회)
  const now = new Date();
  const hour = now.getHours();
  
  if (hour === 9 || hour === 18) {
    await sendExpiryNotifications();
  }

  // 새 쿠폰 알림 (매시간)
  await sendNewCouponNotifications();

  console.log('✅ 알림 스케줄러 완료');
}

// 개발 환경에서 직접 실행 시
if (require.main === module) {
  runScheduler()
    .then(() => {
      console.log('스케줄러 실행 완료');
      process.exit(0);
    })
    .catch((error) => {
      console.error('스케줄러 실행 실패:', error);
      process.exit(1);
    });
}
