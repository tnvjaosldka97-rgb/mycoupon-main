import { useState, useRef, useEffect } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { trpc } from '@/lib/trpc';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Shield, Store, Ticket, MapPin, CheckCircle2, BarChart3, TrendingUp, Users, DollarSign, Edit, Trash2, Activity, Calendar, Package, Crown, Sparkles, ChevronDown, ChevronUp, XCircle, AlertTriangle, Search } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { toast } from '@/components/ui/sonner';
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
import { KakaoAddressSearch } from '@/components/KakaoAddressSearch';
import { EditStoreModal } from '@/components/EditStoreModal';
import { EditCouponModal } from '@/components/EditCouponModal';
import AdminAnalytics from './AdminAnalytics';
import { MapView } from '@/components/Map';

/**
 * 어드민 가게 식별 보조 유틸 — 운영자 화면에서 계정/업장/권한을 빠르게 판독하기 위한
 * 읽기 전용 helper. 기존 저장/판정 로직과 무관.
 */
function resolveStoreThumbnail(raw: unknown): string | null {
  if (!raw || typeof raw !== 'string') return null;
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed[0] ?? null) : raw;
  } catch {
    return raw;
  }
}

const TIER_BADGE_STYLE: Record<string, string> = {
  FREE: 'bg-gray-100 text-gray-600 border-gray-200',
  WELCOME: 'bg-sky-100 text-sky-700 border-sky-200',
  REGULAR: 'bg-emerald-100 text-emerald-700 border-emerald-200',
  BUSY: 'bg-amber-100 text-amber-700 border-amber-200',
};

function StoreOwnerIdentity({
  store,
  compact = false,
}: {
  store: any;
  compact?: boolean;
}) {
  const ownerEmail = store?.ownerEmail ?? null;
  const ownerName = store?.ownerName ?? null;
  // ownerTier는 서버에서 이미 expires_at < NOW() → 'FREE' 정규화됨 (CASE WHEN)
  const tier = store?.ownerTier ?? 'FREE';
  const planExpiresAt = store?.ownerPlanExpiresAt ?? null;
  // 표시용 판정은 effective 필드 사용 (raw ownerPlanIsActive 의미는 contract 그대로 보존)
  const effectivelyActive = store?.ownerPlanIsEffectivelyActive ?? false;
  const isFranchise = store?.ownerIsFranchise ?? false;
  const storeCount = store?.ownerStoreCount ?? null;
  const tierCls = TIER_BADGE_STYLE[tier] ?? TIER_BADGE_STYLE.FREE;
  // 권한 표시: 프랜차이즈 우선 → effective active → 만료 tag
  const planLabel = isFranchise
    ? '프랜차이즈'
    : effectivelyActive
      ? tier
      : tier === 'FREE'
        ? 'FREE'
        : `${tier} (만료)`;
  return (
    <div className={`flex flex-wrap items-center gap-1.5 ${compact ? 'text-xs' : 'text-sm'}`}>
      <span className="text-gray-700 font-medium">
        {ownerName || ownerEmail || '미연결'}
      </span>
      {ownerEmail && ownerName && (
        <span className="text-gray-400 text-xs">({ownerEmail})</span>
      )}
      <span
        className={`inline-flex items-center rounded-full border px-1.5 py-0 text-[10px] font-semibold ${tierCls}`}
        title={planExpiresAt ? `만료: ${new Date(planExpiresAt).toLocaleDateString('ko-KR')}` : '플랜 만료일 없음'}
      >
        {planLabel}
      </span>
      {isFranchise && (
        <span className="inline-flex items-center rounded-full bg-purple-100 text-purple-700 border border-purple-200 px-1.5 py-0 text-[10px] font-semibold">
          FRANCHISE
        </span>
      )}
      {typeof storeCount === 'number' && storeCount > 1 && (
        <span
          className="inline-flex items-center rounded-full bg-indigo-100 text-indigo-700 border border-indigo-200 px-1.5 py-0 text-[10px] font-semibold"
          title="이 계정이 보유한 활성 매장 수"
        >
          매장 {storeCount}
        </span>
      )}
    </div>
  );
}

function StoreCouponStatus({ store, compact = false }: { store: any; compact?: boolean }) {
  const active = Number(store?.activeCouponCount ?? 0);
  const pending = Number(store?.pendingCouponCount ?? 0);
  const expired = Number(store?.expiredCouponCount ?? 0);
  const cls = compact ? 'text-[10px]' : 'text-xs';
  return (
    <div className={`flex flex-wrap items-center gap-1 ${cls} text-gray-600`}>
      <span className="inline-flex items-center rounded bg-green-50 text-green-700 border border-green-200 px-1.5 py-0 font-medium">
        활성 {active}
      </span>
      {pending > 0 && (
        <span className="inline-flex items-center rounded bg-orange-50 text-orange-700 border border-orange-200 px-1.5 py-0 font-medium">
          대기 {pending}
        </span>
      )}
      {expired > 0 && (
        <span className="inline-flex items-center rounded bg-gray-50 text-gray-500 border border-gray-200 px-1.5 py-0">
          만료 {expired}
        </span>
      )}
    </div>
  );
}

const PACK_ORDER_STATUS_LABEL: Record<string, string> = {
  REQUESTED: '요청',
  CONTACTED: '연락',
  APPROVED: '승인',
  REJECTED: '반려',
  CANCELLED: '취소',
};

function StoreLatestPackOrder({ store }: { store: any }) {
  const status = store?.latestPackOrderStatus;
  const at = store?.latestPackOrderAt;
  if (!status || !at) return null;
  const label = PACK_ORDER_STATUS_LABEL[status] ?? status;
  return (
    <span className="text-[10px] text-gray-500" title={`최근 발주: ${new Date(at).toLocaleString('ko-KR')}`}>
      최근 요청: {label} · {new Date(at).toLocaleDateString('ko-KR')}
    </span>
  );
}

