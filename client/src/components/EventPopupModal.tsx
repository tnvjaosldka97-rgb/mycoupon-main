/**
 * EventPopupModal — 이벤트 팝업 (포스터 강조형 대형 팝업)
 *
 * 닫기 동작:
 * - X 닫기: sessionStorage에 저장 (현재 세션/탭에서만 숨김)
 * - 24시간 닫기: localStorage에 popup ID 단위로 24h expiry 저장
 * - 자세히 보기: /my-coupons 상단 공지 영역으로 이동
 */
import { useRef } from "react";
import { useLocation } from "wouter";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { X } from "lucide-react";
import {
  dismissPopupForSession,
  dismissPopupFor24Hours,
  is24hDismissed,
  isSessionDismissed,
} from "@/lib/popupUtils";

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

export default function EventPopupModal({ popup, onClose }: Props) {
  const [, navigate] = useLocation();

  // scroll-lock 잔류 방지:
  // popup=null 시 즉시 return null 하면 Dialog가 open=true 상태인 채로 언마운트되어
  // Radix scroll-lock이 body에 잔류한다.
  // snapshotRef로 마지막 popup을 보관해 Dialog가 open=false 상태로 정상 닫히게 한다.
  const snapshotRef = useRef<PopupData | null>(null);

  // 이미 숨김 상태인 팝업이면 렌더하지 않음
  if (popup && (isSessionDismissed(popup.id) || is24hDismissed(popup.id))) {
    onClose();
    return null;
  }

  if (popup) snapshotRef.current = popup;

  const displayPopup = snapshotRef.current;
  if (!displayPopup) return null;

  const isOpen = !!popup;

  // X 닫기: 세션 스코프 숨김
  const handleClose = () => {
    dismissPopupForSession(displayPopup.id);
    onClose();
  };

  // 24시간 닫기: localStorage 영속 숨김
  const handleHide24h = () => {
    dismissPopupFor24Hours(displayPopup.id);
    onClose();
  };

  // 자세히 보기: 공지 상세로 이동
  const handleDetail = () => {
    dismissPopupForSession(displayPopup.id);
    onClose();
    if (displayPopup.primaryButtonUrl) {
      // 외부 링크면 새 탭
      if (displayPopup.primaryButtonUrl.startsWith('http')) {
        window.open(displayPopup.primaryButtonUrl, '_blank', 'noopener');
      } else {
        navigate(displayPopup.primaryButtonUrl);
      }
    } else {
      // 링크 없으면 내 쿠폰 찾기(공지 영역)로 이동
      navigate('/my-coupons');
    }
  };

  return (
    <Dialog open={isOpen} modal={false} onOpenChange={(v) => { if (!v && displayPopup.dismissible) handleClose(); }}>
      <DialogContent
        className="max-w-[420px] w-[92vw] p-0 overflow-hidden rounded-2xl shadow-2xl border-0"
        showCloseButton={false}
      >
        {/* X 닫기 버튼 */}
        {displayPopup.dismissible && (
          <button
            onClick={handleClose}
            className="absolute top-3 right-3 z-10 w-8 h-8 rounded-full bg-black/40 hover:bg-black/60 flex items-center justify-center text-white transition-colors"
            aria-label="닫기"
          >
            <X className="w-4 h-4" />
          </button>
        )}

        {/* 포스터 이미지 */}
        {displayPopup.imageDataUrl ? (
          <div className="w-full cursor-pointer" onClick={handleDetail}>
            <img
              src={displayPopup.imageDataUrl}
              alt={displayPopup.title}
              className="w-full object-cover"
              style={{ maxHeight: '480px', minHeight: '200px' }}
            />
          </div>
        ) : (
          <div className="px-6 pt-8 pb-4 bg-gradient-to-br from-orange-50 to-pink-50 cursor-pointer" onClick={handleDetail}>
            <h2 className="text-xl font-bold text-gray-900 leading-snug">{displayPopup.title}</h2>
            {displayPopup.body && (
              <p className="mt-3 text-sm text-gray-600 leading-relaxed whitespace-pre-wrap">
                {displayPopup.body}
              </p>
            )}
          </div>
        )}

        {/* 이미지 있을 때 본문 */}
        {displayPopup.imageDataUrl && displayPopup.body && (
          <div className="px-5 pt-4 pb-2">
            <p className="text-sm text-gray-600 leading-relaxed whitespace-pre-wrap">{displayPopup.body}</p>
          </div>
        )}

        {/* 액션 버튼 영역 */}
        <div className="px-5 py-4 flex flex-col gap-2">
          {/* 자세히 보기 버튼 */}
          <Button
            className="w-full bg-gradient-to-r from-orange-500 to-pink-500 hover:from-orange-600 hover:to-pink-600 text-white font-bold rounded-xl h-11"
            onClick={handleDetail}
          >
            {displayPopup.primaryButtonText || '자세히 보기'}
          </Button>

          {/* 하단: 24시간 보지 않기 | 닫기 */}
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
