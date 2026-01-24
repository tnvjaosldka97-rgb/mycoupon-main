import { pgTable, pgEnum, serial, text, timestamp, varchar, boolean, numeric, integer } from "drizzle-orm/pg-core";

/**
 * Enums
 */
export const roleEnum = pgEnum("role", ["user", "admin", "merchant"]);
export const ageGroupEnum = pgEnum("age_group", ["10s", "20s", "30s", "40s", "50s"]);
export const genderEnum = pgEnum("gender", ["male", "female", "other"]);
export const categoryEnum = pgEnum("category", ["cafe", "restaurant", "beauty", "hospital", "fitness", "other"]);
export const discountTypeEnum = pgEnum("discount_type", ["percentage", "fixed", "freebie"]);
export const statusEnum = pgEnum("status", ["active", "used", "expired"]);
export const transactionStatusEnum = pgEnum("transaction_status", ["pending", "paid", "cancelled"]);
export const missionTypeEnum = pgEnum("mission_type", ["daily", "weekly"]);
export const pointTransactionTypeEnum = pgEnum("point_transaction_type", ["earn", "spend", "bonus", "mission", "referral"]);
export const notificationTypeEnum = pgEnum("notification_type", ["coupon_expiring", "new_coupon", "nearby_store", "mission_complete", "level_up", "general"]);
export const emailTypeEnum = pgEnum("email_type", ["new_coupon", "expiry_reminder"]);
export const emailStatusEnum = pgEnum("email_status", ["pending", "sent", "failed"]);
export const updateModeEnum = pgEnum("update_mode", ["none", "soft", "hard"]);
export const eventTypeEnum = pgEnum("event_type", ["landing_view", "install_cta_view", "install_cta_click", "appinstalled", "first_open_standalone", "login_complete"]);
export const bannerTypeEnum = pgEnum("banner_type", ["info", "warning", "error", "maintenance"]);
export const interactionTypeEnum = pgEnum("interaction_type", ["view", "click", "dismiss"]);
export const errorTypeEnum = pgEnum("error_type", ["js_error", "promise_rejection", "api_failure", "network_error"]);

/**
 * Core user table backing auth flow.
 */
export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  openId: varchar("open_id", { length: 64 }).notNull().unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  loginMethod: varchar("login_method", { length: 64 }),
  role: roleEnum("role").default("user").notNull(),
  ageGroup: ageGroupEnum("age_group"), // 연령대 (10대, 20대, 30대, 40대, 50대 이상)
  gender: genderEnum("gender"), // 성별 (남성, 여성, 선택 안 함)
  preferredDistrict: varchar("preferred_district", { length: 50 }), // 주로 활동하는 지역 (강동구, 성동구, 마포구 등)
  profileCompletedAt: timestamp("profile_completed_at"), // 프로필 완성 시간
  emailNotificationsEnabled: boolean("email_notifications_enabled").default(true).notNull(), // 이메일 알림 수신 여부
  newCouponNotifications: boolean("new_coupon_notifications").default(true).notNull(), // 신규 쿠폰 알림 수신 여부
  expiryNotifications: boolean("expiry_notifications").default(true).notNull(), // 만료 임박 알림 수신 여부
  locationNotificationsEnabled: boolean("location_notifications_enabled").default(false).notNull(), // 위치 기반 알림 수신 여부
  notificationRadius: integer("notification_radius").default(200), // 알림 반경 (100, 200, 500 미터)
  lastLatitude: varchar("last_latitude", { length: 50 }), // 마지막 위치 위도
  lastLongitude: varchar("last_longitude", { length: 50 }), // 마지막 위치 경도
  lastLocationUpdate: timestamp("last_location_update"), // 마지막 위치 업데이트 시간
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
  lastSignedIn: timestamp("last_signed_in").defaultNow().notNull(),
});

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;

/**
 * Stores table - 가게 정보
 */
