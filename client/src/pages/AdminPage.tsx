import { useState } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { trpc } from '@/lib/trpc';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Shield, Store, Ticket, MapPin, CheckCircle2, BarChart3 } from 'lucide-react';
import { Link } from 'wouter';

export default function AdminPage() {
  const { user } = useAuth();
  const [storeForm, setStoreForm] = useState({
    name: '',
    category: 'cafe' as 'cafe' | 'restaurant' | 'beauty' | 'hospital' | 'fitness' | 'other',
    address: '',
    phone: '',
    description: '',
  });
  const [couponForm, setCouponForm] = useState({
    storeId: 0,
    title: '',
    description: '',
    discountType: 'fixed' as 'fixed' | 'freebie',
    discountValue: 1000,
    totalQuantity: 100,
    startDate: '',
    endDate: '',
  });
  const [gpsCoords, setGpsCoords] = useState<{ lat: number; lng: number } | null>(null);

  const createStore = trpc.admin.createStore.useMutation();
  const createCoupon = trpc.admin.createCoupon.useMutation();
  const { data: stores } = trpc.admin.listStores.useQuery();
  const { data: coupons } = trpc.admin.listCoupons.useQuery();

  // 관리자 권한 체크
  if (!user || user.role !== 'admin') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-orange-50 to-pink-50">
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Shield className="w-6 h-6 text-red-500" />
              접근 권한 없음
            </CardTitle>
            <CardDescription>
              이 페이지는 관리자만 접근할 수 있습니다.
            </CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  const handleCreateStore = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const result = await createStore.mutateAsync(storeForm);
      setGpsCoords(result.coordinates);
      alert('가게가 성공적으로 등록되었습니다!');
      setStoreForm({
        name: '',
        category: 'cafe',
        address: '',
        phone: '',
        description: '',
      });
    } catch (error: any) {
      alert(error.message || '가게 등록에 실패했습니다.');
    }
  };

  const handleCreateCoupon = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await createCoupon.mutateAsync(couponForm);
      alert('쿠폰이 성공적으로 등록되었습니다!');
      setCouponForm({
        storeId: 0,
        title: '',
        description: '',
        discountType: 'fixed',
        discountValue: 1000,
        totalQuantity: 100,
        startDate: '',
        endDate: '',
      });
    } catch (error: any) {
      alert(error.message || '쿠폰 등록에 실패했습니다.');
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-orange-50 to-pink-50">
      {/* Header */}
      <header className="border-b bg-white/95 backdrop-blur-md shadow-sm sticky top-0 z-50">
        <div className="container mx-auto px-4 py-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-gradient-to-br from-orange-500 to-pink-500 rounded-xl flex items-center justify-center">
              <Shield className="w-6 h-6 text-white" />
            </div>
            <div>
              <h1 className="text-2xl font-bold bg-gradient-to-r from-orange-600 to-pink-600 bg-clip-text text-transparent">
                Admin 관리 페이지
              </h1>
              <p className="text-sm text-gray-600">가게 및 쿠폰 등록 관리</p>
            </div>
          </div>
          <Button asChild>
            <Link href="/admin/analytics">
              <BarChart3 className="w-4 h-4 mr-2" />
              통계 대시보드
            </Link>
          </Button>
        </div>
      </header>

      {/* Main Content */}
      <div className="container mx-auto px-4 py-8">
        <Tabs defaultValue="store" className="space-y-6">
          <TabsList className="grid w-full max-w-md grid-cols-2">
            <TabsTrigger value="store" className="flex items-center gap-2">
              <Store className="w-4 h-4" />
              가게 등록
            </TabsTrigger>
            <TabsTrigger value="coupon" className="flex items-center gap-2">
              <Ticket className="w-4 h-4" />
              쿠폰 등록
            </TabsTrigger>
          </TabsList>

          {/* 가게 등록 탭 */}
          <TabsContent value="store" className="space-y-6">
            <div className="grid md:grid-cols-2 gap-6">
              {/* 가게 등록 폼 */}
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Store className="w-5 h-5" />
                    새 가게 등록
                  </CardTitle>
                  <CardDescription>
                    가게 정보를 입력하면 주소가 자동으로 GPS 좌표로 변환됩니다.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <form onSubmit={handleCreateStore} className="space-y-4">
                    <div className="space-y-2">
                      <Label htmlFor="name">가게명 *</Label>
                      <Input
                        id="name"
                        value={storeForm.name}
                        onChange={(e) => setStoreForm({ ...storeForm, name: e.target.value })}
                        placeholder="예: 스타벅스 명동점"
                        required
                      />
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="category">카테고리 *</Label>
                      <Select
                        value={storeForm.category}
                        onValueChange={(value: any) => setStoreForm({ ...storeForm, category: value })}
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="cafe">☕ 카페</SelectItem>
                          <SelectItem value="restaurant">🍽️ 음식점</SelectItem>
                          <SelectItem value="beauty">💅 뷰티</SelectItem>
                          <SelectItem value="hospital">🏥 병원</SelectItem>
                          <SelectItem value="fitness">💪 헬스장</SelectItem>
                          <SelectItem value="other">🎁 기타</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="address">주소 *</Label>
                      <Input
                        id="address"
                        value={storeForm.address}
                        onChange={(e) => setStoreForm({ ...storeForm, address: e.target.value })}
                        placeholder="예: 서울 중구 명동10길 29"
                        required
                      />
                      <p className="text-xs text-gray-500">
                        주소를 입력하면 자동으로 GPS 좌표로 변환됩니다.
                      </p>
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="phone">전화번호</Label>
                      <Input
                        id="phone"
                        value={storeForm.phone}
                        onChange={(e) => setStoreForm({ ...storeForm, phone: e.target.value })}
                        placeholder="예: 02-1234-5678"
                      />
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="description">설명</Label>
                      <Textarea
                        id="description"
                        value={storeForm.description}
                        onChange={(e) => setStoreForm({ ...storeForm, description: e.target.value })}
                        placeholder="가게에 대한 간단한 설명"
                        rows={3}
                      />
                    </div>

                    {gpsCoords && (
                      <div className="p-3 bg-green-50 border border-green-200 rounded-lg">
                        <div className="flex items-start gap-2">
                          <CheckCircle2 className="w-5 h-5 text-green-600 mt-0.5" />
                          <div className="text-sm">
                            <p className="font-semibold text-green-900">GPS 변환 완료!</p>
                            <p className="text-green-700">
                              위도: {gpsCoords.lat.toFixed(6)}, 경도: {gpsCoords.lng.toFixed(6)}
                            </p>
                          </div>
                        </div>
                      </div>
                    )}

                    <Button
                      type="submit"
                      className="w-full bg-gradient-to-r from-orange-500 to-pink-500 hover:from-orange-600 hover:to-pink-600"
                      disabled={createStore.isPending}
                    >
                      {createStore.isPending ? '등록 중...' : '가게 등록'}
                    </Button>
                  </form>
                </CardContent>
              </Card>

              {/* 등록된 가게 목록 */}
              <Card>
                <CardHeader>
                  <CardTitle>등록된 가게 목록</CardTitle>
                  <CardDescription>
                    총 {stores?.length || 0}개의 가게가 등록되어 있습니다.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="space-y-3 max-h-[600px] overflow-y-auto">
                    {stores?.map((store) => (
                      <div
                        key={store.id}
                        className="p-3 border rounded-lg hover:bg-gray-50 transition-colors"
                      >
                        <div className="flex items-start gap-3">
                          <div className="text-2xl">
                            {store.category === 'cafe' ? '☕' :
                             store.category === 'restaurant' ? '🍽️' :
                             store.category === 'beauty' ? '💅' :
                             store.category === 'hospital' ? '🏥' :
                             store.category === 'fitness' ? '💪' : '🎁'}
                          </div>
                          <div className="flex-1 min-w-0">
                            <h3 className="font-semibold text-sm">{store.name}</h3>
                            <p className="text-xs text-gray-600 flex items-center gap-1 mt-1">
                              <MapPin className="w-3 h-3" />
                              {store.address}
                            </p>
                            {store.phone && (
                              <p className="text-xs text-gray-500 mt-1">📞 {store.phone}</p>
                            )}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          {/* 쿠폰 등록 탭 */}
          <TabsContent value="coupon" className="space-y-6">
            <div className="grid md:grid-cols-2 gap-6">
              {/* 쿠폰 등록 폼 */}
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Ticket className="w-5 h-5" />
                    새 쿠폰 등록
                  </CardTitle>
                  <CardDescription>
                    등록된 가게에 쿠폰을 추가합니다.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <form onSubmit={handleCreateCoupon} className="space-y-4">
                    <div className="space-y-2">
                      <Label htmlFor="storeId">가게 선택 *</Label>
                      <Select
                        value={couponForm.storeId.toString()}
                        onValueChange={(value) => setCouponForm({ ...couponForm, storeId: parseInt(value) })}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="가게를 선택하세요" />
                        </SelectTrigger>
                        <SelectContent>
                          {stores?.map((store) => (
                            <SelectItem key={store.id} value={store.id.toString()}>
                              {store.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="title">쿠폰 제목 *</Label>
                      <Input
                        id="title"
                        value={couponForm.title}
                        onChange={(e) => setCouponForm({ ...couponForm, title: e.target.value })}
                        placeholder="예: 아메리카노 1,000원 할인"
                        required
                      />
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="couponDescription">쿠폰 설명</Label>
                      <Textarea
                        id="couponDescription"
                        value={couponForm.description}
                        onChange={(e) => setCouponForm({ ...couponForm, description: e.target.value })}
                        placeholder="쿠폰에 대한 상세 설명"
                        rows={2}
                      />
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <Label htmlFor="discountType">할인 유형 *</Label>
                        <Select
                          value={couponForm.discountType}
                          onValueChange={(value: any) => setCouponForm({ ...couponForm, discountType: value })}
                        >
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="fixed">원 할인</SelectItem>
                            <SelectItem value="freebie">증정</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>

                      <div className="space-y-2">
                        <Label htmlFor="discountValue">
                          {couponForm.discountType === 'fixed' ? '할인 금액 (원)' : '수량'} *
                          {couponForm.discountType === 'fixed' && <span className="text-xs text-gray-500 ml-1">최소 1,000원</span>}
                        </Label>
                        <Input
                          id="discountValue"
                          type="number"
                          min={couponForm.discountType === 'fixed' ? 1000 : 1}
                          step={couponForm.discountType === 'fixed' ? 500 : 1}
                          value={couponForm.discountValue}
                          onChange={(e) => setCouponForm({ ...couponForm, discountValue: parseInt(e.target.value) })}
                          placeholder={couponForm.discountType === 'fixed' ? '1000' : '예: 30'}
                          required
                        />
                      </div>
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="totalQuantity">발행 수량 *</Label>
                      <Input
                        id="totalQuantity"
                        type="number"
                        value={couponForm.totalQuantity}
                        onChange={(e) => setCouponForm({ ...couponForm, totalQuantity: parseInt(e.target.value) })}
                        placeholder="예: 100"
                        required
                      />
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <Label htmlFor="startDate">시작일 *</Label>
                        <Input
                          id="startDate"
                          type="date"
                          value={couponForm.startDate}
                          onChange={(e) => setCouponForm({ ...couponForm, startDate: e.target.value })}
                          required
                        />
                      </div>

                      <div className="space-y-2">
                        <Label htmlFor="endDate">종료일 *</Label>
                        <Input
                          id="endDate"
                          type="date"
                          value={couponForm.endDate}
                          onChange={(e) => setCouponForm({ ...couponForm, endDate: e.target.value })}
                          required
                        />
                      </div>
                    </div>

                    <Button
                      type="submit"
                      className="w-full bg-gradient-to-r from-orange-500 to-pink-500 hover:from-orange-600 hover:to-pink-600"
                      disabled={createCoupon.isPending || couponForm.storeId === 0}
                    >
                      {createCoupon.isPending ? '등록 중...' : '쿠폰 등록'}
                    </Button>
                  </form>
                </CardContent>
              </Card>

              {/* 등록된 쿠폰 목록 */}
              <Card>
                <CardHeader>
                  <CardTitle>등록된 쿠폰 목록</CardTitle>
                  <CardDescription>
                    총 {coupons?.length || 0}개의 쿠폰이 등록되어 있습니다.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="space-y-3 max-h-[600px] overflow-y-auto">
                    {coupons?.map((coupon) => (
                      <div
                        key={coupon.id}
                        className="p-3 border rounded-lg hover:bg-gray-50 transition-colors"
                      >
                        <h3 className="font-semibold text-sm">{coupon.title}</h3>
                        <p className="text-xs text-gray-600 mt-1">
                          {coupon.discountType === 'percentage' ? `${coupon.discountValue}% 할인` :
                           coupon.discountType === 'fixed' ? `${coupon.discountValue.toLocaleString()}원 할인` :
                           '증정'}
                        </p>
                        <div className="flex items-center justify-between mt-2 text-xs text-gray-500">
                          <span>잔여: {coupon.remainingQuantity}/{coupon.totalQuantity}</span>
                          <span>~{new Date(coupon.endDate).toLocaleDateString()}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            </div>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
