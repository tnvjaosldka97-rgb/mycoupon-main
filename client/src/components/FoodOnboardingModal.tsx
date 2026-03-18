/**
 * FoodOnboardingModal — Top3 음식 선호 온보딩 모달
 * - 비로그인: 3개 선택 완료 시 로그인 CTA 표시 → 선택값 localStorage 임시 저장
 * - 로그인: trpc.users.updateNotificationSettings로 DB 저장
 * - localStorage "onboarding_food_top3_dismissed_v1" 키로 재노출 방지
 */
import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/sonner";
import { X, LogIn } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { getLoginUrl } from "@/lib/const";
import { openGoogleLogin } from "@/lib/capacitor";

const FOOD_CATEGORIES = [
  "제육볶음", "돈까스", "백반", "커피", "햄버거", "치킨", "피자",
  "국밥", "초밥/일식", "라멘", "분식", "디저트/케이크", "파스타",
  "샌드위치", "쌀국수/베트남", "마라탕", "순대국", "냉면",
  "삼겹살/고기", "짜장면/중식", "닭발/포차", "카페/음료",
] as const;

const PICK_LABELS = ["1픽", "2픽", "3픽"];
const DISMISSED_KEY = "onboarding_food_top3_dismissed_v1";
const TEMP_FOOD_KEY = "temp_food_choices";

interface Props {
  open: boolean;
  onClose: () => void;
  isLoggedIn?: boolean;
}

export default function FoodOnboardingModal({ open, onClose, isLoggedIn = false }: Props) {
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
    setPicks(prev => {
      if (prev.includes(food)) return prev.filter(f => f !== food);
      if (prev.length >= 3) {
        toast("3개까지 선택 가능합니다.", { duration: 2000 });
        return prev;
      }
      return [...prev, food];
    });
  };

  const handleSave = () => {
    if (picks.length < 3) return;
    updateSettings.mutate({ favoriteFoodTop3: picks });
  };

  const handleLoginCta = () => {
    // 선택값 임시 보존 → 로그인 후 복원 가능
    localStorage.setItem(TEMP_FOOD_KEY, JSON.stringify(picks));
    localStorage.setItem(DISMISSED_KEY, "true");
    openGoogleLogin(getLoginUrl()).catch(() => {});
  };

  const handleDismiss = () => {
    localStorage.setItem(DISMISSED_KEY, "true");
    onClose();
  };

  const allPicked = picks.length === 3;

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) handleDismiss(); }}>
      <DialogContent
        className="max-w-md w-full max-h-[90vh] overflow-y-auto"
        style={{ zIndex: 10000 }}
        onClick={(e) => e.stopPropagation()}
      >
        <DialogHeader>
          <DialogTitle className="text-lg font-bold">
            {isLoggedIn ? "좋아하는 음식 3가지를 선택해주세요" : "🍽️ 취향을 알려주세요!"}
          </DialogTitle>
          <DialogDescription className="text-sm text-gray-500">
            {isLoggedIn
              ? "1픽 / 2픽 / 3픽 순서로 선택하면 취향저격 쿠폰을 추천해드려요"
              : "3가지를 고르면 우리동네 맞춤 쿠폰을 바로 받을 수 있어요"}
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
                  type="button"
                  onClick={(e) => { e.stopPropagation(); setPicks(prev => prev.filter((_, idx) => idx !== i)); }}
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
                type="button"
                onClick={(e) => { e.stopPropagation(); togglePick(food); }}
                className={`px-3 py-1.5 rounded-full text-sm font-medium border transition-colors select-none ${
                  selected
                    ? "bg-amber-400 text-white border-amber-400 shadow-sm"
                    : "bg-white text-gray-700 border-gray-300 hover:border-amber-400 hover:text-amber-700 active:bg-amber-50"
                }`}
              >
                {selected && <span className="mr-1 text-xs">{PICK_LABELS[idx]}</span>}
                {food}
              </button>
            );
          })}
        </div>

        {/* 비로그인: 3개 완료 시 로그인 CTA */}
        {!isLoggedIn && allPicked && (
          <button
            type="button"
            onClick={handleLoginCta}
            className="mt-4 w-full flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-orange-500 to-pink-500 px-4 py-3.5 text-base font-bold text-white shadow-lg hover:opacity-90 active:opacity-80 transition-opacity"
          >
            <LogIn className="h-5 w-5" />
            지금 로그인하고 우리동네 쿠폰 받기
          </button>
        )}

        {/* 버튼 영역 */}
        <div className="flex gap-2 mt-3">
          <Button
            type="button"
            variant="outline"
            className="flex-1"
            onClick={handleDismiss}
            disabled={updateSettings.isPending}
          >
            나중에
          </Button>
          {isLoggedIn && (
            <Button
              type="button"
              className="flex-1 bg-amber-400 hover:bg-amber-500 text-white font-bold"
              onClick={handleSave}
              disabled={picks.length < 3 || updateSettings.isPending}
            >
              {updateSettings.isPending ? "저장 중..." : `저장 (${picks.length}/3)`}
            </Button>
          )}
          {!isLoggedIn && !allPicked && (
            <Button
              type="button"
              className="flex-1 bg-amber-400 text-white font-bold opacity-50 cursor-not-allowed"
              disabled
            >
              {picks.length}/3 선택
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
