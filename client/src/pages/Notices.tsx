/**
 * client/src/pages/Notices.tsx — 공지/이벤트 게시판 목록 (2026-04-28)
 *
 * - 읽기: public (비로그인도 접근)
 * - 글쓰기: admin role only (목록 우상단 floating button)
 * - 정렬: pinned 상단 + 최신순
 * - 페이지네이션: cursor (무한 스크롤 또는 "더 보기" 버튼)
 */

import { useState } from 'react';
import { Link, useLocation } from 'wouter';
import { trpc } from '../lib/trpc';
import { useAuth } from '../hooks/useAuth';
import { Megaphone, Pin, Eye, ArrowLeft, Pencil } from 'lucide-react';
import { NoticeWriteModal } from '../components/NoticeWriteModal';

export default function Notices() {
  const [, setLocation] = useLocation();
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const [showWriteModal, setShowWriteModal] = useState(false);

  const listQuery = trpc.notices.list.useQuery({ limit: 20 });

  const items = listQuery.data?.items ?? [];

  return (
    <div className="min-h-screen bg-gradient-to-b from-orange-50 to-white">
      {/* Header */}
      <div
        className="sticky top-0 bg-white/80 backdrop-blur-sm border-b border-orange-100 z-10"
        style={{ paddingTop: 'env(safe-area-inset-top, 0px)' }}
      >
        <div className="max-w-2xl mx-auto px-4 py-3 flex items-center justify-between">
          <button
            onClick={() => setLocation('/')}
            className="flex items-center gap-1 text-gray-700 hover:text-orange-600 transition-colors"
          >
            <ArrowLeft className="w-5 h-5" />
            <span className="text-sm font-medium">홈</span>
          </button>
          <h1 className="text-lg font-bold text-gray-900 flex items-center gap-2">
            <Megaphone className="w-5 h-5 text-orange-500" />
            공지/이벤트
          </h1>
          <div className="w-12" />
        </div>
      </div>

      {/* Body */}
      <div className="max-w-2xl mx-auto px-4 py-4 pb-20">
        {listQuery.isLoading && (
          <div className="text-center text-sm text-gray-500 py-12">불러오는 중...</div>
        )}
        {!listQuery.isLoading && items.length === 0 && (
          <div className="text-center text-sm text-gray-500 py-12">
            <Megaphone className="w-12 h-12 mx-auto mb-3 text-orange-200" />
            아직 등록된 공지가 없습니다.
          </div>
        )}
        <div className="space-y-2">
          {items.map((item: any) => (
            <Link key={item.id} href={`/notices/${item.id}`}>
              <a className="block bg-white rounded-xl border border-orange-100 px-4 py-3 hover:border-orange-300 hover:shadow-sm transition-all">
                <div className="flex items-start gap-2">
                  {item.isPinned && (
                    <Pin className="w-4 h-4 text-orange-500 flex-shrink-0 mt-0.5" />
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="font-semibold text-gray-900 truncate">{item.title}</div>
                    <div className="text-xs text-gray-500 mt-0.5 line-clamp-1">{item.preview}</div>
                    <div className="flex items-center gap-3 mt-1.5 text-[11px] text-gray-400">
                      <span>{new Date(item.createdAt as string).toLocaleDateString('ko-KR')}</span>
                      <span className="flex items-center gap-0.5">
                        <Eye className="w-3 h-3" />
                        {item.viewCount.toLocaleString()}
                      </span>
                    </div>
                  </div>
                </div>
              </a>
            </Link>
          ))}
        </div>
      </div>

      {/* Admin floating write button */}
      {isAdmin && (
        <button
          onClick={() => setShowWriteModal(true)}
          className="fixed bottom-6 right-6 w-14 h-14 rounded-full bg-gradient-to-br from-orange-400 to-pink-500 text-white shadow-lg active:scale-95 transition-all flex items-center justify-center"
          aria-label="공지 작성"
        >
          <Pencil className="w-5 h-5" />
        </button>
      )}

      {/* Write modal */}
      {showWriteModal && (
        <NoticeWriteModal
          onClose={() => setShowWriteModal(false)}
          onSuccess={() => {
            setShowWriteModal(false);
            listQuery.refetch();
          }}
        />
      )}
    </div>
  );
}
