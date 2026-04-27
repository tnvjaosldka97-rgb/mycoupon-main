/**
 * client/src/pages/NoticeDetail.tsx — 공지 상세 (2026-04-28)
 *
 * - URL: /notices/:id
 * - 읽기: public, viewCount +1 (server)
 * - 수정/삭제: admin role only (상단 우측 버튼)
 */

import { useState } from 'react';
import { useLocation, useRoute } from 'wouter';
import { trpc } from '../lib/trpc';
import { useAuth } from '../hooks/useAuth';
import { ArrowLeft, Pin, Eye, Pencil, Trash2 } from 'lucide-react';
// @ts-ignore — sonner type 정의 mismatch (runtime 작동 OK, Home.tsx/MapPage.tsx 와 동일 패턴)
import { toast } from 'sonner';
import { NoticeWriteModal } from '../components/NoticeWriteModal';

export default function NoticeDetail() {
  const [, setLocation] = useLocation();
  const [, params] = useRoute<{ id: string }>('/notices/:id');
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const [showEditModal, setShowEditModal] = useState(false);

  const idNum = params ? parseInt(params.id, 10) : NaN;
  const detailQuery = trpc.notices.get.useQuery(
    { id: idNum },
    { enabled: !Number.isNaN(idNum) },
  );
  const trpcUtils = trpc.useUtils();

  const deleteMutation = trpc.notices.delete.useMutation({
    onSuccess: () => {
      toast.success('공지를 삭제했습니다.');
      trpcUtils.notices.list.invalidate();
      setLocation('/notices');
    },
    onError: (e: any) => toast.error(e.message || '삭제 실패'),
  });

  const post = detailQuery.data;

  return (
    <div className="min-h-screen bg-gradient-to-b from-orange-50 to-white">
      {/* Header */}
      <div
        className="sticky top-0 bg-white/80 backdrop-blur-sm border-b border-orange-100 z-10"
        style={{ paddingTop: 'env(safe-area-inset-top, 0px)' }}
      >
        <div className="max-w-2xl mx-auto px-4 py-3 flex items-center justify-between">
          <button
            onClick={() => setLocation('/notices')}
            className="flex items-center gap-1 text-gray-700 hover:text-orange-600 transition-colors"
          >
            <ArrowLeft className="w-5 h-5" />
            <span className="text-sm font-medium">목록</span>
          </button>
          {isAdmin && post && (
            <div className="flex items-center gap-1">
              <button
                onClick={() => setShowEditModal(true)}
                className="w-9 h-9 rounded-full bg-orange-100 hover:bg-orange-200 flex items-center justify-center transition-colors"
                aria-label="수정"
              >
                <Pencil className="w-4 h-4 text-orange-600" />
              </button>
              <button
                onClick={() => {
                  if (!confirm('이 공지를 삭제하시겠습니까?')) return;
                  deleteMutation.mutate({ id: post.id });
                }}
                disabled={deleteMutation.isPending}
                className="w-9 h-9 rounded-full bg-red-100 hover:bg-red-200 flex items-center justify-center transition-colors disabled:opacity-50"
                aria-label="삭제"
              >
                <Trash2 className="w-4 h-4 text-red-600" />
              </button>
            </div>
          )}
          {!isAdmin && <div className="w-12" />}
        </div>
      </div>

      {/* Body */}
      <div className="max-w-2xl mx-auto px-4 py-5 pb-20">
        {detailQuery.isLoading && (
          <div className="text-center text-sm text-gray-500 py-12">불러오는 중...</div>
        )}
        {detailQuery.error && (
          <div className="text-center text-sm text-red-500 py-12">
            {detailQuery.error.message || '공지를 불러오지 못했습니다.'}
          </div>
        )}
        {post && (
          <article className="bg-white rounded-2xl border border-orange-100 px-5 py-5 shadow-sm">
            {/* Title + meta */}
            <div className="border-b border-orange-100 pb-3 mb-4">
              <div className="flex items-start gap-2">
                {post.isPinned && (
                  <Pin className="w-5 h-5 text-orange-500 flex-shrink-0 mt-1" />
                )}
                <h1 className="text-xl font-bold text-gray-900 leading-snug">{post.title}</h1>
              </div>
              <div className="flex items-center gap-3 mt-2 text-xs text-gray-400">
                <span>{new Date(post.createdAt as string).toLocaleString('ko-KR')}</span>
                <span className="flex items-center gap-0.5">
                  <Eye className="w-3.5 h-3.5" />
                  {post.viewCount.toLocaleString()}
                </span>
              </div>
            </div>

            {/* Body */}
            <div className="text-sm text-gray-800 leading-relaxed whitespace-pre-wrap break-words">
              {post.body}
            </div>

            {/* Image gallery */}
            {Array.isArray(post.imageUrls) && post.imageUrls.length > 0 && (
              <div className="mt-5 space-y-3">
                {(post.imageUrls as string[]).map((src, idx) => (
                  <img
                    key={idx}
                    src={src}
                    alt={`첨부 이미지 ${idx + 1}`}
                    className="w-full rounded-xl border border-orange-100"
                  />
                ))}
              </div>
            )}
          </article>
        )}
      </div>

      {/* Edit modal */}
      {showEditModal && post && (
        <NoticeWriteModal
          editingPost={{
            id: post.id,
            title: post.title,
            body: post.body,
            imageUrls: Array.isArray(post.imageUrls) ? (post.imageUrls as string[]) : [],
            isPinned: post.isPinned,
          }}
          onClose={() => setShowEditModal(false)}
          onSuccess={() => {
            setShowEditModal(false);
            detailQuery.refetch();
          }}
        />
      )}
    </div>
  );
}
