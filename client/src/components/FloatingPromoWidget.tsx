import { useState } from "react";
import { X } from "lucide-react";

interface FloatingPromoWidgetProps {
  landingUrl?: string;
  hidden?: boolean;
}

export function FloatingPromoWidget({ landingUrl = "#", hidden = false }: FloatingPromoWidgetProps) {
  const [isVisible, setIsVisible] = useState(true);

  if (!isVisible || hidden) return null;

  const handleCTA = () => {
    if (landingUrl !== "#") {
      window.open(landingUrl, "_blank");
    } else {
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  };

  return (
    <div className="fixed bottom-0 left-0 right-0 z-40 safe-area-bottom">
      <div className="bg-gradient-to-r from-orange-500 to-pink-500 text-white shadow-2xl">
        <div className="flex items-center gap-3 px-4 py-3 max-w-screen-md mx-auto">
          {/* 왼쪽 아이콘 */}
          <div className="text-2xl flex-shrink-0 animate-bounce">🍓</div>

          {/* 중앙 텍스트 */}
          <div className="flex-1 min-w-0">
            <p className="font-bold text-sm leading-tight">선착순! 한정 수량</p>
            <p className="text-xs opacity-90 leading-tight truncate">지금 주변 매장 쿠폰을 확인하세요</p>
          </div>

          {/* 우측 CTA 버튼 */}
          <button
            onClick={handleCTA}
            className="bg-white text-orange-500 font-bold text-xs px-3 py-2 rounded-full flex-shrink-0 hover:bg-orange-50 transition-colors active:scale-95"
          >
            할인 받기
          </button>

          {/* 닫기 버튼 */}
          <button
            onClick={() => setIsVisible(false)}
            className="w-6 h-6 flex items-center justify-center rounded-full bg-white/20 hover:bg-white/30 transition-colors flex-shrink-0"
            aria-label="배너 닫기"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
}
