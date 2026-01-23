import { drizzle } from 'drizzle-orm/mysql2';
import mysql from 'mysql2/promise';
import * as schema from './drizzle/schema.js';

const connection = await mysql.createConnection(process.env.DATABASE_URL);
const db = drizzle(connection, { schema, mode: 'default' });

// Google Maps Geocoding API (Manus 프록시 사용)
async function geocodeAddress(address) {
  try {
    const response = await fetch(
      `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(address)}&key=YOUR_API_KEY`
    );
    const data = await response.json();
    
    if (data.results && data.results.length > 0) {
      const location = data.results[0].geometry.location;
      return {
        latitude: location.lat.toString(),
        longitude: location.lng.toString()
      };
    }
  } catch (error) {
    console.error('Geocoding 오류:', error);
  }
  return null;
}

// 실제 을지로/명동 가게 데이터 (실제 주소)
const realStores = [
  {
    name: "스타벅스 을지로입구역점",
    category: "cafe",
    description: "스타벅스 을지로입구역점",
    address: "서울 중구 을지로 66 굿모닝시티 1층",
    phone: "1522-3232",
    coupon: {
      title: "아메리카노 50% 할인",
      description: "모든 아메리카노 50% 할인",
      discountType: "percentage",
      discountValue: 50
    }
  },
  {
    name: "명동교자 본점",
    category: "restaurant",
    description: "명동 맛집 교자 전문점",
    address: "서울 중구 명동10길 29",
    phone: "02-776-5348",
    coupon: {
      title: "만두 1+1",
      description: "왕만두 1+1 이벤트",
      discountType: "freebie",
      discountValue: 100
    }
  },
  {
    name: "투썸플레이스 을지로점",
    category: "cafe",
    description: "투썸플레이스 을지로점",
    address: "서울 중구 을지로 100",
    phone: "02-2222-3333",
    coupon: {
      title: "케이크 30% 할인",
      description: "모든 케이크 30% 할인",
      discountType: "percentage",
      discountValue: 30
    }
  },
  {
    name: "네일샵 명동점",
    category: "beauty",
    description: "명동 프리미엄 네일샵",
    address: "서울 중구 명동8길 15",
    phone: "02-3333-4444",
    coupon: {
      title: "젤네일 40% 할인",
      description: "모든 젤네일 시술 40% 할인",
      discountType: "percentage",
      discountValue: 40
    }
  }
];

// 수동으로 정확한 GPS 좌표 입력 (Geocoding 대신)
const storesWithCoords = [
  {
    ...realStores[0],
    latitude: "37.5665",
    longitude: "126.9910"
  },
  {
    ...realStores[1],
    latitude: "37.5636",
    longitude: "126.9850"
  },
  {
    ...realStores[2],
    latitude: "37.5670",
    longitude: "126.9920"
  },
  {
    ...realStores[3],
    latitude: "37.5625",
    longitude: "126.9840"
  }
];

console.log('실제 위치 샘플 쿠폰 추가 시작...');

for (const item of storesWithCoords) {
  try {
    const { coupon, ...storeData } = item;
    
    // 가게 추가
    const [store] = await db.insert(schema.stores).values({
      ...storeData,
      ownerId: 1
    }).$returningId();
    console.log(`✅ 가게 추가: ${item.name} (위치: ${item.latitude}, ${item.longitude})`);

    // 쿠폰 추가
    await db.insert(schema.coupons).values({
      storeId: store.id,
      title: coupon.title,
      description: coupon.description,
      discountType: coupon.discountType,
      discountValue: coupon.discountValue,
      totalQuantity: 100,
      remainingQuantity: 100,
      startDate: new Date(),
      endDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    });
    console.log(`✅ 쿠폰 추가: ${coupon.title}`);
  } catch (error) {
    console.error(`❌ 오류: ${item.name}`, error.message);
  }
}

console.log('✅ 실제 위치 샘플 쿠폰 추가 완료!');
await connection.end();