export const stores = pgTable("stores", {
  id: serial("id").primaryKey(),
  ownerId: integer("owner_id").notNull(), // users.id 참조
  name: varchar("name", { length: 255 }).notNull(),
  category: categoryEnum("category").notNull(), // 카페, 음식점, 뷰티, 병원, 헬스장, 기타
  description: text("description"),
  address: text("address").notNull(),
  latitude: varchar("latitude", { length: 50 }),
  longitude: varchar("longitude", { length: 50 }),
  phone: varchar("phone", { length: 20 }),
  district: varchar("district", { length: 50 }), // 업장 소재 지역 (강동구, 성동구, 마포구 등)
  imageUrl: text("image_url"),
  naverPlaceUrl: text("naver_place_url"), // 네이버 플레이스 링크 (m.place.naver.com)
  rating: numeric("rating", { precision: 2, scale: 1 }).default("0.0"), // 별점 (1.0~5.0, 관리자 수동 조정 가능)
  ratingCount: integer("rating_count").default(0), // 별점 개수 (관리자 수동 조정 가능)
  openingHours: text("opening_hours"), // JSON 형태로 저장
  adminComment: text("admin_comment"), // 관리자 한줄평
  adminCommentAuthor: varchar("admin_comment_author", { length: 100 }), // 한줄평 작성자
  isActive: boolean("is_active").default(true).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export type Store = typeof stores.$inferSelect;
export type InsertStore = typeof stores.$inferInsert;

/**
 * Coupons table - 쿠폰 정보
 */
export const coupons = pgTable("coupons", {
  id: serial("id").primaryKey(),
  storeId: integer("store_id").notNull().references(() => stores.id, { onDelete: 'cascade' }), // stores.id 참조
  title: varchar("title", { length: 255 }).notNull(), // 쿠폰 제목
  description: text("description"), // 쿠폰 설명
  discountType: discountTypeEnum("discount_type").notNull(), // 할인 유형
  discountValue: integer("discount_value").notNull(), // 할인 값 (% 또는 원)
  minPurchase: integer("min_purchase").default(0), // 최소 구매 금액
  maxDiscount: integer("max_discount"), // 최대 할인 금액
  totalQuantity: integer("total_quantity").notNull(), // 총 발행 수량
  remainingQuantity: integer("remaining_quantity").notNull(), // 남은 수량
  startDate: timestamp("start_date").notNull(), // 시작일
  endDate: timestamp("end_date").notNull(), // 종료일
  isActive: boolean("is_active").default(true).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export type Coupon = typeof coupons.$inferSelect;
export type InsertCoupon = typeof coupons.$inferInsert;

/**
 * User Coupons table - 사용자가 다운로드한 쿠폰
 */
export const userCoupons = pgTable("user_coupons", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => users.id, { onDelete: 'cascade' }), // users.id 참조
  couponId: integer("coupon_id").notNull().references(() => coupons.id, { onDelete: 'cascade' }), // coupons.id 참조
  couponCode: varchar("coupon_code", { length: 20 }).notNull().unique(), // 고유 쿠폰 번호 (예: CPN-2024-001234)
  pinCode: varchar("pin_code", { length: 6 }).notNull(), // 6자리 PIN 코드
  deviceId: varchar("device_id", { length: 255 }), // 기기 ID (중복 다운로드 방지)
  qrCode: text("qr_code"), // QR 코드 데이터 (base64) - 레거시
  status: statusEnum("status").default("active").notNull(),
  downloadedAt: timestamp("downloaded_at").defaultNow().notNull(),
  usedAt: timestamp("used_at"),
  expiresAt: timestamp("expires_at").notNull(),
  expiryNotificationSent: boolean("expiry_notification_sent").default(false).notNull(), // 만료 24시간 전 알림 발송 여부
});

export type UserCoupon = typeof userCoupons.$inferSelect;
export type InsertUserCoupon = typeof userCoupons.$inferInsert;

/**
 * Coupon Usage table - 쿠폰 사용 내역
 */
export const couponUsage = pgTable("coupon_usage", {
  id: serial("id").primaryKey(),
  userCouponId: integer("user_coupon_id").notNull(), // user_coupons.id 참조
  storeId: integer("store_id").notNull(), // stores.id 참조
  userId: integer("user_id").notNull(), // users.id 참조
  verifiedBy: integer("verified_by").notNull(), // 검증한 사장님 users.id
  usedAt: timestamp("used_at").defaultNow().notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type CouponUsage = typeof couponUsage.$inferSelect;
export type InsertCouponUsage = typeof couponUsage.$inferInsert;

/**
 * User Stats table - 사용자 게임화 통계
 */
export const userStats = pgTable("user_stats", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().unique(), // users.id 참조
  points: integer("points").default(0).notNull(), // 포인트
  level: integer("level").default(1).notNull(), // 레벨 (1=브론즈, 2=실버, 3=골드, 4=다이아)
  totalCouponsDownloaded: integer("total_coupons_downloaded").default(0).notNull(),
  totalCouponsUsed: integer("total_coupons_used").default(0).notNull(),
  consecutiveCheckIns: integer("consecutive_check_ins").default(0).notNull(), // 연속 출석일
  lastCheckInDate: timestamp("last_check_in_date"),
  totalCheckIns: integer("total_check_ins").default(0).notNull(),
  referralCode: varchar("referral_code", { length: 20 }).unique(), // 초대 코드
  referredBy: integer("referred_by"), // 추천인 users.id
  totalReferrals: integer("total_referrals").default(0).notNull(), // 추천한 사람 수
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export type UserStats = typeof userStats.$inferSelect;
export type InsertUserStats = typeof userStats.$inferInsert;

/**
 * Badges table - 뱃지 정의
 */
export const badges = pgTable("badges", {
  id: serial("id").primaryKey(),
  name: varchar("name", { length: 100 }).notNull().unique(),
  description: text("description"),
  icon: varchar("icon", { length: 50 }), // 이모지 또는 아이콘 이름
  requirement: text("requirement"), // JSON 형태로 조건 저장
  points: integer("points").default(0).notNull(), // 획득 시 포인트
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type Badge = typeof badges.$inferSelect;
export type InsertBadge = typeof badges.$inferInsert;

/**
 * User Badges table - 사용자가 획득한 뱃지
 */
export const userBadges = pgTable("user_badges", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(), // users.id 참조
  badgeId: integer("badge_id").notNull(), // badges.id 참조
  earnedAt: timestamp("earned_at").defaultNow().notNull(),
});

export type UserBadge = typeof userBadges.$inferSelect;
export type InsertUserBadge = typeof userBadges.$inferInsert;

/**
 * Check Ins table - 출석 체크 기록
 */
export const checkIns = pgTable("check_ins", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(), // users.id 참조
  checkInDate: timestamp("check_in_date").notNull(), // 출석 날짜
  points: integer("points").default(10).notNull(), // 획득 포인트
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type CheckIn = typeof checkIns.$inferSelect;
export type InsertCheckIn = typeof checkIns.$inferInsert;

/**
 * Favorites table - 즐겨찾기
 */
export const favorites = pgTable("favorites", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(), // users.id 참조
  storeId: integer("store_id").notNull(), // stores.id 참조
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type Favorite = typeof favorites.$inferSelect;
export type InsertFavorite = typeof favorites.$inferInsert;

/**
 * Reviews table - 리뷰
 */
export const reviews = pgTable("reviews", {
  id: serial("id").primaryKey(),
  storeId: integer("store_id").notNull(), // stores.id 참조
  userId: integer("user_id").notNull(), // users.id 참조
  userCouponId: integer("user_coupon_id"), // user_coupons.id 참조 (쿠폰 사용 후 리뷰)
  rating: integer("rating").notNull(), // 1-5점
  content: text("content"),
  imageUrls: text("image_urls"), // JSON 배열 형태로 저장
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export type Review = typeof reviews.$inferSelect;
export type InsertReview = typeof reviews.$inferInsert;

/**
 * Visits table - 방문 기록
 */
export const visits = pgTable("visits", {
  id: serial("id").primaryKey(),
  storeId: integer("store_id").notNull(), // stores.id 참조
  userId: integer("user_id"), // users.id 참조 (선택적, 비로그인 사용자도 기록)
  visitedAt: timestamp("visited_at").defaultNow().notNull(),
  source: varchar("source", { length: 50 }).notNull(), // 'search', 'recommendation', 'direct' 등
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type Visit = typeof visits.$inferSelect;
export type InsertVisit = typeof visits.$inferInsert;

/**
 * Search Logs table - 검색 로그
 */
export const searchLogs = pgTable("search_logs", {
  id: serial("id").primaryKey(),
  userId: integer("user_id"), // users.id 참조 (선택적)
  query: varchar("query", { length: 255 }).notNull(),
  category: varchar("category", { length: 100 }),
  location: varchar("location", { length: 255 }),
  resultCount: integer("result_count").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type SearchLog = typeof searchLogs.$inferSelect;
export type InsertSearchLog = typeof searchLogs.$inferInsert;

/**
 * Ad Transactions table - 광고비 거래 기록
 */
export const adTransactions = pgTable("ad_transactions", {
  id: serial("id").primaryKey(),
  storeId: integer("store_id").notNull(), // stores.id 참조
  visitId: integer("visit_id").notNull(), // visits.id 참조
  amount: integer("amount").notNull(), // 광고비 (센트 단위)
  status: transactionStatusEnum("status").default("pending").notNull(),
  paidAt: timestamp("paid_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export type AdTransaction = typeof adTransactions.$inferSelect;
export type InsertAdTransaction = typeof adTransactions.$inferInsert;

/**
 * Missions table - 일일 미션 정의
 */
export const missions = pgTable("missions", {
  id: serial("id").primaryKey(),
  type: missionTypeEnum("type").notNull(),
  title: varchar("title", { length: 255 }).notNull(),
  description: text("description"),
  requirement: text("requirement"), // JSON 형태로 조건 저장 {type: 'use_coupon', count: 3}
  rewardPoints: integer("reward_points").notNull(),
  isActive: boolean("is_active").default(true).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type Mission = typeof missions.$inferSelect;
export type InsertMission = typeof missions.$inferInsert;

/**
 * User Missions table - 사용자 미션 진행 상황
 */
export const userMissions = pgTable("user_missions", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(), // users.id 참조
  missionId: integer("mission_id").notNull(), // missions.id 참조
  progress: integer("progress").default(0).notNull(), // 현재 진행도
  isCompleted: boolean("is_completed").default(false).notNull(),
  completedAt: timestamp("completed_at"),
  resetDate: timestamp("reset_date").notNull(), // 미션 리셋 날짜 (일일/주간)
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export type UserMission = typeof userMissions.$inferSelect;
export type InsertUserMission = typeof userMissions.$inferInsert;

/**
 * Point Transactions table - 포인트 거래 내역
 */
export const pointTransactions = pgTable("point_transactions", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(), // users.id 참조
  amount: integer("amount").notNull(), // 포인트 변동량 (+ 또는 -)
  type: pointTransactionTypeEnum("type").notNull(),
  description: text("description"),
  relatedId: integer("related_id"), // 관련 ID (쿠폰 ID, 미션 ID 등)
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type PointTransaction = typeof pointTransactions.$inferSelect;
export type InsertPointTransaction = typeof pointTransactions.$inferInsert;

/**
 * Notifications table - 푸시 알림 기록
 */
export const notifications = pgTable("notifications", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(), // users.id 참조
  title: varchar("title", { length: 255 }).notNull(),
  message: text("message").notNull(),
  type: notificationTypeEnum("type").notNull(),
  isRead: boolean("is_read").default(false).notNull(),
  relatedId: integer("related_id"), // 관련 ID (쿠폰 ID, 가게 ID 등)
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type Notification = typeof notifications.$inferSelect;
export type InsertNotification = typeof notifications.$inferInsert;

/**
 * Email Logs table - 이메일 발송 기록
 */
export const emailLogs = pgTable("email_logs", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(), // users.id 참조
  email: varchar("email", { length: 320 }).notNull(),
  type: emailTypeEnum("type").notNull(),
  subject: varchar("subject", { length: 255 }).notNull(),
  content: text("content").notNull(),
  status: emailStatusEnum("status").default("pending").notNull(),
  errorMessage: text("error_message"),
  sentAt: timestamp("sent_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type EmailLog = typeof emailLogs.$inferSelect;
export type InsertEmailLog = typeof emailLogs.$inferInsert;

/**
 * Session Logs table - 세션 로그 (버전/브라우저 분포 추적)
 */
export const sessionLogs = pgTable("session_logs", {
  id: serial("id").primaryKey(),
  userId: integer("user_id"), // users.id 참조 (선택적)
  appVersion: varchar("app_version", { length: 20 }).notNull(),
  browser: varchar("browser", { length: 100 }).notNull(), // "Chrome 120", "Safari 17", etc.
  isPwa: boolean("is_pwa").notNull(),
  isKakaoInapp: boolean("is_kakao_inapp").notNull(),
  userAgent: text("user_agent"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type SessionLog = typeof sessionLogs.$inferSelect;
export type InsertSessionLog = typeof sessionLogs.$inferInsert;

/**
 * App Versions table - 앱 버전 관리 (강제 업데이트)
 */
export const appVersions = pgTable("app_versions", {
  id: serial("id").primaryKey(),
  version: varchar("version", { length: 20 }).notNull().unique(), // 예: "1.0.0"
  minVersion: varchar("min_version", { length: 20 }).notNull(), // 최소 지원 버전 (하드 블록)
  recommendedVersion: varchar("recommended_version", { length: 20 }).notNull(), // 권장 버전 (소프트 블록)
  updateMode: updateModeEnum("update_mode").default("none").notNull(), // 업데이트 모드
  updateMessage: text("update_message"), // 업데이트 안내 메시지
  updateUrl: text("update_url"), // 업데이트 다운로드 URL
  isActive: boolean("is_active").default(true).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export type AppVersion = typeof appVersions.$inferSelect;
export type InsertAppVersion = typeof appVersions.$inferInsert;

/**
 * Install Funnel Events table - 설치 퍼널 측정
 */
export const installFunnelEvents = pgTable("install_funnel_events", {
  id: serial("id").primaryKey(),
  sessionId: varchar("session_id", { length: 255 }).notNull(), // 세션 ID (UUID)
  userId: integer("user_id"), // users.id 참조 (선택적, 로그인 전에는 null)
  eventType: eventTypeEnum("event_type").notNull(),
  deviceType: varchar("device_type", { length: 50 }), // 'android', 'ios', 'desktop'
  browserType: varchar("browser_type", { length: 50 }), // 'chrome', 'safari', 'inapp_kakao', 'inapp_naver', etc.
  osVersion: varchar("os_version", { length: 50 }),
  appVersion: varchar("app_version", { length: 20 }),
  referrer: text("referrer"), // 유입 경로
  metadata: text("metadata"), // JSON 형태로 추가 정보 저장
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type InstallFunnelEvent = typeof installFunnelEvents.$inferSelect;
export type InsertInstallFunnelEvent = typeof installFunnelEvents.$inferInsert;

/**
 * Emergency Banners table - 긴급 공지/차단 배너
 */
export const emergencyBanners = pgTable("emergency_banners", {
  id: serial("id").primaryKey(),
  title: varchar("title", { length: 255 }).notNull(),
  content: text("content").notNull(),
  type: bannerTypeEnum("type").default("info").notNull(),
  priority: integer("priority").default(0).notNull(), // 높을수록 우선순위 높음
  linkUrl: text("link_url"), // 클릭 시 이동할 URL
  linkText: varchar("link_text", { length: 100 }), // 링크 버튼 텍스트
  targetVersions: text("target_versions"), // JSON 배열: ["1.0.0", "1.0.1"]
  targetBrowsers: text("target_browsers"), // JSON 배열: ["chrome", "safari"]
  targetOS: text("target_os"), // JSON 배열: ["android", "ios"]
  isActive: boolean("is_active").default(true).notNull(),
  startDate: timestamp("start_date"),
  endDate: timestamp("end_date"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export type EmergencyBanner = typeof emergencyBanners.$inferSelect;
export type InsertEmergencyBanner = typeof emergencyBanners.$inferInsert;

/**
 * Banner Interactions table - 배너 노출/클릭 추적
 */
export const bannerInteractions = pgTable("banner_interactions", {
  id: serial("id").primaryKey(),
  bannerId: integer("banner_id").notNull().references(() => emergencyBanners.id, { onDelete: 'cascade' }),
  userId: integer("user_id"), // users.id 참조 (선택적)
  sessionId: varchar("session_id", { length: 255 }).notNull(),
  interactionType: interactionTypeEnum("interaction_type").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type BannerInteraction = typeof bannerInteractions.$inferSelect;
export type InsertBannerInteraction = typeof bannerInteractions.$inferInsert;

/**
 * Client Errors table - 클라이언트 오류 수집
 */
export const clientErrors = pgTable("client_errors", {
  id: serial("id").primaryKey(),
  userId: integer("user_id"), // users.id 참조 (선택적)
  sessionId: varchar("session_id", { length: 255 }).notNull(),
  appVersion: varchar("app_version", { length: 20 }).notNull(),
  errorType: errorTypeEnum("error_type").notNull(),
  errorMessage: text("error_message").notNull(),
  errorStack: text("error_stack"),
  url: text("url"), // 에러 발생 페이지 URL
  userAgent: text("user_agent"),
  deviceType: varchar("device_type", { length: 50 }),
  browserType: varchar("browser_type", { length: 50 }),
  osVersion: varchar("os_version", { length: 50 }),
  metadata: text("metadata"), // JSON 형태로 추가 정보 저장
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type ClientError = typeof clientErrors.$inferSelect;
export type InsertClientError = typeof clientErrors.$inferInsert;

/**
 * Feature Flags table - 기능 플래그 / 점진 롤아웃
 */
export const featureFlags = pgTable("feature_flags", {
  id: serial("id").primaryKey(),
  name: varchar("name", { length: 100 }).notNull().unique(), // 예: "new_checkout_flow"
  description: text("description"),
  isEnabled: boolean("is_enabled").default(false).notNull(),
  rolloutPercentage: integer("rollout_percentage").default(0).notNull(), // 0-100
  targetUserGroups: text("target_user_groups"), // JSON 배열: ["beta_testers", "premium_users"]
  targetVersions: text("target_versions"), // JSON 배열: ["1.0.0", "1.0.1"]
  metadata: text("metadata"), // JSON 형태로 추가 설정 저장
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export type FeatureFlag = typeof featureFlags.$inferSelect;
export type InsertFeatureFlag = typeof featureFlags.$inferInsert;

/**
 * User Feature Flags table - 사용자별 Feature Flag 할당
 */
export const userFeatureFlags = pgTable("user_feature_flags", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => users.id, { onDelete: 'cascade' }),
  flagId: integer("flag_id").notNull().references(() => featureFlags.id, { onDelete: 'cascade' }),
  isEnabled: boolean("is_enabled").default(true).notNull(),
  assignedAt: timestamp("assigned_at").defaultNow().notNull(),
});

export type UserFeatureFlag = typeof userFeatureFlags.$inferSelect;
export type InsertUserFeatureFlag = typeof userFeatureFlags.$inferInsert;

/**
 * Version Stats table - 버전 분포 통계 (실시간 집계)
 */
export const versionStats = pgTable("version_stats", {
  id: serial("id").primaryKey(),
  appVersion: varchar("app_version", { length: 20 }).notNull(),
  deviceType: varchar("device_type", { length: 50 }).notNull(),
  browserType: varchar("browser_type", { length: 50 }).notNull(),
  osVersion: varchar("os_version", { length: 50 }),
  isPWA: boolean("is_pwa").default(false).notNull(), // standalone 모드 여부
  isInAppBrowser: boolean("is_in_app_browser").default(false).notNull(),
  userCount: integer("user_count").default(0).notNull(),
  lastUpdatedAt: timestamp("last_updated_at").defaultNow().notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type VersionStat = typeof versionStats.$inferSelect;
export type InsertVersionStat = typeof versionStats.$inferInsert;
