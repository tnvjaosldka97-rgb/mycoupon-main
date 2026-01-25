/**
 * Service Worker for Android Build
 * Android 앱 빌드에서 사용되는 Service Worker
 * 웹 브라우저용은 service-worker.js 참고
 */
// Service Worker - Simplified for Standalone mode stability
const CACHE_VERSION = 'v4-20260124';
const CACHE_NAME = `mycoupon-${CACHE_VERSION}`;

// 캐시할 파일 목록 (HTML 완전 제외, 정적 이미지만)
const urlsToCache = [
  '/manifest.json',
  '/icon-192.png',
  '/icon-512.png',
  '/logo-bear-nobg.png',
];

// SKIP_WAITING 메시지 리스너 (즉시 활성화)
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    console.log('[SW] SKIP_WAITING message received, activating immediately...');
    self.skipWaiting();
  }
  
  // 클라이언트에게 버전 정보 전달
  if (event.data && event.data.type === 'GET_VERSION') {
    event.ports[0]?.postMessage({ 
      version: CACHE_VERSION,
      timestamp: new Date().toISOString()
    });
  }
});

// Install event
self.addEventListener('install', (event) => {
  console.log(`[SW ${CACHE_VERSION}] Installing...`);
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => {
        console.log('[SW] Caching static assets');
        return cache.addAll(urlsToCache).catch((err) => {
          console.warn('[SW] Cache addAll failed (non-critical):', err);
          // 캐싱 실패해도 설치는 진행 (네트워크 오류 무시)
          return Promise.resolve();
        });
      })
  );
  // 🚀 새 버전 즉시 활성화 (PWA 업데이트 시 즉시 반영)
  self.skipWaiting();
});

// Activate event - 모든 이전 캐시 완전 삭제
self.addEventListener('activate', (event) => {
  console.log(`[SW ${CACHE_VERSION}] Activating...`);
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames
          .filter((cacheName) => cacheName !== CACHE_NAME) // 현재 버전 캐시는 유지
          .map((cacheName) => {
            // 이전 버전 캐시만 삭제
            console.log('[SW] Deleting old cache:', cacheName);
            return caches.delete(cacheName);
          })
      );
    }).then(() => {
      // 새 캐시 생성 (이미 있으면 스킵)
      return caches.open(CACHE_NAME).then((cache) => {
        console.log('[SW] Ensuring cache exists:', CACHE_NAME);
        return cache.addAll(urlsToCache).catch((err) => {
          console.warn('[SW] Cache refresh failed (non-critical):', err);
          return Promise.resolve();
        });
      });
    }).then(() => {
      // 🚀 즉시 모든 클라이언트 제어 (새 SW가 즉시 동작)
      console.log('[SW] Claiming all clients immediately');
      return self.clients.claim();
    }).then(() => {
      // 모든 클라이언트에게 업데이트 알림
      return self.clients.matchAll().then((clients) => {
        clients.forEach((client) => {
          client.postMessage({
            type: 'SW_UPDATED',
            version: CACHE_VERSION,
            message: '새 버전이 활성화되었습니다.'
          });
        });
      });
    })
  );
});

