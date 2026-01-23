import { drizzle } from 'drizzle-orm/mysql2';
import mysql from 'mysql2/promise';
import * as schema from './drizzle/schema.js';

const connection = await mysql.createConnection(process.env.DATABASE_URL);
const db = drizzle(connection, { schema, mode: 'default' });

const sampleStores = [
  {
    name: '강남 스타벅스',
    category: 'cafe',
    description: '프리미엄 커피 전문점',
    address: '서울 강남구 테헤란로 123',
    phone: '02-1234-5678',
    lat: 37.4979,
    lng: 127.0276,
    couponTitle: '아메리카노 50% 할인',
    couponDescription: '모든 사이즈 아메리카노 50% 할인! 1인 1회 사용 가능',
    discount: '50% OFF',
  },
  {
    name: '청담 카페베네',
    category: 'cafe',
    description: '아늑한 분위기의 카페',
    address: '서울 강남구 청담동 456',
    phone: '02-2345-6789',
    lat: 37.5050,
    lng: 127.0350,
    couponTitle: '음료 1+1',
    couponDescription: '모든 음료 1+1 (같은 메뉴, 낮은 가격 기준)',
    discount: '1+1',
  },
  {
    name: '역삼 본죽',
    category: 'food',
    description: '건강한 죽 전문점',
    address: '서울 강남구 역삼동 789',
    phone: '02-3456-7890',
    lat: 37.4950,
    lng: 127.0350,
    couponTitle: '전 메뉴 30% 할인',
    couponDescription: '모든 죽 메뉴 30% 할인 (배달 제외)',
    discount: '30% OFF',
  },
  {
    name: '삼성 맥도날드',
    category: 'food',
    description: '패스트푸드 레스토랑',
    address: '서울 강남구 삼성동 321',
    phone: '02-4567-8901',
    lat: 37.5100,
    lng: 127.0600,
    couponTitle: '빅맥 세트 20% 할인',
    couponDescription: '빅맥 세트 20% 할인 (음료 업그레이드 가능)',
    discount: '20% OFF',
  },
  {
    name: '논현 네일샵',
    category: 'beauty',
    description: '프리미엄 네일 아트',
    address: '서울 강남구 논현동 654',
    phone: '02-5678-9012',
    lat: 37.5080,
    lng: 127.0250,
    couponTitle: '젤네일 40% 할인',
    couponDescription: '모든 젤네일 시술 40% 할인 (첫 방문 고객)',
    discount: '40% OFF',
  },
  {
    name: '압구정 헤어샵',
    category: 'beauty',
    description: '트렌디한 헤어 디자인',
    address: '서울 강남구 압구정동 987',
    phone: '02-6789-0123',
    lat: 37.5270,
    lng: 127.0280,
    couponTitle: '컷+펌 30% 할인',
    couponDescription: '컷+펌 패키지 30% 할인 (디자이너 지정 가능)',
    discount: '30% OFF',
  },
  {
    name: '선릉 파리바게뜨',
    category: 'cafe',
    description: '신선한 베이커리',
    address: '서울 강남구 선릉역 근처',
    phone: '02-7890-1234',
    lat: 37.5045,
    lng: 127.0490,
    couponTitle: '빵 3개 이상 20% 할인',
    couponDescription: '빵 3개 이상 구매 시 20% 할인',
    discount: '20% OFF',
  },
  {
    name: '강남역 BBQ',
    category: 'food',
    description: '치킨 전문점',
    address: '서울 강남구 강남역 2번 출구',
    phone: '02-8901-2345',
    lat: 37.4980,
    lng: 127.0290,
    couponTitle: '황금올리브 2마리 50% 할인',
    couponDescription: '황금올리브 치킨 2마리 구매 시 50% 할인',
    discount: '50% OFF',
  },
];

console.log('🌱 샘플 쿠폰 데이터 추가 시작...');

for (const store of sampleStores) {
  try {
    // 가게 추가
    const [storeResult] = await db.insert(schema.stores).values({
      name: store.name,
      category: store.category,
      description: store.description,
      address: store.address,
      phone: store.phone,
      latitude: store.lat.toString(),
      longitude: store.lng.toString(),
      ownerId: 1, // 기본 오너
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const storeId = storeResult.insertId;

    // 쿠폰 추가
    await db.insert(schema.coupons).values({
      storeId: storeId,
      title: store.couponTitle,
      description: store.couponDescription,
      discountType: 'percentage',
      discountValue: parseInt(store.discount) || 50,
      minPurchase: 0,
      totalQuantity: 100,
      remainingQuantity: 100,
      startDate: new Date(),
      endDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30일 후
      isActive: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    console.log(`✅ ${store.name} - ${store.couponTitle}`);
  } catch (error) {
    console.error(`❌ ${store.name} 추가 실패:`, error);
  }
}

console.log('🎉 샘플 쿠폰 데이터 추가 완료!');
await connection.end();
