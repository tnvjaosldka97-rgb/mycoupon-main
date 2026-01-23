/**
 * Service Worker for Web PWA
 * 웹 브라우저에서 사용되는 메인 Service Worker
 * Android 빌드용은 sw.js 참고
 */
// Version 3.0.0 - Updated at 2025-12-25 (PWA Optimization + Network Feedback)
// 서비스 워커 버전 (강제 캐시 파기를 위해 타임스탬프 사용)
// 프로덕션 배포 시에도 캐시를 완전히 파기하기 위해 타임스탬프 기반 버전 사용
const CACHE_VERSION = `v3.0.0-${Date.now()}`;
const CACHE_NAME = `mycoupon-cache-${CACHE_VERSION}`;

// 캐시할 파일 목록 (핵심 파일 포함 - 오프라인 지원)
// index.html과 메인 JS/CSS는 동적으로 캐싱되므로 여기서는 정적 리소스만 명시
const urlsToCache = [
  '/',
  '/index.html',
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
  
  // 최소 필수 자원만 먼저 캐싱 (나머지는 백그라운드에서 처리)
  const criticalResources = [
    '/',
    '/index.html',
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
  
  // HTML, CSS, JS 파일은 Stale-While-Revalidate 전략 사용
  if (
    request.mode === 'navigate' || 
    request.headers.get('accept')?.includes('text/html') ||
    url.pathname.endsWith('.css') ||
    url.pathname.endsWith('.js') ||
    url.pathname.includes('/assets/')
  ) {
    event.respondWith(
      caches.match(request).then((cachedResponse) => {
        // 캐시된 응답이 있으면 즉시 반환 (stale)
        const fetchPromise = fetch(request).then((networkResponse) => {
          // 네트워크 응답을 받으면 캐시 업데이트 (revalidate)
          if (networkResponse && networkResponse.status === 200) {
            const responseClone = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(request, responseClone);
            });
          }
          return networkResponse;
        }).catch((error) => {
          console.error(`[Service Worker ${CACHE_VERSION}] Network fetch failed:`, error);
          // 네트워크 실패 시 캐시된 응답 반환
          return cachedResponse || new Response('Network error', { status: 503 });
        });
        
        // 캐시된 응답이 있으면 즉시 반환하고 백그라운드에서 업데이트
        return cachedResponse || fetchPromise;
        })
    );
    return;
  }
  
  // 이미지 및 정적 파일은 Network-First 전략 (캐시 사용)
  event.respondWith(
    fetch(request)
      .then((response) => {
        // 네트워크 응답을 캐시에 저장
        if (response && response.status === 200) {
          const responseClone = response.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(request, responseClone);
          });
        }
        return response;
      })
      .catch(() => {
        // 네트워크 실패 시 캐시에서 가져오기
        return caches.match(request);
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
