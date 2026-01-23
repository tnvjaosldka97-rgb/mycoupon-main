import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Ticket, MapPin, Calendar, Gift, Store, Percent } from "lucide-react";
import { Link } from "wouter";
import { toast } from "@/components/ui/sonner";

export default function MyCouponsTab() {
  const { data: coupons, isLoading } = trpc.coupons.myCoupons.useQuery();
  const [selectedCoupon, setSelectedCoupon] = useState<any>(null);
  const [showDetailModal, setShowDetailModal] = useState(false);
  const utils = trpc.useUtils();

  const markAsUsedMutation = trpc.coupons.markAsUsed.useMutation({
    onSuccess: () => {
      utils.coupons.myCoupons.invalidate();
    },
  });

  const activeCoupons = coupons?.filter(c => c.status === 'active') || [];
  const usedCoupons = coupons?.filter(c => c.status === 'used') || [];
  const expiredCoupons = coupons?.filter(c => c.status === 'expired') || [];

  if (isLoading) {
    return (
      <div className="flex justify-center items-center py-12">
        <div className="w-8 h-8 border-4 border-primary/30 border-t-primary rounded-full animate-spin"></div>
      </div>
    );
  }

  if (!coupons || coupons.length === 0) {
    return (
      <Card className="p-12 text-center">
        <Gift className="w-16 h-16 text-gray-300 mx-auto mb-4" />
        <h3 className="text-xl font-bold text-gray-600 mb-2">아직 다운로드한 쿠폰이 없어요</h3>
        <p className="text-gray-500 mb-6">주변 매장의 쿠폰을 찾아보세요!</p>
        <Button asChild>
          <Link href="/map">쿠폰 찾으러 가기</Link>
        </Button>
      </Card>
    );
  }

  return (
    <>
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
              <Button asChild className="bg-gradient-to-r from-peach-400 to-pink-400">
                <Link href="/map">쿠폰 찾으러 가기</Link>
              </Button>
            </div>
          ) : (
            <div className="grid gap-4">
              {activeCoupons.map((coupon: any) => (
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
              <Gift className="w-16 h-16 text-gray-300 mx-auto mb-4" />
              <p className="text-gray-500">사용 완료한 쿠폰이 없어요</p>
            </div>
          ) : (
            <div className="grid gap-4">
              {usedCoupons.map((coupon: any) => (
                <CouponCard key={coupon.id} coupon={coupon} />
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="expired">
          {expiredCoupons.length === 0 ? (
            <div className="text-center py-12">
              <Gift className="w-16 h-16 text-gray-300 mx-auto mb-4" />
              <p className="text-gray-500">만료된 쿠폰이 없어요</p>
            </div>
          ) : (
            <div className="grid gap-4">
              {expiredCoupons.map((coupon: any) => (
                <CouponCard key={coupon.id} coupon={coupon} />
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>

      {/* 쿠폰 상세 모달 */}
      {selectedCoupon && (
        <Dialog open={showDetailModal} onOpenChange={setShowDetailModal}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle className="text-2xl font-bold text-peach-600">
                {selectedCoupon.store?.name || '쿠폰 상세'}
              </DialogTitle>
            </DialogHeader>

            <div className="space-y-6">
              {/* PIN 코드 */}
              {selectedCoupon.status === 'active' && selectedCoupon.pinCode && (
                <div className="bg-gradient-to-br from-peach-50 to-pink-50 p-6 rounded-xl text-center border-2 border-dashed border-peach-300">
                  <p className="text-sm text-gray-600 mb-2">매장에서 이 PIN 코드를 알려주세요</p>
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

                {selectedCoupon.store && (
                  <div className="flex items-start gap-2">
                    <Store className="w-5 h-5 text-peach-500 mt-0.5" />
                    <div>
                      <p className="text-sm font-medium">매장 정보</p>
                      <p className="text-sm text-gray-600">{selectedCoupon.store.name}</p>
                      {selectedCoupon.store.address && (
                        <p className="text-xs text-gray-500">{selectedCoupon.store.address}</p>
                      )}
                    </div>
                  </div>
                )}

                <div className="flex items-start gap-2">
                  <Percent className="w-5 h-5 text-peach-500 mt-0.5" />
                  <div>
                    <p className="text-sm font-medium">할인 내용</p>
                    <p className="text-sm text-gray-600">{selectedCoupon.title}</p>
                    {selectedCoupon.description && (
                      <p className="text-xs text-gray-500">{selectedCoupon.description}</p>
                    )}
                  </div>
                </div>
              </div>

              {/* 사용 방법 안내 */}
              {selectedCoupon.status === 'active' && (
                <div className="bg-mint-50 p-4 rounded-lg border border-mint-200">
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
    </>
  );
}

// 쿠폰 카드 컴포넌트
function CouponCard({ coupon, onClick }: { coupon: any; onClick?: () => void }) {
  return (
    <Card 
      className="p-6 hover:shadow-lg transition-shadow cursor-pointer"
      onClick={onClick}
    >
      <div className="flex items-start justify-between mb-4">
        <div className="flex-1">
          <div className="flex items-center gap-2 mb-2">
            <Ticket className="w-5 h-5 text-primary" />
            <h3 className="text-lg font-bold">{coupon.title}</h3>
          </div>
          
          {coupon.store && (
            <div className="flex items-center gap-2 text-sm text-gray-600 mb-2">
              <MapPin className="w-4 h-4" />
              <span>{coupon.store.name}</span>
            </div>
          )}

          {coupon.description && (
            <p className="text-gray-600 text-sm mb-3">{coupon.description}</p>
          )}

          <div className="flex items-center gap-2 text-sm text-gray-500">
            <Calendar className="w-4 h-4" />
            <span>
              {new Date(coupon.expiresAt).toLocaleDateString('ko-KR')}까지
            </span>
          </div>
        </div>

        <div className="text-right">
          {coupon.discountType === 'percentage' && (
            <div className="text-3xl font-bold text-primary">
              {coupon.discountValue}%
            </div>
          )}
          {coupon.discountType === 'fixed' && (
            <div className="text-3xl font-bold text-primary">
              {coupon.discountValue.toLocaleString()}원
            </div>
          )}
          {coupon.discountType === 'freebie' && (
            <Badge className="bg-gradient-to-r from-primary to-accent text-white">
              무료 증정
            </Badge>
          )}
        </div>
      </div>

      <div className="flex items-center justify-between pt-4 border-t">
        <div className="flex items-center gap-2">
          <Badge variant="secondary" className={
            coupon.status === 'active' ? 'bg-green-100 text-green-700' :
            coupon.status === 'used' ? 'bg-gray-100 text-gray-700' :
            'bg-red-100 text-red-700'
          }>
            {coupon.status === 'active' ? '사용 가능' : 
             coupon.status === 'used' ? '사용 완료' : '만료됨'}
          </Badge>
          
          {coupon.downloadedAt && (
            <span className="text-xs text-gray-500">
              다운로드: {new Date(coupon.downloadedAt).toLocaleDateString()}
            </span>
          )}
        </div>

        {coupon.status === 'active' && onClick && (
          <Button size="sm" className="bg-gradient-to-r from-peach-400 to-pink-400">
            쿠폰 사용하기
          </Button>
        )}
      </div>
    </Card>
  );
}
