import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { ArrowLeft, Store, TrendingUp, DollarSign, Users, Plus, Edit2, Trash2, Ticket } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { Link, useLocation } from "wouter";
import { getLoginUrl } from "@/lib/const";
import { useState } from "react";
import { toast } from "@/components/ui/sonner";

export default function MerchantDashboard() {
  const [, setLocation] = useLocation();
  const { user, loading } = useAuth();
  const [isCreateCouponOpen, setIsCreateCouponOpen] = useState(false);
  const [isEditCouponOpen, setIsEditCouponOpen] = useState(false);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [selectedCoupon, setSelectedCoupon] = useState<any>(null);

  const { data: myStores, isLoading: storesLoading } = trpc.stores.myStores.useQuery(undefined, {
    enabled: !!user && (user.role === 'merchant' || user.role === 'admin'),
  });

  const { data: allCoupons, isLoading: couponsLoading, refetch: refetchCoupons } = trpc.coupons.listActive.useQuery(undefined, {
    enabled: !!user && (user.role === 'merchant' || user.role === 'admin'),
  });

  // 내 가게의 쿠폰만 필터링
  const myCoupons = allCoupons?.filter(coupon => 
    myStores?.some(store => store.id === coupon.storeId)
  );

  const createCoupon = trpc.coupons.create.useMutation({
    onSuccess: (data) => {
      toast.success(data.message || "쿠폰이 등록되었습니다!");
      setIsCreateCouponOpen(false);
      refetchCoupons();
      setFormData({
        storeId: 0,
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
      setIsEditCouponOpen(false);
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
    storeId: 0,
    title: "",
    description: "",
    discountType: "percentage" as "percentage" | "fixed" | "freebie",
    discountValue: 0,
    minPurchase: 0,
    maxDiscount: 0,
    totalQuantity: 100,
    dailyLimit: 10, // 일 소비수량
    startDate: "",
    endDate: "",
  });

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p className="text-gray-600">로딩 중...</p>
      </div>
    );
  }

  const handleCreateClick = () => {
    if (!myStores || myStores.length === 0) {
      toast.error("먼저 가게를 등록해주세요.");
      return;
    }
    setFormData({
      storeId: myStores[0].id,
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
    setIsCreateCouponOpen(true);
  };

  const handleEditClick = (coupon: any) => {
    setSelectedCoupon(coupon);
    setFormData({
      storeId: coupon.storeId,
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
    setIsEditCouponOpen(true);
  };

  const handleDeleteClick = (coupon: any) => {
    setSelectedCoupon(coupon);
    setIsDeleteDialogOpen(true);
  };

  const handleCreateSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    createCoupon.mutate({
      ...formData,
      startDate: new Date(formData.startDate),
      endDate: new Date(formData.endDate),
    });
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

  const handleDeleteConfirm = () => {
    if (!selectedCoupon) return;
    deleteCoupon.mutate({ id: selectedCoupon.id });
  };

  if (!user || (user.role !== 'merchant' && user.role !== 'admin')) {
    window.location.href = getLoginUrl();
    return null;
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="border-b bg-white">
        <div className="container mx-auto px-4 py-4 flex items-center justify-between">
          <Button variant="ghost" onClick={() => setLocation("/")}>
            <ArrowLeft className="mr-2 h-4 w-4" />
            홈으로
          </Button>
          <h1 className="text-2xl font-bold text-gray-900">사장님 대시보드</h1>
          <div className="w-24"></div>
        </div>
      </header>

      <div className="container mx-auto px-4 py-8">
        <Tabs defaultValue="stores" className="space-y-6">
          <TabsList>
            <TabsTrigger value="stores">내 가게</TabsTrigger>
            <TabsTrigger value="coupons">쿠폰 관리</TabsTrigger>
          </TabsList>

          {/* 가게 관리 탭 */}
          <TabsContent value="stores" className="space-y-6">
            {/* Action Buttons */}
            <div className="flex gap-4">
              <Button onClick={() => setLocation("/merchant/add-store")}>
                <Store className="mr-2 h-4 w-4" />
                가게 등록하기
              </Button>
            </div>

            {/* My Stores */}
            <div>
              <h2 className="text-2xl font-bold text-gray-900 mb-6">내 가게 목록</h2>

              {storesLoading ? (
                <div className="text-center py-12">
                  <p className="text-gray-600">로딩 중...</p>
                </div>
              ) : myStores && myStores.length > 0 ? (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                  {myStores.map((store) => (
                    <Link key={store.id} href={`/merchant/store/${store.id}`}>
                      <Card className="hover:shadow-lg transition-shadow cursor-pointer h-full">
                          {store.imageUrl && (
                            <div className="h-48 overflow-hidden rounded-t-lg">
                              <img
                                src={store.imageUrl}
                                alt={store.name}
                                className="w-full h-full object-cover"
                              />
                            </div>
                          )}
                          <CardHeader>
                            <div className="flex items-start justify-between">
                              <div>
                                <CardTitle className="text-xl">{store.name}</CardTitle>
                                <CardDescription className="mt-1 flex gap-2">
                                  {store.approvedBy ? (
                                    <Badge className="bg-green-100 text-green-700 hover:bg-green-100">
                                      승인됨
                                    </Badge>
                                  ) : store.isActive ? (
                                    <Badge className="bg-orange-100 text-orange-700 hover:bg-orange-100">
                                      승인 대기
                                    </Badge>
                                  ) : (
                                    <Badge className="bg-red-100 text-red-700 hover:bg-red-100">
                                      거부됨
                                    </Badge>
                                  )}
                                </CardDescription>
                              </div>
                              <Badge variant="outline">{store.category}</Badge>
                            </div>
                          </CardHeader>
                          <CardContent>
                            <p className="text-sm text-gray-600 line-clamp-2">
                              {store.description || "설명 없음"}
                            </p>
                          </CardContent>
                        </Card>
                    </Link>
                  ))}
                </div>
              ) : (
                <Card>
                  <CardContent className="text-center py-12">
                    <Store className="h-12 w-12 text-gray-400 mx-auto mb-4" />
                    <p className="text-gray-600 mb-4">아직 등록된 가게가 없습니다.</p>
                    <Button onClick={() => setLocation("/merchant/add-store")}>
                      첫 가게 등록하기
                    </Button>
                  </CardContent>
                </Card>
              )}
            </div>
          </TabsContent>

          {/* 쿠폰 관리 탭 */}
          <TabsContent value="coupons" className="space-y-6">
            <div className="flex justify-between items-center mb-6">
              <h2 className="text-2xl font-bold text-gray-900">내 쿠폰</h2>
              <Button onClick={handleCreateClick}>
                <Plus className="mr-2 h-4 w-4" />
                쿠폰 등록
              </Button>
            </div>

            {couponsLoading ? (
              <div className="text-center py-12">
                <p className="text-gray-600">로딩 중...</p>
              </div>
            ) : myCoupons && myCoupons.length > 0 ? (
              <div className="space-y-4">
                {myCoupons.map((coupon) => (
                  <Card key={coupon.id}>
                    <CardContent className="pt-6">
                      <div className="flex items-center justify-between">
                        <div className="flex items-start gap-3 flex-1">
                          <Ticket className="h-5 w-5 text-orange-500 mt-1" />
                          <div className="flex-1">
                            <div className="flex items-center gap-2 mb-1">
                              <p className="font-medium text-lg">{coupon.title}</p>
                              {coupon.approvedBy ? (
                                <Badge className="bg-green-100 text-green-700">승인됨</Badge>
                              ) : (
                                <Badge className="bg-orange-100 text-orange-700">승인 대기</Badge>
                              )}
                            </div>
                            <p className="text-sm text-gray-500 mb-2">{coupon.description}</p>
                            <div className="flex items-center gap-2">
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
                        <div className="flex items-center gap-3 ml-4">
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
                    </CardContent>
                  </Card>
                ))}
              </div>
            ) : (
              <Card>
                <CardContent className="text-center py-12">
                  <Ticket className="h-12 w-12 text-gray-400 mx-auto mb-4" />
                  <p className="text-gray-600 mb-4">아직 등록된 쿠폰이 없습니다.</p>
                  <Button onClick={handleCreateClick}>
                    첫 쿠폰 등록하기
                  </Button>
                </CardContent>
              </Card>
            )}
          </TabsContent>
        </Tabs>

        {/* 쿠폰 등록 다이얼로그 */}
        <Dialog open={isCreateCouponOpen} onOpenChange={setIsCreateCouponOpen}>
          <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>새 쿠폰 등록</DialogTitle>
              <DialogDescription>
                쿠폰을 등록하면 관리자 승인 후 지도에 노출됩니다.
              </DialogDescription>
            </DialogHeader>
            <form onSubmit={handleCreateSubmit}>
              <div className="space-y-4 py-4">
                <div className="space-y-2">
                  <Label htmlFor="storeId">가게 선택 *</Label>
                  <Select
                    value={formData.storeId.toString()}
                    onValueChange={(value) => setFormData({ ...formData, storeId: parseInt(value) })}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="가게를 선택하세요" />
                    </SelectTrigger>
                    <SelectContent>
                      {myStores?.map((store) => (
                        <SelectItem key={store.id} value={store.id.toString()}>
                          {store.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="title">쿠폰 제목 *</Label>
                    <Input
                      id="title"
                      value={formData.title}
                      onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                      placeholder="예: 커피 1잔 무료"
                      required
                    />
                  </div>

                  <div className="space-y-2">
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
                        <SelectItem value="percentage">% 할인</SelectItem>
                        <SelectItem value="fixed">원 할인</SelectItem>
                        <SelectItem value="freebie">무료 증정</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  {formData.discountType !== 'freebie' && (
                    <div className="space-y-2">
                      <Label htmlFor="discountValue">
                        할인 {formData.discountType === 'percentage' ? '율 (%)' : '금액 (원)'} *
                      </Label>
                      <Input
                        id="discountValue"
                        type="number"
                        value={formData.discountValue}
                        onChange={(e) => setFormData({ ...formData, discountValue: parseInt(e.target.value) })}
                        required
                      />
                    </div>
                  )}

                  <div className="space-y-2">
                    <Label htmlFor="totalQuantity">발행 수량 *</Label>
                    <Input
                      id="totalQuantity"
                      type="number"
                      value={formData.totalQuantity}
                      onChange={(e) => setFormData({ ...formData, totalQuantity: parseInt(e.target.value) })}
                      required
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="dailyLimit">일 소비수량 *</Label>
                    <Input
                      id="dailyLimit"
                      type="number"
                      value={formData.dailyLimit}
                      onChange={(e) => setFormData({ ...formData, dailyLimit: parseInt(e.target.value) })}
                      placeholder="10"
                      required
                    />
                    <p className="text-xs text-muted-foreground">
                      하루에 다운로드 가능한 최대 수량 (자정 자동 리셋)
                    </p>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="startDate">시작일 *</Label>
                    <Input
                      id="startDate"
                      type="date"
                      value={formData.startDate}
                      onChange={(e) => setFormData({ ...formData, startDate: e.target.value })}
                      required
                    />
                  </div>

                  <div className="space-y-2">
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

                <div className="space-y-2">
                  <Label htmlFor="description">쿠폰 설명</Label>
                  <Textarea
                    id="description"
                    value={formData.description}
                    onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                    placeholder="쿠폰 사용 조건 및 상세 설명"
                    rows={3}
                  />
                </div>
              </div>
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setIsCreateCouponOpen(false)}>
                  취소
                </Button>
                <Button type="submit" className="bg-gradient-to-r from-orange-500 to-pink-500 hover:from-orange-600 hover:to-pink-600" disabled={createCoupon.isPending}>
                  {createCoupon.isPending ? "등록 중..." : "쿠폰 등록"}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>

        {/* 쿠폰 수정 다이얼로그 */}
        <Dialog open={isEditCouponOpen} onOpenChange={setIsEditCouponOpen}>
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
                      onChange={(e) => setFormData({ ...formData, startDate: e.target.value })}
                      required
                    />
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor="edit-endDate">종료일 *</Label>
                    <Input
                      id="edit-endDate"
                      type="date"
                      value={formData.endDate}
                      onChange={(e) => setFormData({ ...formData, endDate: e.target.value })}
                      required
                    />
                  </div>
                </div>
              </div>
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setIsEditCouponOpen(false)}>
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
