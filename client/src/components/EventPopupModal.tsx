/**
 * EventPopupModal — 이벤트 팝업 (포스터 강조형 대형 팝업)
 * - 이미지 포스터 중심 디자인
 * - '24시간 동안 보지 않기' + '닫기(X)' 버튼
 * - X 닫기: 현재 표시만 닫기 (저장 없음)
 * - 24시간 닫기: localStorage에 user+popup 스코프로 저장
 */
import { useRef } from "react";
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
  userId?: number | null;
  onClose: () => void;
}

export function get24hKey(uid: string | number, popupId: number) {
  return `event_popup_hide24h_${uid}_${popupId}`;
}

export function is24hHidden(uid: string | number, popupId: number): boolean {
  const val = localStorage.getItem(get24hKey(uid, popupId));
  if (!val) return false;
  return Date.now() < Number(val);
}

export default function EventPopupModal({ popup, userId, onClose }: Props) {
  const uid = userId ?? 'anon';

  // scroll-lock 잔류 방지:
  // popup=null 시 즉시 return null 하면 Dialog가 open=true 상태인 채로 언마운트되어
  // Radix scroll-lock이 body에 잔류한다.
  // snapshotRef로 마지막 popup을 보관해 Dialog가 open=false 상태로 정상 닫히게 한다.
  const snapshotRef = useRef<PopupData | null>(null);

  // 24h 숨김 상태 체크 (popup이 있을 때만)
  if (popup && is24hHidden(uid, popup.id)) {
    onClose();
    return null;
  }

  // 팝업이 있고 숨김 아닐 때만 snapshot 갱신
  if (popup) snapshotRef.current = popup;

  // Dialog를 한 번도 열지 않은 경우에만 null 반환 (scroll-lock 없음)
  const displayPopup = snapshotRef.current;
  if (!displayPopup) return null;

  const isOpen = !!popup;

  // X 닫기: 현재 표시만 닫기. localStorage에 아무것도 저장하지 않음.
  const handleClose = () => {
    onClose();
    // 다음 팝업이 있으면 재평가 트리거 (다중 팝업 순서 보장)
    setTimeout(() => {
      window.dispatchEvent(new Event('popup-recheck'));
    }, 300);
  };

  // 24시간 닫기: user+popup 스코프로 localStorage에 저장
  const handleHide24h = () => {
    localStorage.setItem(get24hKey(uid, displayPopup.id), String(Date.now() + 24 * 60 * 60 * 1000));
    onClose();
  };

  const handleButtonClick = () => {
    if (displayPopup.primaryButtonUrl) {
      window.open(displayPopup.primaryButtonUrl, '_blank', 'noopener');
    }
    handleClose();
  };

  return (
    <Dialog open={isOpen} onOpenChange={(v) => { if (!v && displayPopup.dismissible) handleClose(); }}>
      <DialogContent
        className="max-w-[420px] w-[92vw] p-0 overflow-hidden rounded-2xl shadow-2xl border-0"
        showCloseButton={false}
      >
        {/* X 닫기 버튼 — 이미지 위에 오버레이 */}
        {displayPopup.dismissible && (
          <button
            onClick={handleClose}
            className="absolute top-3 right-3 z-10 w-8 h-8 rounded-full bg-black/40 hover:bg-black/60 flex items-center justify-center text-white transition-colors"
            aria-label="닫기"
          >
            <X className="w-4 h-4" />
          </button>
        )}

        {/* 포스터 이미지 — 강조 영역 */}
        {displayPopup.imageDataUrl ? (
          <div className="w-full">
            <img
              src={displayPopup.imageDataUrl}
              alt={displayPopup.title}
              className="w-full object-cover"
              style={{ maxHeight: '480px', minHeight: '200px' }}
            />
          </div>
        ) : (
          /* 이미지 없을 때 텍스트 영역 */
          <div className="px-6 pt-8 pb-4 bg-gradient-to-br from-orange-50 to-pink-50">
            <h2 className="text-xl font-bold text-gray-900 leading-snug">{displayPopup.title}</h2>
            {displayPopup.body && (
              <p className="mt-3 text-sm text-gray-600 leading-relaxed whitespace-pre-wrap">
                {displayPopup.body}
              </p>
            )}
          </div>
        )}

        {/* 이미지 있을 때 제목/본문 오버레이 (선택) */}
        {displayPopup.imageDataUrl && displayPopup.body && (
          <div className="px-5 pt-4 pb-2">
            <p className="text-sm text-gray-600 leading-relaxed whitespace-pre-wrap">{displayPopup.body}</p>
          </div>
        )}

        {/* 액션 버튼 영역 */}
        <div className="px-5 py-4 flex flex-col gap-2">
          {displayPopup.primaryButtonText && (
            <Button
              className="w-full bg-gradient-to-r from-orange-500 to-pink-500 hover:from-orange-600 hover:to-pink-600 text-white font-bold rounded-xl h-11"
              onClick={handleButtonClick}
            >
              {displayPopup.primaryButtonText}
            </Button>
          )}

          {/* 하단 버튼: 24시간 보지 않기 + 닫기 */}
          {displayPopup.dismissible && (
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
