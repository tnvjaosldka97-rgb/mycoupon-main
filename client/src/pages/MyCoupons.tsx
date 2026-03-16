import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Gift, Calendar, MapPin, X, Store, Percent } from "lucide-react";
import { Link } from "wouter";
import { toast } from "@/components/ui/sonner";

export default function MyCoupons() {
  // ⚡ 최적화: staleTime 0으로 설정 (항상 최신 데이터)
  const { data: coupons, isLoading, refetch } = trpc.coupons.myCoupons.useQuery(undefined, {
    staleTime: 0,
    refetchOnMount: 'always',
    refetchOnWindowFocus: true,
  });
  const [selectedCoupon, setSelectedCoupon] = useState<any>(null);
  const [showDetailModal, setShowDetailModal] = useState(false);
  const utils = trpc.useUtils();

  const markAsUsedMutation = trpc.coupons.markAsUsed.useMutation({
    onSuccess: async () => {
      // ⚡ 즉시 refetch
      await refetch();
      console.log('[MyCoupons] ⚡ Refreshed immediately after use');
    },
  });

  const activeCoupons = coupons?.filter(c => c.status === 'active') || [];
  const usedCoupons = coupons?.filter(c => c.status === 'used') || [];
  const expiredCoupons = coupons?.filter(c => c.status === 'expired') || [];

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-peach-50 to-mint-50">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-peach-500 mx-auto mb-4"></div>
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

      {/* 쿠폰 목록 */}
      <div className="container max-w-4xl py-8 px-4">
        <Tabs defaultValue="active" className="w-full">
          <TabsList className="grid w-full grid-cols-3 mb-6">
            <TabsTrigger value="active">
              사용 가능 ({activeCoupons.length})
            </TabsTrigger>
            <TabsTrigger value="used">
              사용 완료 ({usedCoupons.length})
            </TabsTrigger>
            <TabsTrigger value="expired">
              만료됨 ({expiredCoupons.length})
            </TabsTrigger>
          </TabsList>

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
                {activeCoupons.map((coupon) => (
                  <CouponCard
                    key={coupon.id}
                    coupon={coupon}
                    onClick={() => {
                      setSelectedCoupon(coupon);
                      setShowDetailModal(true);
                    }}
                  />
                ))}
              </div>
            )}
          </TabsContent>

          <TabsContent value="used">
            {usedCoupons.length === 0 ? (
              <div className="text-center py-12">
                <p className="text-gray-500">사용한 쿠폰이 없어요</p>
              </div>
            ) : (
              <div className="grid gap-4">
                {usedCoupons.map((coupon) => (
                  <CouponCard
                    key={coupon.id}
                    coupon={coupon}
                    onClick={() => setSelectedCoupon(coupon)}
                    disabled
                  />
                ))}
              </div>
            )}
          </TabsContent>

          <TabsContent value="expired">
            {expiredCoupons.length === 0 ? (
              <div className="text-center py-12">
                <p className="text-gray-500">만료된 쿠폰이 없어요</p>
              </div>
            ) : (
              <div className="grid gap-4">
                {expiredCoupons.map((coupon) => (
                  <CouponCard
                    key={coupon.id}
                    coupon={coupon}
                    onClick={() => setSelectedCoupon(coupon)}
                    disabled
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
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setSelectedCoupon(null)}
                >
                  <X className="w-4 h-4" />
                </Button>
              </DialogTitle>
            </DialogHeader>

            <div className="space-y-4">
              {/* PIN 코드 */}
              {selectedCoupon.status === 'active' && selectedCoupon.pinCode && (
                <div className="bg-gradient-to-br from-peach-100 to-pink-100 p-8 rounded-xl border-2 border-peach-300 text-center">
                  <p className="text-sm text-gray-600 mb-4">매장에서 이 PIN 코드를 알려주세요</p>
                  <div className="text-6xl font-bold text-peach-600 tracking-wider mb-4">
                    {selectedCoupon.pinCode}
                  </div>
                  <p className="text-xs text-gray-500 mb-6">6자리 PIN 코드</p>
                  
                  {/* 사용 완료 버튼 */}
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

              {/* 쿠폰 정보 */}
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

              {/* 사용 안내 */}
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

// 쿠폰 카드 컴포넌트
function CouponCard({ coupon, onClick, disabled }: any) {
  // P2-5: FREE=빨간 테두리, 유료=골드 테두리, 비활성=opacity 우선
  const isPaid = coupon.ownerTier && coupon.ownerTier !== 'FREE';
  const borderClass = disabled
    ? ''
    : isPaid
      ? 'border-2 border-amber-400'
      : 'border-2 border-red-400';
  const barClass = disabled
    ? 'bg-gray-300'
    : isPaid
      ? 'bg-gradient-to-r from-amber-300 to-yellow-400'
      : 'bg-gradient-to-r from-red-400 to-rose-400';

  return (
    <Card
      className={`p-4 cursor-pointer transition-all hover:shadow-lg ${borderClass} ${
        disabled ? 'opacity-60' : 'hover:-translate-y-1'
      }`}
      onClick={onClick}
    >
      {/* 상단 색상 바 (tier별) */}
      <div className={`h-2 ${barClass} rounded-t-lg -mt-4 -mx-4 mb-4`} />

      <div className="flex items-start justify-between gap-4">
        <div className="flex-1">
          {/* 업장 이름 */}
          <div className="flex items-center gap-2 mb-2">
            <Store className="w-4 h-4 text-peach-500" />
            <h3 className="font-bold text-lg text-gray-800">{coupon.storeName}</h3>
          </div>

          {/* 상품 내용 및 할인율 */}
          <div className="flex items-center gap-2 mb-3">
            <p className="text-base text-gray-700">{coupon.title}</p>
            <Badge className="bg-gradient-to-r from-peach-400 to-pink-400 text-white">
              <Percent className="w-3 h-3 mr-1" />
              {coupon.discountType === 'percentage' ? `${coupon.discountValue}% 할인` :
               coupon.discountType === 'fixed' ? `${coupon.discountValue.toLocaleString()}원 할인` :
               '무료 제공'}
            </Badge>
          </div>

          {/* 상태 배지 */}
          <div className="flex items-center gap-2 mb-2">
            <Badge variant="secondary" className="bg-mint-100 text-mint-700">
              {coupon.status === 'active' ? '사용 가능' : 
               coupon.status === 'used' ? '사용 완료' : '만료됨'}
            </Badge>
          </div>

          {/* 쿠폰 번호 */}
          <p className="text-xs text-gray-500 mb-1">쿠폰 번호</p>
          <p className="text-xs font-mono bg-gray-100 px-2 py-1 rounded inline-block mb-3">
            {coupon.couponCode}
          </p>

          {/* 유효기간 */}
          <div className="flex items-center gap-2 text-sm text-gray-500">
            <Calendar className="w-4 h-4" />
            <p>유효기간: {new Date(coupon.expiresAt).toLocaleDateString('ko-KR')}까지</p>
          </div>
          {coupon.usedAt && (
            <div className="flex items-center gap-2 text-sm text-gray-500 mt-1">
              <Calendar className="w-4 h-4" />
              <p>사용일: {new Date(coupon.usedAt).toLocaleDateString('ko-KR')}</p>
            </div>
          )}
        </div>
      </div>
    </Card>
  );
}
