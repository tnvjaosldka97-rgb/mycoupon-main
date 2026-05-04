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
import { ArrowLeft, Store, TrendingUp, DollarSign, Users, Plus, Edit2, Trash2, Ticket, Sparkles, Crown, CheckCircle2, Package, AlertCircle, RefreshCw, QrCode } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { getTierColor, PACK_TO_TIER } from "@/lib/tierColors";
import { Link, useLocation } from "wouter";
import { getLoginUrl } from "@/lib/const";
import { openGoogleLogin } from "@/lib/capacitor";
import { useState, useEffect, useRef } from "react";
import { toast } from "@/components/ui/sonner";

// ─── 구독팩 계급 표시 헬퍼 ──────────────────────────────────────────────────
const TIER_LABEL: Record<string, string> = {
  FREE:    '무료',
  WELCOME: '손님마중',
  REGULAR: '단골손님',
  BUSY:    '북적북적',
};

function TierStatusBanner({ myPlan, user }: { myPlan: any; user: any }) {
  const tc = getTierColor(myPlan?.tier);
  return (
    <Card style={{ borderColor: tc.border, backgroundColor: tc.bg }}>
      <CardContent className="pt-5 pb-4">
        <div className="flex items-center gap-3 flex-wrap">
          <Crown className="h-7 w-7 flex-shrink-0" style={{ color: tc.main }} />
          <div className="flex-1 min-w-0">
            <p className="text-sm text-gray-500">현재 등급</p>
            <p className="text-xl font-bold text-gray-900 whitespace-nowrap">
              {TIER_LABEL[myPlan?.tier ?? 'FREE'] ?? '무료'}
              {myPlan?.tier === 'FREE' && !myPlan?.pendingOrder && (() => {
                // PR-41 (2026-05-02): server source of truth 의존 (myPlan.trialState + trialDaysLeft + defaultCouponQuota)
                // 이전: user.trialEndsAt (auth.me staleTime: Infinity 캐시) 의존 → 강등 후 stale 표시
                // 사장님 명세 정합 (사장 상태 매트릭스):
                //   - non_trial_free OR quota=0  → 휴면 (강등/자연만료)
                //   - trial_free + quota>0       → 체험 중 (남은 일수 표시)
                //   - 그 외 fallback             → 7일 체험
                const trialState = (myPlan as any)?.trialState as string | undefined;
                const quota = (myPlan as any)?.defaultCouponQuota ?? 0;
                const trialDaysLeft = (myPlan as any)?.trialDaysLeft as number | null | undefined;

                if (trialState === 'non_trial_free' || quota === 0) {
                  return <span className="ml-2 text-sm font-normal text-blue-600">(휴면 — 조르기 모드)</span>;
                }
                if (trialState === 'trial_free' && typeof trialDaysLeft === 'number') {
                  const days = Math.min(trialDaysLeft, 7);
                  return (
                    <span className="ml-2 text-sm font-normal text-gray-500">
                      {days > 0 ? `(체험 ${days}일 남음 / ${quota}개)` : '(휴면 — 조르기 모드)'}
                    </span>
                  );
                }
                return <span className="ml-2 text-sm font-normal text-gray-500">(7일 체험 / {quota || 10}개)</span>;
              })()}
            </p>
            {myPlan?.pendingOrder && (
              <p className="mt-1 text-sm text-orange-600 font-medium flex items-center gap-1">
                <span className="inline-block h-2 w-2 rounded-full bg-orange-400 animate-pulse" />
                구독팩 신청 중 ({PACK_LABEL[myPlan.pendingOrder.packCode] ?? myPlan.pendingOrder.packCode})
              </p>
            )}
          </div>
          {myPlan && myPlan.tier !== 'FREE' && myPlan.expiresAt && (
            <div className="text-right flex-shrink-0">
              <p className="text-xs text-gray-500">만료일</p>
              <p className="text-sm font-semibold text-gray-700 whitespace-nowrap">
                {new Date(myPlan.expiresAt).toLocaleDateString('ko-KR')}
              </p>
            </div>
          )}
          {myPlan && myPlan.tier !== 'FREE' && (
            <div className="text-right flex-shrink-0">
              <p className="text-xs text-gray-500">쿠폰 등록 기본값</p>
              <p className="text-sm font-semibold text-gray-700 whitespace-nowrap">
                {myPlan.defaultDurationDays}일 / {myPlan.defaultCouponQuota}개
              </p>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

const PACK_LABEL: Record<string, string> = {
  WELCOME_19800: '손님마중패키지',
  REGULAR_29700: '단골손님패키지',
  BUSY_49500:    '북적북적패키지',
};

/** trialEndsAt 기준 남은 체험일 계산 */
function getTrialDaysLeft(trialEndsAt?: Date | null): number | null {
  if (!trialEndsAt) return null;
  const diff = new Date(trialEndsAt).getTime() - Date.now();
  return Math.max(0, Math.ceil(diff / (1000 * 60 * 60 * 24)));
}

// Source of Truth: server/routers/packOrders.ts TIER_DEFAULTS / listPacks
// 2026-05-02 가격 갱신: WELCOME 15,400/20개, REGULAR 19,800/35개, BUSY 36,300/70개
// packCode 는 legacy DB enum 유지 ('WELCOME_19800' 등 — 가격 변동에도 이름 불변)
const PACK_CATALOG = [
  {
    packCode: 'WELCOME_19800' as const,
    title: '손님마중패키지',
    price: 15400,
    durationDays: 30,
    displayCouponCount: 20,   // TIER_DEFAULTS.WELCOME.couponQuota
    dailyLimit: 3,
    unitPriceDisplay: 770,
    discountDisplay: '33.3%',
    highlight: false,
  },
  {
    packCode: 'REGULAR_29700' as const,
    title: '단골손님패키지',
    price: 19800,
    durationDays: 30,
    displayCouponCount: 35,   // TIER_DEFAULTS.REGULAR.couponQuota
    dailyLimit: 5,
    unitPriceDisplay: 565,
    discountDisplay: '42%',
    highlight: true,
  },
  {
    packCode: 'BUSY_49500' as const,
    title: '북적북적패키지',
    price: 36300,
    durationDays: 30,
    displayCouponCount: 70,   // TIER_DEFAULTS.BUSY.couponQuota
    dailyLimit: 9,
    unitPriceDisplay: 518,
    discountDisplay: '47%',
    highlight: false,
  },
];

// 구매하기 클릭 시 이동할 네이버 스마트스토어 URL (단품결제)
const PACK_PURCHASE_URL: Record<string, string> = {
  WELCOME_19800: 'https://smartstore.naver.com/mycoupon/products/13426210476?is_retargeting=true&c=260101_p_Naver_product&pid=Naver&deep_link_value=https%3A%2F%2Fsmartstore.naver.com%2Fmycoupon%2Fproducts%2F13426210476%3Fka_ref%3Dkakao%26ka_req_id%3DgJZsdIocFmR1soySvqFMAQ%26ka_template%3Dcommerce_basic&dtm_source=KK&dtm_detail=gJZsdIocFmR1soySvqFMAQ&dtm_campaign=commerce_basic&dtm_medium=OG',
  REGULAR_29700: 'https://smartstore.naver.com/mycoupon/products/13426216496?is_retargeting=true&c=260101_p_Naver_product&pid=Naver&deep_link_value=https%3A%2F%2Fsmartstore.naver.com%2Fmycoupon%2Fproducts%2F13426216496%3Fka_ref%3Dkakao%26ka_req_id%3DgJZsdGO9kio-BLjykCG4AA%26ka_template%3Dcommerce_basic&dtm_source=KK&dtm_detail=gJZsdGO9kio-BLjykCG4AA&dtm_campaign=commerce_basic&dtm_medium=OG',
  BUSY_49500:    'https://smartstore.naver.com/mycoupon/products/13426224307?is_retargeting=true&c=260101_p_Naver_product&pid=Naver&deep_link_value=https%3A%2F%2Fsmartstore.naver.com%2Fmycoupon%2Fproducts%2F13426224307%3Fka_ref%3Dkakao%26ka_req_id%3DgJZsdHFvFTcrzIMJf-FoAQ%26ka_template%3Dcommerce_basic&dtm_source=KK&dtm_detail=gJZsdHFvFTcrzIMJf-FoAQ&dtm_campaign=commerce_basic&dtm_medium=OG',
};

// 정기결제 / 추가결제 — 카카오 비즈니스 채널 1:1 문의 (2026-05-02 신설)
// 사장님 명시: 단품 패키지와 별도 흐름 — 발주요청 row 안 만듬, 외부 채널 이동만
const KAKAO_BIZ_CHANNEL_URL = 'https://pf.kakao.com/_xbdgxlX';

export default function MerchantDashboard() {
  const [, setLocation] = useLocation();
  const { user, loading } = useAuth();
  const utils = trpc.useUtils();
  const [activeTab, setActiveTab] = useState('stores'); // 탭 제어 state (구독탭 직접 이동용)
  const [isCreateCouponOpen, setIsCreateCouponOpen] = useState(false);
  const [isEditCouponOpen, setIsEditCouponOpen] = useState(false);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [selectedCoupon, setSelectedCoupon] = useState<any>(null);

  const [orderModalOpen, setOrderModalOpen] = useState(false);
  const [orderModalMessage, setOrderModalMessage] = useState('');
  const [pendingPackCode, setPendingPackCode] = useState<string | null>(null);
  const [deleteStoreDialogOpen, setDeleteStoreDialogOpen] = useState(false);
  const [storeToDelete, setStoreToDelete] = useState<{ id: number; name: string } | null>(null);

  const softDeleteStore = trpc.stores.softDeleteMyStore.useMutation({
    onSuccess: () => {
      toast.success('가게가 삭제되었습니다.');
      setDeleteStoreDialogOpen(false);
      setStoreToDelete(null);
      refetchStores();
    },
    onError: (error) => {
      toast.error(error.message || '삭제 중 오류가 발생했습니다.');
      setDeleteStoreDialogOpen(false);
    },
  });

  const reapplyStore = trpc.admin.reapply.useMutation({
    onSuccess: () => {
      toast.success('재신청이 완료되었습니다. 관리자 검토 후 승인됩니다.');
      refetchStores();
    },
    onError: (error: any) => {
      toast.error(error.message || '재신청 중 오류가 발생했습니다.');
    },
  });

  const { data: myPlan } = trpc.packOrders.getMyPlan.useQuery(undefined, {
    enabled: !!user && (user.role === 'merchant' || user.role === 'admin'),
    staleTime: 30 * 1000,
    refetchOnWindowFocus: true,
    refetchInterval: 60_000,
  });


  const createOrderRequest = trpc.packOrders.createOrderRequest.useMutation({
    onSuccess: (data) => {
      setPendingPackCode(null);
      if (!data.orderId || typeof data.orderId !== 'number') {
        toast.error('요청 저장 중 오류가 발생했습니다. 다시 시도해 주세요.');
        console.error('[PackOrder] orderId 없음 — 서버 응답:', data);
        return;
      }
      utils.packOrders.getMyPlan.invalidate();
      utils.packOrders.listPackOrders.invalidate();
      setOrderModalMessage(data.message);
      setOrderModalOpen(true);
    },
    onError: (error) => {
      setPendingPackCode(null);
      toast.error(error.message || '요청 처리 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.');
    },
  });

  // staleTime: 0 → 탭 포커스/재방문 시마다 즉시 재조회 → 관리자 승인 상태 실시간 반영
  // PR-31 (2026-05-01): refetchInterval 60s — admin 승인/강등 자동 반영 (사장님 페이지 active 시)
  const { data: myStores, isLoading: storesLoading, refetch: refetchStores } = trpc.stores.myStores.useQuery(undefined, {
    enabled: !!user && (user.role === 'merchant' || user.role === 'admin'),
    staleTime: 0,
    refetchOnWindowFocus: true,
    refetchInterval: 60_000,
  });

  // 조르기 통계 — 내 가게에 얼마나 많은 유저가 조르고 있는지
  // PR-31 (2026-05-01): refetchInterval 60s — 휴면 진입 후 조르기 통계 자동 반영
  const { data: nudgeStats } = trpc.stores.getExtensionStats.useQuery(
    { ownerId: user?.id as number },
    { enabled: !!user?.id && (user.role === 'merchant' || user.role === 'admin'), refetchInterval: 60_000 }
  );

  // [SECURE] 서버 권한 기반 — 본인 소유 쿠폰만 반환 (클라이언트 필터 불필요)
  // PR-31 (2026-05-01): refetchInterval 60s — admin 승인/강등 시 status 자동 반영
  const { data: myCoupons, isLoading: couponsLoading, refetch: refetchCoupons } = trpc.coupons.listMy.useQuery(undefined, {
    enabled: !!user && (user.role === 'merchant' || user.role === 'admin'),
    refetchInterval: 60_000,
  });

  const createCoupon = trpc.coupons.create.useMutation({
    onSuccess: (data) => {
      toast.success(data.message || "쿠폰 승인을 요청하였습니다. 관리자 승인 후 지도에 노출됩니다.");
      setIsCreateCouponOpen(false);
      refetchCoupons();
      setFormData({
        storeId: 0,
        title: "",
        description: "",
        discountType: "fixed",
        discountValue: 1000,
        minPurchase: 0,
        maxDiscount: 0,
        // FREE 기본값(10) — 폼 재오픈 시 handleCreateClick에서 현재 plan.defaultCouponQuota로 덮어씀
        totalQuantity: 10,
        dailyLimit: 10,
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
      utils.coupons.listMy.invalidate();
      utils.stores.mapStores.invalidate();
      utils.stores.list.invalidate();
    },
    onError: (error) => {
      toast.error(error.message || "쿠폰 삭제에 실패했습니다.");
    },
  });

  const [formData, setFormData] = useState({
    storeId: 0,
    title: "",
    description: "",
    discountType: "fixed" as "fixed" | "freebie",
    discountValue: 1000,
    minPurchase: 0,
    maxDiscount: 0,
    // FREE 기본값(10). 쿠폰 등록 모달 오픈 시 handleCreateClick에서 현재
    // myPlan.defaultCouponQuota로 덮어씌워지며, 편집 모달 오픈 시 handleEditClick에서
    // 기존 쿠폰 값으로 덮어씌워짐. 서버도 plan 기준으로 최종 강제.
    totalQuantity: 10,
    dailyLimit: 10, // 일 소비수량
    startDate: "",
    endDate: "",
  });

  // 플랜 변경(무료→유료 승급, 유료 만료 등) 시 열려 있는 "쿠폰 등록" 폼의
  // 기본값 totalQuantity를 현재 플랜 기준으로 자동 반영. 편집 모달은 제외
  // (기존 쿠폰 값 유지). 서버는 어차피 plan 기준으로 최종 강제.
  useEffect(() => {
    if (!isCreateCouponOpen) return;
    if (!myPlan) return;
    const quota = myPlan?.isAdmin ? 100 : (myPlan?.defaultCouponQuota ?? 10);
    setFormData(prev => (prev.totalQuantity === quota ? prev : { ...prev, totalQuantity: quota }));
  }, [myPlan?.tier, myPlan?.defaultCouponQuota, myPlan?.isAdmin, isCreateCouponOpen]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p className="text-gray-600">로딩 중...</p>
      </div>
    );
  }

  /**
   * startDate 기준으로 endDate를 플랜 정책에 맞게 자동 계산 (표시 전용)
   * 서버가 최종 결정하지만, 사용자에게 예상 종료일을 보여주기 위해 사용
   */
  function computeDisplayEndDate(startDateStr: string): string {
    if (!startDateStr) return "";
    const start = new Date(startDateStr);
    const isAdmin = myPlan?.isAdmin ?? false;
    const isPaid = !isAdmin && myPlan?.tier && myPlan.tier !== 'FREE';
    const days = isAdmin ? 30 : isPaid ? 30 : 7;
    const end = new Date(start);
    end.setDate(start.getDate() + (days - 1)); // 시작일 포함 N일
    // plan.expiresAt으로 cap (PAID인 경우)
    if (isPaid && myPlan?.expiresAt) {
      const planExpiry = new Date(myPlan.expiresAt);
      if (planExpiry < end) return planExpiry.toISOString().split('T')[0];
    }
    return end.toISOString().split('T')[0];
  }

  const handleCreateClick = () => {
    if (!myStores || myStores.length === 0) {
      toast.error("먼저 가게를 등록해주세요.");
      return;
    }
    // 플랜 기본값 적용 (어드민은 100, 그 외는 플랜 quota - franchise 포함 동일)
    const quota = myPlan?.isAdmin ? 100 : (myPlan?.defaultCouponQuota ?? 10);
    // quota가 0이면 쿠폰 등록 차단 — 구독팩 신청 필요
    if (!myPlan?.isAdmin && quota <= 0) {
      toast.error("쿠폰 등록 가능 수량이 0개입니다. 구독팩을 신청해 주세요.", { duration: 4000 });
      return;
    }
    const today = new Date();
    const todayStr = today.toISOString().split('T')[0];

    const tierMinDaily = (myPlan as any)?.defaultDailyLimit ?? 1;
    setFormData({
      storeId: myStores[0].id,
      title: "",
      description: "",
      discountType: "fixed" as const,
      discountValue: 1000,
      minPurchase: 0,
      maxDiscount: 0,
      totalQuantity: quota,
      dailyLimit: tierMinDaily,
      startDate: todayStr,
      endDate: computeDisplayEndDate(todayStr),
    });
    setIsCreateCouponOpen(true);
  };

  const handleEditClick = (coupon: any) => {
    const tierMinDaily = (myPlan as any)?.defaultDailyLimit ?? 1;
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
      dailyLimit: Math.max(coupon.dailyLimit ?? tierMinDaily, tierMinDaily),
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
    if (!formData.storeId || formData.storeId === 0) {
      alert('가게를 먼저 선택해주세요.');
      return;
    }
    // 서버 전송 직전 quota 재검증 — 0개면 등록 차단
    if (!myPlan?.isAdmin && (myPlan?.defaultCouponQuota ?? 10) <= 0) {
      toast.error("쿠폰 등록 가능 수량이 0개입니다. 마이쿠폰 구독팩 탭에서 구독팩을 신청해 주세요.");
      return;
    }
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

  // ── 접근 권한 가드 (useRef로 1회만 실행) ──────────────────────────────────
  const guardRan = useRef(false);
  useEffect(() => {
    if (loading) return;
    if (guardRan.current) return;
    guardRan.current = true;

    if (!user) {
      // 비로그인 → Google 로그인
      openGoogleLogin(getLoginUrl()).catch(() => {});
      return;
    }
    if (user.role !== 'merchant' && user.role !== 'admin') {
      // role='user' → 동의/온보딩 필요 (로그인 루프 방지)
      window.location.href = '/signup/consent?next=/merchant/dashboard';
      return;
    }
    // role='merchant'이지만 signupCompletedAt이 없는 예외 케이스 (구멍 차단)
    // 어드민이 수동으로 role을 변경했거나, 마이그레이션 미적용 계정 대응
    if (user.role === 'merchant' && !(user as any).signupCompletedAt) {
      window.location.href = '/signup/consent?next=/merchant/dashboard';
    }
  }, [loading, user]);

  if (loading) return null;
  if (!user || (user.role !== 'merchant' && user.role !== 'admin')) return null;
  // signupCompletedAt 없으면 렌더 차단 (라우트 가드 보완)
  if (user.role === 'merchant' && !(user as any).signupCompletedAt) return null;

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
        <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
          <TabsList className="flex-wrap h-auto gap-1">
            <TabsTrigger value="stores">내 가게</TabsTrigger>
            <TabsTrigger value="coupons">쿠폰 관리</TabsTrigger>
            {/* 구독팩 탭 – 강조 스타일 */}
            <TabsTrigger
              value="subscription"
              className="relative group data-[state=active]:bg-gradient-to-r data-[state=active]:from-orange-500 data-[state=active]:to-pink-500 data-[state=active]:text-white hover:shadow-[0_0_12px_rgba(249,115,22,0.5)] transition-all duration-200"
            >
              <Sparkles className="mr-1.5 h-4 w-4 text-orange-400 group-data-[state=active]:text-white" />
              마이쿠폰 구독팩
              <span className="ml-1.5 inline-flex items-center rounded-full bg-orange-500 px-1.5 py-0.5 text-[10px] font-bold text-white group-data-[state=active]:bg-white group-data-[state=active]:text-orange-500">
                NEW
              </span>
            </TabsTrigger>
          </TabsList>

          {/* 가게 관리 탭 */}
          <TabsContent value="stores" className="space-y-6">
            {/* ── 계급 상태 배너 ── */}
            <TierStatusBanner myPlan={myPlan} user={user} />
            {/* Action Buttons — 일반 계정은 가게 1개 있으면 차단, 프랜차이즈는 무제한 */}
            <div className="flex flex-wrap gap-4">
              {(() => {
                const isF     = (myPlan as any)?.isFranchise as boolean;
                const hasStore = (myStores ?? []).length > 0;
                if (!myPlan?.isAdmin && !isF && hasStore) {
                  return (
                    <Button disabled variant="outline" className="opacity-50 cursor-not-allowed">
                      <Store className="mr-2 h-4 w-4" />
                      가게 등록하기 (1업장 제한)
                    </Button>
                  );
                }
                return (
                  <Button onClick={() => setLocation("/merchant/add-store")}>
                    <Store className="mr-2 h-4 w-4" />
                    가게 등록하기
                  </Button>
                );
              })()}
              {/* PR-49: 쿠폰 검증 (QR 스캔 + PIN 입력) — 매장 1+ 시 노출 */}
              {(myStores ?? []).length > 0 && (
                <Button
                  variant="default"
                  className="bg-gradient-to-r from-peach-500 to-pink-500 hover:from-peach-600 hover:to-pink-600 text-white"
                  onClick={() => setLocation("/merchant/coupon-verify")}
                >
                  <QrCode className="mr-2 h-4 w-4" />
                  쿠폰 검증
                </Button>
              )}
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
                  {myStores.map((store) => {
                    const storeStatus = (store as any).status as string | undefined;
                    const rejectionReason = (store as any).rejectionReason as string | null | undefined;
                    const isRejected = storeStatus === 'rejected';

                    return (
                    <div key={store.id} className="relative group flex flex-col gap-2">
                      {/* 거절 알림 배너 */}
                      {isRejected && (
                        <div className="rounded-lg border-2 border-red-400 bg-red-50 px-4 py-3 space-y-2">
                          <div className="flex items-start gap-2">
                            <AlertCircle className="h-5 w-5 text-red-600 flex-shrink-0 mt-0.5" />
                            <div className="flex-1">
                              <p className="font-bold text-red-800 text-sm">가게 등록이 거절되었습니다.</p>
                              {rejectionReason && (
                                <p className="text-red-700 text-sm mt-1">
                                  <span className="font-medium">거절 사유:</span> {rejectionReason}
                                </p>
                              )}
                              <p className="text-red-600 text-xs mt-1">내용을 수정한 후 재신청 버튼을 눌러주세요.</p>
                            </div>
                          </div>
                          <Button
                            size="sm"
                            className="w-full bg-red-600 hover:bg-red-700 text-white"
                            disabled={reapplyStore.isPending}
                            onClick={() => reapplyStore.mutate({ id: store.id })}
                          >
                            <RefreshCw className="h-4 w-4 mr-1.5" />
                            수정 후 재신청
                          </Button>
                        </div>
                      )}

                      <Link href={`/merchant/store/${store.id}`}>
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
                                    {storeStatus === 'approved' || store.approvedBy ? (
                                      <Badge className="bg-green-100 text-green-700 hover:bg-green-100">
                                        승인됨
                                      </Badge>
                                    ) : isRejected ? (
                                      <Badge className="bg-red-100 text-red-700 hover:bg-red-100">
                                        거절됨
                                      </Badge>
                                    ) : (
                                      <Badge className="bg-orange-100 text-orange-700 hover:bg-orange-100">
                                        승인 대기
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
                              {nudgeStats && nudgeStats.waitingCount > 0 && (
                                <div className="mt-3 flex items-center gap-1.5 rounded-lg bg-orange-50 border border-orange-200 px-3 py-2">
                                  <span className="text-base">🔔</span>
                                  <span className="text-xs font-semibold text-orange-700">
                                    {nudgeStats.waitingCount}명이 쿠폰을 기다리고 있어요!
                                  </span>
                                  <span className="text-[10px] text-orange-500 ml-auto">
                                    오늘 {nudgeStats.today}명
                                  </span>
                                </div>
                              )}
                            </CardContent>
                          </Card>
                      </Link>
                      {/* 삭제 버튼 — 본인 소유 가게에만 표시 */}
                      <Button
                        variant="outline"
                        size="sm"
                        className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity bg-white hover:bg-red-50 hover:text-red-600 hover:border-red-300"
                        onClick={(e) => {
                          e.preventDefault();
                          setStoreToDelete({ id: store.id, name: store.name });
                          setDeleteStoreDialogOpen(true);
                        }}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                    );
                  })}
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
            {/* ── 계급 상태 배너 ── */}
            <TierStatusBanner myPlan={myPlan} user={user} />
            <div className="flex justify-between items-center mb-6">
              <h2 className="text-2xl font-bold text-gray-900">내 쿠폰</h2>
              {(() => {
                const trialState  = (myPlan as any)?.trialState  as string | undefined;
                const quota = myPlan?.isAdmin ? 100 : (myPlan?.defaultCouponQuota ?? 10);
                // 프랜차이즈도 trial 만료되면 쿠폰 등록 불가 / quota=0이면 등록 불가
                const canCreate = (myPlan?.isAdmin || trialState === 'trial_free' || trialState === 'paid')
                  && (myPlan?.isAdmin || quota > 0);
                const blockReason = quota <= 0 && !myPlan?.isAdmin
                  ? '쿠폰 수량이 0개입니다. 구독팩을 신청해 주세요.'
                  : '무료 체험이 종료되었습니다. 유료 구독팩을 신청해 주세요.';
                return canCreate ? (
                  <Button onClick={handleCreateClick}>
                    <Plus className="mr-2 h-4 w-4" />
                    쿠폰 등록
                  </Button>
                ) : (
                  <Button
                    disabled
                    variant="outline"
                    className="cursor-not-allowed opacity-40"
                    title={blockReason}
                  >
                    <Plus className="mr-2 h-4 w-4" />
                    쿠폰 등록 불가
                  </Button>
                );
              })()}
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
                            {(() => {
                              const end = new Date(coupon.endDate);
                              const hoursLeft = (end.getTime() - Date.now()) / (1000 * 60 * 60);
                              const isExpiringSoon = hoursLeft > 0 && hoursLeft <= 24;
                              const fmt = (d: Date) => d.toLocaleDateString('ko-KR', { month: 'numeric', day: 'numeric' });
                              return (
                                <>
                                  <p className="text-xs text-gray-400">
                                    {fmt(new Date(coupon.startDate))} ~ {fmt(end)} 사용가능
                                  </p>
                                  {isExpiringSoon && (
                                    <p className="text-xs font-semibold text-red-500 mt-0.5">⚠ 오늘 만료 예정</p>
                                  )}
                                </>
                              );
                            })()}
                          </div>
                          <div className="flex gap-2">
                            <Button
                              variant="outline"
                              size="sm"
                              disabled={!myPlan?.isAdmin && (myPlan as any)?.trialState === 'non_trial_free'}
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
                  {(() => {
                    const quota = myPlan?.isAdmin ? 100 : (myPlan?.defaultCouponQuota ?? 10);
                    const canCreate = myPlan?.isAdmin || quota > 0;
                    return canCreate ? (
                      <Button onClick={handleCreateClick}>
                        첫 쿠폰 등록하기
                      </Button>
                    ) : (
                      <div className="space-y-2">
                        <p className="text-sm text-red-500 font-medium">쿠폰 수량이 0개입니다.</p>
                        <Button
                          variant="outline"
                          onClick={() => setActiveTab('subscription')}
                        >
                          구독팩 신청하러 가기
                        </Button>
                      </div>
                    );
                  })()}
                </CardContent>
              </Card>
            )}
          </TabsContent>

            {/* ── 마이쿠폰 구독팩 탭 ── */}
          <TabsContent value="subscription" className="space-y-6">
            {/* ── 계급 상태 배너 ── */}
            <TierStatusBanner myPlan={myPlan} user={user} />
            <div>
              <h2 className="text-2xl font-bold text-gray-900 mb-2">구독팩 선택</h2>
              <p className="text-sm text-gray-500 mb-6">
                원하시는 패키지를 선택하고 구매하기를 누르면, 담당자가 개별 연락드립니다.
              </p>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
                {PACK_CATALOG.map((pack) => {
                  const packTier = PACK_TO_TIER[pack.packCode] ?? 'FREE';
                  const tc = getTierColor(packTier);
                  return (
                  <Card
                    key={pack.packCode}
                    className="relative flex flex-col transition-all duration-200 hover:shadow-xl"
                    style={{
                      borderWidth: pack.highlight ? 2 : 1,
                      borderColor: tc.border,
                      boxShadow: pack.highlight ? `0 4px 24px 0 ${tc.main}33` : undefined,
                    }}
                  >
                    {pack.highlight && (
                      <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                        <span
                          className="inline-flex items-center gap-1 rounded-full px-3 py-0.5 text-xs font-bold text-white shadow"
                          style={{ backgroundColor: tc.main }}
                        >
                          <Sparkles className="h-3 w-3" /> 추천
                        </span>
                      </div>
                    )}
                    <CardHeader className="pb-2">
                      <div className="flex items-center gap-2">
                        <CardTitle className="text-lg font-bold" style={{ color: tc.text }}>{pack.title}</CardTitle>
                        <span className="text-xs font-semibold rounded-full px-2 py-0.5 bg-gray-100 text-gray-500">유료 · 30일</span>
                      </div>
                      <div className="flex items-baseline gap-1 mt-1">
                        <span className="text-3xl font-extrabold" style={{ color: tc.main }}>
                          {pack.price.toLocaleString()}원
                        </span>
                        <span className="text-sm text-gray-400">/ 30일</span>
                      </div>
                    </CardHeader>
                    <CardContent className="flex-1 space-y-2 pb-5">
                      <div className="flex items-center gap-2 text-sm text-gray-700">
                        <CheckCircle2 className="h-4 w-4 shrink-0" style={{ color: tc.main }} />
                        쿠폰 <span className="font-semibold text-gray-900">{pack.displayCouponCount}개</span> 제공
                      </div>
                      <div className="flex items-center gap-2 text-sm text-gray-700">
                        <CheckCircle2 className="h-4 w-4 shrink-0" style={{ color: tc.main }} />
                        개당 <span className="font-semibold text-gray-900">{pack.unitPriceDisplay}원</span>
                      </div>
                      <div className="flex items-center gap-2 text-sm text-gray-700">
                        <CheckCircle2 className="h-4 w-4 shrink-0" style={{ color: tc.main }} />
                        <span className="font-semibold" style={{ color: tc.main }}>{pack.discountDisplay} 할인</span>
                      </div>
                      <div className="pt-3">
                        {myPlan?.isAdmin ? (
                          <Button className="w-full font-bold shadow-md" variant="outline" disabled>
                            관리자 계정 신청 불가
                          </Button>
                        ) : (
                          <Button
                            className="w-full font-bold text-white shadow-md"
                            style={{ backgroundColor: tc.main }}
                            onClick={() => {
                              const url = PACK_PURCHASE_URL[pack.packCode];
                              if (!url) return;
                              window.open(url, '_blank', 'noopener,noreferrer');
                            }}
                          >
                            구매하기
                          </Button>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                  );
                })}
              </div>
            </div>

            <p className="text-xs text-gray-400 text-center">
              * 구매하기를 누르면 네이버 스마트스토어 결제 페이지로 이동합니다.
            </p>

            {/* ── 카카오 채널 결제 섹션 (정기결제 / 추가결제) ── */}
            <div className="mt-10 pt-8 border-t border-gray-200">
              <div className="text-center mb-6">
                <h3 className="text-xl font-bold text-gray-900">카카오톡으로 간편 결제</h3>
                <p className="text-sm text-gray-500 mt-1">
                  정기결제·추가결제는 마이쿠폰 카카오톡 채널에서 1:1 안내로 진행됩니다.
                </p>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                {/* 정기결제 카드 */}
                <Card className="relative flex flex-col border border-yellow-200 bg-gradient-to-br from-yellow-50 to-white hover:shadow-lg transition-all">
                  <CardHeader className="pb-2">
                    <div className="flex items-center gap-2">
                      <CardTitle className="text-lg font-bold text-gray-900">정기결제</CardTitle>
                      <span className="text-xs font-semibold rounded-full px-2 py-0.5 bg-yellow-100 text-yellow-700">월 자동결제</span>
                    </div>
                    <div className="flex items-baseline gap-1 mt-1">
                      <span className="text-3xl font-extrabold text-gray-900">9,900원</span>
                      <span className="text-sm text-gray-400">부터 / 월</span>
                    </div>
                  </CardHeader>
                  <CardContent className="flex-1 space-y-2 pb-5">
                    <div className="flex items-center gap-2 text-sm text-gray-700">
                      <CheckCircle2 className="h-4 w-4 shrink-0 text-yellow-500" />
                      매월 자동 결제로 끊김 없이 운영
                    </div>
                    <div className="flex items-center gap-2 text-sm text-gray-700">
                      <CheckCircle2 className="h-4 w-4 shrink-0 text-yellow-500" />
                      가게 규모에 맞춘 맞춤 안내
                    </div>
                    <div className="pt-3">
                      <Button
                        className="w-full font-bold text-gray-900 shadow-md hover:opacity-90"
                        style={{ backgroundColor: '#FEE500' }}
                        onClick={() => window.open(KAKAO_BIZ_CHANNEL_URL, '_blank', 'noopener,noreferrer')}
                      >
                        카카오톡 문의하기
                      </Button>
                    </div>
                  </CardContent>
                </Card>

                {/* 추가결제 카드 */}
                <Card className="relative flex flex-col border border-yellow-200 bg-gradient-to-br from-yellow-50 to-white hover:shadow-lg transition-all">
                  <CardHeader className="pb-2">
                    <div className="flex items-center gap-2">
                      <CardTitle className="text-lg font-bold text-gray-900">추가결제</CardTitle>
                      <span className="text-xs font-semibold rounded-full px-2 py-0.5 bg-yellow-100 text-yellow-700">필요할 때만</span>
                    </div>
                    <div className="flex items-baseline gap-1 mt-1">
                      <span className="text-3xl font-extrabold text-gray-900">9,900원</span>
                      <span className="text-sm text-gray-400">/ 쿠폰 10개</span>
                    </div>
                  </CardHeader>
                  <CardContent className="flex-1 space-y-2 pb-5">
                    <div className="flex items-center gap-2 text-sm text-gray-700">
                      <CheckCircle2 className="h-4 w-4 shrink-0 text-yellow-500" />
                      기존 패키지에 쿠폰 10개 즉시 추가
                    </div>
                    <div className="flex items-center gap-2 text-sm text-gray-700">
                      <CheckCircle2 className="h-4 w-4 shrink-0 text-yellow-500" />
                      개당 990원 — 단품가 대비 저렴
                    </div>
                    <div className="pt-3">
                      <Button
                        className="w-full font-bold text-gray-900 shadow-md hover:opacity-90"
                        style={{ backgroundColor: '#FEE500' }}
                        onClick={() => window.open(KAKAO_BIZ_CHANNEL_URL, '_blank', 'noopener,noreferrer')}
                      >
                        카카오톡 문의하기
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              </div>
              <p className="text-xs text-gray-400 text-center mt-4">
                * 카카오톡 채널을 통해 담당자가 결제와 견적 안내를 도와드립니다.
              </p>
            </div>
          </TabsContent>
        </Tabs>

        {/* 발주요청 완료 모달 */}
        <Dialog open={orderModalOpen} onOpenChange={setOrderModalOpen}>
          <DialogContent className="max-w-sm text-center">
            <DialogHeader>
              <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-full bg-orange-100">
                <Package className="h-7 w-7 text-orange-500" />
              </div>
              <DialogTitle className="text-lg font-bold text-gray-900">
                담당자가 개별적으로 연락드리겠습니다
              </DialogTitle>
              <DialogDescription className="mt-2 text-sm text-gray-600 leading-relaxed">
                {orderModalMessage}
              </DialogDescription>
            </DialogHeader>
            <DialogFooter className="mt-2 justify-center">
              <Button
                className="bg-gradient-to-r from-orange-500 to-pink-500 text-white w-full"
                onClick={() => setOrderModalOpen(false)}
              >
                확인
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

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
                {/* 현재 플랜 안내 배너 */}
                {!myPlan?.isAdmin && (() => {
                  const trialState  = (myPlan as any)?.trialState  as string | undefined;
                  const isFranchise = (myPlan as any)?.isFranchise as boolean | undefined;
                  // 프랜차이즈 체험 중이면 경고 배너 불필요
                  if (isFranchise && trialState === 'trial_free') return null;
                  if (trialState === 'non_trial_free') {
                    return (
                      <div className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm border bg-red-50 border-red-200">
                        <Crown className="h-4 w-4 shrink-0 text-red-500" />
                        <span className="text-red-700 font-medium">
                          무료(체험 종료) — 쿠폰 생성/수정 불가. 유료 구독팩을 신청해 주세요.
                        </span>
                      </div>
                    );
                  }
                  if (trialState === 'trial_free') {
                    return (
                      <div className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm border bg-orange-50 border-orange-200">
                        <Crown className="h-4 w-4 shrink-0 text-orange-500" />
                        <span className="text-gray-700">
                          무료 체험 — 기간 <strong>7일</strong> / 수량 <strong>10개</strong> 기본 적용
                          <span className="ml-2 text-orange-600">(무료 체험은 계정당 1회)</span>
                        </span>
                      </div>
                    );
                  }
                  // paid 분기. 2026-04-18 패키지 고정 정책:
                  //   - 누적 quota 소진(quotaRemaining<=0) 시 단일 문구 한 줄만 노출
                  //     (남은 수량/티켓/다음 멤버십 등 다른 문구 금지)
                  //   - quotaRemaining은 getMyPlan이 approved 기준으로 내려주는 값
                  const quotaTotal     = (myPlan as any)?.quotaTotal ?? myPlan?.defaultCouponQuota ?? 0;
                  const quotaRemaining = (myPlan as any)?.quotaRemaining ?? quotaTotal;
                  const tierName       = TIER_LABEL[myPlan?.tier ?? 'FREE'] ?? (myPlan?.tier ?? '');
                  if (quotaRemaining <= 0) {
                    return (
                      <div className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm border bg-red-50 border-red-200">
                        <Crown className="h-4 w-4 shrink-0 text-red-500" />
                        <span className="text-red-700 font-medium">
                          현재 등급({tierName}) 누적 쿠폰 한도({quotaTotal}개)에 도달했습니다.
                        </span>
                      </div>
                    );
                  }
                  return (
                    <div className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm border bg-green-50 border-green-200">
                      <Crown className="h-4 w-4 shrink-0 text-green-600" />
                      <span className="text-gray-700">
                        현재 등급: <strong>{tierName}</strong>
                        {' '}— 기간 <strong>30일</strong> / 수량 <strong>{quotaTotal}개</strong>
                        {myPlan?.expiresAt && (
                          <span className="ml-2 text-green-700">(만료: {new Date(myPlan.expiresAt).toLocaleDateString('ko-KR')})</span>
                        )}
                      </span>
                    </div>
                  );
                })()}
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
                      onValueChange={(value: "fixed" | "freebie") =>
                        setFormData({ ...formData, discountType: value })
                      }
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="fixed">원 할인</SelectItem>
                        <SelectItem value="freebie">무료 증정</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  {formData.discountType !== 'freebie' && (
                    <div className="space-y-2">
                      <Label htmlFor="discountValue">할인 금액 (원) * <span className="text-xs text-gray-500">최소 1,000원</span></Label>
                      <Input
                        id="discountValue"
                        type="number"
                        min={1000}
                        step={500}
                        value={formData.discountValue}
                        onChange={(e) => setFormData({ ...formData, discountValue: parseInt(e.target.value) })}
                        required
                      />
                      {/* 사장님 결정 (PR-27, A안): 5 티어 — 1,000원 차이로 색 변환 자극 */}
                      <p className="text-xs text-gray-500 mt-1 leading-relaxed">
                        📌 할인 <strong>2,000원</strong>부터 띠 색깔이 부여됩니다.
                        더 많은 후킹을 위해 할인가를 올려주세요 🙂
                        <br />
                        <span className="text-[11px] text-gray-400">
                          (1,000~1,999원: 무색 / 2,000~2,999원: 초록 / 3,000~4,999원: 노랑 / 5,000~9,999원: 빨강 / 10,000원+: 빨강 + 🔥)
                        </span>
                      </p>
                    </div>
                  )}

                  <div className="space-y-2">
                    <Label htmlFor="totalQuantity">발행 수량 *</Label>
                    <Input
                      id="totalQuantity"
                      type="number"
                      value={formData.totalQuantity}
                      onChange={(e) => setFormData({ ...formData, totalQuantity: parseInt(e.target.value) })}
                      readOnly={!myPlan?.isAdmin}
                      className={!myPlan?.isAdmin ? 'bg-gray-50 cursor-not-allowed' : ''}
                      required
                    />
                    {!myPlan?.isAdmin && (
                      <p className="text-xs text-orange-500">현재 등급 기준으로 고정됩니다.</p>
                    )}
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="dailyLimit">일 소비수량 *</Label>
                    <Input
                      id="dailyLimit"
                      type="number"
                      min={(myPlan as any)?.defaultDailyLimit ?? 1}
                      value={formData.dailyLimit}
                      onChange={(e) => {
                        const floor = (myPlan as any)?.defaultDailyLimit ?? 1;
                        const val = parseInt(e.target.value) || floor;
                        setFormData({ ...formData, dailyLimit: Math.max(val, floor) });
                      }}
                      placeholder={String((myPlan as any)?.defaultDailyLimit ?? 1)}
                      required
                    />
                    <p className="text-xs text-muted-foreground">
                      하루에 다운로드 가능한 최대 수량 (자정 자동 리셋).
                      {myPlan && <> 현재 계급 최소값: <strong>{(myPlan as any).defaultDailyLimit ?? 1}</strong> (이상만 가능)</>}
                    </p>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="startDate">시작일 *</Label>
                    <Input
                      id="startDate"
                      type="date"
                      value={formData.startDate}
                      readOnly={!myPlan?.isAdmin}
                      className={!myPlan?.isAdmin ? 'bg-gray-50 cursor-not-allowed' : ''}
                      onChange={(e) => {
                        // 비관리자: 편집 불가 (서버가 등록일=오늘로 강제 — UI 잠금 방어선)
                        if (!myPlan?.isAdmin) return;
                        const newStart = e.target.value;
                        setFormData({
                          ...formData,
                          startDate: newStart,
                          // 시작일 변경 시 종료일 자동 재계산 (표시용)
                          endDate: computeDisplayEndDate(newStart),
                        });
                      }}
                      required
                    />
                    {!myPlan?.isAdmin && (
                      <p className="text-xs text-orange-500">
                        시작일은 등록일(오늘)로 고정됩니다.
                      </p>
                    )}
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="endDate">종료일 (자동 설정)</Label>
                    <Input
                      id="endDate"
                      type="date"
                      value={formData.endDate}
                      readOnly
                      className="bg-gray-50 cursor-not-allowed"
                    />
                    <p className="text-xs text-orange-500">
                      {myPlan?.isAdmin
                        ? '어드민: 종료일 자동 설정 (30일)'
                        : myPlan?.tier !== 'FREE'
                          ? `유료 플랜 기준 30일 자동 설정 (플랜 만료일 이내)`
                          : `무료 플랜 기준 7일 자동 설정됩니다.`}
                    </p>
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
                      onValueChange={(value: "fixed" | "freebie") =>
                        setFormData({ ...formData, discountType: value })
                      }
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="fixed">금액 할인</SelectItem>
                        <SelectItem value="freebie">무료 제공</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor="edit-discountValue">할인 금액 (원) <span className="text-xs text-gray-500">최소 1,000원</span></Label>
                    <Input
                      id="edit-discountValue"
                      type="number"
                      min={1000}
                      step={500}
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
                {/* 2026-04-18 패키지 고정 정책: 비관리자는 수량/기간 필드 편집 불가 (UI 잠금) */}
                {!myPlan?.isAdmin && (
                  <div className="flex items-start gap-2 rounded-lg px-3 py-2 text-xs border bg-orange-50 border-orange-200 text-orange-700">
                    <span>
                      발행 수량 · 시작일 · 종료일은 패키지 기본값으로 고정되어 수정할 수 없습니다.
                      나머지(제목/설명/할인/일 소비수량)만 수정 가능합니다.
                    </span>
                  </div>
                )}
                <div className="grid grid-cols-2 gap-4">
                  <div className="grid gap-2">
                    <Label htmlFor="edit-totalQuantity">발행 수량 *</Label>
                    <Input
                      id="edit-totalQuantity"
                      type="number"
                      value={formData.totalQuantity}
                      readOnly={!myPlan?.isAdmin}
                      className={!myPlan?.isAdmin ? 'bg-gray-50 cursor-not-allowed' : ''}
                      onChange={(e) => {
                        if (!myPlan?.isAdmin) return;
                        setFormData({ ...formData, totalQuantity: parseInt(e.target.value) });
                      }}
                      required
                    />
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor="edit-dailyLimit">일 소비수량 *</Label>
                    <Input
                      id="edit-dailyLimit"
                      type="number"
                      min={(myPlan as any)?.defaultDailyLimit ?? 1}
                      value={formData.dailyLimit}
                      onChange={(e) => {
                        const floor = (myPlan as any)?.defaultDailyLimit ?? 1;
                        const val = parseInt(e.target.value) || floor;
                        setFormData({ ...formData, dailyLimit: Math.max(val, floor) });
                      }}
                      required
                    />
                    {myPlan && (
                      <p className="text-xs text-muted-foreground">
                        현재 계급 최소값: <strong>{(myPlan as any).defaultDailyLimit ?? 1}</strong> (이상만 가능)
                      </p>
                    )}
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="grid gap-2">
                    <Label htmlFor="edit-startDate">시작일 *</Label>
                    <Input
                      id="edit-startDate"
                      type="date"
                      value={formData.startDate}
                      readOnly={!myPlan?.isAdmin}
                      className={!myPlan?.isAdmin ? 'bg-gray-50 cursor-not-allowed' : ''}
                      onChange={(e) => {
                        if (!myPlan?.isAdmin) return;
                        setFormData({ ...formData, startDate: e.target.value });
                      }}
                      required
                    />
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor="edit-endDate">종료일 *</Label>
                    <Input
                      id="edit-endDate"
                      type="date"
                      value={formData.endDate}
                      readOnly={!myPlan?.isAdmin}
                      className={!myPlan?.isAdmin ? 'bg-gray-50 cursor-not-allowed' : ''}
                      onChange={(e) => {
                        if (!myPlan?.isAdmin) return;
                        setFormData({ ...formData, endDate: e.target.value });
                      }}
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
                삭제 시 기존 미사용 쿠폰도 모두 비활성화됩니다. 이 작업은 되돌릴 수 없습니다.
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

        {/* 가게 삭제 확인 다이얼로그 */}
        <AlertDialog open={deleteStoreDialogOpen} onOpenChange={setDeleteStoreDialogOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>가게 삭제</AlertDialogTitle>
              <AlertDialogDescription>
                <strong>"{storeToDelete?.name}"</strong> 가게를 삭제하시겠습니까?
                <br />
                삭제된 가게는 목록에서 사라지며, 활성 쿠폰이 있으면 삭제할 수 없습니다.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel onClick={() => setStoreToDelete(null)}>취소</AlertDialogCancel>
              <AlertDialogAction
                onClick={() => storeToDelete && softDeleteStore.mutate({ id: storeToDelete.id })}
                className="bg-red-500 hover:bg-red-600"
                disabled={softDeleteStore.isPending}
              >
                {softDeleteStore.isPending ? "삭제 중..." : "삭제"}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </div>
  );
}
