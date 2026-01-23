import { makeRequest } from './server/_core/map';
import { getDb } from './server/db';
import { stores, coupons } from './drizzle/schema';

const sampleStores = [
  {
    name: '스타벅스 명동입구점',
    category: 'cafe',
    address: '서울 중구 남대문로 68-1',
    phone: '1522-3232',
    coupon: { title: '아메리카노 30% 할인', discountType: 'percentage', discountValue: 30 }
  },
  {
    name: '스타벅스 명동중앙로점',
    category: 'cafe',
    address: '서울 중구 명동길 60',
    phone: '1522-3232',
    coupon: { title: '프라푸치노 20% 할인', discountType: 'percentage', discountValue: 20 }
  },
  {
    name: '스타벅스 별다방점',
    category: 'cafe',
    address: '서울 중구 퇴계로 100',
    phone: '1522-3232',
    coupon: { title: '디저트 세트 15% 할인', discountType: 'percentage', discountValue: 15 }
  },
  {
    name: '투썸플레이스 명동대연각타워점',
    category: 'cafe',
    address: '서울 중구 퇴계로 97',
    phone: '02-318-2388',
    coupon: { title: '케이크 2+1', discountType: 'freebie', discountValue: 0 }
  },
  {
    name: '투썸플레이스 명동예술극장점',
    category: 'cafe',
    address: '서울 중구 명동1가 48-2',
    phone: '02-318-2388',
    coupon: { title: '음료 25% 할인', discountType: 'percentage', discountValue: 25 }
  },
  {
    name: '을지로베로나',
    category: 'cafe',
    address: '서울 중구 을지로3가 320-24',
    phone: '02-2266-0525',
    coupon: { title: '커피 1+1', discountType: 'freebie', discountValue: 0 }
  },
  {
    name: '명동교자 본점',
    category: 'restaurant',
    address: '서울 중구 명동10길 29',
    phone: '0507-1366-5348',
    coupon: { title: '칼국수+만두 세트 10% 할인', discountType: 'percentage', discountValue: 10 }
  },
  {
    name: '명동교자 분점',
    category: 'restaurant',
    address: '서울 중구 명동10길 10',
    phone: '0507-1366-5348',
    coupon: { title: '비빔국수 15% 할인', discountType: 'percentage', discountValue: 15 }
  },
  {
    name: '본죽 명동점',
    category: 'restaurant',
    address: '서울 중구 명동길 52',
    phone: '02-318-2388',
    coupon: { title: '죽 2개 구매 시 1개 무료', discountType: 'freebie', discountValue: 0 }
  },
  {
    name: '을지로 BBQ',
    category: 'restaurant',
    address: '서울 중구 을지로 192',
    phone: '02-2266-0000',
    coupon: { title: '치킨 20% 할인', discountType: 'percentage', discountValue: 20 }
  },
  {
    name: '네일샵 명동점',
    category: 'beauty',
    address: '서울 중구 명동8길 15',
    phone: '02-3333-4444',
    coupon: { title: '젤네일 40% 할인', discountType: 'percentage', discountValue: 40 }
  },
  {
    name: '헤어샵 을지로점',
    category: 'beauty',
    address: '서울 중구 을지로 150',
    phone: '02-2222-3333',
    coupon: { title: '커트+펌 패키지 30% 할인', discountType: 'percentage', discountValue: 30 }
  }
];

async function geocodeAddress(address: string) {
  try {
    const response = await makeRequest('/maps/api/geocode/json', {
      address: address,
      language: 'ko'
    });
    
    if (response.results && response.results.length > 0) {
      const location = response.results[0].geometry.location;
      return {
        lat: location.lat.toString(),
        lng: location.lng.toString()
      };
    }
    return null;
  } catch (error) {
    console.error(`Geocoding failed for ${address}:`, error);
    return null;
  }
}

async function addSampleCoupons() {
  console.log('🚀 샘플 쿠폰 추가 시작...\n');
  
  const db = await getDb();
  if (!db) {
    console.error('❌ DB 연결 실패');
    process.exit(1);
  }
  
  for (const storeData of sampleStores) {
    console.log(`📍 ${storeData.name} 처리 중...`);
    
    // 주소 → GPS 변환
    const coords = await geocodeAddress(storeData.address);
    
    if (!coords) {
      console.log(`❌ ${storeData.name}: GPS 변환 실패\n`);
      continue;
    }
    
    console.log(`   GPS: ${coords.lat}, ${coords.lng}`);
    
    // 가게 등록
    const result = await db.insert(stores).values({
      name: storeData.name,
      category: storeData.category,
      address: storeData.address,
      phone: storeData.phone,
      latitude: coords.lat,
      longitude: coords.lng,
      description: `${storeData.name}에서 특별한 쿠폰을 만나보세요!`,
      ownerId: 1 // 임시 owner ID
    });
    
    const storeId = Number(result[0].insertId);
    console.log(`   ✅ 가게 등록 완료 (ID: ${storeId})`);
    
    // 쿠폰 등록
    const endDate = new Date();
    endDate.setMonth(endDate.getMonth() + 1); // 1개월 후 만료
    
    await db.insert(coupons).values({
      storeId: storeId,
      title: storeData.coupon.title,
      description: `${storeData.name}에서만 사용 가능한 특별 할인 쿠폰입니다.`,
      discountType: storeData.coupon.discountType,
      discountValue: storeData.coupon.discountValue,
      startDate: new Date(),
      endDate: endDate,
      totalQuantity: 1000,
      remainingQuantity: 1000
    });
    
    console.log(`   ✅ 쿠폰 등록 완료\n`);
  }
  
  console.log('🎉 모든 샘플 쿠폰 추가 완료!');
  process.exit(0);
}

addSampleCoupons().catch(error => {
  console.error('❌ 오류 발생:', error);
  process.exit(1);
});
