/**
 * Speculative Preloading 유틸리티
 *
 * 동작 원리:
 *   dynamic import()를 Hover/TouchStart 시점에 호출 → 브라우저가 청크를 미리 다운로드
 *   실제 내비게이션 클릭 시에는 이미 캐시된 청크를 즉시 사용 → 체감 속도 0ms
 *
 * 사용법:
 *   <span onMouseEnter={preloadPage.map} onTouchStart={preloadPage.map}>
 *
 * 주의:
 *   - 함수 호출이 아닌 참조로 전달할 것 (preloadPage.map, NOT preloadPage.map())
 *   - import()는 Promise를 반환하며 중복 호출 시 브라우저가 자동으로 캐시 사용
 */
export const preloadPage = {
  map:                  () => import("../pages/MapPage"),
  coupons:              () => import("../pages/CouponMap"),
  myCoupons:            () => import("../pages/MyCoupons"),
  gamification:         () => import("../pages/Gamification"),
  rewards:              () => import("../pages/Rewards"),
  storeDetail:          () => import("../pages/StoreDetail"),
  searchResults:        () => import("../pages/SearchResults"),
  myVisits:             () => import("../pages/MyVisits"),
  adminDashboard:       () => import("../pages/AdminDashboard"),
  merchantAnalytics:    () => import("../pages/MerchantAnalytics"),
  notificationSettings: () => import("../pages/NotificationSettings"),
};
