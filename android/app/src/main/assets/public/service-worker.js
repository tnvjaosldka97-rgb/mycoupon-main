/**
 * Service Worker — Tombstone (Migration v1)
 *
 * 목적: 기존 사용자에게 캐시된 구 SW(v4)를 정리하는 migration 단계.
 * - install: 즉시 skipWaiting → 구 SW를 밀어냄
 * - activate: 모든 캐시 전부 삭제 → clean 상태
 * - fetch: 핸들러 없음 → 모든 요청 네트워크 직통
 *
 * 다음 단계 (tombstone 안정화 1~2주 후):
 *   main.tsx에서 SW 등록 코드 제거 → SW 완전 종료
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
