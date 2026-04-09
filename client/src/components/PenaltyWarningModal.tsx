import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';

interface PenaltyWarningModalProps {
  open: boolean;
  onClose: () => void;
}

export default function PenaltyWarningModal({ open, onClose }: PenaltyWarningModalProps) {
  // open=false 시 return null 제거:
  // Dialog open=true 상태에서 컴포넌트가 언마운트되면 Radix가 scroll-lock을 해제하지 못해 body lock 잔류.
  // Dialog에 open prop을 넘겨 Radix가 자체 cleanup을 처리하게 한다.
  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-red-700">
            <span className="text-xl">⚠️</span> 이용 주의 안내
          </DialogTitle>
          <DialogDescription asChild>
            <div className="space-y-2 text-sm text-gray-700 mt-2">
              <p>
                비정상적인 참여 패턴이 감지되어 주의 조치가 적용되었습니다.
              </p>
              <p className="font-semibold text-red-700">
                현재 계정은 주 1회만 참여할 수 있습니다.
              </p>
              <p className="text-gray-500">
                동일 또는 추가적인 이상 행위가 확인될 경우 계정 및 기기 이용이 제한될 수 있습니다.
              </p>
            </div>
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button onClick={onClose} className="w-full bg-red-600 hover:bg-red-700 text-white">
            확인
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
