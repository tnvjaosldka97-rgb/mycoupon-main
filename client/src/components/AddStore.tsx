import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { ArrowLeft, Store, Ticket, CheckCircle } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { useState } from "react";
import { useLocation } from "wouter";
import { toast } from "@/components/ui/sonner";
import { getLoginUrl } from "@/lib/const";
import { AddressAutocomplete } from "@/components/AddressAutocomplete";

export default function AddStore() {
  const [, setLocation] = useLocation();
  const { user, loading } = useAuth();
  const [step, setStep] = useState<1 | 2>(1); // 1: 가게 등록, 2: 쿠폰 등록
  const [createdStoreId, setCreatedStoreId] = useState<number | null>(null);

  const [formData, setFormData] = useState<{
    name: string;
    category: "cafe" | "restaurant" | "beauty" | "hospital" | "fitness" | "other" | "";
    description: string;
    address: string;
    latitude?: string;
    longitude?: string;
    phone: string;
    imageUrl: string;
    openingHours: string;
    naverPlaceUrl?: string;
  }>({
    name: "",
    category: "",
    description: "",
    address: "",
    phone: "",
    imageUrl: "",
    openingHours: "",
    naverPlaceUrl: "",
  });

  const [couponForm, setCouponForm] = useState({
    title: "",
    description: "",
    discountType: "percentage" as "percentage" | "fixed" | "freebie",
    discountValue: 10,
    minPurchase: 0,
    maxDiscount: 0,
    totalQuantity: 100,
    startDate: new Date().toISOString().split('T')[0],
    endDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
  });

  const utils = trpc.useUtils();

  const createStore = trpc.stores.create.useMutation({
    onSuccess: async (data, variables) => {
      toast.success("가게가 등록되었습니다!");
      
      // 등록된 가게의 ID를 가져오기 위해 myStores를 다시 조회
      const stores = await utils.stores.myStores.fetch();
      const newStore = stores.find(s => s.name === variables.name);
      
      if (newStore) {
        setCreatedStoreId(newStore.id);
        setStep(2); // 쿠폰 등록 단계로 이동
      } else {
        // 가게 ID를 못 찾으면 대시보드로 이동
        setLocation("/merchant/dashboard");
      }
    },
    onError: (error) => {
      toast.error(error.message || "가게 등록에 실패했습니다.");
    },
  });

  const createCoupon = trpc.coupons.create.useMutation({
    onSuccess: () => {
      toast.success("쿠폰이 등록되었습니다!");
      setLocation("/merchant/dashboard");
    },
    onError: (error) => {
      toast.error(error.message || "쿠폰 등록에 실패했습니다.");
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    if (!formData.name || !formData.category || !formData.address) {
      toast.error("필수 항목을 모두 입력해주세요.");
      return;
    }

    createStore.mutate(formData as any);
  };

  const handleCouponSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    if (!createdStoreId) {
      toast.error("가게 정보를 찾을 수 없습니다.");
      return;
    }

    if (!couponForm.title) {
      toast.error("쿠폰 제목을 입력해주세요.");
      return;
    }

    createCoupon.mutate({
      storeId: createdStoreId,
      ...couponForm,
      startDate: new Date(couponForm.startDate),
      endDate: new Date(couponForm.endDate),
    });
  };

  const handleSkipCoupon = () => {
    setLocation("/merchant/dashboard");
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p className="text-gray-600">로딩 중...</p>
      </div>
    );
  }

  if (!user || (user.role !== 'merchant' && user.role !== 'admin')) {
    window.location.href = getLoginUrl();
    return null;
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="border-b bg-white">
        <div className="container mx-auto px-4 py-4">
          <Button variant="ghost" onClick={() => {
            if (step === 2) {
              setStep(1);
            } else {
              setLocation("/merchant/dashboard");
            }
          }}>
            <ArrowLeft className="mr-2 h-4 w-4" />
            {step === 2 ? "이전 단계로" : "대시보드로"}
          </Button>
        </div>
      </header>

      <div className="container mx-auto px-4 py-8 max-w-2xl">
        {/* 진행 표시 */}
        <div className="mb-8 flex items-center justify-center gap-4">
          <div className={`flex items-center gap-2 ${step === 1 ? 'text-primary' : 'text-green-600'}`}>
            {step === 2 ? <CheckCircle className="w-5 h-5" /> : <Store className="w-5 h-5" />}
            <span className="font-medium">1. 가게 등록</span>
          </div>
          <div className="w-12 h-0.5 bg-gray-300"></div>
          <div className={`flex items-center gap-2 ${step === 2 ? 'text-primary' : 'text-gray-400'}`}>
            <Ticket className="w-5 h-5" />
            <span className="font-medium">2. 쿠폰 등록</span>
          </div>
        </div>

        {step === 1 ? (
          <Card>
            <CardHeader>
              <CardTitle className="text-2xl">가게 등록</CardTitle>
              <CardDescription>가게 정보를 입력하면 관리자 승인 후 지도에 노출됩니다</CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleSubmit} className="space-y-6">
              <div>
                <Label htmlFor="name">가게 이름 *</Label>
                <Input
                  id="name"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  placeholder="예: 맛있는 카페"
                  required
                />
              </div>

              <div>
                <Label htmlFor="category">카테고리 *</Label>
                <Select
                  value={formData.category}
                  onValueChange={(value) => setFormData({ ...formData, category: value as "cafe" | "restaurant" | "beauty" | "hospital" | "fitness" | "other" })}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="카테고리를 선택하세요" />
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

              <div>
                <Label htmlFor="description">설명</Label>
                <Textarea
                  id="description"
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  placeholder="가게에 대한 설명을 입력하세요..."
                  rows={4}
                />
              </div>

              {/* 🔧 AddressAutocomplete 사용 (Google Places) */}
              <AddressAutocomplete
                value={formData.address}
                onChange={(address, coordinates) => {
                  setFormData({
                    ...formData,
                    address,
                    latitude: coordinates?.lat.toString() || formData.latitude,
                    longitude: coordinates?.lng.toString() || formData.longitude,
                  });
                }}
                label="주소"
                placeholder="예: 서울시 강남구 테헤란로 123"
                required
              />

              <div>
                <Label htmlFor="naverPlaceUrl">네이버 플레이스 링크</Label>
                <Input
                  id="naverPlaceUrl"
                  value={formData.naverPlaceUrl}
                  onChange={(e) => setFormData({ ...formData, naverPlaceUrl: e.target.value })}
                  placeholder="https://m.place.naver.com/... 또는 https://map.naver.com/..."
                />
                <p className="text-xs text-muted-foreground mt-1">
                  네이버 플레이스 링크를 입력하면 대표 이미지를 자동으로 가져옵니다.
                </p>
              </div>

              <div>
                <Label htmlFor="phone">전화번호</Label>
                <Input
                  id="phone"
                  value={formData.phone}
                  onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                  placeholder="예: 02-1234-5678"
                />
              </div>

              <div>
                <Label htmlFor="openingHours">영업 시간</Label>
                <Input
                  id="openingHours"
                  value={formData.openingHours}
                  onChange={(e) => setFormData({ ...formData, openingHours: e.target.value })}
                  placeholder="예: 월-금 09:00-18:00"
                />
              </div>

                <Button type="submit" className="w-full" disabled={createStore.isPending}>
                  {createStore.isPending ? "등록 중..." : "다음: 쿠폰 등록"}
                </Button>
              </form>
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardHeader>
              <CardTitle className="text-2xl flex items-center gap-2">
                <Ticket className="w-6 h-6" />
                쿠폰 등록
              </CardTitle>
              <CardDescription>
                <strong>{formData.name}</strong>의 첫 쿠폰을 등록하세요. 건너뛰고 나중에 등록할 수도 있습니다.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleCouponSubmit} className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="coupon-title">쿠폰 제목 *</Label>
                    <Input
                      id="coupon-title"
                      value={couponForm.title}
                      onChange={(e) => setCouponForm({ ...couponForm, title: e.target.value })}
                      placeholder="아메리카노 30% 할인"
                      required
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="discount-type">할인 유형 *</Label>
                    <Select
                      value={couponForm.discountType}
                      onValueChange={(value: "percentage" | "fixed" | "freebie") =>
                        setCouponForm({ ...couponForm, discountType: value })
                      }
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="percentage">% 할인</SelectItem>
                        <SelectItem value="fixed">원 할인</SelectItem>
                        <SelectItem value="freebie">무료 증정</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  {couponForm.discountType !== 'freebie' && (
                    <div className="space-y-2">
                      <Label htmlFor="discount-value">
                        할인 {couponForm.discountType === 'percentage' ? '율 (%)' : '금액 (원)'} *
                      </Label>
                      <Input
                        id="discount-value"
                        type="number"
                        value={couponForm.discountValue}
                        onChange={(e) => setCouponForm({ ...couponForm, discountValue: parseInt(e.target.value) || 0 })}
                        required
                      />
                    </div>
                  )}

                  <div className="space-y-2">
                    <Label htmlFor="total-quantity">발행 수량 *</Label>
                    <Input
                      id="total-quantity"
                      type="number"
                      value={couponForm.totalQuantity}
                      onChange={(e) => setCouponForm({ ...couponForm, totalQuantity: parseInt(e.target.value) || 100 })}
                      required
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="start-date">시작일 *</Label>
                    <Input
                      id="start-date"
                      type="date"
                      value={couponForm.startDate}
                      onChange={(e) => setCouponForm({ ...couponForm, startDate: e.target.value })}
                      required
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="end-date">종료일 *</Label>
                    <Input
                      id="end-date"
                      type="date"
                      value={couponForm.endDate}
                      onChange={(e) => setCouponForm({ ...couponForm, endDate: e.target.value })}
                      required
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="coupon-description">쿠폰 설명</Label>
                  <Textarea
                    id="coupon-description"
                    value={couponForm.description}
                    onChange={(e) => setCouponForm({ ...couponForm, description: e.target.value })}
                    placeholder="쿠폰 사용 조건 및 상세 설명"
                    rows={3}
                  />
                </div>

                <div className="flex gap-3">
                  <Button
                    type="button"
                    variant="outline"
                    className="flex-1"
                    onClick={handleSkipCoupon}
                  >
                    건너뛰기
                  </Button>
                  <Button type="submit" className="flex-1 bg-gradient-to-r from-orange-500 to-pink-500 hover:from-orange-600 hover:to-pink-600" disabled={createCoupon.isPending}>
                    {createCoupon.isPending ? "등록 중..." : "쿠폰 등록"}
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
