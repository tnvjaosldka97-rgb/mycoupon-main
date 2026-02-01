import { useState } from 'react';
import { useAuth } from '@/_core/hooks/useAuth';
import { trpc } from '@/lib/trpc';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Shield, Store, Ticket, MapPin, CheckCircle2, BarChart3, TrendingUp, Users, DollarSign, Edit, Trash2, Activity, Calendar } from 'lucide-react';
import { Line, Bar, Doughnut } from 'react-chartjs-2';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  BarElement,
  ArcElement,
  Title,
  Tooltip,
  Legend,
  Filler
} from 'chart.js';

ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  BarElement,
  ArcElement,
  Title,
  Tooltip,
  Legend,
  Filler
);
import { Link, useLocation } from 'wouter';
import { AddressAutocomplete } from '@/components/AddressAutocomplete';
import { EditStoreModal } from '@/components/EditStoreModal';
import { EditCouponModal } from '@/components/EditCouponModal';
import AdminAnalytics from './AdminAnalytics';

export default function AdminDashboard() {
  const { user } = useAuth();
  const [, setLocation] = useLocation();
  const [storeForm, setStoreForm] = useState({
    name: '',
    category: 'cafe' as 'cafe' | 'restaurant' | 'beauty' | 'other',
    address: '',
    phone: '',
    description: '',
    naverPlaceUrl: '', // 네이버 플레이스 링크
  });
  const [couponForm, setCouponForm] = useState({
    storeId: 0,
    title: '',
    description: '',
    discountType: 'percentage' as 'percentage' | 'fixed' | 'freebie',
    discountValue: 0,
    totalQuantity: 100,
    startDate: '',
    endDate: '',
  });
  const [gpsCoords, setGpsCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [editingStore, setEditingStore] = useState<any>(null);
  const [editingCoupon, setEditingCoupon] = useState<any>(null);

  const utils = trpc.useUtils();
  const createStore = trpc.admin.createStore.useMutation({
    onSuccess: () => {
      utils.admin.listStores.invalidate();
    },
  });
  const updateStore = trpc.admin.updateStore.useMutation({
    onSuccess: () => {
      utils.admin.listStores.invalidate();
      setEditingStore(null);
    },
  });
  const deleteStore = trpc.admin.deleteStore.useMutation({
    onSuccess: () => {
      utils.admin.listStores.invalidate();
    },
  });
  const approveStore = trpc.admin.approveStore.useMutation({
    onSuccess: () => {
      utils.admin.listStores.invalidate();
    },
  });
  const rejectStore = trpc.admin.rejectStore.useMutation({
    onSuccess: () => {
      utils.admin.listStores.invalidate();
    },
  });
  const createCoupon = trpc.admin.createCoupon.useMutation({
    onSuccess: () => {
      utils.admin.listCoupons.invalidate();
    },
  });
  const updateCoupon = trpc.admin.updateCoupon.useMutation({
    onSuccess: () => {
      utils.admin.listCoupons.invalidate();
      setEditingCoupon(null);
    },
  });
  const deleteCoupon = trpc.admin.deleteCoupon.useMutation({
    onSuccess: () => {
      utils.admin.listCoupons.invalidate();
    },
  });
  const { data: stores } = trpc.admin.listStores.useQuery();
  const { data: coupons } = trpc.admin.listCoupons.useQuery();
  const { data: analyticsOverview } = trpc.analytics.overview.useQuery();
  const { data: usageTrend } = trpc.analytics.usageTrend.useQuery({ period: 'daily' });
  const { data: topStores } = trpc.analytics.topStores.useQuery();
  const { data: categoryDistribution } = trpc.analytics.categoryDistribution.useQuery();

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
        naverPlaceUrl: '',
      });
      setGpsCoords(null);
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
        discountType: 'percentage',
        discountValue: 0,
        totalQuantity: 100,
        startDate: '',
        endDate: '',
      });
    } catch (error: any) {
      alert(error.message || '쿠폰 등록에 실패했습니다.');
    }
  };

  const handleUpdateStore = async (data: any) => {
    try {
      await updateStore.mutateAsync(data);
      alert('가게 정보가 수정되었습니다!');
    } catch (error: any) {
      alert(error.message || '가게 수정에 실패했습니다.');
    }
  };

  const handleUpdateCoupon = async (data: any) => {
    try {
      await updateCoupon.mutateAsync(data);
      alert('쿠폰 정보가 수정되었습니다!');
    } catch (error: any) {
      alert(error.message || '쿠폰 수정에 실패했습니다.');
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-orange-50 to-pink-50">
      {/* Header */}
      <header className="border-b bg-white/95 backdrop-blur-md shadow-sm sticky top-0 z-50">
        <div className="container mx-auto px-4 py-4 flex items-center justify-between">
          <Button variant="ghost" onClick={() => setLocation('/')}>
            <div className="flex items-center gap-3">
              <img src="/logo-symbol.png" alt="마이쿠폰" className="w-10 h-10" />
              <span className="text-2xl font-bold bg-gradient-to-r from-primary to-accent bg-clip-text text-transparent">
                마이쿠폰 관리자
              </span>
            </div>
          </Button>
          <div className="flex items-center gap-3">
            <Shield className="w-5 h-5 text-primary" />
            <span className="text-sm font-medium">{user.name}</span>
          </div>
        </div>
      </header>

      <div className="container mx-auto px-4 py-8">
        <Tabs defaultValue="overview" className="space-y-6">
          <TabsList className="grid w-full grid-cols-4">
            <TabsTrigger value="overview">
              <BarChart3 className="w-4 h-4 mr-2" />
              대시보드
            </TabsTrigger>
            <TabsTrigger value="stores">
              <Store className="w-4 h-4 mr-2" />
              가게 관리
            </TabsTrigger>
            <TabsTrigger value="coupons">
              <Ticket className="w-4 h-4 mr-2" />
              쿠폰 관리
            </TabsTrigger>
            <TabsTrigger value="analytics">
              <TrendingUp className="w-4 h-4 mr-2" />
              통계 분석
            </TabsTrigger>
          </TabsList>

          {/* 대시보드 탭 */}
          <TabsContent value="overview" className="space-y-6">
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
              <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium">승인된 가게</CardTitle>
                  <Store className="h-4 w-4 text-muted-foreground" />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">{stores?.filter(s => s.approvedBy).length || 0}</div>
                  <p className="text-xs text-muted-foreground">활성화된 제휴 매장</p>
                </CardContent>
              </Card>

              <Card className="border-orange-200 bg-orange-50/50">
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium text-orange-900">승인 대기</CardTitle>
                  <Activity className="h-4 w-4 text-orange-600" />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold text-orange-900">{stores?.filter(s => !s.approvedBy).length || 0}</div>
                  <p className="text-xs text-orange-700">검토가 필요한 매장</p>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium">총 쿠폰 수</CardTitle>
                  <Ticket className="h-4 w-4 text-muted-foreground" />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">{coupons?.length || 0}</div>
                  <p className="text-xs text-muted-foreground">발행된 쿠폰</p>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium">쿠폰 사용률</CardTitle>
                  <TrendingUp className="h-4 w-4 text-muted-foreground" />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">0%</div>
                  <p className="text-xs text-muted-foreground">전체 사용률</p>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium">총 사용자 수</CardTitle>
                  <Users className="h-4 w-4 text-muted-foreground" />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">0</div>
                  <p className="text-xs text-muted-foreground">가입 사용자</p>
                </CardContent>
              </Card>
            </div>

            <div className="grid grid-cols-1 gap-4">
              <Card>
                <CardHeader>
                  <CardTitle>최근 승인된 가게</CardTitle>
                  <CardDescription>최근 5개 매장</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="space-y-3">
                    {stores?.filter(s => s.approvedBy).slice(0, 5).map((store) => (
                      <div key={store.id} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                        <div className="flex items-center gap-3">
                          <Store className="w-5 h-5 text-primary" />
                          <div>
                            <p className="font-medium">{store.name}</p>
                            <p className="text-xs text-gray-600">{store.category}</p>
                          </div>
                        </div>
                        <Button variant="ghost" size="sm" onClick={() => setLocation(`/store/${store.id}`)}>
                          보기
                        </Button>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>최근 등록된 쿠폰</CardTitle>
                  <CardDescription>최근 5개 쿠폰</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="space-y-3">
                    {coupons?.slice(0, 5).map((coupon) => (
                      <div key={coupon.id} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                        <div className="flex items-center gap-3">
                          <Ticket className="w-5 h-5 text-accent" />
                          <div>
                            <p className="font-medium">{coupon.title}</p>
                            <p className="text-xs text-gray-600">
                              {coupon.discountType === 'percentage' && `${coupon.discountValue}% 할인`}
                              {coupon.discountType === 'fixed' && `${coupon.discountValue}원 할인`}
                              {coupon.discountType === 'freebie' && '무료 증정'}
                            </p>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          {/* 가게 관리 탭 */}
          <TabsContent value="stores" className="space-y-6">
            {/* 승인 대기 상점 섹션 */}
            {stores?.filter(s => !s.approvedBy).length > 0 && (
              <Card className="border-orange-200 bg-orange-50/50">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-orange-900">
                    <Activity className="w-6 h-6 text-orange-600" />
                    승인 대기 중인 상점 ({stores?.filter(s => !s.approvedBy).length})
                  </CardTitle>
                  <CardDescription>사장님이 등록한 상점을 승인하거나 거부할 수 있습니다</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="space-y-3">
                    {stores?.filter(s => !s.approvedBy).map((store) => (
                      <div key={store.id} className="flex items-center justify-between p-4 bg-white rounded-lg border border-orange-200">
                        <div className="flex-1">
                          <div className="flex items-center gap-3 mb-2">
                            <Store className="w-5 h-5 text-orange-600" />
                            <div>
                              <p className="font-semibold text-lg">{store.name}</p>
                              <p className="text-sm text-gray-600">{store.category}</p>
                            </div>
                          </div>
                          <div className="ml-8 space-y-1 text-sm text-gray-700">
                            <p><span className="font-medium">주소:</span> {store.address}</p>
                            {store.phone && <p><span className="font-medium">전화:</span> {store.phone}</p>}
                            {store.description && <p><span className="font-medium">설명:</span> {store.description}</p>}
                          </div>
                        </div>
                        <div className="flex gap-2 ml-4">
                          <Button
                            size="sm"
                            className="bg-green-600 hover:bg-green-700 text-white"
                            onClick={async () => {
                              if (confirm(`"${store.name}" 상점을 승인하시겠습니까?`)) {
                                try {
                                  await approveStore.mutateAsync({ id: store.id });
                                  alert('상점이 승인되었습니다.');
                                } catch (error: any) {
                                  alert(error.message || '승인에 실패했습니다.');
                                }
                              }
                            }}
                            disabled={approveStore.isPending}
                          >
                            <CheckCircle2 className="w-4 h-4 mr-1" />
                            승인
                          </Button>
                          <Button
                            size="sm"
                            variant="destructive"
                            onClick={async () => {
                              if (confirm(`"${store.name}" 상점을 거부하시겠습니까? 이 작업은 되돌릴 수 없습니다.`)) {
                                try {
                                  await rejectStore.mutateAsync({ id: store.id });
                                  alert('상점이 거부되었습니다.');
                                } catch (error: any) {
                                  alert(error.message || '거부에 실패했습니다.');
                                }
                              }
                            }}
                            disabled={rejectStore.isPending}
                          >
                            <Trash2 className="w-4 h-4 mr-1" />
                            거부
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Store className="w-6 h-6 text-primary" />
                  가게 등록
                </CardTitle>
                <CardDescription>새로운 제휴 매장을 등록합니다</CardDescription>
              </CardHeader>
              <CardContent>
                <form onSubmit={handleCreateStore} className="space-y-4">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="storeName">가게명 *</Label>
                      <Input
                        id="storeName"
                        value={storeForm.name}
                        onChange={(e) => setStoreForm({ ...storeForm, name: e.target.value })}
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
                          <SelectItem value="restaurant">🍽️ 맛집</SelectItem>
                          <SelectItem value="beauty">💅 뷰티</SelectItem>
                          <SelectItem value="other">🎁 기타</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    <div>
                      <AddressAutocomplete
                        value={storeForm.address}
                        onChange={(address, coordinates) => {
                          setStoreForm({ ...storeForm, address });
                          if (coordinates) {
                            setGpsCoords(coordinates);
                          }
                        }}
                        label="주소"
                        placeholder="주소를 검색하세요 (예: 서울 강남구 테헤란로)"
                        required
                      />
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="phone">전화번호</Label>
                      <Input
                        id="phone"
                        value={storeForm.phone}
                        onChange={(e) => setStoreForm({ ...storeForm, phone: e.target.value })}
                        placeholder="02-1234-5678"
                      />
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="description">설명</Label>
                    <Textarea
                      id="description"
                      value={storeForm.description}
                      onChange={(e) => setStoreForm({ ...storeForm, description: e.target.value })}
                      placeholder="가게에 대한 간단한 설명을 입력하세요"
                      rows={3}
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="naverPlaceUrl">네이버 플레이스 링크</Label>
                    <Input
                      id="naverPlaceUrl"
                      value={storeForm.naverPlaceUrl}
                      onChange={(e) => setStoreForm({ ...storeForm, naverPlaceUrl: e.target.value })}
                      placeholder="https://m.place.naver.com/... 또는 https://map.naver.com/..."
                    />
                    <p className="text-xs text-muted-foreground">
                      네이버 플레이스 링크를 입력하면 대표 이미지를 자동으로 가져옵니다.
                    </p>
                  </div>

                  {/* GPS 좌표는 백그라운드에서 자동 변환되므로 표시하지 않음 */}

                  <Button type="submit" className="w-full bg-gradient-to-r from-primary to-accent" disabled={createStore.isPending}>
                    {createStore.isPending ? '등록 중...' : '가게 등록'}
                  </Button>
                </form>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>승인된 가게 목록</CardTitle>
                <CardDescription>{stores?.filter(s => s.approvedBy).length || 0}개의 승인된 제휴 매장</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-1 gap-4">
                  {stores?.filter(s => s.approvedBy).map((store) => (
                    <Card key={store.id}>
                      <CardHeader>
                        <CardTitle className="text-lg flex items-center gap-2">
                          {store.category === 'cafe' && '☕'}
                          {store.category === 'restaurant' && '🍽️'}
                          {store.category === 'beauty' && '💅'}
                          {store.category === 'other' && '🎁'}
                          {store.name}
                          <span className="ml-2 px-2 py-1 bg-green-100 text-green-700 text-xs rounded-full flex items-center gap-1">
                            <CheckCircle2 className="w-3 h-3" />
                            승인됨
                          </span>
                        </CardTitle>
                        <CardDescription className="flex items-center gap-1">
                          <MapPin className="w-3 h-3" />
                          {store.address}
                        </CardDescription>
                      </CardHeader>
                      <CardContent>
                        <div className="flex gap-2">
                          <Button variant="outline" size="sm" className="flex-1" onClick={() => setEditingStore(store)}>
                            <Edit className="w-4 h-4 mr-1" />
                            수정
                          </Button>
                          <Button 
                            variant="outline" 
                            size="sm" 
                            className="flex-1 text-red-600 hover:text-red-700 hover:bg-red-50" 
                            onClick={() => {
                              if (confirm(`"${store.name}" 가게를 삭제하시겠습니까? 연결된 쿠폰도 모두 삭제됩니다.`)) {
                                deleteStore.mutate({ id: store.id });
                              }
                            }}
                          >
                            <Trash2 className="w-4 h-4 mr-1" />
                            삭제
                          </Button>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* 쿠폰 관리 탭 */}
          <TabsContent value="coupons" className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Ticket className="w-6 h-6 text-accent" />
                  쿠폰 등록
                </CardTitle>
                <CardDescription>새로운 쿠폰을 생성합니다</CardDescription>
              </CardHeader>
              <CardContent>
                <form onSubmit={handleCreateCoupon} className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="storeId">가게 선택 * (승인된 가게만)</Label>
                    <Select
                      value={couponForm.storeId.toString()}
                      onValueChange={(value) => setCouponForm({ ...couponForm, storeId: parseInt(value) })}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="가게를 선택하세요" />
                      </SelectTrigger>
                      <SelectContent>
                        {stores?.filter(s => s.approvedBy).map((store) => (
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
                        value={couponForm.title}
                        onChange={(e) => setCouponForm({ ...couponForm, title: e.target.value })}
                        placeholder="아메리카노 30% 할인"
                        required
                      />
                    </div>

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
                          <SelectItem value="percentage">% 할인</SelectItem>
                          <SelectItem value="fixed">원 할인</SelectItem>
                          <SelectItem value="freebie">무료 증정</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    {couponForm.discountType !== 'freebie' && (
                      <div className="space-y-2">
                        <Label htmlFor="discountValue">
                          할인 {couponForm.discountType === 'percentage' ? '율 (%)' : '금액 (원)'} *
                        </Label>
                        <Input
                          id="discountValue"
                          type="number"
                          value={couponForm.discountValue}
                          onChange={(e) => setCouponForm({ ...couponForm, discountValue: parseInt(e.target.value) })}
                          required
                        />
                      </div>
                    )}

                    <div className="space-y-2">
                      <Label htmlFor="totalQuantity">발행 수량 *</Label>
                      <Input
                        id="totalQuantity"
                        type="number"
                        value={couponForm.totalQuantity}
                        onChange={(e) => setCouponForm({ ...couponForm, totalQuantity: parseInt(e.target.value) })}
                        required
                      />
                    </div>

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

                  <div className="space-y-2">
                    <Label htmlFor="couponDescription">쿠폰 설명</Label>
                    <Textarea
                      id="couponDescription"
                      value={couponForm.description}
                      onChange={(e) => setCouponForm({ ...couponForm, description: e.target.value })}
                      placeholder="쿠폰 사용 조건 및 상세 설명"
                      rows={3}
                    />
                  </div>

                  <Button type="submit" className="w-full bg-gradient-to-r from-primary to-accent" disabled={createCoupon.isPending}>
                    {createCoupon.isPending ? '등록 중...' : '쿠폰 등록'}
                  </Button>
                </form>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>등록된 쿠폰 목록</CardTitle>
                <CardDescription>{coupons?.length || 0}개의 쿠폰</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {coupons?.map((coupon) => (
                    <div key={coupon.id} className="p-4 bg-gray-50 rounded-lg">
                      <div className="flex items-center justify-between">
                        <div className="flex-1">
                          <h4 className="font-bold">{coupon.title}</h4>
                          <p className="text-sm text-gray-600">{coupon.description}</p>
                          <div className="flex items-center gap-4 mt-2 text-xs text-gray-500">
                            <span>
                              {coupon.discountType === 'percentage' && `${coupon.discountValue}% 할인`}
                              {coupon.discountType === 'fixed' && `${coupon.discountValue}원 할인`}
                              {coupon.discountType === 'freebie' && '무료 증정'}
                            </span>
                            <span>발행: {coupon.totalQuantity}개</span>
                            <span>사용: 0개</span>
                          </div>
                        </div>
                        <div className="flex gap-2">
                          <Button variant="outline" size="sm" onClick={() => setEditingCoupon(coupon)}>
                            <Edit className="w-4 h-4" />
                          </Button>
                          <Button 
                            variant="outline" 
                            size="sm" 
                            className="text-red-600 hover:text-red-700 hover:bg-red-50" 
                            onClick={() => {
                              if (confirm(`"${coupon.title}" 쿠폰을 삭제하시겠습니까?`)) {
                                deleteCoupon.mutate({ id: coupon.id });
                              }
                            }}
                          >
                            <Trash2 className="w-4 h-4" />
                          </Button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* 통계 분석 탭 */}
          <TabsContent value="analytics" className="space-y-6">
            <AdminAnalytics />
          </TabsContent>
        </Tabs>
      </div>

      {/* 가게 수정 모달 */}
      {editingStore && (
        <EditStoreModal
          store={editingStore}
          open={!!editingStore}
          onClose={() => setEditingStore(null)}
          onSubmit={handleUpdateStore}
          isPending={updateStore.isPending}
        />
      )}

      {/* 쿠폰 수정 모달 */}
      {editingCoupon && (
        <EditCouponModal
          coupon={editingCoupon}
          open={!!editingCoupon}
          onClose={() => setEditingCoupon(null)}
          onSubmit={handleUpdateCoupon}
          isPending={updateCoupon.isPending}
        />
      )}
    </div>
  );
}
