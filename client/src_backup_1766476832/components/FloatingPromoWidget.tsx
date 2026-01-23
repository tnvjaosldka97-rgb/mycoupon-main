import { useState } from "react";
import { X, Gift, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";

interface FloatingPromoWidgetProps {
  landingUrl?: string;
}

export function FloatingPromoWidget({ landingUrl = "#" }: FloatingPromoWidgetProps) {
  const [isVisible, setIsVisible] = useState(true);
  const [isExpanded, setIsExpanded] = useState(false);

  if (!isVisible) return null;

  const handleClick = () => {
    if (landingUrl !== "#") {
      window.open(landingUrl, "_blank");
    } else {
      setIsExpanded(!isExpanded);
    }
  };

  return (
    <div className="fixed right-0 top-1/2 -translate-y-1/2 z-50">
      {/* 닫기 버튼 */}
      {isExpanded && (
        <button
          onClick={() => setIsVisible(false)}
          className="absolute -top-2 -right-2 w-6 h-6 bg-gray-800 text-white rounded-full flex items-center justify-center hover:bg-gray-700 transition-colors z-10"
          aria-label="닫기"
        >
          <X className="w-4 h-4" />
        </button>
      )}

      {/* 위젯 본체 */}
      <div
        className={`
          bg-gradient-to-br from-pink-500 via-orange-400 to-peach-400
          rounded-2xl shadow-2xl cursor-pointer
          transition-all duration-300 ease-in-out
          hover:scale-105 hover:shadow-pink-300/50
          ${isExpanded ? "w-64 p-4" : "w-20 h-20 p-0"}
        `}
        onClick={handleClick}
      >
        {!isExpanded ? (
          // 축소 상태: 아이콘만 표시
          <div className="w-full h-full flex items-center justify-center relative">
            <Gift className="w-10 h-10 text-white animate-bounce" />
            <Sparkles className="w-4 h-4 text-yellow-300 absolute top-1 right-1 animate-pulse" />
          </div>
        ) : (
          // 확장 상태: 전체 내용 표시
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <Gift className="w-6 h-6 text-white" />
              <Sparkles className="w-4 h-4 text-yellow-300 animate-pulse" />
            </div>
            <div className="text-white">
              <h3 className="font-bold text-lg leading-tight mb-1">
                무제한 쿠폰
              </h3>
              <p className="text-sm opacity-90 leading-tight">
                지금 바로 받아가세요!
              </p>
            </div>
            <Button
              variant="secondary"
              size="sm"
              className="w-full bg-white text-pink-600 hover:bg-pink-50 font-semibold"
              onClick={(e) => {
                e.stopPropagation();
                if (landingUrl !== "#") {
                  window.open(landingUrl, "_blank");
                }
              }}
            >
              자세히 보기 →
            </Button>
          </div>
        )}
      </div>

      {/* 펄스 효과 (축소 상태일 때만) */}
      {!isExpanded && (
        <div className="absolute inset-0 rounded-2xl bg-pink-400 animate-ping opacity-20 pointer-events-none" />
      )}
    </div>
  );
}
