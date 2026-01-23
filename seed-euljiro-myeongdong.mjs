import { drizzle } from 'drizzle-orm/mysql2';
import mysql from 'mysql2/promise';
import * as schema from './drizzle/schema.js';

const connection = await mysql.createConnection(process.env.DATABASE_URL);
const db = drizzle(connection, { schema, mode: 'default' });

// 을지로/명동 샘플 쿠폰 데이터
const euljiroMyeongdongCoupons = [
  {
    store: {
      name: "을지로 카페 온더",
      category: "cafe",
      description: "을지로 감성 카페",
      address: "서울 중구 을지로 100",
      latitude: "37.5665",
      longitude: "126.9910",
      phone: "02-1234-5678",
      ownerId: 1
    },
    coupon: {
      title: "아메리카노 50% 할인",
      description: "모든 아메리카노 50% 할인",
      discountType: "percentage",
      discountValue: 50,
      startDate: new Date(),
      endDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      totalQuantity: 100,
      usedQuantity: 0
    }
  },
  {
    store: {
      name: "명동 교자",
      category: "restaurant",
      description: "명동 맛집 교자 전문점",
      address: "서울 중구 명동길 29",
      latitude: "37.5636",
      longitude: "126.9850",
      phone: "02-776-5348",
      ownerId: 1
    },
    coupon: {
      title: "만두 1+1",
      description: "왕만두 1+1 이벤트",
      discountType: "freebie",
      discountValue: 100,
      startDate: new Date(),
      endDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      totalQuantity: 50,
      usedQuantity: 0
    }
  },
  {
    store: {
      name: "을지로 BBQ",
      category: "restaurant",
      description: "치킨 전문점",
      address: "서울 중구 을지로 120",
      latitude: "37.5670",
      longitude: "126.9920",
      phone: "02-2222-3333",
      ownerId: 1
    },
    coupon: {
      title: "황금올리브 30% 할인",
      description: "황금올리브 치킨 30% 할인",
      discountType: "percentage",
      discountValue: 30,
      startDate: new Date(),
      endDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      totalQuantity: 80,
      usedQuantity: 0
    }
  },
  {
    store: {
      name: "명동 네일샵",
      category: "beauty",
      description: "명동 프리미엄 네일샵",
      address: "서울 중구 명동8길 15",
      latitude: "37.5625",
      longitude: "126.9840",
      phone: "02-3333-4444",
      ownerId: 1
    },
    coupon: {
      title: "젤네일 40% 할인",
      description: "모든 젤네일 시술 40% 할인",
      discountType: "percentage",
      discountValue: 40,
      startDate: new Date(),
      endDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      totalQuantity: 30,
      usedQuantity: 0
    }
  },
  {
    store: {
      name: "을지로 스타벅스",
      category: "cafe",
      description: "스타벅스 을지로점",
      address: "서울 중구 을지로 110",
      latitude: "37.5668",
      longitude: "126.9915",
      phone: "1522-3232",
      ownerId: 1
    },
    coupon: {
      title: "음료 20% 할인",
      description: "전 음료 20% 할인 (일부 제외)",
      discountType: "percentage",
      discountValue: 20,
      startDate: new Date(),
      endDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      totalQuantity: 200,
      usedQuantity: 0
    }
  },
  {
    store: {
      name: "명동 본죽",
      category: "restaurant",
      description: "건강한 죽 전문점",
      address: "서울 중구 명동길 35",
      latitude: "37.5630",
      longitude: "126.9845",
      phone: "02-4444-5555",
      ownerId: 1
    },
    coupon: {
      title: "전 메뉴 30% 할인",
      description: "모든 죽 메뉴 30% 할인",
      discountType: "percentage",
      discountValue: 30,
      startDate: new Date(),
      endDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      totalQuantity: 60,
      usedQuantity: 0
    }
  }
];

console.log('을지로/명동 샘플 쿠폰 추가 시작...');

for (const item of euljiroMyeongdongCoupons) {
  try {
    // 가게 추가
    const [store] = await db.insert(schema.stores).values(item.store).$returningId();
    console.log(`✅ 가게 추가: ${item.store.name} (ID: ${store.id})`);

    // 쿠폰 추가
    await db.insert(schema.coupons).values({
      ...item.coupon,
      storeId: store.id,
      remainingQuantity: item.coupon.totalQuantity
    });
    console.log(`✅ 쿠폰 추가: ${item.coupon.title}`);
  } catch (error) {
    console.error(`❌ 오류: ${item.store.name}`, error.message);
  }
}

console.log('✅ 을지로/명동 샘플 쿠폰 추가 완료!');
await connection.end();
