/**
 * Service Worker for Web PWA
 * 웹 브라우저에서 사용되는 메인 Service Worker
 * Android 빌드용은 sw.js 참고
 */
// Version 4.0.0 - Updated at 2026-01-24 (Standalone Mode Fix)
// 간소화된 Service Worker - 최소한의 캐싱만 수행
const CACHE_VERSION = 'v4-20260124';
const CACHE_NAME = `mycoupon-${CACHE_VERSION}`;

// 캐시할 파일 목록 (핵심 파일 포함 - 오프라인 지원)
// HTML은 fetch 이벤트에서 동적으로 캐싱 (여기서는 정적 리소스만)
const urlsToCache = [
  '/manifest.json',
  '/icon-192.png',
  '/icon-512.png',
  '/logo-bear-nobg.png',
];

// SKIP_WAITING 메시지 리스너 (즉시 활성화)
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    console.log(`[Service Worker ${CACHE_VERSION}] SKIP_WAITING message received, activating immediately...`);
    self.skipWaiting();
  }
});

// 서비스 워커 설치 - 최소 필수 자원만 먼저 캐싱
self.addEventListener('install', (event) => {
  console.log(`[Service Worker ${CACHE_VERSION}] Installing... (최소 필수 자원만 캐싱)`);
  
  // 최소 필수 자원만 먼저 캐싱 (HTML은 fetch에서 처리)
  const criticalResources = [
    '/manifest.json',
  ];
  
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log(`[Service Worker ${CACHE_VERSION}] Critical resources caching...`);
      // 최소 필수 자원만 먼저 캐싱
      return cache.addAll(criticalResources).then(() => {
        console.log(`[Service Worker ${CACHE_VERSION}] Critical resources cached, caching other assets in background...`);
        // 나머지 자원은 백그라운드에서 캐싱 (실패해도 계속 진행)
        return Promise.allSettled(
          urlsToCache
            .filter(url => !criticalResources.includes(url))
            .map(url => cache.add(url).catch(err => {
              console.warn(`[Service Worker ${CACHE_VERSION}] Failed to cache ${url}:`, err);
              return null;
            }))
        );
      });
    })
  );
  // 새 버전 즉시 활성화 (Immediately 전략)
  self.skipWaiting();
});

// 서비스 워커 활성화
self.addEventListener('activate', (event) => {
  console.log(`[Service Worker ${CACHE_VERSION}] Activating... (FORCE CACHE CLEAR)`);
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      // 모든 이전 캐시 완전 삭제 (강제 캐시 클리어)
      console.log(`[Service Worker ${CACHE_VERSION}] Found ${cacheNames.length} caches to delete`);
      return Promise.all(
        cacheNames.map((cacheName) => {
          console.log(`[Service Worker ${CACHE_VERSION}] Deleting cache:`, cacheName);
          return caches.delete(cacheName);
        })
      );
    }).then(() => {
      // 모든 클라이언트에 즉시 제어권 부여 및 강제 새로고침
      return self.clients.claim().then(() => {
        // 모든 클라이언트에 새 버전 알림 및 강제 새로고침 요청
        return self.clients.matchAll().then((clients) => {
          clients.forEach((client) => {
            client.postMessage({ type: 'FORCE_RELOAD', version: CACHE_VERSION });
          });
        });
      });
    })
  );
});

// Stale-While-Revalidate 전략: 핵심 파일들을 오프라인에서도 즉시 로드 가능하게
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);
  
  // API 요청은 절대 캐싱하지 않음 (로그인/인증 요청 등)
  if (
    url.pathname.startsWith('/api/') ||
    url.pathname.includes('/trpc/') ||
    url.pathname.includes('/auth/') ||
    request.headers.get('authorization') ||
    request.headers.get('cookie')
  ) {
    // API 요청은 네트워크에서만 가져오기 (캐시 완전 제외)
    event.respondWith(
      fetch(request, {
        cache: 'no-store',
        credentials: 'include',
      }).catch((error) => {
        console.error(`[Service Worker ${CACHE_VERSION}] API fetch failed:`, error);
        return new Response('Network error', { status: 503 });
      })
    );
    return;
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
