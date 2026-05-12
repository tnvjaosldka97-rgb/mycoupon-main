-- Manual Migration: notice_posts.category (공지/이벤트 카테고리 분리)
-- 적용일: 2026-05-12 (PR-105)
-- 적용 방법: 운영 DB에 직접 실행 (idempotent, db_apply_0020.mjs 경유)
-- 적용 상태: APPLIED ✅
--
-- 목적:
--   슈퍼어드민 공지/이벤트 게시판 (notice_posts) 글을 카테고리 (공지/이벤트) 로 분리.
--   사용자 측 /notices 페이지에서 탭(공지/이벤트) 으로 필터링 노출.
--   image #2 의 admin 이벤트 팝업 관리 (event_popups) 시스템은 영향 0 — 별개 시스템.
--
-- 추가 컬럼:
--   category VARCHAR(20) NOT NULL DEFAULT 'notice'
--   - 값: 'notice' (공지) | 'event' (이벤트)
--   - 기본값: 'notice' → 기존 글 3건 (안내/공지/마이쿠폰 런칭) 자동 분류
--   - 사장님이 추후 NoticeWriteModal 수정 모달에서 카테고리 변경 가능
--     (예: [런칭 무료 이벤트] 글을 '이벤트' 탭으로 이동)
--
-- 인덱스:
--   idx_notice_posts_category (category, is_pinned, created_at)
--   - 탭별 목록 조회 최적화 (WHERE category=? ORDER BY is_pinned DESC, created_at DESC)
--
-- 적용 확인:
--   \d notice_posts → category 컬럼 + idx_notice_posts_category 인덱스 존재 확인
--   SELECT category, COUNT(*) FROM notice_posts GROUP BY category;
--   → notice = 3 (기존 글 전부 default 분류)
--
-- 롤백 SQL (필요 시):
--   DROP INDEX IF EXISTS idx_notice_posts_category;
--   ALTER TABLE notice_posts DROP COLUMN IF EXISTS category;

BEGIN;

ALTER TABLE notice_posts
  ADD COLUMN IF NOT EXISTS category VARCHAR(20) NOT NULL DEFAULT 'notice';

CREATE INDEX IF NOT EXISTS idx_notice_posts_category
  ON notice_posts (category, is_pinned, created_at);

COMMIT;
