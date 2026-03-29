/**
 * EventPopupModal — 이벤트 팝업 (포스터 강조형 대형 팝업)
 * - 이미지 포스터 중심 디자인
 * - '24시간 동안 보지 않기' + '닫기(X)' 버튼
 * - localStorage 기반 24시간 숨김 상태 유지
 */
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { X } from "lucide-react";

interface PopupData {
  id: number;
  title: string;
  body?: string | null;
  imageDataUrl?: string | null;
  primaryButtonText?: string | null;
  primaryButtonUrl?: string | null;
  dismissible: boolean;
}

interface Props {
  popup: PopupData | null;
  onClose: () => void;
}

function get24hKey(id: number) {
  return `event_popup_hide24h_${id}`;
}

function is24hHidden(id: number): boolean {
  const val = localStorage.getItem(get24hKey(id));
  if (!val) return false;
  return Date.now() < Number(val);
}

export default function EventPopupModal({ popup, onClose }: Props) {
  if (!popup) return null;
  if (is24hHidden(popup.id)) {
    // 24시간 숨김 상태면 즉시 닫기 처리
    onClose();
    return null;
  }

  const handleClose = () => {
    localStorage.setItem(`event_popup_seen_${popup.id}`, '1');
    onClose();
  };

  const handleHide24h = () => {
    localStorage.setItem(get24hKey(popup.id), String(Date.now() + 24 * 60 * 60 * 1000));
    localStorage.setItem(`event_popup_seen_${popup.id}`, '1');
    onClose();
  };

  const handleButtonClick = () => {
    if (popup.primaryButtonUrl) {
      window.open(popup.primaryButtonUrl, '_blank', 'noopener');
    }
    handleClose();
  };

  return (
    <Dialog open={!!popup} onOpenChange={(v) => { if (!v && popup.dismissible) handleClose(); }}>
      <DialogContent
        className="max-w-[420px] w-[92vw] p-0 overflow-hidden rounded-2xl shadow-2xl border-0"
        showCloseButton={false}
      >
        {/* X 닫기 버튼 — 이미지 위에 오버레이 */}
        {popup.dismissible && (
          <button
            onClick={handleClose}
            className="absolute top-3 right-3 z-10 w-8 h-8 rounded-full bg-black/40 hover:bg-black/60 flex items-center justify-center text-white transition-colors"
            aria-label="닫기"
          >
            <X className="w-4 h-4" />
          </button>
        )}

        {/* 포스터 이미지 — 강조 영역 */}
        {popup.imageDataUrl ? (
          <div className="w-full">
            <img
              src={popup.imageDataUrl}
              alt={popup.title}
              className="w-full object-cover"
              style={{ maxHeight: '480px', minHeight: '200px' }}
            />
          </div>
        ) : (
          /* 이미지 없을 때 텍스트 영역 */
          <div className="px-6 pt-8 pb-4 bg-gradient-to-br from-orange-50 to-pink-50">
            <h2 className="text-xl font-bold text-gray-900 leading-snug">{popup.title}</h2>
            {popup.body && (
              <p className="mt-3 text-sm text-gray-600 leading-relaxed whitespace-pre-wrap">
                {popup.body}
              </p>
            )}
          </div>
        )}

        {/* 이미지 있을 때 제목/본문 오버레이 (선택) */}
        {popup.imageDataUrl && popup.body && (
          <div className="px-5 pt-4 pb-2">
            <p className="text-sm text-gray-600 leading-relaxed whitespace-pre-wrap">{popup.body}</p>
          </div>
        )}

        {/* 액션 버튼 영역 */}
        <div className="px-5 py-4 flex flex-col gap-2">
          {popup.primaryButtonText && (
            <Button
              className="w-full bg-gradient-to-r from-orange-500 to-pink-500 hover:from-orange-600 hover:to-pink-600 text-white font-bold rounded-xl h-11"
              onClick={handleButtonClick}
            >
              {popup.primaryButtonText}
            </Button>
          )}

          {/* 하단 버튼: 24시간 보지 않기 + 닫기 */}
          {popup.dismissible && (
            <div className="flex gap-2">
              <button
                onClick={handleHide24h}
                className="flex-1 text-xs text-gray-400 hover:text-gray-600 py-1.5 transition-colors"
              >
                24시간 동안 보지 않기
              </button>
              <span className="text-gray-200 self-center">|</span>
              <button
                onClick={handleClose}
                className="flex-1 text-xs text-gray-400 hover:text-gray-600 py-1.5 transition-colors"
              >
                닫기
              </button>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
