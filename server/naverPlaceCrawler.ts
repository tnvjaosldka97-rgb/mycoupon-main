/**
 * 네이버 플레이스 크롤링 서비스
 * m.place.naver.com에서 업체 대표 이미지를 추출합니다.
 */

interface NaverPlaceInfo {
  name?: string;
  imageUrl?: string;
  imageUrls?: string[];  // 여러 이미지 지원
  category?: string;
  address?: string;
  phone?: string;
}

/**
 * 네이버 플레이스 URL에서 place ID 추출
 * 지원 형식:
 * - https://m.place.naver.com/restaurant/1234567890/home
 * - https://map.naver.com/p/entry/place/1234567890
 * - https://naver.me/xxxxx (단축 URL)
 */
export function extractPlaceId(url: string): string | null {
  try {
    // m.place.naver.com 형식
    const mPlaceMatch = url.match(/m\.place\.naver\.com\/\w+\/(\d+)/);
    if (mPlaceMatch) return mPlaceMatch[1];

    // map.naver.com 형식
    const mapMatch = url.match(/map\.naver\.com\/.*place\/(\d+)/);
    if (mapMatch) return mapMatch[1];

    // place.naver.com 형식
    const placeMatch = url.match(/place\.naver\.com\/.*\/(\d+)/);
    if (placeMatch) return placeMatch[1];

    return null;
  } catch {
    return null;
  }
}

/**
 * 이미지 URL에서 고유 식별자 추출 (중복 체크용)
 */
function getImageIdentifier(url: string): string {
  // src 파라미터에서 원본 파일명 추출
  const srcMatch = url.match(/src=([^&]+)/);
  if (srcMatch) {
    // URL 디코딩하여 파일명 추출
    const decoded = decodeURIComponent(srcMatch[1]);
    const fileMatch = decoded.match(/([^/]+)\.(jpg|jpeg|png|webp)/i);
    if (fileMatch) return fileMatch[1];
    return srcMatch[1];
  }
  
  // 파일명 추출
  const fileMatch = url.match(/\/([^/?]+)\.(jpg|jpeg|png|webp)/i);
  if (fileMatch) return fileMatch[1];
  
  return url;
}

/**
 * 네이버 플레이스 페이지에서 정보 크롤링
 */
export async function crawlNaverPlace(url: string): Promise<NaverPlaceInfo | null> {
  try {
    const placeId = extractPlaceId(url);
    if (!placeId) {
      console.error('[NaverPlace] Invalid URL format:', url);
      return null;
    }

    const headers = {
      'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 14_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/14.0 Mobile/15E148 Safari/604.1',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
      'Accept-Language': 'ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7',
    };

    // 1. 홈 페이지에서 기본 정보 가져오기
    const mobileUrl = `https://m.place.naver.com/restaurant/${placeId}/home`;
    const response = await fetch(mobileUrl, { headers });

    if (!response.ok) {
      console.error('[NaverPlace] Failed to fetch page:', response.status);
      return null;
    }

    const html = await response.text();

    // Open Graph 정보 추출
    const ogImageMatch = html.match(/og:image[^>]*content="([^"]+)"/);
    const ogTitleMatch = html.match(/og:title[^>]*content="([^"]+)"/);

    // 모든 이미지 URL 수집 (중복 제거)
    const imageUrls: string[] = [];
    const seenIdentifiers = new Set<string>();

    // 2. 사진 페이지에서 추가 이미지 가져오기
    const photoUrl = `https://m.place.naver.com/restaurant/${placeId}/photo`;
    try {
      const photoResponse = await fetch(photoUrl, { headers });
      if (photoResponse.ok) {
        const photoHtml = await photoResponse.text();
        
        // naverbooking-phinf 및 ldb-phinf 이미지 URL 패턴 검색
        const imgRegex = /https:\/\/search\.pstatic\.net\/common\/\?[^"'\s<>]*src=[^"'\s<>]*(naverbooking-phinf|ldb-phinf)[^"'\s<>]*\.(jpg|jpeg|png|webp)/gi;
        let match;
        while ((match = imgRegex.exec(photoHtml)) !== null) {
          const imgUrl = match[0].replace(/&amp;/g, '&');
          const identifier = getImageIdentifier(imgUrl);
          
          // 중복 체크 및 최대 5개까지만 수집
          if (!seenIdentifiers.has(identifier) && imageUrls.length < 5) {
            imageUrls.push(imgUrl);
            seenIdentifiers.add(identifier);
          }
        }
      }
    } catch (e) {
      console.log('[NaverPlace] Photo page fetch failed, using home page images');
    }

    // 3. 홈 페이지 OG 이미지 추가 (사진 페이지에서 못 가져온 경우)
    if (imageUrls.length === 0 && ogImageMatch?.[1]) {
      const ogImage = ogImageMatch[1].replace(/&amp;/g, '&');
      const identifier = getImageIdentifier(ogImage);
      if (!seenIdentifiers.has(identifier)) {
        imageUrls.push(ogImage);
        seenIdentifiers.add(identifier);
      }
    }

    // 4. 홈 페이지에서 추가 이미지 검색
    if (imageUrls.length < 2) {
      const imgRegex = /https:\/\/search\.pstatic\.net\/common\/\?[^"'\s<>]*src=[^"'\s<>]*naverbooking-phinf[^"'\s<>]*\.(jpg|jpeg|png|webp)/gi;
      let match;
      while ((match = imgRegex.exec(html)) !== null) {
        const imgUrl = match[0].replace(/&amp;/g, '&');
        const identifier = getImageIdentifier(imgUrl);
        
        if (!seenIdentifiers.has(identifier) && imageUrls.length < 5) {
          imageUrls.push(imgUrl);
          seenIdentifiers.add(identifier);
        }
      }
    }

    console.log(`[NaverPlace] Found ${imageUrls.length} unique images for place ${placeId}`);
    
    return {
      name: ogTitleMatch?.[1]?.replace(' : 네이버', '').trim(),
      imageUrl: imageUrls[0],  // 첫 번째 이미지 (하위 호환성)
      imageUrls: imageUrls,    // 모든 이미지 배열
      category: undefined,
      address: undefined,
      phone: undefined,
    };
  } catch (error) {
    console.error('[NaverPlace] Crawling error:', error);
    return null;
  }
}

/**
 * 네이버 플레이스 이미지 URL을 프록시하여 다운로드
 * (CORS 우회 및 이미지 저장용)
 */
export async function downloadNaverImage(imageUrl: string): Promise<Buffer | null> {
  try {
    const response = await fetch(imageUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 14_0 like Mac OS X) AppleWebKit/605.1.15',
        'Referer': 'https://m.place.naver.com/',
      },
    });

    if (!response.ok) {
      console.error('[NaverPlace] Failed to download image:', response.status);
      return null;
    }

    const arrayBuffer = await response.arrayBuffer();
    return Buffer.from(arrayBuffer);
  } catch (error) {
    console.error('[NaverPlace] Image download error:', error);
    return null;
  }
}
