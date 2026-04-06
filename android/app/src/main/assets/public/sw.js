/**
 * Service Worker — Tombstone (Migration v1)
 *
 * 목적: Capacitor 빌드에 번들된 구 SW(v20260123)를 정리하는 migration 단계.
 * main.tsx에서 Capacitor 환경 시 SW를 unregister하지만,
 * 혹시라도 등록된 구 SW가 있다면 이 버전으로 교체되어 캐시를 정리한다.
 * - fetch 핸들러 없음 → 모든 요청 네트워크 직통
 *
 * 다음 단계 (tombstone 안정화 1~2주 후):
 *   SW 등록 코드 + 이 파일 자체 제거
 */

// Tombstone v1 — 2026-04-02
self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

// fetch 핸들러 없음: SW는 어떤 요청도 가로채지 않는다
