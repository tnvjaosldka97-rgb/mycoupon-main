/**
 * EventPopupModal — 이벤트 팝업 노출 컴포넌트
 * - 비로그인 포함 ALL 타겟 지원
 * - localStorage로 팝업당 1회 노출 보장
 */
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
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

export default function EventPopupModal({ popup, onClose }: Props) {
  if (!popup) return null;

  const handleClose = () => {
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
        className="max-w-sm w-full p-0 overflow-hidden rounded-2xl"
        showCloseButton={popup.dismissible}
      >
        {popup.imageDataUrl && (
          <img
            src={popup.imageDataUrl}
            alt={popup.title}
            className="w-full object-cover max-h-52"
          />
        )}
        <div className="p-5">
          <DialogHeader>
            <div className="flex items-start justify-between gap-2">
              <DialogTitle className="text-base font-bold leading-snug">{popup.title}</DialogTitle>
              {popup.dismissible && (
                <button onClick={handleClose} className="text-gray-400 hover:text-gray-600 mt-0.5 flex-shrink-0">
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>
            {popup.body && (
              <DialogDescription className="text-sm text-gray-600 mt-1 whitespace-pre-wrap">
                {popup.body}
              </DialogDescription>
            )}
          </DialogHeader>
          <div className="flex gap-2 mt-4">
            {popup.primaryButtonText && (
              <Button className="flex-1 bg-amber-400 hover:bg-amber-500 text-white font-bold" onClick={handleButtonClick}>
                {popup.primaryButtonText}
              </Button>
            )}
            {popup.dismissible && (
              <Button variant="outline" className="flex-1" onClick={handleClose}>
                닫기
              </Button>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
