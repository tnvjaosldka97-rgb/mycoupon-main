import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ArrowLeft } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { useState } from "react";
import { useLocation } from "wouter";
import { toast } from "@/components/ui/sonner";
import { getLoginUrl } from "@/lib/const";
import { AddressAutocomplete } from "@/components/AddressAutocomplete";

export default function AddStore() {
  const [, setLocation] = useLocation();
  const { user, loading } = useAuth();

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

  const createStore = trpc.stores.create.useMutation({
    onSuccess: () => {
      toast.success("가게가 등록되었습니다!");
      setLocation("/merchant/dashboard");
    },
    onError: (error) => {
      toast.error(error.message || "가게 등록에 실패했습니다.");
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
          <Button variant="ghost" onClick={() => setLocation("/merchant/dashboard")}>
            <ArrowLeft className="mr-2 h-4 w-4" />
            대시보드로
          </Button>
        </div>
      </header>

      <div className="container mx-auto px-4 py-8 max-w-2xl">
        <Card>
          <CardHeader>
            <CardTitle className="text-2xl">가게 등록</CardTitle>
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
                <Label htmlFor="category">카테곣리 *</Label>
                <Select
                  value={formData.category}
                  onValueChange={(value) => setFormData({ ...formData, category: value as "cafe" | "restaurant" | "beauty" | "hospital" | "fitness" | "other" })}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="카테곣리를 선택하세요" />
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
                <Label htmlFor="phone">전화번호</Label>
                <Input
                  id="phone"
                  value={formData.phone}
                  onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                  placeholder="예: 02-1234-5678"
                />
              </div>

              <div>
                <Label htmlFor="imageUrl">이미지 URL</Label>
                <Input
                  id="imageUrl"
                  value={formData.imageUrl}
                  onChange={(e) => setFormData({ ...formData, imageUrl: e.target.value })}
                  placeholder="https://example.com/image.jpg"
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

              <Button type="submit" className="w-full" disabled={createStore.isPending}>
                {createStore.isPending ? "등록 중..." : "가게 등록"}
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
