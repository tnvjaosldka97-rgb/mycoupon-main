/**
 * Service Worker for Web PWA
 * 웹 브라우저에서 사용되는 메인 Service Worker
 * Android 빌드용은 sw.js 참고
 */
// Version 4.0.0 - Updated at 2026-01-24 (Standalone Mode Fix)
// 간소화된 Service Worker - 최소한의 캐싱만 수행
const CACHE_VERSION = 'v2026031618043';
const CACHE_NAME = `mycoupon-${CACHE_VERSION}`;

// 설치 속도 최적화: 필수 파일만 캐싱 (나머지는 런타임에)
const urlsToCache = [
  '/manifest.json', // PWA 설치에 필수
];

// SKIP_WAITING 메시지 리스너 (즉시 활성화)
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    console.log(`[Service Worker ${CACHE_VERSION}] SKIP_WAITING message received, activating immediately...`);
    self.skipWaiting();
  }
});

// 서비스 워커 설치 - 초고속 설치 (캐싱 최소화)
self.addEventListener('install', (event) => {
  console.log(`[Service Worker ${CACHE_VERSION}] Installing... (instant)`);
  
  // 캐싱 없이 즉시 설치 (fetch 이벤트에서 동적 캐싱)
  // 설치 속도 최대화: 0.1초 이내 완료
  event.waitUntil(Promise.resolve());
  
  // 즉시 활성화
  self.skipWaiting();
  console.log(`[Service Worker ${CACHE_VERSION}] Installed instantly!`);
});

// 서비스 워커 활성화 — 구버전 캐시 삭제 후 클라이언트 제어
self.addEventListener('activate', (event) => {
  console.log(`[SW ${CACHE_VERSION}] Activating...`);
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames
          .filter((name) => name !== CACHE_NAME) // 현재 버전 외 전부 삭제
          .map((name) => {
            console.log(`[SW] Deleting old cache: ${name}`);
            return caches.delete(name);
          })
      );
    }).then(() => self.clients.claim())
  );
  console.log(`[SW ${CACHE_VERSION}] Active!`);
});

// Stale-While-Revalidate 전략: 핵심 파일들을 오프라인에서도 즉시 로드 가능하게
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);
  
  // API/tRPC 요청: SW가 절대 개입하지 않음 (무한 루프 방지)
  // event.respondWith를 호출하지 않으면 브라우저가 직접 네트워크 요청 처리
  // → initiator가 service-worker.js로 찍히는 현상 방지
  if (
    url.pathname.startsWith('/api/') ||
    url.pathname.startsWith('/trpc/') ||
    url.pathname.startsWith('/auth/')
  ) {
    return; // SW 개입 없이 브라우저 기본 동작 위임
  }
  
  // 모든 리소스는 Network-First (캐시는 백업용만)
  // Standalone 모드 안정성을 위해 최대한 단순하게
  event.respondWith(
    fetch(request)
      .then((response) => {
        console.log(`[SW] Fetched: ${url.pathname}`);
        return response;
      })
      .catch((error) => {
        console.error(`[SW] Fetch failed:`, url.pathname, error);
        // 캐시에서 찾기
        return caches.match(request).then((cached) => {
          if (cached) {
            console.log(`[SW] Serving from cache: ${url.pathname}`);
            return cached;
          }
          // 캐시도 없으면 기본 에러
          return new Response('Resource not available', { status: 503 });
        });
      })
  );
});

// 푸시 알림 수신
self.addEventListener('push', (event) => {
  console.log(`[Service Worker ${CACHE_VERSION}] Push received:`, event);
  
  const data = event.data ? event.data.json() : {};
  const title = data.title || '마이쿠폰';
  const options = {
    body: data.body || '새로운 쿠폰이 있습니다!',
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    data: data.url || '/',
    vibrate: [200, 100, 200],
    tag: 'coupon-notification',
    requireInteraction: false,
  };

  event.waitUntil(
    self.registration.showNotification(title, options)
  );
});

// 알림 클릭 처리
self.addEventListener('notificationclick', (event) => {
  console.log(`[Service Worker ${CACHE_VERSION}] Notification clicked:`, event);
  event.notification.close();

  event.waitUntil(
    clients.openWindow(event.notification.data || '/')
  );
});
