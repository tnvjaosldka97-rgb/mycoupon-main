import { useAuth } from "@/_core/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ArrowLeft, TrendingUp, DollarSign, Users, Plus, Ticket } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { useParams, useLocation } from "wouter";
import { getLoginUrl } from "@/const";
import { useState } from "react";
import { toast } from "sonner";

export default function MerchantStoreDetail() {
  const { id } = useParams<{ id: string }>();
  const [, setLocation] = useLocation();
  const { user, loading } = useAuth();
  const [isDialogOpen, setIsDialogOpen] = useState(false);

  const storeId = parseInt(id || "0");
  const { data: stats, isLoading, refetch } = trpc.dashboard.stats.useQuery(
    { storeId },
    { enabled: !!user && (user.role === 'merchant' || user.role === 'admin') }
  );

  const { data: coupons, isLoading: couponsLoading, refetch: refetchCoupons } = trpc.coupons.listByStore.useQuery(
    { storeId },
    { enabled: !!user && (user.role === 'merchant' || user.role === 'admin') }
  );

  const createCoupon = trpc.coupons.create.useMutation({
    onSuccess: () => {
      toast.success("쿠폰이 등록되었습니다!");
      setIsDialogOpen(false);
      refetchCoupons();
      // 폼 초기화
      setFormData({
        title: "",
        description: "",
        discountType: "percentage",
        discountValue: 0,
        minPurchase: 0,
        maxDiscount: 0,
        totalQuantity: 100,
        startDate: "",
        endDate: "",
      });
    },
    onError: (error) => {
      toast.error(error.message || "쿠폰 등록에 실패했습니다.");
    },
  });

  const [formData, setFormData] = useState({
    title: "",
    description: "",
    discountType: "percentage" as "percentage" | "fixed" | "freebie",
    discountValue: 0,
    minPurchase: 0,
    maxDiscount: 0,
    totalQuantity: 100,
    startDate: "",
    endDate: "",
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    createCoupon.mutate({
      storeId,
      ...formData,
      startDate: new Date(formData.startDate),
      endDate: new Date(formData.endDate),
    });
  };

  if (loading || isLoading) {
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

  if (!stats) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p className="text-gray-600">가게 정보를 찾을 수 없습니다.</p>
      </div>
    );
  }

  const totalAdCostDollars = (stats.totalAdCost / 100).toFixed(2);

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

      <div className="container mx-auto px-4 py-8">
        {/* Store Info */}
        <div className="mb-8">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h1 className="text-3xl font-bold text-gray-900">{stats.store.name}</h1>
              <p className="text-gray-600 mt-1">{stats.store.category}</p>
            </div>
            <div className="flex items-center gap-2">
              <Badge variant={stats.store.isActive ? "default" : "secondary"}>
                {stats.store.isActive ? "활성" : "비활성"}
              </Badge>
              <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
                <DialogTrigger asChild>
                  <Button className="bg-gradient-to-r from-orange-500 to-pink-500 hover:from-orange-600 hover:to-pink-600">
                    <Plus className="mr-2 h-4 w-4" />
                    쿠폰 등록
                  </Button>
                </DialogTrigger>
                <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
                  <DialogHeader>
                    <DialogTitle>새 쿠폰 등록</DialogTitle>
                    <DialogDescription>
                      {stats.store.name}에 새로운 쿠폰을 등록합니다.
                    </DialogDescription>
                  </DialogHeader>
                  <form onSubmit={handleSubmit}>
                    <div className="grid gap-4 py-4">
                      <div className="grid gap-2">
                        <Label htmlFor="title">쿠폰 제목 *</Label>
                        <Input
                          id="title"
                          value={formData.title}
                          onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                          placeholder="예: 커피 1잔 무료"
                          required
                        />
                      </div>
                      <div className="grid gap-2">
                        <Label htmlFor="description">설명</Label>
                        <Textarea
                          id="description"
                          value={formData.description}
                          onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                          placeholder="쿠폰 사용 조건 및 상세 설명"
                        />
                      </div>
                      <div className="grid grid-cols-2 gap-4">
                        <div className="grid gap-2">
                          <Label htmlFor="discountType">할인 유형 *</Label>
                          <Select
                            value={formData.discountType}
                            onValueChange={(value: "percentage" | "fixed" | "freebie") =>
                              setFormData({ ...formData, discountType: value })
                            }
                          >
                            <SelectTrigger>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="percentage">퍼센트 할인</SelectItem>
                              <SelectItem value="fixed">금액 할인</SelectItem>
                              <SelectItem value="freebie">무료 제공</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="grid gap-2">
                          <Label htmlFor="discountValue">
                            {formData.discountType === 'percentage' ? '할인율 (%)' : '할인 금액 (원)'}
                          </Label>
                          <Input
                            id="discountValue"
                            type="number"
                            value={formData.discountValue}
                            onChange={(e) => setFormData({ ...formData, discountValue: parseInt(e.target.value) })}
                            required
                          />
                        </div>
                      </div>
                      <div className="grid grid-cols-2 gap-4">
                        <div className="grid gap-2">
                          <Label htmlFor="minPurchase">최소 구매 금액 (원)</Label>
                          <Input
                            id="minPurchase"
                            type="number"
                            value={formData.minPurchase}
                            onChange={(e) => setFormData({ ...formData, minPurchase: parseInt(e.target.value) })}
                          />
                        </div>
                        <div className="grid gap-2">
                          <Label htmlFor="maxDiscount">최대 할인 금액 (원)</Label>
                          <Input
                            id="maxDiscount"
                            type="number"
                            value={formData.maxDiscount}
                            onChange={(e) => setFormData({ ...formData, maxDiscount: parseInt(e.target.value) })}
                          />
                        </div>
                      </div>
                      <div className="grid gap-2">
                        <Label htmlFor="totalQuantity">발행 수량 *</Label>
                        <Input
                          id="totalQuantity"
                          type="number"
                          value={formData.totalQuantity}
                          onChange={(e) => setFormData({ ...formData, totalQuantity: parseInt(e.target.value) })}
                          required
                        />
                      </div>
                      <div className="grid grid-cols-2 gap-4">
                        <div className="grid gap-2">
                          <Label htmlFor="startDate">시작일 *</Label>
                          <Input
                            id="startDate"
                            type="date"
                            value={formData.startDate}
                            onChange={(e) => setFormData({ ...formData, startDate: e.target.value })}
                            required
                          />
                        </div>
                        <div className="grid gap-2">
                          <Label htmlFor="endDate">종료일 *</Label>
                          <Input
                            id="endDate"
                            type="date"
                            value={formData.endDate}
                            onChange={(e) => setFormData({ ...formData, endDate: e.target.value })}
                            required
                          />
                        </div>
                      </div>
                    </div>
                    <DialogFooter>
                      <Button type="button" variant="outline" onClick={() => setIsDialogOpen(false)}>
                        취소
                      </Button>
                      <Button type="submit" disabled={createCoupon.isPending}>
                        {createCoupon.isPending ? "등록 중..." : "등록하기"}
                      </Button>
                    </DialogFooter>
                  </form>
                </DialogContent>
              </Dialog>
            </div>
          </div>
        </div>

        {/* Stats Cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">총 방문 수</CardTitle>
              <Users className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{stats.visitCount}</div>
              <p className="text-xs text-muted-foreground">
                플랫폼을 통한 방문자 수
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">총 광고비</CardTitle>
              <DollarSign className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">${totalAdCostDollars}</div>
              <p className="text-xs text-muted-foreground">
                성과형 후불제 광고비
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">방문당 광고비</CardTitle>
              <TrendingUp className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">
                ${stats.visitCount > 0 ? ((stats.totalAdCost / stats.visitCount) / 100).toFixed(2) : "0.00"}
              </div>
              <p className="text-xs text-muted-foreground">
                평균 방문당 비용
              </p>
            </CardContent>
          </Card>
        </div>

        {/* Coupons List */}
        <Card className="mb-8">
          <CardHeader>
            <CardTitle>등록된 쿠폰</CardTitle>
            <CardDescription>이 가게에 등록된 쿠폰 목록입니다</CardDescription>
          </CardHeader>
          <CardContent>
            {couponsLoading ? (
              <p className="text-gray-500">로딩 중...</p>
            ) : coupons && coupons.length > 0 ? (
              <div className="space-y-4">
                {coupons.map((coupon) => (
                  <div key={coupon.id} className="flex items-center justify-between border-b pb-4 last:border-b-0">
                    <div className="flex items-start gap-3">
                      <Ticket className="h-5 w-5 text-orange-500 mt-1" />
                      <div>
                        <p className="font-medium">{coupon.title}</p>
                        <p className="text-sm text-gray-500">{coupon.description}</p>
                        <div className="flex items-center gap-2 mt-1">
                          <Badge variant="outline">
                            {coupon.discountType === 'percentage' ? `${coupon.discountValue}% 할인` :
                             coupon.discountType === 'fixed' ? `${coupon.discountValue}원 할인` :
                             '무료 제공'}
                          </Badge>
                          <Badge variant="secondary">
                            {coupon.remainingQuantity}/{coupon.totalQuantity} 남음
                          </Badge>
                        </div>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="text-sm text-gray-500">
                        {new Date(coupon.startDate).toLocaleDateString()} ~
                      </p>
                      <p className="text-sm text-gray-500">
                        {new Date(coupon.endDate).toLocaleDateString()}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-8">
                <Ticket className="h-12 w-12 text-gray-400 mx-auto mb-4" />
                <p className="text-gray-500 mb-4">아직 등록된 쿠폰이 없습니다.</p>
                <Button onClick={() => setIsDialogOpen(true)}>
                  첫 쿠폰 등록하기
                </Button>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Recent Visits */}
        <Card className="mb-8">
          <CardHeader>
            <CardTitle>최근 방문 기록</CardTitle>
            <CardDescription>최근 10개의 방문 기록입니다</CardDescription>
          </CardHeader>
          <CardContent>
            {stats.visits && stats.visits.length > 0 ? (
              <div className="space-y-4">
                {stats.visits.map((visit) => (
                  <div key={visit.id} className="flex items-center justify-between border-b pb-4 last:border-b-0">
                    <div>
                      <p className="font-medium">
                        {visit.source === 'search' ? '검색' : visit.source === 'recommendation' ? 'AI 추천' : '직접 방문'}
                      </p>
                      <p className="text-sm text-gray-500">
                        {new Date(visit.visitedAt).toLocaleString()}
                      </p>
                    </div>
                    <Badge variant="outline">{visit.source}</Badge>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-gray-500">아직 방문 기록이 없습니다.</p>
            )}
          </CardContent>
        </Card>

        {/* Ad Transactions */}
        <Card>
          <CardHeader>
            <CardTitle>광고비 거래 내역</CardTitle>
            <CardDescription>최근 10개의 광고비 거래 내역입니다</CardDescription>
          </CardHeader>
          <CardContent>
            {stats.adTransactions && stats.adTransactions.length > 0 ? (
              <div className="space-y-4">
                {stats.adTransactions.map((transaction) => (
                  <div key={transaction.id} className="flex items-center justify-between border-b pb-4 last:border-b-0">
                    <div>
                      <p className="font-medium">${(transaction.amount / 100).toFixed(2)}</p>
                      <p className="text-sm text-gray-500">
                        {new Date(transaction.createdAt).toLocaleString()}
                      </p>
                    </div>
                    <Badge variant={
                      transaction.status === 'paid' ? 'default' :
                      transaction.status === 'pending' ? 'secondary' :
                      'destructive'
                    }>
                      {transaction.status === 'paid' ? '지불 완료' :
                       transaction.status === 'pending' ? '대기 중' :
                       '취소됨'}
                    </Badge>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-gray-500">아직 광고비 거래 내역이 없습니다.</p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