// Network-Only 전략: HTML은 절대 캐시하지 않음
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);
  
  // ⚠️ CRITICAL: OAuth 관련 요청은 절대 캐시하지 않음 (서비스 워커 완전 우회)
  // Google OAuth 콜백, 토큰 교환, 세션 설정 등을 방해하지 않도록 즉시 반환
  if (
    url.pathname.includes('/oauth/') ||
    url.pathname.includes('/api/auth/') ||
    url.pathname.includes('/auth/') ||
    url.hostname.includes('google.com') ||
    url.hostname.includes('accounts.google.com') ||
    url.hostname.includes('oauth2.googleapis.com')
  ) {
    console.log('[SW] OAuth request detected - BYPASSING service worker:', url.pathname);
    // 서비스 워커를 완전히 우회하고 네트워크로 직접 전달
    return;
  }
  
  // HTML 파일은 Stale-While-Revalidate (오프라인 지원)
  if (
    request.mode === 'navigate' || 
    request.headers.get('accept')?.includes('text/html') ||
    url.pathname.endsWith('.html') ||
    url.pathname === '/' ||
    url.pathname.startsWith('/admin') ||
    url.pathname.startsWith('/map') ||
    url.pathname.startsWith('/install')
  ) {
    event.respondWith(
      caches.open(CACHE_NAME).then((cache) => {
        return fetch(request, {
          cache: 'no-store',
          headers: {
            'Cache-Control': 'no-cache, no-store, must-revalidate',
          }
        })
          .then((response) => {
            console.log('[SW] HTML fetched from network:', url.pathname);
            // 네트워크에서 가져온 HTML을 캐시에 저장 (백업용)
            cache.put(request, response.clone());
            return response;
          })
          .catch((error) => {
            console.warn('[SW] Network failed for HTML, trying cache:', error);
            // 네트워크 실패 시 캐시된 HTML 반환 (오프라인 지원)
            return cache.match(request).then((cached) => {
              if (cached) {
                console.log('[SW] Serving cached HTML (offline):', url.pathname);
                return cached;
              }
              // 캐시도 없으면 기본 오프라인 페이지
              return new Response(
                '<html><body><h1>오프라인</h1><p>인터넷 연결을 확인해주세요.</p></body></html>',
                { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' } }
              );
            });
          });
      })
    );
    return;
  }
  
  // CSS, JS 파일도 Network-Only (절대 캐시하지 않음)
  if (url.pathname.endsWith('.css') || url.pathname.endsWith('.js')) {
    event.respondWith(
      fetch(request, {
        cache: 'no-store',
        headers: {
          'Cache-Control': 'no-cache, no-store, must-revalidate',
          'Pragma': 'no-cache',
          'Expires': '0'
        }
      })
        .then((response) => {
          console.log('[SW] CSS/JS fetched from network:', url.pathname);
          return response;
        })
        .catch((error) => {
          console.error('[SW] Network error for CSS/JS:', error);
          return new Response('Network error', { status: 503 });
        })
    );
    return;
  }
  
  // healthz 엔드포인트는 항상 네트워크 우선 (캐시 완전 제외)
  if (url.pathname === '/healthz') {
    event.respondWith(
      fetch(request, {
        cache: 'no-store',
        headers: {
          'Cache-Control': 'no-cache, no-store, must-revalidate',
          'Pragma': 'no-cache',
          'Expires': '0'
        }
      })
    );
    return;
  }
  
  // API 요청은 Network-Only (캐시하지 않음)
  if (url.pathname.includes('/api/')) {
    event.respondWith(
      fetch(request).catch(() => {
        return new Response(JSON.stringify({ error: 'Network unavailable' }), {
          status: 503,
          headers: { 'Content-Type': 'application/json' }
        });
      })
    );
    return;
  }
  
  // 정적 이미지 파일만 Cache-First 전략
  if (
    url.pathname.endsWith('.png') ||
    url.pathname.endsWith('.jpg') ||
    url.pathname.endsWith('.jpeg') ||
    url.pathname.endsWith('.svg') ||
    url.pathname.endsWith('.webp') ||
    url.pathname.endsWith('.json')
  ) {
    event.respondWith(
      caches.match(request).then((cachedResponse) => {
        if (cachedResponse) {
          console.log('[SW] Serving from cache:', url.pathname);
          return cachedResponse;
        }
        return fetch(request).then((response) => {
          if (response && response.status === 200) {
            const responseClone = response.clone();
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(request, responseClone);
            });
          }
          return response;
        });
      })
    );
    return;
  }
  
  // 기타 모든 요청은 Network-Only
  event.respondWith(fetch(request));
});

// Push notification
self.addEventListener('push', (event) => {
  console.log('[SW] Push received:', event);
  
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

// Notification click
self.addEventListener('notificationclick', (event) => {
  console.log('[SW] Notification clicked:', event);
  event.notification.close();

  event.waitUntil(
    clients.openWindow(event.notification.data || '/')
  );
});

// Background Sync - 오프라인 쿠폰 동기화
self.addEventListener('sync', (event) => {
  console.log('[SW] Background sync triggered:', event.tag);
  
  if (event.tag === 'sync-offline-coupons') {
    event.waitUntil(syncOfflineCoupons());
  }
});

async function syncOfflineCoupons() {
  try {
    const db = await openDB();
    const tx = db.transaction('offlineCoupons', 'readonly');
    const store = tx.objectStore('offlineCoupons');
    const coupons = await getAllFromStore(store);
    
    console.log('[SW] Syncing', coupons.length, 'offline coupons');
    
    for (const coupon of coupons) {
      try {
        const response = await fetch('/api/trpc/couponUsage.verify', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(coupon.data),
        });
        
        if (response.ok) {
          const deleteTx = db.transaction('offlineCoupons', 'readwrite');
          const deleteStore = deleteTx.objectStore('offlineCoupons');
          await deleteFromStore(deleteStore, coupon.id);
          console.log('[SW] Synced coupon:', coupon.couponCode);
        }
      } catch (error) {
        console.error('[SW] Failed to sync coupon:', error);
      }
    }
    
    const clients = await self.clients.matchAll();
    clients.forEach((client) => {
      client.postMessage({ type: 'SYNC_COMPLETE', syncedCount: coupons.length });
    });
  } catch (error) {
    console.error('[SW] Sync failed:', error);
    throw error;
  }
}

function openDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('MyCouponDB', 1);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains('offlineCoupons')) {
        const store = db.createObjectStore('offlineCoupons', { keyPath: 'id', autoIncrement: true });
        store.createIndex('couponCode', 'couponCode', { unique: false });
        store.createIndex('timestamp', 'timestamp', { unique: false });
      }
    };
  });
}

function getAllFromStore(store) {
  return new Promise((resolve, reject) => {
    const request = store.getAll();
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function deleteFromStore(store, id) {
  return new Promise((resolve, reject) => {
    const request = store.delete(id);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}
