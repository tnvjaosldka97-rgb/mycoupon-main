import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { ArrowLeft, TrendingUp, DollarSign, Users, Plus, Ticket, Edit2, Trash2 } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { useParams, useLocation } from "wouter";
import { getLoginUrl } from "@/lib/const";
import { openGoogleLogin } from "@/lib/capacitor";
import { useState } from "react";
import { toast } from "@/components/ui/sonner";

export default function MerchantStoreDetail() {
  const { id } = useParams<{ id: string }>();
  const [, setLocation] = useLocation();
  const { user, loading } = useAuth();
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [selectedCoupon, setSelectedCoupon] = useState<any>(null);

  const storeId = parseInt(id || "0");
  const { data: stats, isLoading, refetch } = trpc.dashboard.stats.useQuery(
    { storeId },
    { enabled: !!user && (user.role === 'merchant' || user.role === 'admin') }
  );

  // listMy: 사장님 소유 전체 쿠폰 (승인 여부 무관) → storeId로 필터
  const { data: allMyCoupons, isLoading: couponsLoading, refetch: refetchCoupons } = trpc.coupons.listMy.useQuery(
    undefined,
    { enabled: !!user && (user.role === 'merchant' || user.role === 'admin') }
  );
  const coupons = allMyCoupons?.filter((c: any) => c.storeId === storeId);

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

  const updateCoupon = trpc.coupons.update.useMutation({
    onSuccess: () => {
      toast.success("쿠폰이 수정되었습니다!");
      setIsEditDialogOpen(false);
      setSelectedCoupon(null);
      refetchCoupons();
    },
    onError: (error) => {
      toast.error(error.message || "쿠폰 수정에 실패했습니다.");
    },
  });

  const deleteCoupon = trpc.coupons.delete.useMutation({
    onSuccess: () => {
      toast.success("쿠폰이 삭제되었습니다!");
      setIsDeleteDialogOpen(false);
      setSelectedCoupon(null);
      refetchCoupons();
    },
    onError: (error) => {
      toast.error(error.message || "쿠폰 삭제에 실패했습니다.");
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

  const handleEditClick = (coupon: any) => {
    setSelectedCoupon(coupon);
    setFormData({
      title: coupon.title,
      description: coupon.description || "",
      discountType: coupon.discountType,
      discountValue: coupon.discountValue,
      minPurchase: coupon.minPurchase || 0,
      maxDiscount: coupon.maxDiscount || 0,
      totalQuantity: coupon.totalQuantity,
      startDate: new Date(coupon.startDate).toISOString().split('T')[0],
      endDate: new Date(coupon.endDate).toISOString().split('T')[0],
    });
    setIsEditDialogOpen(true);
  };

  const handleEditSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedCoupon) return;
    
    updateCoupon.mutate({
      id: selectedCoupon.id,
      ...formData,
      startDate: new Date(formData.startDate),
      endDate: new Date(formData.endDate),
    });
  };

  const handleDeleteClick = (coupon: any) => {
    setSelectedCoupon(coupon);
    setIsDeleteDialogOpen(true);
  };

  const handleDeleteConfirm = () => {
    if (!selectedCoupon) return;
    deleteCoupon.mutate({ id: selectedCoupon.id });
  };

  if (loading || isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p className="text-gray-600">로딩 중...</p>
      </div>
    );
  }

  if (!user || (user.role !== 'merchant' && user.role !== 'admin')) {
    openGoogleLogin(getLoginUrl()).catch(() => {});
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

  /** 시작일 기준으로 종료일 자동 계산 (30일) */
  function calcEndDate(startDateStr: string): string {
    if (!startDateStr) return "";
    const start = new Date(startDateStr);
    start.setDate(start.getDate() + 29); // 시작일 포함 30일
    return start.toISOString().split('T')[0];
  }

  /** 쿠폰 상태 판정 */
  function getCouponStatus(coupon: any): { label: string; className: string } {
    const now = new Date();
    const endDate = new Date(coupon.endDate);
    const isExpired = endDate < now;
    const isExhausted = coupon.remainingQuantity <= 0;

    if (!coupon.approvedBy) {
      // 미승인: 검수대기중
      return { label: '검수대기중', className: 'bg-orange-100 text-orange-700 border border-orange-300' };
    }
    if (coupon.isActive && !isExpired && !isExhausted) {
      // 승인 + 유효기간 내 + 수량 있음: 활성화중
      return { label: '활성화중', className: 'bg-green-100 text-green-700 border border-green-300' };
    }
    // 그 외(만료/소진/비활성): 비활성화중
    return { label: '비활성화중', className: 'bg-gray-100 text-gray-500 border border-gray-300' };
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
                            onChange={(e) => {
                              const newStart = e.target.value;
                              setFormData({
                                ...formData,
                                startDate: newStart,
                                endDate: calcEndDate(newStart), // 30일 자동 계산
                              });
                            }}
                            required
                          />
                        </div>
                        <div className="grid gap-2">
                          <Label htmlFor="endDate">종료일 (자동)</Label>
                          <Input
                            id="endDate"
                            type="date"
                            value={formData.endDate}
                            readOnly
                            className="bg-gray-50 cursor-not-allowed"
                          />
                          <p className="text-xs text-gray-400">시작일 기준 30일 자동 설정</p>
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
                {coupons.map((coupon: any) => {
                  const status = getCouponStatus(coupon);
                  return (
                  <div key={coupon.id} className="flex items-center justify-between border-b pb-4 last:border-b-0">
                    <div className="flex items-start gap-3 flex-1">
                      <Ticket className="h-5 w-5 text-orange-500 mt-1" />
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-1">
                          <p className="font-medium">{coupon.title}</p>
                          {/* 상태 배지 */}
                          <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${status.className}`}>
                            {status.label}
                          </span>
                        </div>
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
                    <div className="flex items-center gap-3">
                      <div className="text-right mr-4">
                        <p className="text-sm text-gray-500">
                          {new Date(coupon.startDate).toLocaleDateString()} ~
                        </p>
                        <p className="text-sm text-gray-500">
                          {new Date(coupon.endDate).toLocaleDateString()}
                        </p>
                      </div>
                      <div className="flex gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleEditClick(coupon)}
                        >
                          <Edit2 className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleDeleteClick(coupon)}
                        >
                          <Trash2 className="h-4 w-4 text-red-500" />
                        </Button>
                      </div>
                    </div>
                  </div>
                );
                })}
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

        {/* 수정 다이얼로그 */}
        <Dialog open={isEditDialogOpen} onOpenChange={setIsEditDialogOpen}>
          <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>쿠폰 수정</DialogTitle>
              <DialogDescription>
                쿠폰 정보를 수정합니다.
              </DialogDescription>
            </DialogHeader>
            <form onSubmit={handleEditSubmit}>
              <div className="grid gap-4 py-4">
                <div className="grid gap-2">
                  <Label htmlFor="edit-title">쿠폰 제목 *</Label>
                  <Input
                    id="edit-title"
                    value={formData.title}
                    onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                    placeholder="예: 커피 1잔 무료"
                    required
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="edit-description">설명</Label>
                  <Textarea
                    id="edit-description"
                    value={formData.description}
                    onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                    placeholder="쿠폰 사용 조건 및 상세 설명"
                  />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="grid gap-2">
                    <Label htmlFor="edit-discountType">할인 유형 *</Label>
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
                    <Label htmlFor="edit-discountValue">
                      {formData.discountType === 'percentage' ? '할인율 (%)' : '할인 금액 (원)'}
                    </Label>
                    <Input
                      id="edit-discountValue"
                      type="number"
                      value={formData.discountValue}
                      onChange={(e) => setFormData({ ...formData, discountValue: parseInt(e.target.value) })}
                      required
                    />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="grid gap-2">
                    <Label htmlFor="edit-minPurchase">최소 구매 금액 (원)</Label>
                    <Input
                      id="edit-minPurchase"
                      type="number"
                      value={formData.minPurchase}
                      onChange={(e) => setFormData({ ...formData, minPurchase: parseInt(e.target.value) })}
                    />
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor="edit-maxDiscount">최대 할인 금액 (원)</Label>
                    <Input
                      id="edit-maxDiscount"
                      type="number"
                      value={formData.maxDiscount}
                      onChange={(e) => setFormData({ ...formData, maxDiscount: parseInt(e.target.value) })}
                    />
                  </div>
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="edit-totalQuantity">발행 수량 *</Label>
                  <Input
                    id="edit-totalQuantity"
                    type="number"
                    value={formData.totalQuantity}
                    onChange={(e) => setFormData({ ...formData, totalQuantity: parseInt(e.target.value) })}
                    required
                  />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="grid gap-2">
                    <Label htmlFor="edit-startDate">시작일 *</Label>
                    <Input
                      id="edit-startDate"
                      type="date"
                      value={formData.startDate}
                      onChange={(e) => {
                        const newStart = e.target.value;
                        setFormData({
                          ...formData,
                          startDate: newStart,
                          endDate: calcEndDate(newStart),
                        });
                      }}
                      required
                    />
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor="edit-endDate">종료일 (자동)</Label>
                    <Input
                      id="edit-endDate"
                      type="date"
                      value={formData.endDate}
                      readOnly
                      className="bg-gray-50 cursor-not-allowed"
                    />
                    <p className="text-xs text-gray-400">시작일 기준 30일 자동 설정</p>
                  </div>
                </div>
              </div>
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setIsEditDialogOpen(false)}>
                  취소
                </Button>
                <Button type="submit" disabled={updateCoupon.isPending}>
                  {updateCoupon.isPending ? "수정 중..." : "수정하기"}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>

        {/* 삭제 확인 다이얼로그 */}
        <AlertDialog open={isDeleteDialogOpen} onOpenChange={setIsDeleteDialogOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>쿠폰 삭제</AlertDialogTitle>
              <AlertDialogDescription>
                정말로 "{selectedCoupon?.title}" 쿠폰을 삭제하시겠습니까?
                <br />
                이 작업은 되돌릴 수 없습니다.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>취소</AlertDialogCancel>
              <AlertDialogAction
                onClick={handleDeleteConfirm}
                className="bg-red-500 hover:bg-red-600"
                disabled={deleteCoupon.isPending}
              >
                {deleteCoupon.isPending ? "삭제 중..." : "삭제"}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </div>
  );
}
