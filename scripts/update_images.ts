import { drizzle } from 'drizzle-orm/mysql2';
import mysql from 'mysql2/promise';
import { stores } from '../drizzle/schema';
import { like, eq } from 'drizzle-orm';
import { crawlNaverPlace } from '../server/naverPlaceCrawler';

async function main() {
  const connection = await mysql.createConnection(process.env.DATABASE_URL!);
  const db = drizzle(connection);
  
  // 헬로웍스 가게 정보 확인
  const result = await db.select({
    id: stores.id,
    name: stores.name,
    naverPlaceUrl: stores.naverPlaceUrl,
    imageUrl: stores.imageUrl
  }).from(stores).where(like(stores.name, '%헬로웍스%')).limit(1);
  
  console.log('현재 가게 정보:', JSON.stringify(result, null, 2));
  
  if (result.length > 0 && result[0].naverPlaceUrl) {
    console.log('네이버 플레이스에서 이미지 크롤링 중...');
    const placeInfo = await crawlNaverPlace(result[0].naverPlaceUrl);
    console.log('크롤링 결과:', JSON.stringify(placeInfo, null, 2));
    
    if (placeInfo?.imageUrls && placeInfo.imageUrls.length > 0) {
      // 최소 3개 이미지 확보
      const images = placeInfo.imageUrls.slice(0, 3);
      const newImageUrl = JSON.stringify(images);
      console.log('업데이트할 이미지 URL:', newImageUrl);
      console.log('이미지 개수:', images.length);
      
      await db.update(stores)
        .set({ imageUrl: newImageUrl })
        .where(eq(stores.id, result[0].id));
      
      console.log('이미지 업데이트 완료!');
    }
  }
  
  await connection.end();
  process.exit(0);
}
main().catch(console.error);
