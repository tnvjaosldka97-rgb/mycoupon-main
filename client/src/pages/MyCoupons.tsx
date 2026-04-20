import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Gift, Calendar, X, Store, Percent, Clock, CheckCircle2, AlertTriangle, Megaphone, ChevronRight, Bell, BellOff } from "lucide-react";
import { Link } from "wouter";
import { toast } from "@/components/ui/sonner";

export default function MyCoupons() {
  const { data: coupons, isLoading, refetch } = trpc.coupons.myCoupons.useQuery(undefined, {
    staleTime: 0,
    refetchOnMount: 'always',
    refetchOnWindowFocus: true,
  });
  const [selectedCoupon, setSelectedCoupon] = useState<any>(null);
  const [showDetailModal, setShowDetailModal] = useState(false);

  // 단골(찜) 매장 — 신규 listWithStores 사용 (매장 정보 + 활성 쿠폰 개수 포함)
  const trpcUtils = trpc.useUtils();
  const { data: favoriteList, isLoading: favoritesLoading } = trpc.favorites.listWithStores.useQuery(undefined, {
    staleTime: 30_000,
    refetchOnWindowFocus: true,
  });
  const removeFavoriteMutation = trpc.favorites.remove.useMutation({
    onSuccess: () => {
      toast.success('단골에서 해제했어요');
      trpcUtils.favorites.listWithStores.invalidate();
      trpcUtils.favorites.list.invalidate(); // MapPage Set 동기화
    },
    onError: (e: any) => toast.error(e.message || '단골 해제 실패'),
  });
  const favoriteCount = (favoriteList as any[] | undefined)?.length ?? 0;

  // 공지(이벤트) 배너
  const { data: eventPopups } = trpc.popup.getActive.useQuery(undefined, { staleTime: 60_000 });
  const [selectedNotice, setSelectedNotice] = useState<any>(null);

  const markAsUsedMutation = trpc.coupons.markAsUsed.useMutation({
    onSuccess: async () => {
      await refetch();
    },
  });

  // 서버 isExpired 플래그 우선, 없으면 클라이언트 시간 비교 (fallback)
  const isExpiredCoupon = (c: any) =>
    c.isExpired === true || c.status === 'expired' || new Date(c.expiresAt) < new Date();

  // 사용 가능: status=active + 미만료
  const activeCoupons = ((coupons as any[]) || [])
    .filter((c: any) => c.status === 'active' && !isExpiredCoupon(c))
    // 만료 임박순 정렬 (expiresAt 오름차순 = 긴급한 것 상단)
    .sort((a: any, b: any) => new Date(a.expiresAt).getTime() - new Date(b.expiresAt).getTime());

  const usedCoupons = ((coupons as any[]) || []).filter((c: any) => c.status === 'used');

  // 만료됨: status=expired OR (active이지만 expiresAt 지남)
  const expiredCoupons = ((coupons as any[]) || []).filter((c: any) => isExpiredCoupon(c) && c.status !== 'used');

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-peach-50 to-mint-50">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-peach-500 mx-auto mb-4" />
          <p className="text-gray-600">쿠폰을 불러오는 중...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-peach-50 to-mint-50">
      {/* 헤더 */}
      <div className="bg-gradient-to-r from-peach-400 via-pink-400 to-mint-400 text-white py-8 px-4 shadow-lg">
        <div className="container max-w-4xl">
          <Link href="/">
            <Button variant="ghost" size="sm" className="text-white hover:bg-white/20 mb-4">
              ← 홈으로
            </Button>
          </Link>
          <div className="flex items-center gap-3 mb-2">
            <Gift className="w-8 h-8" />
            <h1 className="text-3xl font-bold">내 쿠폰북</h1>
          </div>
          <p className="text-white/90">다운로드한 쿠폰을 확인하고 사용하세요</p>
        </div>
      </div>

      {/* 공지/이벤트 배너 */}
      {eventPopups && (eventPopups as any[]).length > 0 && (
        <div className="container max-w-4xl px-4 pt-4">
          <div className="flex items-center gap-1.5 mb-2">
            <Megaphone className="w-3.5 h-3.5 text-orange-500" />
            <span className="text-xs font-semibold text-orange-600 tracking-wide">EVENTS</span>
          </div>
          <div className="flex gap-2 overflow-x-auto pb-2 scrollbar-hide">
            {(eventPopups as any[]).map((notice: any) => (
              <button
                key={notice.id}
                onClick={() => setSelectedNotice(notice)}
                className="flex-shrink-0 flex items-center gap-2 bg-white border border-orange-100 rounded-lg px-3 py-2 text-left hover:bg-orange-50 transition-colors shadow-sm"
                style={{ maxWidth: '260px' }}
              >
                {notice.imageDataUrl && (
                  <img src={notice.imageDataUrl} alt="" className="w-8 h-8 rounded object-cover flex-shrink-0" />
                )}
                <span className="text-xs text-gray-700 font-medium truncate">{notice.title}</span>
                <ChevronRight className="w-3 h-3 text-gray-400 flex-shrink-0" />
              </button>
            ))}
          </div>
        </div>
      )}

      {/* 공지 상세 모달 */}
      {selectedNotice && (
        <Dialog open={!!selectedNotice} onOpenChange={(v) => { if (!v) setSelectedNotice(null); }}>
          <DialogContent className="max-w-[420px] w-[92vw] p-0 overflow-hidden rounded-2xl border-0">
            <button
              onClick={() => setSelectedNotice(null)}
              className="absolute top-3 right-3 z-10 w-8 h-8 rounded-full bg-black/40 hover:bg-black/60 flex items-center justify-center text-white transition-colors"
              aria-label="닫기"
            >
              <X className="w-4 h-4" />
            </button>
            {selectedNotice.imageDataUrl && (
              <img
                src={selectedNotice.imageDataUrl}
                alt={selectedNotice.title}
                className="w-full object-cover"
                style={{ maxHeight: '400px' }}
              />
            )}
            <div className="px-5 py-4">
              <h2 className="text-lg font-bold text-gray-900 mb-2">{selectedNotice.title}</h2>
              {selectedNotice.body && (
                <p className="text-sm text-gray-600 whitespace-pre-wrap leading-relaxed">{selectedNotice.body}</p>
              )}
              {selectedNotice.primaryButtonText && selectedNotice.primaryButtonUrl && (
                <Button
                  className="w-full mt-4 bg-gradient-to-r from-orange-500 to-pink-500 text-white font-bold rounded-xl h-10"
                  onClick={() => {
                    window.open(selectedNotice.primaryButtonUrl, '_blank', 'noopener');
                  }}
                >
                  {selectedNotice.primaryButtonText}
                </Button>
              )}
            </div>
          </DialogContent>
        </Dialog>
      )}

      {/* 쿠폰 목록 */}
      <div className="container max-w-4xl py-8 px-4">
        <Tabs defaultValue="active" className="w-full">
          <TabsList className="grid w-full grid-cols-4 mb-6">
            <TabsTrigger value="active" className="relative">
              사용 가능 ({activeCoupons.length})
              {activeCoupons.some((c: any) => getDaysLeft(c.expiresAt) <= 3) && (
                <span className="absolute -top-1 -right-1 w-2 h-2 bg-red-500 rounded-full" />
              )}
            </TabsTrigger>
            <TabsTrigger value="used">사용 완료 ({usedCoupons.length})</TabsTrigger>
            <TabsTrigger value="expired">만료됨 ({expiredCoupons.length})</TabsTrigger>
            <TabsTrigger value="favorites">내 단골 ({favoriteCount})</TabsTrigger>
          </TabsList>

          {/* ── 사용 가능 탭 ── */}
          <TabsContent value="active">
            {activeCoupons.length === 0 ? (
              <div className="text-center py-12">
                <Gift className="w-16 h-16 text-gray-300 mx-auto mb-4" />
                <p className="text-gray-500 mb-4">사용 가능한 쿠폰이 없어요</p>
                <Link href="/">
                  <Button className="bg-gradient-to-r from-peach-400 to-pink-400">
                    쿠폰 찾으러 가기
                  </Button>
                </Link>
              </div>
            ) : (
              <div className="grid gap-4">
                {activeCoupons.map((coupon: any) => (
                  <CouponCard
                    key={coupon.id}
                    coupon={coupon}
                    onClick={() => { setSelectedCoupon(coupon); setShowDetailModal(true); }}
                  />
                ))}
              </div>
            )}
          </TabsContent>

          {/* ── 사용 완료 탭 ── */}
          <TabsContent value="used">
            {usedCoupons.length === 0 ? (
              <div className="text-center py-12">
                <CheckCircle2 className="w-16 h-16 text-gray-300 mx-auto mb-4" />
                <p className="text-gray-500">사용한 쿠폰이 없어요</p>
              </div>
            ) : (
              <div className="grid gap-4">
                {usedCoupons.map((coupon: any) => (
                  <CouponCard key={coupon.id} coupon={coupon} onClick={() => setSelectedCoupon(coupon)} disabled />
                ))}
              </div>
            )}
          </TabsContent>

          {/* ── 만료됨 탭 ── */}
          <TabsContent value="expired">
            {expiredCoupons.length === 0 ? (
              <div className="text-center py-12">
                <Clock className="w-16 h-16 text-gray-300 mx-auto mb-4" />
                <p className="text-gray-500">만료된 쿠폰이 없어요</p>
              </div>
            ) : (
              <div className="grid gap-4">
                {expiredCoupons.map((coupon: any) => (
                  <CouponCard key={coupon.id} coupon={coupon} onClick={() => setSelectedCoupon(coupon)} disabled />
                ))}
              </div>
            )}
          </TabsContent>

          {/* ── 내 단골 탭 — 단골 등록한 매장 리스트 + 해제 버튼 ── */}
          <TabsContent value="favorites">
            {favoritesLoading ? (
              <div className="text-center py-12 text-gray-400 text-sm">단골 목록을 불러오는 중...</div>
            ) : favoriteCount === 0 ? (
              <div className="text-center py-12">
                <Bell className="w-16 h-16 text-gray-300 mx-auto mb-4" />
                <p className="text-gray-500 mb-4">아직 단골 매장이 없어요</p>
                <p className="text-xs text-gray-400 mb-4">지도에서 🔔 단골 버튼으로 관심 매장을 등록해보세요</p>
                <Link href="/map">
                  <Button className="bg-gradient-to-r from-peach-400 to-pink-400">
                    지도에서 매장 찾기
                  </Button>
                </Link>
              </div>
            ) : (
              <div className="grid gap-3">
                {(favoriteList as any[]).map((fav: any) => (
                  <FavoriteStoreCard
                    key={fav.favoriteId}
                    fav={fav}
                    onRemove={() => {
                      if (!confirm(`'${fav.storeName}' 단골에서 해제할까요?`)) return;
                      removeFavoriteMutation.mutate({ storeId: fav.storeId });
                    }}
                    disabled={removeFavoriteMutation.isPending}
                  />
                ))}
              </div>
            )}
          </TabsContent>
        </Tabs>
      </div>

      {/* 쿠폰 상세 모달 */}
      {selectedCoupon && (
        <Dialog open={showDetailModal} onOpenChange={(open) => {
          setShowDetailModal(open);
          if (!open) setSelectedCoupon(null);
        }}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle className="flex items-center justify-between">
                <span>쿠폰 상세</span>
                <Button variant="ghost" size="sm" onClick={() => setSelectedCoupon(null)}>
                  <X className="w-4 h-4" />
                </Button>
              </DialogTitle>
            </DialogHeader>

            <div className="space-y-4">
              {selectedCoupon.status === 'active' && selectedCoupon.pinCode && (
                <div className="bg-gradient-to-br from-peach-100 to-pink-100 p-8 rounded-xl border-2 border-peach-300 text-center">
                  <p className="text-sm text-gray-600 mb-4">매장에서 이 PIN 코드를 알려주세요</p>
                  <div className="text-6xl font-bold text-peach-600 tracking-wider mb-4">
                    {selectedCoupon.pinCode}
                  </div>
                  <p className="text-xs text-gray-500 mb-6">6자리 PIN 코드</p>
                  <Button
                    className="w-full bg-gradient-to-r from-peach-400 to-pink-400 hover:from-peach-500 hover:to-pink-500 text-white font-bold py-6 text-lg"
                    onClick={async () => {
                      if (!confirm('정말로 사용 완료하시겠습니까? 사용 후에는 취소할 수 없습니다.')) return;
                      try {
                        await markAsUsedMutation.mutateAsync({ userCouponId: selectedCoupon.id });
                        toast.success('쿠폰을 사용 완료했습니다!');
                        setShowDetailModal(false);
                        setSelectedCoupon(null);
                      } catch (error: any) {
                        toast.error(error.message || '쿠폰 사용에 실패했습니다.');
                      }
                    }}
                  >
                    사용 완료
                  </Button>
                </div>
              )}

              <div className="space-y-2">
                <div className="flex items-start gap-2">
                  <Calendar className="w-5 h-5 text-peach-500 mt-0.5" />
                  <div>
                    <p className="text-sm font-medium">유효기간</p>
                    <p className="text-sm text-gray-600">
                      {new Date(selectedCoupon.expiresAt).toLocaleDateString('ko-KR')}까지
                    </p>
                  </div>
                </div>
                {selectedCoupon.usedAt && (
                  <div className="flex items-start gap-2">
                    <Calendar className="w-5 h-5 text-gray-500 mt-0.5" />
                    <div>
                      <p className="text-sm font-medium">사용일</p>
                      <p className="text-sm text-gray-600">
                        {new Date(selectedCoupon.usedAt).toLocaleDateString('ko-KR')}
                      </p>
                    </div>
                  </div>
                )}
              </div>

              {selectedCoupon.status === 'active' && (
                <div className="bg-mint-50 p-4 rounded-lg">
                  <h4 className="font-medium text-mint-700 mb-2">💡 사용 방법</h4>
                  <ol className="text-sm text-mint-600 space-y-1">
                    <li>1. 매장을 방문하세요</li>
                    <li>2. 주문 전에 쿠폰을 보여주세요</li>
                    <li>3. 점주님에게 <strong>PIN 코드</strong>를 알려주세요</li>
                    <li>4. 할인을 받고 <strong>"사용 완료"</strong> 버튼을 누르세요! 🎉</li>
                  </ol>
                  <p className="text-xs text-mint-500 mt-2">
                    ⚠️ "사용 완료" 버튼은 할인을 받은 후에 누르세요.
                  </p>
                </div>
              )}
            </div>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}

// ── 헬퍼 ──────────────────────────────────────────────────────────────────────

/** expiresAt 기준 남은 일수 (소수 포함). 음수 = 이미 만료. */
function getDaysLeft(expiresAt: string | Date): number {
  return (new Date(expiresAt).getTime() - Date.now()) / (1000 * 60 * 60 * 24);
}

/** 남은 시간 비율 (0~100). downloadedAt~expiresAt 전체 구간 대비 현재 위치. */
function getProgressPct(downloadedAt: string | Date, expiresAt: string | Date): number {
  const total = new Date(expiresAt).getTime() - new Date(downloadedAt).getTime();
  if (total <= 0) return 0;
  const elapsed = Date.now() - new Date(downloadedAt).getTime();
  const remaining = 1 - Math.min(elapsed / total, 1);
  return Math.round(remaining * 100);
}

/** D-Day 뱃지 텍스트 */
function getDDayLabel(daysLeft: number): string {
  if (daysLeft < 0) return '만료';
  if (daysLeft < 1) return 'D-Day';
  return `D-${Math.ceil(daysLeft)}`;
}

// ── 단골 매장 카드 ────────────────────────────────────────────────────────────
function FavoriteStoreCard({
  fav,
  onRemove,
  disabled,
}: {
  fav: {
    favoriteId: number;
    storeId: number;
    storeName: string;
    category: string;
    address: string;
    imageUrl: string | null;
    activeCouponCount: number;
    createdAt: string;
  };
  onRemove: () => void;
  disabled: boolean;
}) {
  const categoryEmoji =
    fav.category === 'cafe' ? '☕' :
    fav.category === 'restaurant' ? '🍽️' :
    fav.category === 'beauty' ? '💅' :
    fav.category === 'hospital' ? '🏥' :
    fav.category === 'fitness' ? '💪' : '🎁';

  return (
    <Card className="overflow-hidden border border-gray-200 hover:shadow-md transition-shadow">
      <div className="p-3 flex items-center gap-3">
        {/* 카테고리 이모지 아바타 */}
        <div className="w-12 h-12 rounded-full bg-pink-50 flex items-center justify-center text-2xl shrink-0">
          {categoryEmoji}
        </div>
        {/* 매장 정보 */}
        <div className="flex-1 min-w-0">
          <Link href="/map">
            <div className="cursor-pointer hover:underline">
              <h3 className="font-bold text-sm text-gray-900 truncate">{fav.storeName}</h3>
            </div>
          </Link>
          <p className="text-xs text-gray-500 truncate mt-0.5">📍 {fav.address}</p>
          <div className="flex items-center gap-2 mt-1">
            <Badge
              variant="secondary"
              className={
                fav.activeCouponCount > 0
                  ? 'bg-emerald-100 text-emerald-700 text-[10px]'
                  : 'bg-gray-100 text-gray-500 text-[10px]'
              }
            >
              {fav.activeCouponCount > 0 ? `🎁 쿠폰 ${fav.activeCouponCount}개` : '현재 쿠폰 없음'}
            </Badge>
            <span className="text-[10px] text-gray-400">
              {new Date(fav.createdAt).toLocaleDateString('ko-KR')} 등록
            </span>
          </div>
        </div>
        {/* 해제 버튼 */}
        <Button
          variant="ghost"
          size="sm"
          onClick={onRemove}
          disabled={disabled}
          className="shrink-0 h-8 px-2 text-xs text-gray-500 hover:text-red-600 hover:bg-red-50"
          aria-label="단골 해제"
        >
          <BellOff className="w-3.5 h-3.5 mr-1" />
          해제
        </Button>
      </div>
    </Card>
  );
}

// ── 쿠폰 카드 컴포넌트 ─────────────────────────────────────────────────────────
function CouponCard({ coupon, onClick, disabled }: { coupon: any; onClick: () => void; disabled?: boolean }) {
  const daysLeft = getDaysLeft(coupon.expiresAt);
  const isUrgent = !disabled && daysLeft <= 3;
  const isWarning = !disabled && daysLeft > 3 && daysLeft <= 7;
  const progressPct = disabled ? 0 : getProgressPct(coupon.downloadedAt, coupon.expiresAt);

  const isPaid = coupon.ownerTier && coupon.ownerTier !== 'FREE';

  // 테두리 + 상단 바 색상
  const borderClass = disabled
    ? 'border border-gray-200'
    : isUrgent
      ? 'border-2 border-red-400'
      : isPaid
        ? 'border-2 border-amber-400'
        : 'border-2 border-red-300';

  const barGradient = disabled
    ? 'bg-gray-200'
    : isUrgent
      ? 'bg-gradient-to-r from-red-500 to-rose-400'
      : isPaid
        ? 'bg-gradient-to-r from-amber-400 to-yellow-300'
        : 'bg-gradient-to-r from-peach-400 to-pink-400';

  // 게이지 바 색상
  const gaugeColor = isUrgent ? 'bg-red-500' : isPaid ? 'bg-amber-400' : 'bg-peach-400';

  const discountLabel =
    coupon.discountType === 'percentage' ? `${coupon.discountValue}% 할인`
    : coupon.discountType === 'fixed'    ? `${coupon.discountValue?.toLocaleString()}원 할인`
    : '무료 제공';

  return (
    <Card
      className={`cursor-pointer transition-all overflow-hidden ${borderClass} ${
        disabled ? 'opacity-55' : 'hover:shadow-lg hover:-translate-y-0.5'
      }`}
      onClick={onClick}
    >
      {/* 상단 색상 바 */}
      <div className={`h-1.5 ${barGradient}`} />

      <div className="p-4">
        <div className="flex items-start justify-between gap-3">
          {/* 왼쪽: 쿠폰 정보 */}
          <div className="flex-1 min-w-0">
            {/* 업장명 + 긴급 뱃지 */}
            <div className="flex items-center gap-2 mb-1 flex-wrap">
              <Store className="w-4 h-4 text-peach-500 shrink-0" />
              <h3 className="font-bold text-base text-gray-800 truncate">{coupon.storeName}</h3>
              {isUrgent && (
                <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-xs font-bold bg-red-100 text-red-600 border border-red-300 shrink-0">
                  <AlertTriangle className="w-3 h-3" />
                  {getDDayLabel(daysLeft)}
                </span>
              )}
              {isWarning && (
                <span className="inline-flex items-center px-1.5 py-0.5 rounded-full text-xs font-semibold bg-amber-50 text-amber-600 border border-amber-300 shrink-0">
                  {getDDayLabel(daysLeft)}
                </span>
              )}
            </div>

            {/* 쿠폰 제목 */}
            <p className="text-sm text-gray-700 mb-2 leading-snug">{coupon.title}</p>

            {/* 할인 뱃지 + 상태 뱃지 */}
            <div className="flex items-center gap-2 flex-wrap mb-3">
              <Badge className="bg-gradient-to-r from-peach-400 to-pink-400 text-white text-xs">
                <Percent className="w-3 h-3 mr-1" />
                {discountLabel}
              </Badge>
              <Badge
                variant="secondary"
                className={
                  coupon.status === 'active' && !disabled
                    ? 'bg-emerald-100 text-emerald-700 text-xs'
                    : coupon.status === 'used'
                      ? 'bg-gray-100 text-gray-500 text-xs'
                      : 'bg-red-50 text-red-500 text-xs'
                }
              >
                {coupon.status === 'active' && !disabled ? '사용 가능'
                  : coupon.status === 'used'   ? '사용 완료'
                  : '만료됨'}
              </Badge>
            </div>

            {/* 유효기간 텍스트 */}
            <div className="flex items-center gap-1.5 text-xs text-gray-400 mb-2">
              <Calendar className="w-3.5 h-3.5" />
              {coupon.status === 'used' && coupon.usedAt
                ? <span>사용일: {new Date(coupon.usedAt).toLocaleDateString('ko-KR')}</span>
                : <span>{new Date(coupon.expiresAt).toLocaleDateString('ko-KR')}까지</span>
              }
            </div>

            {/* 게이지 바 (활성 쿠폰만) */}
            {!disabled && (
              <div className="space-y-0.5">
                <div className="flex justify-between text-xs text-gray-400">
                  <span>남은 유효기간</span>
                  <span className={isUrgent ? 'text-red-500 font-semibold' : ''}>
                    {progressPct}%
                  </span>
                </div>
                <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all ${gaugeColor}`}
                    style={{ width: `${progressPct}%` }}
                  />
                </div>
              </div>
            )}
          </div>

          {/* 오른쪽: 쿠폰 번호 + 탭 화살표 힌트 */}
          <div className="shrink-0 text-right">
            <p className="text-xs text-gray-400 mb-1">쿠폰번호</p>
            <p className="text-xs font-mono bg-gray-100 px-2 py-1 rounded text-gray-600 mb-2">
              {coupon.couponCode}
            </p>
            {!disabled && (
              <p className="text-xs text-peach-500 font-medium">탭하여 사용 →</p>
            )}
          </div>
        </div>
      </div>
    </Card>
  );
}
