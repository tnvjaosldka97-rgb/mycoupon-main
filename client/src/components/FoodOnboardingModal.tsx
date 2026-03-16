/**
 * FoodOnboardingModal — 로그인 직후 1회 Top3 음식 선호 온보딩 모달
 * - favoriteFoodTop3가 비어있을 때 1회만 표시
 * - localStorage "onboarding_food_top3_dismissed_v1" 키로 재노출 방지
 * - 저장: trpc.users.updateNotificationSettings (기존 API 재사용)
 */
import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/sonner";
import { X } from "lucide-react";
import { trpc } from "@/lib/trpc";

const FOOD_CATEGORIES = [
  "제육볶음", "돈까스", "백반", "커피", "햄버거", "치킨", "피자",
  "국밥", "초밥/일식", "라멘", "분식", "디저트/케이크", "파스타",
  "샌드위치", "쌀국수/베트남", "마라탕", "순대국", "냉면",
  "삼겹살/고기", "짜장면/중식", "닭발/포차", "카페/음료",
] as const;

const PICK_LABELS = ["1픽", "2픽", "3픽"];
const DISMISSED_KEY = "onboarding_food_top3_dismissed_v1";

interface Props {
  open: boolean;
  onClose: () => void;
}

export default function FoodOnboardingModal({ open, onClose }: Props) {
  const [picks, setPicks] = useState<string[]>([]);
  const utils = trpc.useUtils();

  const updateSettings = trpc.users.updateNotificationSettings.useMutation({
    onSuccess: () => {
      utils.users.getNotificationSettings.invalidate();
      utils.auth.me.invalidate();
      localStorage.setItem(DISMISSED_KEY, "true");
      toast.success("취향이 저장되었습니다! 취향저격 쿠폰을 추천해드릴게요 🎁");
      onClose();
    },
    onError: (e: any) => {
      toast.error(e.message || "저장에 실패했습니다. 다시 시도해주세요.");
    },
  });

  const togglePick = (food: string) => {
    if (picks.includes(food)) {
      setPicks(picks.filter(f => f !== food));
    } else {
      if (picks.length >= 3) {
        toast("3개까지 선택 가능합니다.", { duration: 2000 });
        return;
      }
      setPicks([...picks, food]);
    }
  };

  const handleSave = () => {
    if (picks.length < 3) return;
    updateSettings.mutate({ favoriteFoodTop3: picks });
  };

  const handleDismiss = () => {
    localStorage.setItem(DISMISSED_KEY, "true");
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) handleDismiss(); }}>
      <DialogContent className="max-w-md w-full max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-lg font-bold">좋아하는 음식 3가지를 선택해주세요</DialogTitle>
          <DialogDescription className="text-sm text-gray-500">
            1픽 / 2픽 / 3픽 순서로 선택하면 취향저격 쿠폰을 추천해드려요
          </DialogDescription>
        </DialogHeader>

        {/* 선택된 픽 배지 */}
        {picks.length > 0 && (
          <div className="flex flex-wrap gap-2 mb-3">
            {picks.map((food, i) => (
              <span
                key={food}
                className="inline-flex items-center gap-1 px-3 py-1 rounded-full text-sm font-semibold bg-amber-100 text-amber-800 border border-amber-300"
              >
                <span className="text-xs text-amber-600">{PICK_LABELS[i]}</span>
                {food}
                <button
                  onClick={() => setPicks(picks.filter((_, idx) => idx !== i))}
                  className="ml-1 text-amber-500 hover:text-amber-700"
                >
                  <X className="w-3 h-3" />
                </button>
              </span>
            ))}
          </div>
        )}

        {/* 음식 칩 목록 */}
        <div className="flex flex-wrap gap-2">
          {FOOD_CATEGORIES.map((food) => {
            const idx = picks.indexOf(food);
            const selected = idx !== -1;
            return (
              <button
                key={food}
                onClick={() => togglePick(food)}
                className={`px-3 py-1.5 rounded-full text-sm font-medium border transition-colors ${
                  selected
                    ? "bg-amber-400 text-white border-amber-400"
                    : "bg-white text-gray-700 border-gray-300 hover:border-amber-400 hover:text-amber-700"
                }`}
              >
                {selected && <span className="mr-1 text-xs">{PICK_LABELS[idx]}</span>}
                {food}
              </button>
            );
          })}
        </div>

        {/* 버튼 영역 */}
        <div className="flex gap-2 mt-4">
          <Button
            variant="outline"
            className="flex-1"
            onClick={handleDismiss}
            disabled={updateSettings.isPending}
          >
            나중에
          </Button>
          <Button
            className="flex-1 bg-amber-400 hover:bg-amber-500 text-white font-bold"
            onClick={handleSave}
            disabled={picks.length < 3 || updateSettings.isPending}
          >
            {updateSettings.isPending ? "저장 중..." : `저장 (${picks.length}/3)`}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