export default function AdminDashboard() {
  const { user } = useAuth();
  const [, setLocation] = useLocation();
  const [storeForm, setStoreForm] = useState({
    name: '',
    category: 'cafe' as 'cafe' | 'restaurant' | 'beauty' | 'other',
    address: '',
    phone: '',
    description: '',
    naverPlaceUrl: '',
    latitude: '',   // GPS 좌표 (AddressAutocomplete에서 자동 채움)
    longitude: '',
  });
  const [couponForm, setCouponForm] = useState({
    storeId: 0,
    title: '',
    description: '',
    discountType: 'percentage' as 'percentage' | 'fixed' | 'freebie',
    discountValue: 0,
    totalQuantity: 100,
    dailyLimit: 10, // 일 소비수량
    startDate: '',
    endDate: '',
  });
  const [gpsCoords, setGpsCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [editingStore, setEditingStore] = useState<any>(null);
  const [editingCoupon, setEditingCoupon] = useState<any>(null);

  // ── 가게 검색 셀렉트 상태 ────────────────────────────────────────────────
  const [storeSelectOpen, setStoreSelectOpen] = useState(false);
  const [storeSelectQuery, setStoreSelectQuery] = useState('');
  const storeSelectRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (storeSelectRef.current && !storeSelectRef.current.contains(e.target as Node)) {
        setStoreSelectOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  // ── 구독팩 발주요청 상태 ────────────────────────────────────────────────
  const [packOrderFilter, setPackOrderFilter] = useState('');
  const [packOrderSearch, setPackOrderSearch] = useState('');
  const [selectedPackOrder, setSelectedPackOrder] = useState<any>(null);
  const [packOrderMemo, setPackOrderMemo] = useState('');
  const [packOrderStatus, setPackOrderStatus] = useState('');
  const [rejectedStoresOpen, setRejectedStoresOpen] = useState(false);
  const [rejectTarget, setRejectTarget] = useState<{ id: number; name: string } | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  // 탭 제어 상태 — 가게 보기 버튼으로 stores 탭 직접 이동 가능
  const [activeTab, setActiveTab] = useState('overview');
  const [storeOwnerFilter, setStoreOwnerFilter] = useState<{ id: number; name: string } | null>(null);
  // 가게 관리 탭 검색 (가게명·주소·사장님 이메일)
  const [storeSearch, setStoreSearch] = useState('');
  // 쿠폰 관리 탭 검색 (쿠폰명·가게명)
  const [couponSearch, setCouponSearch] = useState('');

  // ── 어뷰저 관리 상태 ─────────────────────────────────────────────────────
  const [abuseSearch, setAbuseSearch] = useState('');
  const [abuseStatusFilter, setAbuseStatusFilter] = useState<'WATCHLIST' | 'PENALIZED' | 'CLEAN' | ''>('');
  const [expandedAbuseUser, setExpandedAbuseUser] = useState<number | null>(null);
  const [abuseNote, setAbuseNote] = useState('');
  const [linkedAccounts, setLinkedAccounts] = useState<Record<string, unknown>[]>([]);
  const [snapshots, setSnapshots] = useState<Record<string, unknown>[]>([]);

  // ── 유저 플랜 관리 상태 ──────────────────────────────────────────────────
  const [planUserSearch, setPlanUserSearch] = useState('');
  const [selectedPlanUser, setSelectedPlanUser] = useState<any>(null);
  const [planForm, setPlanForm] = useState({
    tier: 'FREE' as 'FREE' | 'WELCOME' | 'REGULAR' | 'BUSY',
    durationDays: 30,
    defaultCouponQuota: 20,
    defaultDurationDays: 30,
    memo: '',
  });

  const utils = trpc.useUtils();

  // ── 신규 요청 확인 상태 ──────────────────────────────────────────────────
  const { data: checkedStoreIds } = trpc.admin.getCheckedIds.useQuery({ itemType: 'store' });
  const { data: checkedCouponIds } = trpc.admin.getCheckedIds.useQuery({ itemType: 'coupon' });
  const { data: checkedOrderIds } = trpc.admin.getCheckedIds.useQuery({ itemType: 'pack_order' });
  const { data: checkedPlanUserIds } = trpc.admin.getCheckedIds.useQuery({ itemType: 'plan_user' });
  const checkedStoreSet = new Set(checkedStoreIds ?? []);
  const checkedCouponSet = new Set(checkedCouponIds ?? []);
  const checkedOrderSet = new Set(checkedOrderIds ?? []);
  const checkedPlanUserSet = new Set(checkedPlanUserIds ?? []);
  const markChecked = trpc.admin.markChecked.useMutation({
    onSuccess: (_data, variables) => {
      utils.admin.getCheckedIds.invalidate({ itemType: variables.itemType });
    },
  });

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
    onSuccess: (data) => {
      utils.admin.listStores.invalidate();
      utils.stores.mapStores.invalidate();
      utils.stores.list.invalidate();
      const msg = data.deactivatedCoupons && data.deactivatedCoupons > 0
        ? `가게가 삭제되었습니다. (연관 쿠폰 ${data.deactivatedCoupons}개 비활성화)`
        : '가게가 삭제되었습니다.';
      toast.success(msg);
    },
    onError: (e: any) => toast.error(e.message || '삭제에 실패했습니다.'),
  });
  const approveStore = trpc.admin.approveStore.useMutation({
    onSuccess: () => {
      utils.admin.listStores.invalidate();
      utils.stores.list.invalidate();
      utils.stores.mapStores.invalidate();
      utils.admin.listCoupons.invalidate();
      toast.success('상점이 승인되었습니다. 지도에 즉시 노출됩니다.');
    },
    onError: (e: any) => toast.error(e.message || '승인에 실패했습니다.'),
  });
  const rejectStore = trpc.admin.rejectStore.useMutation({
    onSuccess: () => {
      utils.admin.listStores.invalidate();
      utils.stores.list.invalidate();
      utils.stores.mapStores.invalidate();
      toast.success('상점이 거부되었습니다.');
    },
    onError: (e: any) => toast.error(e.message || '거부에 실패했습니다.'),
  });
  const approveCoupon = trpc.admin.approveCoupon.useMutation({
    onSuccess: () => {
      utils.admin.listCoupons.invalidate();
      utils.stores.list.invalidate();
      utils.stores.mapStores.invalidate();
    },
    onError: (e: any) => toast.error(e.message || '쿠폰 승인에 실패했습니다.'),
  });
  const rejectCoupon = trpc.admin.rejectCoupon.useMutation({
    onSuccess: () => {
      utils.admin.listCoupons.invalidate();
      utils.stores.list.invalidate();
      utils.stores.mapStores.invalidate();
    },
    onError: (e: any) => toast.error(e.message || '쿠폰 거부에 실패했습니다.'),
  });
  const createCoupon = trpc.admin.createCoupon.useMutation({
    onSuccess: () => {
      utils.admin.listCoupons.invalidate();
      toast.success('쿠폰이 등록되었습니다.');
    },
    onError: (e: any) => toast.error(e.message || '쿠폰 등록에 실패했습니다.'),
  });
  const updateCoupon = trpc.admin.updateCoupon.useMutation({
    onSuccess: () => {
      utils.admin.listCoupons.invalidate();
      setEditingCoupon(null);
      toast.success('쿠폰이 수정되었습니다.');
    },
    onError: (e: any) => toast.error(e.message || '쿠폰 수정에 실패했습니다.'),
  });
  const deleteCoupon = trpc.admin.deleteCoupon.useMutation({
    onSuccess: () => {
      utils.admin.listCoupons.invalidate();
      utils.stores.list.invalidate();
      utils.stores.mapStores.invalidate();
      toast.success('쿠폰이 삭제되었습니다.');
    },
    onError: (e: any) => toast.error(e.message || '쿠폰 삭제에 실패했습니다.'),
  });
  const { data: stores, dataUpdatedAt, refetch: refetchStores } = trpc.admin.listStores.useQuery(undefined, {
    refetchOnWindowFocus: true,
    staleTime: 0,
    refetchInterval: 7000,
  });
  const { data: coupons } = trpc.admin.listCoupons.useQuery();
  const { data: unusedExpiryStats } = trpc.admin.getMerchantUnusedExpiryStats.useQuery();

  // ── 구독팩 발주요청 ──────────────────────────────────────────────────────
  const { data: packOrders, refetch: refetchPackOrders } = trpc.packOrders.listPackOrders.useQuery({
    status: packOrderFilter || undefined,
    q: packOrderSearch || undefined,
  });

  const updatePackOrder = trpc.packOrders.updatePackOrder.useMutation({
    onSuccess: () => {
      refetchPackOrders();
      setSelectedPackOrder(null);
      toast.success('발주요청이 저장되었습니다.');
    },
    onError: (e: any) => toast.error(e.message || '저장에 실패했습니다.'),
  });

  const deletePackOrder = trpc.packOrders.deletePackOrder.useMutation({
    onSuccess: () => {
      refetchPackOrders();
      setSelectedPackOrder(null);
      toast.success('발주요청이 삭제되었습니다.');
    },
    onError: (e: any) => toast.error(e.message || '삭제에 실패했습니다.'),
  });

  // ── 유저 플랜 관리 ───────────────────────────────────────────────────────
  const { data: planUsers, refetch: refetchPlanUsers } = trpc.packOrders.listUsersForPlan.useQuery({
    q: planUserSearch || undefined,
  });

  // 조르기 누적 현황 (슈퍼어드민)
  const { data: nudgeLeaderboard } = trpc.stores.getNudgeLeaderboard.useQuery();

  const setFranchise = trpc.admin.setFranchise.useMutation({
    onSuccess: () => {
      refetchPlanUsers();
      toast.success('프랜차이즈 권한이 업데이트되었습니다.');
    },
    onError: (e: any) => toast.error(e.message || '프랜차이즈 권한 변경에 실패했습니다.'),
  });

  // ── 이벤트 팝업 관리 ────────────────────────────────────────────────────
  const [showPopupForm, setShowPopupForm] = useState(false);
  const [editingPopup, setEditingPopup] = useState<any>(null);
  const [popupForm, setPopupForm] = useState({
    title: '', body: '', target: 'ALL' as 'ALL'|'DORMANT_ONLY'|'ACTIVE_ONLY',
    imageDataUrl: '', primaryButtonText: '', primaryButtonUrl: '',
    dismissible: true, priority: 0, startsAt: '', endsAt: '',
  });
  const { data: eventPopups, refetch: refetchPopups } = trpc.popup.list.useQuery();
  const createPopup = trpc.popup.create.useMutation({
    onSuccess: () => { refetchPopups(); setShowPopupForm(false); toast.success('팝업이 생성되었습니다.'); },
    onError: (e: any) => toast.error(e.message || '생성 실패'),
  });
  const updatePopup = trpc.popup.update.useMutation({
    onSuccess: () => { refetchPopups(); setEditingPopup(null); toast.success('팝업이 수정되었습니다.'); },
    onError: (e: any) => toast.error(e.message || '수정 실패'),
  });
  const togglePopup = trpc.popup.toggleActive.useMutation({
    onSuccess: () => { refetchPopups(); },
    onError: (e: any) => toast.error(e.message || '변경 실패'),
  });
  const deletePopup = trpc.popup.delete.useMutation({
    onSuccess: () => { refetchPopups(); toast.success('팝업이 삭제되었습니다.'); },
    onError: (e: any) => toast.error(e.message || '삭제 실패'),
  });

  // ── 어뷰저 관리 API ──────────────────────────────────────────────────────
  const { data: abuseList, refetch: refetchAbuse } = trpc.abuse.listAbusers.useQuery(
    { status: (abuseStatusFilter || undefined) as any, q: abuseSearch || undefined },
    { enabled: activeTab === 'abuse' }
  );
  const setAbuseStatus = trpc.abuse.setStatus.useMutation({
    onSuccess: () => { refetchAbuse(); toast.success('상태가 업데이트되었습니다.'); },
    onError: (e: any) => toast.error(e.message || '업데이트 실패'),
  });
  const getLinkedAccounts = trpc.abuse.getLinkedAccounts.useMutation({
    onSuccess: (data) => setLinkedAccounts(data as any),
    onError: () => setLinkedAccounts([]),
  });
  const getSnapshots = trpc.abuse.getSnapshots.useMutation({
    onSuccess: (data) => setSnapshots(data as any),
    onError: () => setSnapshots([]),
  });

  const nudgeMerchant = trpc.admin.nudgeMerchant.useMutation({
    onSuccess: (data) => {
      refetchPlanUsers();
      toast.success(data.mailSent ? '조르기 완료! 이메일 발송됨.' : '조르기 완료 (이메일 미설정)');
    },
    onError: (e: any) => toast.error(e.message || '조르기에 실패했습니다.'),
  });

  const deleteUser = trpc.admin.deleteUser.useMutation({
    onSuccess: () => {
      refetchPlanUsers();
      setSelectedPlanUser(null);
      toast.success('계정이 삭제되었습니다.');
    },
    onError: (e: any) => toast.error(e.message || '계정 삭제에 실패했습니다.'),
  });

  const terminatePlan = trpc.packOrders.terminatePlan.useMutation({
    onSuccess: (data) => {
      refetchPlanUsers();
      setSelectedPlanUser(null);
      utils.stores.mapStores.invalidate();
      utils.stores.list.invalidate();
      utils.admin.listStores.invalidate();
      toast.success(`강제 종료 완료. 비활성 쿠폰: ${data.deactivated}개. 계정이 즉시 휴면 처리되었습니다.`);
    },
    onError: (e: any) => toast.error(e.message || '종료 처리에 실패했습니다.'),
  });

  const setUserPlan = trpc.packOrders.setUserPlan.useMutation({
    onSuccess: () => {
      refetchPlanUsers();
      setSelectedPlanUser(null);
      utils.stores.mapStores.invalidate();
      utils.stores.list.invalidate();
      utils.admin.listStores.invalidate();
      utils.packOrders.getMyPlan.invalidate();
      utils.packOrders.listPackOrders.invalidate();
      toast.success('플랜이 업데이트되었습니다.');
    },
    onError: (e: any) => toast.error(e.message || '플랜 업데이트에 실패했습니다.'),
  });

  // Source of Truth: server/routers/packOrders.ts TIER_DEFAULTS와 반드시 일치
  const TIER_DEFAULTS: Record<string, { couponQuota: number; durationDays: number }> = {
    FREE:    { couponQuota: 10, durationDays: 7  },
    WELCOME: { couponQuota: 30, durationDays: 30 },
    REGULAR: { couponQuota: 50, durationDays: 30 },
    BUSY:    { couponQuota: 90, durationDays: 30 },
  };
  const TIER_LABEL: Record<string, string> = {
    FREE: '무료', WELCOME: '손님마중', REGULAR: '단골손님', BUSY: '북적북적',
  };
  const ORDER_STATUS_LABEL: Record<string, string> = {
    REQUESTED: '접수', CONTACTED: '연락완료', APPROVED: '등급부여완료',
    REJECTED: '거절', CANCELLED: '취소',
  };
  const PACK_LABEL: Record<string, string> = {
    WELCOME_19800: '손님마중패키지 (19,800원)',
    REGULAR_29700: '단골손님패키지 (29,700원)',
    BUSY_49500:    '북적북적패키지 (49,500원)',
  };
  
  // ✅ Analytics 재활성화 (Drizzle ORM으로 수정됨)
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
      toast.success('가게가 등록되었습니다!');
      setStoreForm({
        name: '',
        category: 'cafe',
        address: '',
        phone: '',
        description: '',
        naverPlaceUrl: '',
        latitude: '',
        longitude: '',
      });
      setGpsCoords(null);
    } catch (error: any) {
      toast.error(error.message || '가게 등록에 실패했습니다.');
    }
  };

  const handleCreateCoupon = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!couponForm.storeId || couponForm.storeId === 0) {
      toast.error('가게를 선택해주세요.');
      return;
    }
    try {
      await createCoupon.mutateAsync(couponForm);
      // 🔄 쿠폰 목록 즉시 갱신
      await utils.coupons.list.invalidate();
      
      setCouponForm({
        storeId: 0,
        title: '',
        description: '',
        discountType: 'percentage',
        discountValue: 0,
        totalQuantity: 100,
        dailyLimit: 10,
        startDate: '',
        endDate: '',
      });
    } catch (error: any) {
      toast.error(error.message || '쿠폰 등록에 실패했습니다.');
    }
  };

  const handleUpdateStore = async (data: any) => {
    try {
      await updateStore.mutateAsync(data);
      toast.success('가게 정보가 수정되었습니다.');
    } catch (error: any) {
      toast.error(error.message || '가게 수정에 실패했습니다.');
    }
  };

  const handleUpdateCoupon = async (data: any) => {
    try {
      await updateCoupon.mutateAsync(data);
      toast.success('쿠폰 정보가 수정되었습니다.');
    } catch (error: any) {
      toast.error(error.message || '쿠폰 수정에 실패했습니다.');
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
        <Tabs value={activeTab} onValueChange={(v) => { setActiveTab(v); if (v !== 'stores') setStoreOwnerFilter(null); }} className="space-y-6">
          {/* 모바일: overflow-x-auto 스크롤, 데스크톱: 한 줄 */}
          <div className="overflow-x-auto pb-1 -mx-1 px-1">
            <TabsList className="flex w-max min-w-full md:w-full md:grid md:grid-cols-8 gap-0">
              <TabsTrigger value="overview" className="flex-shrink-0 px-2 md:px-3">
                <BarChart3 className="w-4 h-4 mr-1 flex-shrink-0" />
                <span className="whitespace-nowrap text-xs md:text-sm">대시보드</span>
              </TabsTrigger>
              <TabsTrigger value="stores" className="relative flex-shrink-0 px-2 md:px-3">
                <Store className="w-4 h-4 mr-1 flex-shrink-0" />
                <span className="whitespace-nowrap text-xs md:text-sm">가게 관리</span>
                {(() => {
                  const cnt = stores?.filter((s: any) => !s.approvedBy && s.isActive !== false && !checkedStoreSet.has(Number(s.id))).length ?? 0;
                  return cnt > 0 ? (
                    <span className="absolute -top-1 -right-1 h-4 min-w-[16px] px-0.5 rounded-full bg-red-500 text-[10px] text-white font-bold flex items-center justify-center">
                      {cnt}
                    </span>
                  ) : null;
                })()}
              </TabsTrigger>
              <TabsTrigger value="coupons" className="relative flex-shrink-0 px-2 md:px-3">
                <Ticket className="w-4 h-4 mr-1 flex-shrink-0" />
                <span className="whitespace-nowrap text-xs md:text-sm">쿠폰 관리</span>
                {(() => {
                  const cnt = coupons?.filter((c: any) => !c.approvedBy && !checkedCouponSet.has(Number(c.id))).length ?? 0;
                  return cnt > 0 ? (
                    <span className="absolute -top-1 -right-1 h-4 min-w-[16px] px-0.5 rounded-full bg-red-500 text-[10px] text-white font-bold flex items-center justify-center">
                      {cnt}
                    </span>
                  ) : null;
                })()}
              </TabsTrigger>
              <TabsTrigger value="analytics" className="flex-shrink-0 px-2 md:px-3">
                <TrendingUp className="w-4 h-4 mr-1 flex-shrink-0" />
                <span className="whitespace-nowrap text-xs md:text-sm">통계 분석</span>
              </TabsTrigger>
              <TabsTrigger value="pack-orders" className="relative flex-shrink-0 px-2 md:px-3">
                <Package className="w-4 h-4 mr-1 flex-shrink-0" />
                <span className="whitespace-nowrap text-xs md:text-sm">발주요청</span>
                {(() => {
                  const cnt = packOrders?.filter((o: any) => o.status === 'REQUESTED' && !checkedOrderSet.has(Number(o.id))).length ?? 0;
                  return cnt > 0 ? (
                    <span className="absolute -top-1 -right-1 h-4 min-w-[16px] px-0.5 rounded-full bg-red-500 text-[10px] text-white font-bold flex items-center justify-center">
                      {cnt}
                    </span>
                  ) : null;
                })()}
              </TabsTrigger>
              <TabsTrigger value="user-plans" className="relative flex-shrink-0 px-2 md:px-3">
                <Crown className="w-4 h-4 mr-1 flex-shrink-0" />
                <span className="whitespace-nowrap text-xs md:text-sm">계급 관리</span>
                {(() => {
                  const dormantUsers = planUsers?.filter((u: any) => u.is_dormant && !checkedPlanUserSet.has(Number(u.id))) ?? [];
                  const cnt = dormantUsers.length;
                  return cnt > 0 ? (
                    <span className="absolute -top-1 -right-1 h-4 min-w-[16px] px-0.5 rounded-full bg-amber-500 text-[10px] text-white font-bold flex items-center justify-center">
                      {cnt}
                    </span>
                  ) : null;
                })()}
              </TabsTrigger>
              <TabsTrigger value="event-popups" className="flex-shrink-0 px-2 md:px-3">
                <Sparkles className="w-4 h-4 mr-1 flex-shrink-0" />
                <span className="whitespace-nowrap text-xs md:text-sm">이벤트팝업</span>
              </TabsTrigger>
              <TabsTrigger value="abuse" className="relative flex-shrink-0 px-2 md:px-3">
                <AlertTriangle className="w-4 h-4 mr-1 flex-shrink-0" />
                <span className="whitespace-nowrap text-xs md:text-sm">어뷰저</span>
                {(() => {
                  const cnt = abuseList?.filter((a: any) => a.status === 'PENALIZED').length ?? 0;
                  return cnt > 0 ? (
                    <span className="absolute -top-1 -right-1 h-4 min-w-[16px] px-0.5 rounded-full bg-red-500 text-[10px] text-white font-bold flex items-center justify-center">
                      {cnt}
                    </span>
                  ) : null;
                })()}
              </TabsTrigger>
            </TabsList>
          </div>

          {/* 대시보드 탭 */}
          <TabsContent value="overview" className="space-y-6">
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
              <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium">승인된 가게</CardTitle>
                  <Store className="h-4 w-4 text-muted-foreground" />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">{stores?.filter(s => s.approvedBy && s.isActive && (!storeOwnerFilter || Number((s as any).ownerId) === Number(storeOwnerFilter.id)) && (!storeSearch || s.name?.toLowerCase().includes(storeSearch.toLowerCase()) || (s as any).address?.toLowerCase().includes(storeSearch.toLowerCase()) || (s as any).ownerEmail?.toLowerCase().includes(storeSearch.toLowerCase()))).length || 0}</div>
                  <p className="text-xs text-muted-foreground">활성화된 제휴 매장</p>
                </CardContent>
              </Card>

              <Card className="border-orange-200 bg-orange-50/50">
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium text-orange-900">승인 대기</CardTitle>
                  <Activity className="h-4 w-4 text-orange-600" />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold text-orange-900">{stores?.filter(s => !s.approvedBy && s.isActive !== false && (!storeOwnerFilter || Number((s as any).ownerId) === Number(storeOwnerFilter.id)) && (!storeSearch || s.name?.toLowerCase().includes(storeSearch.toLowerCase()) || (s as any).address?.toLowerCase().includes(storeSearch.toLowerCase()) || (s as any).ownerEmail?.toLowerCase().includes(storeSearch.toLowerCase()))).length || 0}</div>
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
                  <div className="text-2xl font-bold">{analyticsOverview?.usageRate || 0}%</div>
                  <p className="text-xs text-muted-foreground">전체 사용률</p>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium">총 사용자 수</CardTitle>
                  <Users className="h-4 w-4 text-muted-foreground" />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">{analyticsOverview?.totalUsers || 0}</div>
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
                    {stores?.filter(s => s.approvedBy).slice(0, 5).map((store) => {
                      const imgSrc = resolveStoreThumbnail((store as any).imageUrl);
                      return (
                      <div key={store.id} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg gap-3">
                        <div className="flex items-center gap-3 min-w-0 flex-1">
                          {imgSrc ? (
                            <img src={imgSrc} alt="" className="w-10 h-10 rounded-lg object-cover shrink-0 border" />
                          ) : (
                            <div className="w-10 h-10 rounded-lg bg-white flex items-center justify-center shrink-0 border">
                              <Store className="w-5 h-5 text-primary" />
                            </div>
                          )}
                          <div className="min-w-0">
                            <p className="font-medium truncate">{store.name || '가게정보 없음'}</p>
                            <p className="text-xs text-gray-600">{store.category}</p>
                            <div className="mt-0.5">
                              <StoreOwnerIdentity store={store} compact />
                            </div>
                          </div>
                        </div>
                        <Button variant="ghost" size="sm" onClick={() => setLocation(`/store/${store.id}`)}>
                          보기
                        </Button>
                      </div>
                      );
                    })}
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
            {/* 검색바 */}
            <div className="flex flex-wrap gap-2 items-center">
              <div className="relative flex-1 min-w-[220px]">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                <Input
                  placeholder="가게명 · 주소 · 사장님 이메일 검색"
                  value={storeSearch}
                  onChange={(e) => setStoreSearch(e.target.value)}
                  className="pl-9"
                />
              </div>
              {storeSearch && (
                <button
                  className="text-xs text-gray-400 hover:text-gray-600 underline"
                  onClick={() => setStoreSearch('')}
                >
                  초기화
                </button>
              )}
              <span className="text-xs text-gray-400 ml-auto">
                {storeSearch
                  ? `검색 결과 ${stores?.filter(s => {
                      const q = storeSearch.toLowerCase();
                      return (
                        s.name?.toLowerCase().includes(q) ||
                        (s as any).address?.toLowerCase().includes(q) ||
                        (s as any).ownerEmail?.toLowerCase().includes(q)
                      );
                    }).length ?? 0}개`
                  : `전체 ${stores?.length ?? 0}개`}
              </span>
            </div>
            {/* 폴링 상태 표시 */}
            <div className="flex items-center justify-between text-xs text-gray-400 px-1">
              <span>마지막 갱신: {dataUpdatedAt ? new Date(dataUpdatedAt).toLocaleTimeString('ko-KR') : '-'}</span>
              <button
                onClick={() => refetchStores()}
                className="flex items-center gap-1 text-gray-400 hover:text-gray-600 transition-colors"
              >
                <Activity className="w-3 h-3" />
                새로고침
              </button>
            </div>
            {/* 사장님 필터 배너 */}
            {storeOwnerFilter && (
              <div className="flex items-center gap-2 px-3 py-2 bg-blue-50 border border-blue-200 rounded-lg text-sm text-blue-800">
                <Store className="w-4 h-4 flex-shrink-0" />
                <span><strong>{storeOwnerFilter.name}</strong> 사장님의 가게만 표시 중</span>
                <button
                  className="ml-auto text-xs text-blue-500 hover:text-blue-700 underline"
                  onClick={() => setStoreOwnerFilter(null)}
                >
                  필터 해제
                </button>
              </div>
            )}
            {/* 승인 대기 상점 섹션 */}
            {stores?.filter(s => !s.approvedBy && s.isActive !== false && (!storeOwnerFilter || Number((s as any).ownerId) === Number(storeOwnerFilter.id)) && (!storeSearch || s.name?.toLowerCase().includes(storeSearch.toLowerCase()) || (s as any).address?.toLowerCase().includes(storeSearch.toLowerCase()) || (s as any).ownerEmail?.toLowerCase().includes(storeSearch.toLowerCase()))).length > 0 && (
              <Card className="border-orange-200 bg-orange-50/50">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-orange-900">
                    <Activity className="w-6 h-6 text-orange-600" />
                    승인 대기 중인 상점 ({stores?.filter(s => !s.approvedBy && s.isActive !== false && (!storeOwnerFilter || Number((s as any).ownerId) === Number(storeOwnerFilter.id)) && (!storeSearch || s.name?.toLowerCase().includes(storeSearch.toLowerCase()) || (s as any).address?.toLowerCase().includes(storeSearch.toLowerCase()) || (s as any).ownerEmail?.toLowerCase().includes(storeSearch.toLowerCase()))).length})
                  </CardTitle>
                  <CardDescription>사장님이 등록한 상점을 승인하거나 거부할 수 있습니다</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="space-y-3">
                    {stores?.filter(s => !s.approvedBy && s.isActive !== false && (!storeOwnerFilter || Number((s as any).ownerId) === Number(storeOwnerFilter.id)) && (!storeSearch || s.name?.toLowerCase().includes(storeSearch.toLowerCase()) || (s as any).address?.toLowerCase().includes(storeSearch.toLowerCase()) || (s as any).ownerEmail?.toLowerCase().includes(storeSearch.toLowerCase()))).map((store) => {
                      // 해당 가게의 쿠폰 목록 (승인 안 된 쿠폰만)
                      const storeCoupons = coupons?.filter(c => c.storeId === store.id && !c.approvedBy) || [];
                      
                      return (
                      <div key={store.id} className="p-4 bg-white rounded-lg border border-orange-200"
                        onClick={() => {
                          if (!checkedStoreSet.has(Number(store.id))) {
                            markChecked.mutate({ itemType: 'store', itemId: Number(store.id) });
                          }
                        }}
                      >
                        <div className="flex items-center justify-between mb-3">
                          <div className="flex-1">
                            <div className="flex items-center gap-3 mb-2">
                              {(() => {
                                const imgSrc = resolveStoreThumbnail((store as any).imageUrl);
                                return imgSrc ? (
                                  <img src={imgSrc} alt="" className="w-12 h-12 rounded-lg object-cover shrink-0 border" />
                                ) : (
                                  <div className="w-12 h-12 rounded-lg bg-orange-50 flex items-center justify-center shrink-0 border border-orange-100">
                                    <Store className="w-5 h-5 text-orange-300" />
                                  </div>
                                );
                              })()}
                              <div className="min-w-0">
                                <p className="font-semibold text-lg">{store.name || '가게정보 없음'}</p>
                                <p className="text-sm text-gray-600">{store.category}</p>
                                <div className="mt-1 flex items-center gap-2">
                                  <StoreOwnerIdentity store={store} />
                                  {!checkedStoreSet.has(Number(store.id)) && (
                                    <span className="inline-flex items-center justify-center w-7 h-7 rounded-full bg-red-500 text-white text-lg font-black animate-pulse flex-shrink-0" title="신규 미확인">!</span>
                                  )}
                                </div>
                              </div>
                            </div>
                            <div className="ml-8 space-y-1 text-sm text-gray-700">
                              <p><span className="font-medium">주소:</span> {store.address}</p>
                              {store.phone && <p><span className="font-medium">전화:</span> {store.phone}</p>}
                              {store.description && <p><span className="font-medium">설명:</span> {store.description}</p>}
                              <div className="flex flex-wrap items-center gap-2 pt-1">
                                <StoreCouponStatus store={store} />
                                <StoreLatestPackOrder store={store} />
                                {store.createdAt && (
                                  <span className="text-[10px] text-gray-400">
                                    요청일 {new Date(store.createdAt).toLocaleDateString('ko-KR')}
                                  </span>
                                )}
                              </div>
                            </div>
                          </div>
                          <div className="flex gap-2 ml-4">
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => setEditingStore(store)}
                            >
                              <Edit className="w-4 h-4 mr-1" />
                              수정
                            </Button>
                            <Button
                              size="sm"
                              className="bg-green-600 hover:bg-green-700 text-white"
                              onClick={async () => {
                                if (confirm(`"${store.name}" 상점을 승인하시겠습니까?\n승인하면 즉시 지도에 노출됩니다.`)) {
                                  try {
                                    await approveStore.mutateAsync({ id: store.id });
                                  } catch (error: any) {
                                    toast.error(error.message || '승인에 실패했습니다.');
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
                              onClick={() => {
                                setRejectReason('');
                                setRejectTarget({ id: store.id, name: store.name });
                              }}
                              disabled={rejectStore.isPending}
                            >
                              <XCircle className="w-4 h-4 mr-1" />
                              거부
                            </Button>
                          </div>
                        </div>
                        
                        {/* 해당 가게의 쿠폰 목록 표시 */}
                        {storeCoupons.length > 0 && (
                          <div className="mt-4 pt-4 border-t border-orange-100">
                            <div className="flex items-center gap-2 mb-3">
                              <Ticket className="w-4 h-4 text-orange-600" />
                              <p className="font-medium text-sm text-orange-900">등록된 쿠폰 ({storeCoupons.length}개)</p>
                            </div>
                            <div className="space-y-2 ml-6">
                              {storeCoupons.map((coupon) => (
                                <div key={coupon.id} className="p-3 bg-orange-50 rounded border border-orange-200">
                                  <div className="flex items-start justify-between">
                                    <div className="flex-1">
                                      <p className="font-medium text-sm">{coupon.title}</p>
                                      {coupon.description && (
                                        <p className="text-xs text-gray-600 mt-1">{coupon.description}</p>
                                      )}
                                      <div className="flex items-center gap-3 mt-2 text-xs text-gray-700">
                                        <span>
                                          {coupon.discountType === 'percentage' && `${coupon.discountValue}% 할인`}
                                          {coupon.discountType === 'fixed' && `${coupon.discountValue}원 할인`}
                                          {coupon.discountType === 'freebie' && '무료 증정'}
                                        </span>
                                        <span>총 {coupon.totalQuantity}개</span>
                                        {coupon.dailyLimit && (
                                          <span className="text-orange-700 font-medium">
                                            일 {coupon.dailyUsedCount || 0}/{coupon.dailyLimit}개
                                          </span>
                                        )}
                                        <span>
                                          {new Date(coupon.startDate).toLocaleDateString()} ~ {new Date(coupon.endDate).toLocaleDateString()}
                                        </span>
                                      </div>
                                    </div>
                                    <div className="flex gap-2 ml-3">
                                      <Button
                                        size="sm"
                                        variant="outline"
                                        className="h-7 text-xs"
                                        onClick={() => setEditingCoupon(coupon)}
                                      >
                                        <Edit className="w-3 h-3 mr-1" />
                                        수정
                                      </Button>
                                      <Button
                                        size="sm"
                                        className="h-7 text-xs bg-green-600 hover:bg-green-700 text-white"
                                        onClick={async () => {
                                          if (confirm(`"${coupon.title}" 쿠폰을 승인하시겠습니까?`)) {
                                            try {
                                              await approveCoupon.mutateAsync({ id: coupon.id });
                                            } catch (error: any) {
                                              toast.error(error.message || '쿠폰 승인에 실패했습니다.');
                                            }
                                          }
                                        }}
                                        disabled={approveCoupon.isPending}
                                      >
                                        승인
                                      </Button>
                                    </div>
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                      );
                    })}
                  </div>
                </CardContent>
              </Card>
            )}

            {/* 거부된 가게 섹션 — 기본 접힘, 추가 API 호출 없음 */}
            {stores?.filter(s => !s.approvedBy && s.isActive === false && (!storeOwnerFilter || Number((s as any).ownerId) === Number(storeOwnerFilter.id)) && (!storeSearch || s.name?.toLowerCase().includes(storeSearch.toLowerCase()) || (s as any).address?.toLowerCase().includes(storeSearch.toLowerCase()) || (s as any).ownerEmail?.toLowerCase().includes(storeSearch.toLowerCase()))).length > 0 && (
              <Card className="border-red-200 bg-red-50/30">
                <CardHeader
                  className="cursor-pointer select-none"
                  onClick={() => setRejectedStoresOpen(v => !v)}
                >
                  <CardTitle className="flex items-center gap-2 text-red-800">
                    <Trash2 className="w-5 h-5 text-red-500" />
                    거부된 가게 ({stores?.filter(s => !s.approvedBy && s.isActive === false && (!storeOwnerFilter || Number((s as any).ownerId) === Number(storeOwnerFilter.id)) && (!storeSearch || s.name?.toLowerCase().includes(storeSearch.toLowerCase()) || (s as any).address?.toLowerCase().includes(storeSearch.toLowerCase()) || (s as any).ownerEmail?.toLowerCase().includes(storeSearch.toLowerCase()))).length})
                    {rejectedStoresOpen
                      ? <ChevronUp className="w-4 h-4 ml-auto" />
                      : <ChevronDown className="w-4 h-4 ml-auto" />}
                  </CardTitle>
                  <CardDescription>거부 처리된 매장 목록입니다 (클릭하여 펼치기)</CardDescription>
                </CardHeader>
                {rejectedStoresOpen && (
                  <CardContent>
                    <div className="space-y-2">
                      {stores?.filter(s => !s.approvedBy && s.isActive === false && (!storeOwnerFilter || Number((s as any).ownerId) === Number(storeOwnerFilter.id)) && (!storeSearch || s.name?.toLowerCase().includes(storeSearch.toLowerCase()) || (s as any).address?.toLowerCase().includes(storeSearch.toLowerCase()) || (s as any).ownerEmail?.toLowerCase().includes(storeSearch.toLowerCase()))).map((store) => {
                        const imgSrc = resolveStoreThumbnail((store as any).imageUrl);
                        return (
                        <div key={store.id} className="flex items-center justify-between p-3 bg-white rounded-lg border border-red-200">
                          <div className="flex items-center gap-3 min-w-0">
                            {imgSrc ? (
                              <img src={imgSrc} alt="" className="w-10 h-10 rounded-lg object-cover shrink-0 border" />
                            ) : (
                              <div className="w-10 h-10 rounded-lg bg-red-50 flex items-center justify-center shrink-0 border border-red-100">
                                <Store className="w-4 h-4 text-red-300" />
                              </div>
                            )}
                            <div className="min-w-0">
                              <p className="font-medium text-sm truncate">{store.name || '가게정보 없음'}</p>
                              <p className="text-xs text-gray-500 truncate">{store.address}</p>
                              <div className="mt-0.5">
                                <StoreOwnerIdentity store={store} compact />
                              </div>
                            </div>
                          </div>
                          <div className="flex items-center gap-2 shrink-0">
                            {(store as any).rejectionReason && (
                              <span
                                className="text-[10px] text-red-500 max-w-[140px] truncate"
                                title={(store as any).rejectionReason}
                              >
                                사유: {(store as any).rejectionReason}
                              </span>
                            )}
                            {store.createdAt && (
                              <span className="text-xs text-gray-400">
                                {new Date(store.createdAt).toLocaleDateString('ko-KR')}
                              </span>
                            )}
                            <span className="px-2 py-1 bg-red-100 text-red-700 text-xs rounded-full">
                              거부됨
                            </span>
                          </div>
                        </div>
                        );
                      })}
                    </div>
                  </CardContent>
                )}
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
                          <SelectItem value="restaurant">🍽️ 음식점</SelectItem>
                          <SelectItem value="beauty">💅 뷰티</SelectItem>
                          <SelectItem value="hospital">🏥 병원</SelectItem>
                          <SelectItem value="fitness">💪 헬스장</SelectItem>
                          <SelectItem value="other">🎁 기타</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="md:col-span-2 space-y-3">
                      <KakaoAddressSearch
                        value={storeForm.address}
                        onChange={(address) => {
                          setStoreForm({ ...storeForm, address, latitude: '', longitude: '' });
                          setGpsCoords(null);
                          // 주소 선택 후 Google Geocoder로 좌표 자동 추출
                          if (address && window.google?.maps) {
                            const geocoder = new window.google.maps.Geocoder();
                            geocoder.geocode({ address }, (results, status) => {
                              if (status === 'OK' && results?.[0]) {
                                const loc = results[0].geometry.location;
                                const coords = { lat: loc.lat(), lng: loc.lng() };
                                setStoreForm(prev => ({
                                  ...prev,
                                  address,
                                  latitude: coords.lat.toString(),
                                  longitude: coords.lng.toString(),
                                }));
                                setGpsCoords(coords);
                              }
                            });
                          }
                        }}
                        label="주소"
                        placeholder="주소 검색 버튼을 클릭하세요"
                        required
                      />
                      
                      {/* 🗺️ 지도에 선택한 주소 표시 */}
                      {gpsCoords && (
                        <div className="space-y-2">
                          <Label>선택된 위치 미리보기</Label>
                          <div className="h-[300px] border-2 border-green-300 rounded-lg overflow-hidden">
                            <MapView
                              initialCenter={gpsCoords}
                              initialZoom={17}
                              onMapReady={(map) => {
                                // ✅ 기본 Marker 사용 (AdvancedMarker 대신)
                                new google.maps.Marker({
                                  map,
                                  position: gpsCoords,
                                  title: storeForm.name || '선택한 위치',
                                  animation: google.maps.Animation.DROP,
                                });
                              }}
                            />
                          </div>
                          <p className="text-xs text-green-600 font-medium">
                            ✅ GPS: {gpsCoords.lat.toFixed(6)}, {gpsCoords.lng.toFixed(6)}
                          </p>
                        </div>
                      )}
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
                    <Label htmlFor="description">내 업체 자랑하기</Label>
                    <Textarea
                      id="description"
                      value={storeForm.description}
                      onChange={(e) => setStoreForm({ ...storeForm, description: e.target.value })}
                      placeholder="예: 여기는 갈비가 맛있고 직화구이가 일품이에요!"
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
                <CardDescription>{stores?.filter(s => s.approvedBy && s.isActive && (!storeOwnerFilter || Number((s as any).ownerId) === Number(storeOwnerFilter.id)) && (!storeSearch || s.name?.toLowerCase().includes(storeSearch.toLowerCase()) || (s as any).address?.toLowerCase().includes(storeSearch.toLowerCase()) || (s as any).ownerEmail?.toLowerCase().includes(storeSearch.toLowerCase()))).length || 0}개의 승인된 제휴 매장</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-1 gap-4">
                  {stores?.filter(s => s.approvedBy && s.isActive && (!storeOwnerFilter || Number((s as any).ownerId) === Number(storeOwnerFilter.id)) && (!storeSearch || s.name?.toLowerCase().includes(storeSearch.toLowerCase()) || (s as any).address?.toLowerCase().includes(storeSearch.toLowerCase()) || (s as any).ownerEmail?.toLowerCase().includes(storeSearch.toLowerCase()))).map((store) => {
                    const imgSrc = resolveStoreThumbnail((store as any).imageUrl);
                    return (
                    <Card key={store.id}>
                      <CardHeader className="pb-3">
                        <div className="flex items-start gap-3">
                          {imgSrc ? (
                            <img src={imgSrc} alt="" className="w-14 h-14 rounded-lg object-cover shrink-0 border" />
                          ) : (
                            <div className="w-14 h-14 rounded-lg bg-gray-50 flex items-center justify-center shrink-0 border">
                              <Store className="w-6 h-6 text-gray-300" />
                            </div>
                          )}
                          <div className="min-w-0 flex-1">
                            <CardTitle className="text-lg flex items-center gap-2 flex-wrap">
                              {store.category === 'cafe' && '☕'}
                              {store.category === 'restaurant' && '🍽️'}
                              {store.category === 'beauty' && '💅'}
                              {store.category === 'hospital' && '🏥'}
                              {store.category === 'fitness' && '💪'}
                              {store.category === 'other' && '🎁'}
                              <span className="truncate">{store.name || '가게정보 없음'}</span>
                              <span className="px-2 py-1 bg-green-100 text-green-700 text-xs rounded-full flex items-center gap-1">
                                <CheckCircle2 className="w-3 h-3" />
                                승인됨
                              </span>
                            </CardTitle>
                            <CardDescription className="flex items-center gap-1 mt-1">
                              <MapPin className="w-3 h-3 shrink-0" />
                              <span className="truncate">{store.address}</span>
                            </CardDescription>
                            <div className="mt-2">
                              <StoreOwnerIdentity store={store} />
                            </div>
                            <div className="mt-2 flex flex-wrap items-center gap-2">
                              <StoreCouponStatus store={store} />
                              <StoreLatestPackOrder store={store} />
                              {store.approvedAt && (
                                <span className="text-[10px] text-gray-400">
                                  승인일 {new Date(store.approvedAt).toLocaleDateString('ko-KR')}
                                </span>
                              )}
                            </div>
                          </div>
                        </div>
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
                    );
                  })}
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* 쿠폰 관리 탭 */}
          <TabsContent value="coupons" className="space-y-6">
            {/* 검색바 */}
            <div className="flex flex-wrap gap-2 items-center">
              <div className="relative flex-1 min-w-[220px]">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                <Input
                  placeholder="쿠폰명 · 가게명 검색"
                  value={couponSearch}
                  onChange={(e) => setCouponSearch(e.target.value)}
                  className="pl-9"
                />
              </div>
              {couponSearch && (
                <button
                  className="text-xs text-gray-400 hover:text-gray-600 underline"
                  onClick={() => setCouponSearch('')}
                >
                  초기화
                </button>
              )}
              <span className="text-xs text-gray-400 ml-auto">
                {couponSearch
                  ? `검색 결과 ${coupons?.filter(c => c.title?.toLowerCase().includes(couponSearch.toLowerCase()) || (c as any).storeName?.toLowerCase().includes(couponSearch.toLowerCase())).length ?? 0}개`
                  : `전체 ${coupons?.length ?? 0}개`}
              </span>
            </div>
            {/* 승인 대기 쿠폰 섹션 */}
            {coupons?.filter(c => !c.approvedBy && (!couponSearch || c.title?.toLowerCase().includes(couponSearch.toLowerCase()) || (c as any).storeName?.toLowerCase().includes(couponSearch.toLowerCase()))).length > 0 && (
              <Card className="border-orange-200 bg-orange-50/50">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-orange-900">
                    <Activity className="w-6 h-6 text-orange-600" />
                    승인 대기 중인 쿠폰 ({coupons?.filter(c => !c.approvedBy && (!couponSearch || c.title?.toLowerCase().includes(couponSearch.toLowerCase()) || (c as any).storeName?.toLowerCase().includes(couponSearch.toLowerCase()))).length})
                  </CardTitle>
                  <CardDescription>사장님이 등록한 쿠폰을 승인하거나 거부할 수 있습니다</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="space-y-3">
                    {coupons?.filter(c => !c.approvedBy && (!couponSearch || c.title?.toLowerCase().includes(couponSearch.toLowerCase()) || (c as any).storeName?.toLowerCase().includes(couponSearch.toLowerCase()))).map((coupon) => (
                      <div key={coupon.id} className="flex items-center justify-between p-4 bg-white rounded-lg border border-orange-200"
                        onClick={() => {
                          if (!checkedCouponSet.has(Number(coupon.id))) {
                            markChecked.mutate({ itemType: 'coupon', itemId: Number(coupon.id) });
                          }
                        }}
                      >
                        <div className="flex-1">
                          <div className="flex items-center gap-3 mb-2">
                            <Ticket className="w-5 h-5 text-orange-600" />
                            <div>
                              <p className="font-semibold text-lg">{coupon.title}</p>
                              <p className="text-sm text-gray-600">{coupon.description}</p>
                              <div className="flex items-center gap-2 mt-0.5">
                                <span className="text-xs text-gray-500">
                                  {(coupon as any).storeName ?? '업장 미연결'}
                                  {(coupon as any).ownerEmail && (
                                    <span className="text-gray-400 ml-1">({(coupon as any).ownerEmail})</span>
                                  )}
                                </span>
                                {!checkedCouponSet.has(Number(coupon.id)) && (
                                  <span className="inline-flex items-center justify-center w-7 h-7 rounded-full bg-red-500 text-white text-lg font-black animate-pulse flex-shrink-0" title="신규 미확인">!</span>
                                )}
                              </div>
                            </div>
                          </div>
                          <div className="ml-8 space-y-1 text-sm text-gray-700">
                            <p>
                              <span className="font-medium">할인:</span>{' '}
                              {coupon.discountType === 'percentage' && `${coupon.discountValue}% 할인`}
                              {coupon.discountType === 'fixed' && `${coupon.discountValue}원 할인`}
                              {coupon.discountType === 'freebie' && '무료 증정'}
                            </p>
                            <p><span className="font-medium">수량:</span> {coupon.totalQuantity}개</p>
                            <p>
                              <span className="font-medium">기간:</span>{' '}
                              {new Date(coupon.startDate).toLocaleDateString()} ~ {new Date(coupon.endDate).toLocaleDateString()}
                            </p>
                          </div>
                        </div>
                        <div className="flex gap-2 ml-4">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => setEditingCoupon(coupon)}
                          >
                            <Edit className="w-4 h-4 mr-1" />
                            수정
                          </Button>
                          <Button
                            size="sm"
                            className="bg-green-600 hover:bg-green-700 text-white"
                            onClick={async () => {
                              if (confirm(`"${coupon.title}" 쿠폰을 승인하시겠습니까?\n승인하면 즉시 지도에 노출됩니다.`)) {
                                try {
                                  await approveCoupon.mutateAsync({ id: coupon.id });
                                } catch (error: any) {
                                  toast.error(error.message || '쿠폰 승인에 실패했습니다.');
                                }
                              }
                            }}
                            disabled={approveCoupon.isPending}
                          >
                            <CheckCircle2 className="w-4 h-4 mr-1" />
                            승인
                          </Button>
                          <Button
                            size="sm"
                            variant="destructive"
                            onClick={async () => {
                              if (confirm(`"${coupon.title}" 쿠폰을 거부하시겠습니까?`)) {
                                try {
                                  await rejectCoupon.mutateAsync({ id: coupon.id });
                                } catch (error: any) {
                                  toast.error(error.message || '쿠폰 거부에 실패했습니다.');
                                }
                              }
                            }}
                            disabled={rejectCoupon.isPending}
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
                  <Ticket className="w-6 h-6 text-accent" />
                  쿠폰 등록
                </CardTitle>
                <CardDescription>새로운 쿠폰을 생성합니다</CardDescription>
              </CardHeader>
              <CardContent>
                <form onSubmit={handleCreateCoupon} className="space-y-4">
                  <div className="space-y-2">
                    <Label>가게 선택 * (승인된 가게만)</Label>
                    {/* 검색 가능한 가게 선택 드롭다운 */}
                    {(() => {
                      const approvedStores = stores?.filter(s => s.approvedBy) ?? [];
                      const filtered = storeSelectQuery.trim()
                        ? approvedStores.filter(s => s.name?.toLowerCase().includes(storeSelectQuery.toLowerCase()))
                        : approvedStores;
                      const selectedStore = approvedStores.find(s => s.id === couponForm.storeId);
                      return (
                        <div ref={storeSelectRef} className="relative">
                          <button
                            type="button"
                            onClick={() => { setStoreSelectOpen(v => !v); setStoreSelectQuery(''); }}
                            className="w-full flex items-center justify-between rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
                          >
                            <span className={selectedStore ? 'text-foreground' : 'text-muted-foreground'}>
                              {selectedStore ? selectedStore.name : '가게를 선택하세요'}
                            </span>
                            <ChevronDown className="h-4 w-4 opacity-50" />
                          </button>
                          {storeSelectOpen && (
                            <div className="absolute z-50 mt-1 w-full rounded-md border bg-popover shadow-md">
                              <div className="p-2 border-b">
                                <div className="relative">
                                  <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                                  <input
                                    autoFocus
                                    value={storeSelectQuery}
                                    onChange={e => setStoreSelectQuery(e.target.value)}
                                    placeholder="가게명 검색..."
                                    className="w-full pl-7 pr-2 py-1.5 text-sm bg-transparent outline-none placeholder:text-muted-foreground"
                                  />
                                </div>
                              </div>
                              <div className="max-h-56 overflow-y-auto py-1">
                                {filtered.length === 0 ? (
                                  <p className="py-3 text-center text-sm text-muted-foreground">검색 결과 없음</p>
                                ) : filtered.map(store => (
                                  <button
                                    key={store.id}
                                    type="button"
                                    onClick={() => {
                                      setCouponForm(f => ({ ...f, storeId: store.id }));
                                      setStoreSelectOpen(false);
                                    }}
                                    className={`w-full text-left px-3 py-2 text-sm hover:bg-accent hover:text-accent-foreground flex items-center justify-between ${couponForm.storeId === store.id ? 'bg-accent font-medium' : ''}`}
                                  >
                                    {store.name}
                                    {couponForm.storeId === store.id && <CheckCircle2 className="h-3.5 w-3.5 text-primary flex-shrink-0" />}
                                  </button>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })()}
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
                      <Label htmlFor="dailyLimit">일 소비수량 *</Label>
                      <Input
                        id="dailyLimit"
                        type="number"
                        value={couponForm.dailyLimit}
                        onChange={(e) => setCouponForm({ ...couponForm, dailyLimit: parseInt(e.target.value) })}
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
                <CardTitle>승인된 쿠폰 목록</CardTitle>
                <CardDescription>{coupons?.filter(c => c.approvedBy && (!couponSearch || c.title?.toLowerCase().includes(couponSearch.toLowerCase()) || (c as any).storeName?.toLowerCase().includes(couponSearch.toLowerCase()))).length || 0}개의 승인된 쿠폰</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {coupons?.filter(c => c.approvedBy && (!couponSearch || c.title?.toLowerCase().includes(couponSearch.toLowerCase()) || (c as any).storeName?.toLowerCase().includes(couponSearch.toLowerCase()))).map((coupon) => (
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
                            <span>사용: {coupon.totalQuantity - coupon.remainingQuantity}개</span>
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

          {/* ── 구독팩 발주요청 탭 ── */}
          <TabsContent value="pack-orders" className="space-y-4">
            <div className="flex flex-wrap gap-3 items-center">
              <h2 className="text-xl font-bold text-gray-900 flex items-center gap-2">
                <Package className="h-5 w-5 text-orange-500" />
                구독팩 발주요청
              </h2>
              <div className="flex gap-2 ml-auto flex-wrap">
                <Input
                  placeholder="이름/이메일 검색"
                  value={packOrderSearch}
                  onChange={(e) => setPackOrderSearch(e.target.value)}
                  className="w-40"
                />
                <Select value={packOrderFilter || "ALL"} onValueChange={(v) => setPackOrderFilter(v === "ALL" ? "" : v)}>
                  <SelectTrigger className="w-36">
                    <SelectValue placeholder="전체 상태" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ALL">전체</SelectItem>
                    <SelectItem value="REQUESTED">접수</SelectItem>
                    <SelectItem value="CONTACTED">연락완료</SelectItem>
                    <SelectItem value="APPROVED">등급부여완료</SelectItem>
                    <SelectItem value="REJECTED">거절</SelectItem>
                    <SelectItem value="CANCELLED">취소</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* 발주요청 상세 편집 패널 */}
            {selectedPackOrder && (
              <Card className="border-orange-300 bg-orange-50">
                <CardHeader className="pb-3">
                  <CardTitle className="text-base font-semibold text-gray-800">
                    요청 #{selectedPackOrder.id} – {selectedPackOrder.user_name} ({selectedPackOrder.user_email})
                  </CardTitle>
                  <CardDescription>
                    {PACK_LABEL[selectedPackOrder.requested_pack]} · 요청일: {new Date(selectedPackOrder.created_at).toLocaleString('ko-KR')}
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div>
                      <Label>상태 변경</Label>
                      <Select
                        value={packOrderStatus || selectedPackOrder.status}
                        onValueChange={setPackOrderStatus}
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="REQUESTED">접수</SelectItem>
                          <SelectItem value="CONTACTED">연락완료</SelectItem>
                          <SelectItem value="APPROVED">등급부여완료</SelectItem>
                          <SelectItem value="REJECTED">거절</SelectItem>
                          <SelectItem value="CANCELLED">취소</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <Label>관리자 메모</Label>
                      <Input
                        value={packOrderMemo}
                        onChange={(e) => setPackOrderMemo(e.target.value)}
                        placeholder="상담 내용, 메모 입력..."
                      />
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      className="bg-orange-500 hover:bg-orange-600 text-white"
                      onClick={() =>
                        updatePackOrder.mutate({
                          id: selectedPackOrder.id,
                          status: (packOrderStatus || selectedPackOrder.status) as any,
                          adminMemo: packOrderMemo,
                        })
                      }
                      disabled={updatePackOrder.isPending}
                    >
                      저장
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => setSelectedPackOrder(null)}>
                      닫기
                    </Button>
                  </div>
                </CardContent>
              </Card>
            )}

            {/* 발주요청 목록 */}
            <div className="space-y-2">
              {!packOrders || packOrders.length === 0 ? (
                <Card>
                  <CardContent className="py-10 text-center text-gray-400">
                    발주요청이 없습니다.
                  </CardContent>
                </Card>
              ) : (
                packOrders.map((order: any) => (
                  <Card
                    key={order.id}
                    className={`cursor-pointer hover:shadow-md transition-shadow ${
                      selectedPackOrder?.id === order.id ? 'border-orange-400' : ''
                    }`}
                    onClick={() => {
                      setSelectedPackOrder(order);
                      setPackOrderMemo(order.admin_memo ?? '');
                      setPackOrderStatus(order.status);
                      if (order.status === 'REQUESTED' && !checkedOrderSet.has(Number(order.id))) {
                        markChecked.mutate({ itemType: 'pack_order', itemId: Number(order.id) });
                      }
                    }}
                  >
                    <CardContent className="pt-4 pb-4">
                      <div className="flex items-center justify-between flex-wrap gap-2">
                        <div className="flex items-center gap-3">
                          {(() => {
                            let imgSrc: string | null = null;
                            try {
                              const raw = order.store_image_url;
                              if (raw) {
                                const parsed = JSON.parse(raw);
                                imgSrc = Array.isArray(parsed) ? parsed[0] : raw;
                              }
                            } catch { imgSrc = order.store_image_url ?? null; }
                            return imgSrc ? (
                              <img src={imgSrc} alt="" className="w-10 h-10 rounded-lg object-cover shrink-0 border" />
                            ) : (
                              <div className="w-10 h-10 rounded-lg bg-gray-100 flex items-center justify-center shrink-0 border">
                                <Store className="w-5 h-5 text-gray-300" />
                              </div>
                            );
                          })()}
                          <div>
                            <p className="font-semibold text-gray-900 flex items-center gap-2">
                              {order.user_name}
                              <span className="text-sm font-normal text-gray-500">{order.user_email}</span>
                              {order.status === 'REQUESTED' && !checkedOrderSet.has(Number(order.id)) && (
                                <span className="inline-flex items-center justify-center w-7 h-7 rounded-full bg-red-500 text-white text-lg font-black animate-pulse flex-shrink-0" title="신규 미확인">!</span>
                              )}
                            </p>
                            <p className="text-sm text-gray-600 mt-0.5">{PACK_LABEL[order.requested_pack]}</p>
                            <p className="text-xs text-gray-400 mt-0.5">
                              매장: {order.store_name ?? '가게정보 없음'}
                              {order.store_category && <span className="ml-1 text-gray-300">· {order.store_category}</span>}
                            </p>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <span
                            className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-bold ${
                              order.status === 'REQUESTED'
                                ? 'bg-blue-100 text-blue-700'
                                : order.status === 'CONTACTED'
                                ? 'bg-yellow-100 text-yellow-700'
                                : order.status === 'APPROVED'
                                ? 'bg-green-100 text-green-700'
                                : 'bg-gray-100 text-gray-600'
                            }`}
                          >
                            {ORDER_STATUS_LABEL[order.status]}
                          </span>
                          <p className="text-xs text-gray-400">
                            {new Date(order.created_at).toLocaleDateString('ko-KR')}
                          </p>
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-7 text-xs text-red-600 hover:bg-red-50 hover:border-red-300"
                            onClick={(e) => {
                              e.stopPropagation();
                              if (confirm(`"${order.user_name}" 님의 발주요청을 삭제하시겠습니까?`)) {
                                deletePackOrder.mutate({ id: order.id });
                              }
                            }}
                            disabled={deletePackOrder.isPending}
                          >
                            <Trash2 className="w-3 h-3" />
                          </Button>
                        </div>
                      </div>
                      {order.admin_memo && (
                        <p className="mt-2 text-xs text-gray-500 border-t pt-2 italic">{order.admin_memo}</p>
                      )}
                    </CardContent>
                  </Card>
                ))
              )}
            </div>
          </TabsContent>

          {/* ── 유저 계급(플랜) 관리 탭 ── */}
          <TabsContent value="user-plans" className="space-y-4">
            {/* 구독 종료 & 미사용 만료 누적 섹션 */}
            {unusedExpiryStats && unusedExpiryStats.length > 0 && (
              <Card className="border-red-200 bg-red-50/30">
                <CardHeader className="pb-3">
                  <CardTitle className="flex items-center gap-2 text-red-800 text-base">
                    <Activity className="w-4 h-4 text-red-500" />
                    구독 종료 &amp; 미사용 만료 누적 ({unusedExpiryStats.length}명)
                  </CardTitle>
                  <CardDescription className="text-red-700 text-xs">
                    다운로드 후 사용하지 않고 만료된 쿠폰 누적 수 — 재결제 시 수동 보정 참고용
                  </CardDescription>
                </CardHeader>
                <CardContent className="pt-0">
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-red-200 text-xs text-red-700">
                          <th className="text-left py-2 pr-3 font-medium">사장/이메일</th>
                          <th className="text-left py-2 pr-3 font-medium">플랜</th>
                          <th className="text-left py-2 pr-3 font-medium">구독만료일</th>
                          <th className="text-right py-2 pr-3 font-medium">미사용 만료 누적</th>
                          <th className="text-right py-2 font-medium">마지막 집계</th>
                        </tr>
                      </thead>
                      <tbody>
                        {unusedExpiryStats.map((stat: any) => (
                          <tr key={stat.merchantId} className="border-b border-red-100 hover:bg-red-50/50">
                            <td className="py-2 pr-3">
                              <p className="font-medium text-gray-800">{stat.merchantName || `ID:${stat.merchantId}`}</p>
                              <p className="text-xs text-gray-500">{stat.merchantEmail}</p>
                            </td>
                            <td className="py-2 pr-3">
                              <span className="px-2 py-0.5 rounded-full text-xs bg-gray-100 text-gray-600">
                                {stat.planTier ?? 'FREE'}
                              </span>
                            </td>
                            <td className="py-2 pr-3 text-xs text-gray-600">
                              {stat.planExpiresAt
                                ? new Date(stat.planExpiresAt).toLocaleDateString('ko-KR')
                                : '없음'}
                            </td>
                            <td className="py-2 pr-3 text-right">
                              <span className="font-bold text-red-700">{stat.totalUnusedExpired}</span>
                              <span className="text-xs text-gray-500 ml-1">개</span>
                            </td>
                            <td className="py-2 text-right text-xs text-gray-400">
                              {stat.lastComputedAt
                                ? new Date(stat.lastComputedAt).toLocaleString('ko-KR')
                                : '-'}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </CardContent>
              </Card>
            )}

            {/* 조르기 현황 */}
            {nudgeLeaderboard && nudgeLeaderboard.length > 0 && (
              <Card className="border-orange-200 bg-orange-50">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-semibold text-orange-700 flex items-center gap-2">
                    🔔 조르기 누적 현황 (업장별 TOP {nudgeLeaderboard.length})
                  </CardTitle>
                </CardHeader>
                <CardContent className="p-0">
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="border-b border-orange-200 bg-orange-100">
                          <th className="py-2 px-3 text-left font-semibold text-orange-800">업장명</th>
                          <th className="py-2 px-3 text-left font-semibold text-orange-800">사장님 이메일</th>
                          <th className="py-2 px-3 text-right font-semibold text-orange-800">누적</th>
                          <th className="py-2 px-3 text-right font-semibold text-orange-800">7일</th>
                          <th className="py-2 px-3 text-right font-semibold text-orange-800">오늘</th>
                          <th className="py-2 px-3 text-right font-semibold text-orange-800">마지막</th>
                        </tr>
                      </thead>
                      <tbody>
                        {nudgeLeaderboard.map((n: { ownerId: number; ownerEmail: string; storeName: string; totalNudges: number; nudges7d: number; nudgesToday: number; lastNudgeAt: string | null }, i: number) => (
                          <tr key={`${n.ownerId}-${n.storeName}`} className={i % 2 === 0 ? 'bg-white' : 'bg-orange-50/50'}>
                            <td className="py-1.5 px-3 font-medium">{n.storeName}</td>
                            <td className="py-1.5 px-3 text-gray-500">{n.ownerEmail}</td>
                            <td className="py-1.5 px-3 text-right font-bold text-orange-700">{n.totalNudges}</td>
                            <td className="py-1.5 px-3 text-right text-gray-600">{n.nudges7d}</td>
                            <td className="py-1.5 px-3 text-right text-gray-600">{n.nudgesToday}</td>
                            <td className="py-1.5 px-3 text-right text-gray-400">
                              {n.lastNudgeAt ? new Date(n.lastNudgeAt).toLocaleDateString('ko-KR') : '-'}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </CardContent>
              </Card>
            )}

            <div className="flex flex-wrap gap-3 items-center">
              <h2 className="text-xl font-bold text-gray-900 flex items-center gap-2">
                <Crown className="h-5 w-5 text-orange-500" />
                사장님 계급 관리
              </h2>
              <Input
                placeholder="이름/이메일 검색"
                value={planUserSearch}
                onChange={(e) => setPlanUserSearch(e.target.value)}
                className="w-48 ml-auto"
              />
            </div>

            {/* 플랜 편집 패널 */}
            {selectedPlanUser && (
              <Card className="border-orange-300 bg-orange-50">
                <CardHeader className="pb-3">
                  <CardTitle className="text-base font-semibold text-gray-800 flex items-center gap-2">
                    <Crown className="h-4 w-4 text-orange-500" />
                    {selectedPlanUser.name}
                    {selectedPlanUser.email && (
                      <span className="text-sm font-normal text-gray-500 ml-1">{selectedPlanUser.email}</span>
                    )}
                    {!selectedPlanUser.email && (
                      <span className="text-sm font-normal text-gray-400 ml-1">(이메일 없음)</span>
                    )}
                    <span className="text-sm font-normal text-gray-500 ml-1">– 계급 편집</span>
                  </CardTitle>
                  <CardDescription>현재 계급: <strong>{TIER_LABEL[selectedPlanUser.tier ?? 'FREE']}</strong></CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div>
                      <Label>계급 선택</Label>
                      <Select
                        value={planForm.tier}
                        onValueChange={(v: any) => {
                          const defaults = TIER_DEFAULTS[v];
                          setPlanForm({
                            ...planForm,
                            tier: v,
                            defaultCouponQuota: defaults.couponQuota,
                            defaultDurationDays: defaults.durationDays,
                            durationDays: v === 'FREE' ? 0 : 30,
                          });
                        }}
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="FREE">무료 (기본)</SelectItem>
                          <SelectItem value="WELCOME">손님마중</SelectItem>
                          <SelectItem value="REGULAR">단골손님</SelectItem>
                          <SelectItem value="BUSY">북적북적</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    {planForm.tier !== 'FREE' && (
                      <div>
                        <Label>부여 기간 (일)</Label>
                        <Input
                          type="number"
                          value={planForm.durationDays}
                          onChange={(e) => setPlanForm({ ...planForm, durationDays: parseInt(e.target.value) || 30 })}
                        />
                      </div>
                    )}
                    <div>
                      <Label>쿠폰 등록 기본 수량</Label>
                      <Input
                        type="number"
                        value={planForm.defaultCouponQuota}
                        onChange={(e) => setPlanForm({ ...planForm, defaultCouponQuota: parseInt(e.target.value) || 10 })}
                      />
                    </div>
                    <div>
                      <Label>쿠폰 등록 기본 기간 (일)</Label>
                      <Input
                        type="number"
                        value={planForm.defaultDurationDays}
                        onChange={(e) => setPlanForm({ ...planForm, defaultDurationDays: parseInt(e.target.value) || 7 })}
                      />
                    </div>
                    <div className="md:col-span-2">
                      <Label>메모</Label>
                      <Input
                        value={planForm.memo}
                        onChange={(e) => setPlanForm({ ...planForm, memo: e.target.value })}
                        placeholder="상담 내용 / 메모"
                      />
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      className="bg-orange-500 hover:bg-orange-600 text-white"
                      onClick={() =>
                        setUserPlan.mutate({
                          userId: selectedPlanUser.id,
                          tier: planForm.tier,
                          durationDays: planForm.tier !== 'FREE' ? planForm.durationDays : undefined,
                          defaultCouponQuota: planForm.defaultCouponQuota,
                          defaultDurationDays: planForm.defaultDurationDays,
                          memo: planForm.memo,
                        })
                      }
                      disabled={setUserPlan.isPending}
                    >
                      {setUserPlan.isPending ? '저장 중...' : '저장'}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="text-red-600 border-red-300 hover:bg-red-50"
                      onClick={() => {
                        if (!window.confirm(`[주의] "${selectedPlanUser.name}" 계정을 즉시 휴면 처리합니다.\n- 모든 쿠폰 비활성화\n- trial_ends_at 과거 설정\n- quota=0 강제 적용\n계속하시겠습니까?`)) return;
                        terminatePlan.mutate({
                          userId: selectedPlanUser.id,
                          reason: '관리자 즉시 강제 종료',
                        });
                      }}
                      disabled={terminatePlan.isPending || setUserPlan.isPending}
                    >
                      {terminatePlan.isPending ? '종료 중...' : '🔴 무료로 즉시 종료 (휴면)'}
                    </Button>
                    {/* 조르기 — 휴면 계정에만 활성, 1회 제한 */}
                    {selectedPlanUser?.is_dormant && (
                      <Button
                        size="sm"
                        variant="outline"
                        className={
                          selectedPlanUser?.has_been_nudged
                            ? 'opacity-50 cursor-not-allowed border-gray-300 text-gray-400'
                            : 'border-amber-400 text-amber-700 hover:bg-amber-50'
                        }
                        disabled={nudgeMerchant.isPending || selectedPlanUser?.has_been_nudged}
                        onClick={() => {
                          if (selectedPlanUser?.has_been_nudged) return;
                          if (!confirm(`"${selectedPlanUser?.name}" 에게 구독 갱신 이메일을 발송하시겠습니까?\n(1회만 가능)`)) return;
                          nudgeMerchant.mutate({ userId: selectedPlanUser.id });
                        }}
                      >
                        {selectedPlanUser?.has_been_nudged ? '📢 조르기 완료' : '📢 조르기'}
                      </Button>
                    )}
                    {/* 프랜차이즈 권한 토글 — 어드민만 부여/해제 가능 */}
                    <Button
                      size="sm"
                      variant={selectedPlanUser?.isFranchise ? "destructive" : "outline"}
                      className={selectedPlanUser?.isFranchise ? '' : 'border-purple-400 text-purple-700 hover:bg-purple-50'}
                      onClick={() => {
                        if (!confirm(
                          selectedPlanUser?.isFranchise
                            ? `"${selectedPlanUser?.name}" 프랜차이즈 권한을 해제하시겠습니까?`
                            : `"${selectedPlanUser?.name}" 에게 프랜차이즈 권한을 부여하시겠습니까?\n(1계정 1가게 제한이 해제됩니다)`
                        )) return;
                        setFranchise.mutate({
                          userId: selectedPlanUser.id,
                          isFranchise: !selectedPlanUser.isFranchise,
                        });
                      }}
                      disabled={setFranchise.isPending}
                    >
                      {selectedPlanUser?.isFranchise ? '🏢 프랜차이즈 해제' : '🏢 프랜차이즈 부여'}
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => setSelectedPlanUser(null)}>
                      닫기
                    </Button>
                  </div>
                </CardContent>
              </Card>
            )}

            {/* 유저 목록 */}
            <div className="space-y-2">
              {!planUsers || planUsers.length === 0 ? (
                <Card>
                  <CardContent className="py-10 text-center text-gray-400">
                    사장님 계정이 없습니다.
                  </CardContent>
                </Card>
              ) : (
                planUsers.map((u: any) => (
                  <Card
                    key={u.id}
                    className={`cursor-pointer hover:shadow-md transition-shadow ${
                      selectedPlanUser?.id === u.id ? 'border-orange-400' : ''
                    }`}
                    onClick={() => {
                      setSelectedPlanUser(u);
                      const tier = u.tier ?? 'FREE';
                      const defaults = TIER_DEFAULTS[tier];
                      setPlanForm({
                        tier,
                        durationDays: 30,
                        defaultCouponQuota: u.default_coupon_quota ?? defaults.couponQuota,
                        defaultDurationDays: u.default_duration_days ?? defaults.durationDays,
                        memo: '',
                      });
                      if (u.is_dormant && !checkedPlanUserSet.has(Number(u.id))) {
                        markChecked.mutate({ itemType: 'plan_user', itemId: Number(u.id) });
                      }
                    }}
                  >
                    <CardContent className="pt-4 pb-4">
                      <div className="flex items-center justify-between flex-wrap gap-2">
                        <div>
                          <p className="font-semibold text-gray-900 flex items-center gap-2">
                            {u.name}
                            <span className="text-sm font-normal text-gray-500">{u.email}</span>
                            {u.is_dormant && !checkedPlanUserSet.has(Number(u.id)) && (
                              <span className="inline-flex items-center justify-center w-7 h-7 rounded-full bg-red-500 text-white text-lg font-black animate-pulse flex-shrink-0" title="신규 미확인">!</span>
                            )}
                          </p>
                          <p className="text-xs text-gray-400 mt-0.5 flex items-center gap-1.5 flex-wrap">
                            가게 {u.store_count ?? 0}개
                            {(u as any).store_names && (
                              <span className="text-orange-600 font-medium">({(u as any).store_names})</span>
                            )}
                            <button
                              className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-blue-50 text-blue-600 border border-blue-200 hover:bg-blue-100 leading-none"
                              onClick={(e) => {
                                e.stopPropagation();
                                setStoreOwnerFilter({ id: Number(u.id), name: u.name || u.email });
                                setActiveTab('stores');
                              }}
                            >
                              가게 보기
                            </button>
                            · 가입 {u.created_at ? new Date(u.created_at).toLocaleDateString('ko-KR') : '-'}
                            {u.isFranchise && (
                              <span className="ml-2 inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold bg-purple-100 text-purple-700">🏢 프랜차이즈</span>
                            )}
                            {u.is_dormant && (
                              <span className="ml-2 inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold bg-gray-100 text-gray-500">💤 휴면</span>
                            )}
                          </p>
                        </div>
                        <div className="flex items-center gap-3">
                          <span
                            className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-bold ${
                              u.tier === 'FREE' || !u.tier
                                ? 'bg-gray-100 text-gray-600'
                                : u.tier === 'WELCOME'
                                ? 'bg-blue-100 text-blue-700'
                                : u.tier === 'REGULAR'
                                ? 'bg-purple-100 text-purple-700'
                                : 'bg-orange-100 text-orange-700'
                            }`}
                          >
                            <Crown className="h-3 w-3" />
                            {TIER_LABEL[u.tier ?? 'FREE']}
                          </span>
                          {u.plan_expires_at && new Date(u.plan_expires_at) > new Date() && (
                            <p className="text-xs text-gray-400">
                              ~{new Date(u.plan_expires_at).toLocaleDateString('ko-KR')} 까지
                            </p>
                          )}
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-7 text-xs text-red-600 hover:bg-red-50 hover:border-red-300 ml-1"
                            onClick={(e) => {
                              e.stopPropagation();
                              if (confirm(`"${u.name || u.email}" 계정을 삭제하시겠습니까?\n모든 데이터(쿠폰, 플랜, 가게 등)가 함께 삭제됩니다.`)) {
                                deleteUser.mutate({ userId: u.id });
                              }
                            }}
                            disabled={deleteUser.isPending}
                          >
                            <Trash2 className="w-3 h-3" />
                          </Button>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                ))
              )}
            </div>
          </TabsContent>

          {/* 이벤트 팝업 탭 */}
          <TabsContent value="event-popups" className="space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-xl font-bold text-gray-900 flex items-center gap-2">
                <Sparkles className="h-5 w-5 text-amber-500" />
                이벤트 팝업 관리
              </h2>
              <Button size="sm" className="bg-amber-400 hover:bg-amber-500 text-white"
                onClick={() => {
                  setPopupForm({ title:'', body:'', target:'ALL', imageDataUrl:'', primaryButtonText:'', primaryButtonUrl:'', dismissible:true, priority:0, startsAt:'', endsAt:'' });
                  setShowPopupForm(true);
                }}>
                + 팝업 생성
              </Button>
            </div>

            {/* 생성/수정 폼 */}
            {(showPopupForm || editingPopup) && (
              <Card className="border-amber-200 bg-amber-50/30">
                <CardHeader className="pb-3">
                  <CardTitle className="text-base">{editingPopup ? '팝업 수정' : '새 팝업 생성'}</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div>
                      <Label>제목 *</Label>
                      <Input value={popupForm.title} onChange={e => setPopupForm({...popupForm, title: e.target.value})} placeholder="팝업 제목" />
                    </div>
                    <div>
                      <Label>타겟</Label>
                      <select className="w-full border rounded-md px-3 py-2 text-sm"
                        value={popupForm.target}
                        onChange={e => setPopupForm({...popupForm, target: e.target.value as any})}>
                        <option value="ALL">전체 (비로그인 포함)</option>
                        <option value="ACTIVE_ONLY">활성 계정만</option>
                        <option value="DORMANT_ONLY">휴면 계정만</option>
                      </select>
                    </div>
                    <div className="md:col-span-2">
                      <Label>본문</Label>
                      <Textarea value={popupForm.body} onChange={e => setPopupForm({...popupForm, body: e.target.value})} rows={2} placeholder="팝업 본문 (선택)" />
                    </div>
                    <div>
                      <Label>버튼 텍스트</Label>
                      <Input value={popupForm.primaryButtonText} onChange={e => setPopupForm({...popupForm, primaryButtonText: e.target.value})} placeholder="예: 자세히 보기" />
                    </div>
                    <div>
                      <Label>버튼 URL</Label>
                      <Input value={popupForm.primaryButtonUrl} onChange={e => setPopupForm({...popupForm, primaryButtonUrl: e.target.value})} placeholder="https://..." />
                    </div>
                    <div>
                      <Label>시작일시 <span className="text-xs text-gray-400 font-normal">(비워두면 즉시 노출)</span></Label>
                      <Input type="datetime-local" value={popupForm.startsAt} onChange={e => setPopupForm({...popupForm, startsAt: e.target.value})} />
                    </div>
                    <div>
                      <Label>종료일시 <span className="text-xs text-gray-400 font-normal">(비워두면 ♾️ 무기한 표시)</span></Label>
                      <Input type="datetime-local" value={popupForm.endsAt} onChange={e => setPopupForm({...popupForm, endsAt: e.target.value})} />
                      {popupForm.endsAt && (
                        <button className="mt-1 text-xs text-red-400 hover:text-red-600 underline" onClick={() => setPopupForm({...popupForm, endsAt: ''})}>
                          종료일 제거 (무기한)
                        </button>
                      )}
                    </div>
                    <div>
                      <Label>우선순위 (숫자, 높을수록 먼저)</Label>
                      <Input type="number" value={popupForm.priority} onChange={e => setPopupForm({...popupForm, priority: Number(e.target.value)})} />
                    </div>
                    <div className="flex items-center gap-3 pt-5">
                      <input type="checkbox" id="dismissible" checked={popupForm.dismissible}
                        onChange={e => setPopupForm({...popupForm, dismissible: e.target.checked})} />
                      <Label htmlFor="dismissible">닫기 허용</Label>
                    </div>
                    <div className="md:col-span-2">
                      <Label className="flex items-center gap-1">
                        팝업 이미지 <span className="text-red-500">*</span>
                        <span className="text-xs text-gray-400 font-normal">(jpg/png, ≤600KB, 필수)</span>
                      </Label>
                      <div className="mt-2 flex items-center gap-3">
                        <label className="cursor-pointer inline-flex items-center gap-2 px-4 py-2 rounded-lg border-2 border-dashed border-amber-400 bg-amber-50 hover:bg-amber-100 transition-colors text-amber-700 font-semibold text-sm">
                          🖼️ 이미지 업로드
                          <input
                            type="file"
                            accept="image/jpeg,image/png"
                            className="hidden"
                            onChange={e => {
                              const file = e.target.files?.[0];
                              if (!file) return;
                              if (file.size > 600 * 1024) { toast.error('600KB 이하 이미지만 가능합니다.'); return; }
                              const reader = new FileReader();
                              reader.onload = ev => setPopupForm({...popupForm, imageDataUrl: ev.target?.result as string});
                              reader.readAsDataURL(file);
                            }}
                          />
                        </label>
                        {popupForm.imageDataUrl && (
                          <button
                            onClick={() => setPopupForm({...popupForm, imageDataUrl: ''})}
                            className="text-xs text-red-500 hover:text-red-700"
                          >
                            ✕ 제거
                          </button>
                        )}
                        {!popupForm.imageDataUrl && (
                          <span className="text-xs text-gray-400">이미지를 선택해주세요</span>
                        )}
                      </div>
                      {popupForm.imageDataUrl && (
                        <img src={popupForm.imageDataUrl} alt="미리보기" className="mt-3 h-40 w-full rounded-lg object-cover border-2 border-amber-200 shadow" />
                      )}
                    </div>
                  </div>
                  <div className="flex gap-2 pt-2">
                    <Button size="sm" className="bg-amber-400 hover:bg-amber-500 text-white"
                      disabled={!popupForm.title || !popupForm.imageDataUrl || createPopup.isPending || updatePopup.isPending}
                      title={!popupForm.imageDataUrl ? '이미지를 업로드해주세요 (필수)' : undefined}
                      onClick={() => {
                        const payload = {
                          title: popupForm.title, body: popupForm.body || undefined,
                          target: popupForm.target,
                          imageDataUrl: popupForm.imageDataUrl || undefined,
                          primaryButtonText: popupForm.primaryButtonText || undefined,
                          primaryButtonUrl: popupForm.primaryButtonUrl || undefined,
                          dismissible: popupForm.dismissible,
                          priority: popupForm.priority,
                          startsAt: popupForm.startsAt || undefined,
                          endsAt: popupForm.endsAt || undefined,
                        };
                        if (editingPopup) {
                          updatePopup.mutate({ id: editingPopup.id, ...payload });
                        } else {
                          createPopup.mutate(payload);
                        }
                      }}>
                      {createPopup.isPending || updatePopup.isPending ? '저장 중...' : '저장'}
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => { setShowPopupForm(false); setEditingPopup(null); }}>취소</Button>
                  </div>
                </CardContent>
              </Card>
            )}

            {/* 팝업 목록 */}
            <div className="space-y-2">
              {(!eventPopups || (eventPopups as any[]).length === 0) ? (
                <Card><CardContent className="py-8 text-center text-gray-400">등록된 팝업이 없습니다.</CardContent></Card>
              ) : (
                (eventPopups as any[]).map((popup: any) => (
                  <Card key={popup.id} className={popup.is_active ? '' : 'opacity-60'}>
                    <CardContent className="pt-4 pb-3">
                      <div className="flex items-start justify-between gap-2 flex-wrap">
                        <div className="flex-1">
                          <p className="font-semibold text-sm">{popup.title}</p>
                          <p className="text-xs text-gray-500 mt-0.5">
                            타겟: <span className="font-medium">{popup.target}</span>
                            {' · '} 우선순위: {popup.priority}
                            {popup.starts_at && ` · 시작: ${new Date(popup.starts_at).toLocaleDateString('ko-KR')}`}
                            {popup.ends_at
                              ? new Date(popup.ends_at) < new Date()
                                ? <span className="ml-1 text-red-500 font-bold">⚠️ 만료됨 (종료일 수정 필요)</span>
                                : ` · 종료: ${new Date(popup.ends_at).toLocaleDateString('ko-KR')}`
                              : <span className="ml-1 text-green-600 text-[10px]">♾️ 무기한</span>}
                          </p>
                        </div>
                        <div className="flex items-center gap-1.5 flex-shrink-0">
                          <Button size="sm" variant="outline" className="h-7 text-xs text-blue-600 hover:bg-blue-50"
                            title="숨김 상태 초기화 후 즉시 팝업 표시"
                            onClick={() => {
                              // 해당 팝업의 24h 키 제거 (모든 유저 스코프)
                              Object.keys(localStorage).filter(k => k.endsWith(`:${popup.id}`) && k.startsWith('popup_hide_until:')).forEach(k => localStorage.removeItem(k));
                              utils.popup.getActive.invalidate();
                              window.dispatchEvent(new Event('popup-recheck'));
                              toast.success('팝업이 이 화면에 바로 표시됩니다!');
                            }}>
                            👁️ 테스트
                          </Button>
                          <Button size="sm" variant="outline" className="h-7 text-xs"
                            onClick={() => togglePopup.mutate({ id: popup.id, isActive: !popup.is_active })}>
                            {popup.is_active ? '비활성' : '활성'}
                          </Button>
                          <Button size="sm" variant="outline" className="h-7 text-xs"
                            onClick={() => {
                              setEditingPopup(popup);
                              setPopupForm({
                                title: popup.title, body: popup.body || '',
                                target: popup.target, imageDataUrl: popup.image_data_url || '',
                                primaryButtonText: popup.primary_button_text || '',
                                primaryButtonUrl: popup.primary_button_url || '',
                                dismissible: popup.dismissible, priority: popup.priority,
                                startsAt: popup.starts_at ? popup.starts_at.slice(0,16) : '',
                                endsAt: popup.ends_at ? popup.ends_at.slice(0,16) : '',
                              });
                              setShowPopupForm(false);
                            }}>
                            수정
                          </Button>
                          <Button size="sm" variant="outline" className="h-7 text-xs text-red-600 hover:bg-red-50"
                            onClick={() => { if (confirm(`"${popup.title}" 팝업을 삭제하시겠습니까?`)) deletePopup.mutate({ id: popup.id }); }}>
                            삭제
                          </Button>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                ))
              )}
            </div>
          </TabsContent>

          {/* 어뷰저 관리 탭 */}
          <TabsContent value="abuse" className="space-y-4">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <h2 className="text-xl font-bold text-gray-900 flex items-center gap-2">
                <AlertTriangle className="w-5 h-5 text-red-500" />
                어뷰저 관리
              </h2>
              <div className="flex gap-2 flex-wrap">
                <input
                  type="text"
                  placeholder="이름 또는 이메일 검색"
                  className="border rounded px-3 py-1.5 text-sm w-48"
                  value={abuseSearch}
                  onChange={(e) => setAbuseSearch(e.target.value)}
                />
                <select
                  className="border rounded px-2 py-1.5 text-sm"
                  value={abuseStatusFilter}
                  onChange={(e) => setAbuseStatusFilter(e.target.value as any)}
                >
                  <option value="">WATCHLIST + PENALIZED</option>
                  <option value="PENALIZED">PENALIZED만</option>
                  <option value="WATCHLIST">WATCHLIST만</option>
                  <option value="CLEAN">CLEAN만</option>
                </select>
                <Button size="sm" variant="outline" onClick={() => refetchAbuse()}>새로고침</Button>
              </div>
            </div>

            {!abuseList || abuseList.length === 0 ? (
              <Card>
                <CardContent className="text-center py-10 text-gray-500 text-sm">
                  감지된 어뷰저가 없습니다.
                </CardContent>
              </Card>
            ) : (
              <div className="space-y-3">
                {abuseList.map((row: any) => {
                  const isExpanded = expandedAbuseUser === row.user_id;
                  const isPenalized = row.status === 'PENALIZED';
                  const rateStr = row.expired_unused_rate != null
                    ? `${(Number(row.expired_unused_rate) * 100).toFixed(1)}%`
                    : '-';
                  return (
                    <Card key={row.user_id} className={`border ${isPenalized ? 'border-red-300 bg-red-50' : 'border-orange-200 bg-orange-50'}`}>
                      <CardContent className="pt-4 pb-3">
                        <div className="flex items-start justify-between gap-2 flex-wrap">
                          <div>
                            <div className="flex items-center gap-2">
                              <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${isPenalized ? 'bg-red-500 text-white' : 'bg-orange-400 text-white'}`}>
                                {row.status}
                              </span>
                              <span className="font-semibold text-sm">{row.name ?? '(이름없음)'} #{row.user_id}</span>
                              {row.manually_set && <span className="text-xs text-purple-600 font-medium">[수동지정]</span>}
                            </div>
                            <p className="text-xs text-gray-500 mt-0.5">{row.email ?? '-'}</p>
                            <p className="text-xs text-gray-600 mt-1">
                              미사용 만료율: <strong>{rateStr}</strong>
                              {' '}({row.expired_unused_count ?? '-'}/{row.expired_total_count ?? '-'})
                              {' · '}연속 {row.consecutive_penalized_weeks ?? 0}주
                            </p>
                          </div>
                          <div className="flex gap-1.5 flex-wrap">
                            {row.status !== 'PENALIZED' && (
                              <Button size="sm" variant="destructive" className="h-7 text-xs"
                                onClick={() => setAbuseStatus.mutate({ userId: row.user_id, status: 'PENALIZED', note: abuseNote || undefined })}>
                                패널티 적용
                              </Button>
                            )}
                            {row.status !== 'CLEAN' && (
                              <Button size="sm" variant="outline" className="h-7 text-xs border-green-400 text-green-700 hover:bg-green-50"
                                onClick={() => setAbuseStatus.mutate({ userId: row.user_id, status: 'CLEAN', note: '관리자 수동 해제' })}>
                                해제 (CLEAN)
                              </Button>
                            )}
                            <Button size="sm" variant="ghost" className="h-7 text-xs"
                              onClick={() => {
                                if (isExpanded) {
                                  setExpandedAbuseUser(null);
                                } else {
                                  setExpandedAbuseUser(row.user_id);
                                  getLinkedAccounts.mutate({ userId: row.user_id });
                                  getSnapshots.mutate({ userId: row.user_id });
                                  setAbuseNote('');
                                }
                              }}>
                              {isExpanded ? '접기' : '상세'}
                            </Button>
                          </div>
                        </div>

                        {isExpanded && (
                          <div className="mt-3 space-y-3 border-t pt-3">
                            {/* 패널티 메모 */}
                            <div className="flex gap-2 items-center">
                              <input
                                type="text"
                                placeholder="패널티 메모 (선택사항)"
                                className="border rounded px-2 py-1 text-xs flex-1"
                                value={abuseNote}
                                onChange={(e) => setAbuseNote(e.target.value)}
                              />
                            </div>
                            {row.note && (
                              <p className="text-xs text-gray-500">현재 메모: {row.note}</p>
                            )}

                            {/* 주간 스냅샷 이력 */}
                            <div>
                              <p className="text-xs font-semibold text-gray-700 mb-1">주간 스냅샷 이력</p>
                              {snapshots.length === 0 ? (
                                <p className="text-xs text-gray-400">스냅샷 없음</p>
                              ) : (
                                <div className="overflow-x-auto">
                                  <table className="text-xs w-full border-collapse">
                                    <thead>
                                      <tr className="bg-gray-100">
                                        <th className="px-2 py-1 text-left">주</th>
                                        <th className="px-2 py-1 text-right">전체</th>
                                        <th className="px-2 py-1 text-right">미사용</th>
                                        <th className="px-2 py-1 text-right">비율</th>
                                        <th className="px-2 py-1 text-center">평가</th>
                                      </tr>
                                    </thead>
                                    <tbody>
                                      {snapshots.map((s: any) => (
                                        <tr key={s.week_start} className="border-t">
                                          <td className="px-2 py-1">{s.week_start}</td>
                                          <td className="px-2 py-1 text-right">{s.expired_total_count}</td>
                                          <td className="px-2 py-1 text-right">{s.expired_unused_count}</td>
                                          <td className="px-2 py-1 text-right">{(Number(s.expired_unused_rate)*100).toFixed(1)}%</td>
                                          <td className={`px-2 py-1 text-center font-semibold ${s.evaluation === 'PENALIZED' ? 'text-red-600' : s.evaluation === 'WATCHLIST' ? 'text-orange-600' : 'text-green-600'}`}>
                                            {s.evaluation}
                                          </td>
                                        </tr>
                                      ))}
                                    </tbody>
                                  </table>
                                </div>
                              )}
                            </div>

                            {/* device_key 연계 계정 */}
                            <div>
                              <p className="text-xs font-semibold text-gray-700 mb-1">
                                device_key 연계 계정
                                {linkedAccounts.length >= 2 && (
                                  <span className="ml-1 text-orange-600">⚠️ {linkedAccounts.length}개 감지</span>
                                )}
                              </p>
                              {linkedAccounts.length === 0 ? (
                                <p className="text-xs text-gray-400">연계 계정 없음</p>
                              ) : (
                                <div className="space-y-1">
                                  {linkedAccounts.map((la: any) => (
                                    <div key={la.linked_user_id} className="flex items-center gap-2 text-xs">
                                      <span className={`px-1.5 py-0.5 rounded text-white text-[10px] ${la.abuse_status === 'PENALIZED' ? 'bg-red-500' : la.abuse_status === 'WATCHLIST' ? 'bg-orange-400' : 'bg-gray-400'}`}>
                                        {la.abuse_status ?? 'CLEAN'}
                                      </span>
                                      <span>{la.name ?? '(없음)'} #{la.linked_user_id}</span>
                                      <span className="text-gray-400">공유 {la.shared_count}건</span>
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>
                          </div>
                        )}
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            )}
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

      {/* 가게 거부 사유 입력 다이얼로그 */}
      <Dialog open={!!rejectTarget} onOpenChange={(open) => { if (!open) setRejectTarget(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-red-600">
              <XCircle className="w-5 h-5" />
              가게 승인 거부
            </DialogTitle>
            <DialogDescription>
              <span className="font-semibold">"{rejectTarget?.name}"</span> 상점을 거부합니다.
              거절 사유를 입력하면 사장님 대시보드에 표시됩니다.
            </DialogDescription>
          </DialogHeader>
          <div className="py-2">
            <Label htmlFor="reject-reason">거절 사유 (선택사항)</Label>
            <Textarea
              id="reject-reason"
              className="mt-1.5"
              rows={3}
              placeholder="예: 사업자 등록증 미확인, 주소 불일치, 카테고리 부적합 등"
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
            />
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setRejectTarget(null)}>
              취소
            </Button>
            <Button
              variant="destructive"
              disabled={rejectStore.isPending}
              onClick={() => {
                if (!rejectTarget) return;
                rejectStore.mutate(
                  { id: rejectTarget.id, reason: rejectReason || undefined },
                  { onSuccess: () => setRejectTarget(null) }
                );
              }}
            >
              거부 확정
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
