/**
 * client/src/components/NoticeWriteModal.tsx — 공지 작성/수정 모달 (2026-04-28)
 *
 * - admin role only (server adminProcedure 가드)
 * - 이미지: base64 inline, 최대 5장 / 1.5MB per 장
 * - 본문: textarea, 최대 5000자 (whitespace-pre-wrap)
 * - 상단 고정 토글
 *
 * editingPost 가 주어지면 수정 모드, 아니면 신규 작성 모드.
 */

import { useState } from 'react';
import { trpc } from '../lib/trpc';
import { X, Image as ImageIcon, Pin } from 'lucide-react';
// @ts-ignore — sonner type 정의 mismatch (runtime 작동 OK, Home.tsx/MapPage.tsx 와 동일 패턴)
import { toast } from 'sonner';

const MAX_IMAGES = 5;
const MAX_IMAGE_BYTES = 1.5 * 1024 * 1024; // 1.5MB
const MAX_TITLE_LEN = 200;
const MAX_BODY_LEN = 5000;

interface EditingPost {
  id: number;
  title: string;
  body: string;
  imageUrls: string[];
  isPinned: boolean;
}

interface Props {
  editingPost?: EditingPost;
  onClose: () => void;
  onSuccess: () => void;
}

export function NoticeWriteModal({ editingPost, onClose, onSuccess }: Props) {
  const isEdit = !!editingPost;
  const [title, setTitle] = useState(editingPost?.title ?? '');
  const [body, setBody] = useState(editingPost?.body ?? '');
  const [images, setImages] = useState<string[]>(editingPost?.imageUrls ?? []);
  const [isPinned, setIsPinned] = useState(editingPost?.isPinned ?? false);

  const trpcUtils = trpc.useUtils();

  const createMutation = trpc.notices.create.useMutation({
    onSuccess: () => {
      toast.success('공지를 등록했습니다.');
      trpcUtils.notices.list.invalidate();
      onSuccess();
    },
    onError: (e: any) => toast.error(e.message || '등록 실패'),
  });

  const updateMutation = trpc.notices.update.useMutation({
    onSuccess: () => {
      toast.success('공지를 수정했습니다.');
      trpcUtils.notices.list.invalidate();
      if (editingPost) trpcUtils.notices.get.invalidate({ id: editingPost.id });
      onSuccess();
    },
    onError: (e: any) => toast.error(e.message || '수정 실패'),
  });

  const isPending = createMutation.isPending || updateMutation.isPending;

  const handleImageSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    if (files.length === 0) return;

    const remaining = MAX_IMAGES - images.length;
    if (remaining <= 0) {
      toast.error(`이미지는 최대 ${MAX_IMAGES}장까지 첨부할 수 있습니다.`);
      e.target.value = '';
      return;
    }
    const accepted = files.slice(0, remaining);

    accepted.forEach((file) => {
      if (file.size > MAX_IMAGE_BYTES) {
        toast.error(`${file.name} 파일이 1.5MB 를 초과합니다.`);
        return;
      }
      const reader = new FileReader();
      reader.onload = () => {
        const dataUrl = reader.result;
        if (typeof dataUrl === 'string') {
          setImages((prev) => (prev.length >= MAX_IMAGES ? prev : [...prev, dataUrl]));
        }
      };
      reader.onerror = () => toast.error(`${file.name} 읽기 실패`);
      reader.readAsDataURL(file);
    });

    e.target.value = '';
  };

  const removeImage = (idx: number) => {
    setImages((prev) => prev.filter((_, i) => i !== idx));
  };

  const handleSubmit = () => {
    const trimmedTitle = title.trim();
    const trimmedBody = body.trim();
    if (!trimmedTitle) return toast.error('제목을 입력하세요.');
    if (!trimmedBody) return toast.error('본문을 입력하세요.');
    if (trimmedTitle.length > MAX_TITLE_LEN) return toast.error(`제목은 최대 ${MAX_TITLE_LEN}자입니다.`);
    if (trimmedBody.length > MAX_BODY_LEN) return toast.error(`본문은 최대 ${MAX_BODY_LEN}자입니다.`);

    if (isEdit && editingPost) {
      updateMutation.mutate({
        id: editingPost.id,
        title: trimmedTitle,
        body: trimmedBody,
        imageUrls: images,
        isPinned,
      });
    } else {
      createMutation.mutate({
        title: trimmedTitle,
        body: trimmedBody,
        imageUrls: images,
        isPinned,
      });
    }
  };

  return (
    <div
      className="fixed inset-0 bg-black/40 z-[120] flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-2xl w-full max-w-xl max-h-[90vh] overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-orange-100">
          <h2 className="text-lg font-bold text-gray-900">
            {isEdit ? '✏️ 공지 수정' : '✏️ 공지 작성'}
          </h2>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full bg-gray-100 hover:bg-gray-200 flex items-center justify-center"
          >
            <X className="w-4 h-4 text-gray-600" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          {/* Title */}
          <div>
            <label className="text-xs font-bold text-gray-700 mb-1 block">제목</label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              maxLength={MAX_TITLE_LEN}
              placeholder="공지 제목"
              className="w-full px-3 py-2 rounded-lg border border-gray-200 focus:border-orange-400 focus:outline-none text-sm"
            />
            <div className="text-[10px] text-gray-400 text-right mt-0.5">
              {title.length} / {MAX_TITLE_LEN}
            </div>
          </div>

          {/* Body */}
          <div>
            <label className="text-xs font-bold text-gray-700 mb-1 block">본문</label>
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              maxLength={MAX_BODY_LEN}
              placeholder="공지 내용 (줄바꿈 그대로 표시됩니다)"
              rows={10}
              className="w-full px-3 py-2 rounded-lg border border-gray-200 focus:border-orange-400 focus:outline-none text-sm resize-y"
            />
            <div className="text-[10px] text-gray-400 text-right mt-0.5">
              {body.length} / {MAX_BODY_LEN}
            </div>
          </div>

          {/* Images */}
          <div>
            <label className="text-xs font-bold text-gray-700 mb-1 block">
              이미지 첨부 (최대 {MAX_IMAGES}장 / 1.5MB)
            </label>
            <div className="grid grid-cols-3 gap-2">
              {images.map((src, idx) => (
                <div key={idx} className="relative aspect-square rounded-lg overflow-hidden border border-gray-200">
                  <img src={src} alt={`첨부 ${idx + 1}`} className="w-full h-full object-cover" />
                  <button
                    onClick={() => removeImage(idx)}
                    className="absolute top-1 right-1 w-6 h-6 rounded-full bg-black/60 text-white flex items-center justify-center"
                    aria-label="제거"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
              {images.length < MAX_IMAGES && (
                <label className="aspect-square rounded-lg border-2 border-dashed border-gray-300 hover:border-orange-400 cursor-pointer flex flex-col items-center justify-center text-gray-400 transition-colors">
                  <ImageIcon className="w-6 h-6" />
                  <span className="text-[10px] mt-1">추가</span>
                  <input
                    type="file"
                    accept="image/*"
                    multiple
                    onChange={handleImageSelect}
                    className="hidden"
                  />
                </label>
              )}
            </div>
          </div>

          {/* Pin */}
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={isPinned}
              onChange={(e) => setIsPinned(e.target.checked)}
              className="w-4 h-4 accent-orange-500"
            />
            <Pin className="w-4 h-4 text-orange-500" />
            <span className="text-sm text-gray-700">상단 고정</span>
          </label>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-orange-100">
          <button
            onClick={onClose}
            disabled={isPending}
            className="px-4 py-2 rounded-lg text-sm font-medium text-gray-600 hover:bg-gray-100 disabled:opacity-50"
          >
            취소
          </button>
          <button
            onClick={handleSubmit}
            disabled={isPending}
            className="px-4 py-2 rounded-lg text-sm font-bold text-white bg-gradient-to-br from-orange-400 to-pink-500 active:scale-95 disabled:opacity-50 transition-all"
          >
            {isPending ? '처리 중...' : isEdit ? '수정' : '등록'}
          </button>
        </div>
      </div>
    </div>
  );
}
