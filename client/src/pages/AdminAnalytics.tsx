import { useState } from "react";
import { useAuth } from '@/hooks/useAuth';
import { trpc } from "@/lib/trpc";
import { Card, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import {
  BarChart3,
  TrendingUp,
  Users,
  Store,
  Clock,
  PieChart,
  Shield,
  Trophy,
} from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { CompetitionReport } from "@/pages/CompetitionReport";
import { NearbyStoreRanking } from "@/pages/NearbyStoreRanking";
import { UserStatistics } from "@/pages/UserStatistics";
import { Link } from "wouter";
import {
  BarChart,
  Bar,
  LineChart,
  Line,
  PieChart as RechartsPieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";

type OverviewDetailType = null | 'todayUsage' | 'totalDownloads' | 'totalUsage' | 'activeStores';

export default function AdminAnalytics() {
  const { user } = useAuth();
  const [period, setPeriod] = useState<"daily" | "weekly" | "monthly">("daily");
  const [topStoresLimit, setTopStoresLimit] = useState<number>(10);
  const [overviewDetail, setOverviewDetail] = useState<OverviewDetailType>(null);

  // Dialog 열릴 때만 조회 (enabled)
  const usageDetailToday = trpc.analytics.usageDetail.useQuery(
    { today: true, limit: 200 },
    { enabled: overviewDetail === 'todayUsage' }
  );
  const usageDetailAll = trpc.analytics.usageDetail.useQuery(
    { today: false, limit: 200 },
    { enabled: overviewDetail === 'totalUsage' }
  );
  const downloadDetail = trpc.analytics.downloadDetail.useQuery(
    { limit: 200 },
    { enabled: overviewDetail === 'totalDownloads' }
  );
  const activeStoresList = trpc.analytics.activeStoresList.useQuery(
    undefined,
    { enabled: overviewDetail === 'activeStores' }
  );

  // 모든 Hooks를 먼저 호출 (조건문 이전에)
  const { data: overview } = trpc.analytics.overview.useQuery(undefined, {
    enabled: user?.role === 'admin',
  });
  const { data: usageTrend } = trpc.analytics.usageTrend.useQuery(
    { period },
    { enabled: user?.role === 'admin' }
  );
  const { data: topStores } = trpc.analytics.topStores.useQuery(
    { limit: topStoresLimit },
    { enabled: user?.role === 'admin' }
  );
  const { data: hourlyPattern } = trpc.analytics.hourlyPattern.useQuery(undefined, {
    enabled: user?.role === 'admin',
  });
  const { data: categoryDist } = trpc.analytics.categoryDistribution.useQuery(undefined, {
    enabled: user?.role === 'admin',
  });

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

  const COLORS = ["#FF6B6B", "#4ECDC4", "#FFE66D", "#95E1D3", "#F38181"];

  return (
    <div className="min-h-screen bg-gradient-to-br from-peach-50 to-mint-50">
      {/* 헤더 */}
      <div className="bg-gradient-to-r from-peach-400 via-pink-400 to-mint-400 text-white py-8 px-4 shadow-lg">
        <div className="container max-w-7xl">
          <Button variant="ghost" size="sm" className="text-white hover:bg-white/20 mb-4" asChild>
            <Link href="/admin">
              ← Admin 홈
            </Link>
          </Button>
          <div className="flex items-center gap-3 mb-2">
            <BarChart3 className="w-8 h-8" />
            <h1 className="text-3xl font-bold">통계 대시보드</h1>
          </div>
          <p className="text-white/90">전체 쿠폰 사용 현황을 한눈에 확인하세요</p>
        </div>
      </div>

      {/* 메인 컨텐츠 */}
      <div className="container max-w-7xl py-8 px-4">
        <Tabs defaultValue="overview" className="mb-8">
          <TabsList className="grid w-full grid-cols-4 max-w-3xl">
            <TabsTrigger value="overview">
              <BarChart3 className="w-4 h-4 mr-2" />
              전체 통계
            </TabsTrigger>
            <TabsTrigger value="users">
              <Users className="w-4 h-4 mr-2" />
              사용자 통계
            </TabsTrigger>
            <TabsTrigger value="competition">
              <Trophy className="w-4 h-4 mr-2" />
              경쟁 구도
            </TabsTrigger>
            <TabsTrigger value="nearby">
              <Store className="w-4 h-4 mr-2" />
              지역별 랭킹
            </TabsTrigger>
          </TabsList>

          <TabsContent value="users" className="mt-6">
            <UserStatistics />
          </TabsContent>

          <TabsContent value="competition" className="mt-6">
            <CompetitionReport />
          </TabsContent>

          <TabsContent value="nearby" className="mt-6">
            <NearbyStoreRanking />
          </TabsContent>

          <TabsContent value="overview" className="mt-6">
        {/* 실시간 현황 카드 — 각 카드 클릭 시 상세 모달 오픈 */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4 mb-8">
          <Card
            className="p-6 cursor-pointer hover:shadow-md transition-shadow"
            onClick={() => setOverviewDetail('todayUsage')}
            role="button"
            aria-label="오늘 사용량 상세 보기"
          >
            <div className="flex items-center justify-between mb-2">
              <div className="text-sm text-muted-foreground">오늘 사용량</div>
              <TrendingUp className="w-5 h-5 text-primary" />
            </div>
            <div className="text-3xl font-bold">{overview?.todayUsage || 0}</div>
            <div className="text-xs text-muted-foreground mt-1">개 · 클릭하여 상세</div>
          </Card>

          <Card
            className="p-6 cursor-pointer hover:shadow-md transition-shadow"
            onClick={() => setOverviewDetail('totalDownloads')}
            role="button"
            aria-label="전체 다운로드 상세 보기"
          >
            <div className="flex items-center justify-between mb-2">
              <div className="text-sm text-muted-foreground">전체 다운로드</div>
              <Users className="w-5 h-5 text-accent" />
            </div>
            <div className="text-3xl font-bold">{overview?.totalDownloads || 0}</div>
            <div className="text-xs text-muted-foreground mt-1">개 · 클릭하여 상세</div>
          </Card>

          <Card
            className="p-6 cursor-pointer hover:shadow-md transition-shadow"
            onClick={() => setOverviewDetail('totalUsage')}
            role="button"
            aria-label="전체 사용 상세 보기"
          >
            <div className="flex items-center justify-between mb-2">
              <div className="text-sm text-muted-foreground">전체 사용</div>
              <BarChart3 className="w-5 h-5 text-secondary" />
            </div>
            <div className="text-3xl font-bold">{overview?.totalUsage || 0}</div>
            <div className="text-xs text-muted-foreground mt-1">개 · 클릭하여 상세</div>
          </Card>

          <Card
            className="p-6 cursor-pointer hover:shadow-md transition-shadow"
            onClick={() => setOverviewDetail('activeStores')}
            role="button"
            aria-label="활성 가게 상세 보기"
          >
            <div className="flex items-center justify-between mb-2">
              <div className="text-sm text-muted-foreground">활성 가게</div>
              <Store className="w-5 h-5 text-primary" />
            </div>
            <div className="text-3xl font-bold">{overview?.activeStores || 0}</div>
            <div className="text-xs text-muted-foreground mt-1">곳 · 클릭하여 상세</div>
          </Card>

          <Card className="p-6 bg-gradient-to-br from-green-50 to-emerald-50 border-green-200">
            <div className="flex items-center justify-between mb-2">
              <div className="text-sm text-green-700 font-medium">전체 할인 제공액</div>
              <TrendingUp className="w-5 h-5 text-green-600" />
            </div>
            <div className="text-3xl font-bold text-green-900">
              {overview?.totalDiscountAmount ? `${(overview.totalDiscountAmount / 10000).toFixed(0)}만원` : '0원'}
            </div>
            <div className="text-xs text-green-600 mt-1">쿠폰 사용으로 제공된 총 할인</div>
          </Card>
        </div>

        {/* 카드 클릭 시 상세 모달 */}
        <Dialog open={!!overviewDetail} onOpenChange={(open) => !open && setOverviewDetail(null)}>
          <DialogContent className="max-w-3xl max-h-[80vh] overflow-hidden flex flex-col">
            <DialogHeader>
              <DialogTitle>
                {overviewDetail === 'todayUsage' && '오늘 사용 상세'}
                {overviewDetail === 'totalUsage' && '전체 사용 상세 (최근 200건)'}
                {overviewDetail === 'totalDownloads' && '전체 다운로드 상세 (최근 200건)'}
                {overviewDetail === 'activeStores' && '활성 가게 전체 목록'}
              </DialogTitle>
              <DialogDescription>
                {overviewDetail === 'todayUsage' && '오늘 사용된 쿠폰 — 어느 매장, 어떤 쿠폰, 누가 사용했는지'}
                {overviewDetail === 'totalUsage' && '최근 사용 이력 (매장 · 쿠폰 · 사용자 · 시간)'}
                {overviewDetail === 'totalDownloads' && '최근 다운로드 이력 (매장 · 쿠폰 · 사용자 · 시간)'}
                {overviewDetail === 'activeStores' && '현재 지도에 노출 중인 활성 가게 전체'}
              </DialogDescription>
            </DialogHeader>
            <div className="overflow-y-auto flex-1 -mx-6 px-6">
              {/* 오늘 사용 / 전체 사용 — 공통 리스트 렌더 */}
              {(overviewDetail === 'todayUsage' || overviewDetail === 'totalUsage') && (() => {
                const q = overviewDetail === 'todayUsage' ? usageDetailToday : usageDetailAll;
                if (q.isLoading) return <p className="text-center text-gray-500 py-8">불러오는 중...</p>;
                if (q.error) return <p className="text-center text-red-500 py-8">조회 실패: {String(q.error.message ?? '')}</p>;
                const rows = q.data ?? [];
                if (rows.length === 0) return <p className="text-center text-gray-400 py-8">기록 없음</p>;
                return (
                  <div className="divide-y">
                    {rows.map((r: any) => (
                      <div key={`u-${r.usageId}`} className="py-3 flex items-start justify-between gap-3">
                        <div className="flex-1 min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <Badge variant="secondary" className="text-xs">🏪 {r.storeName ?? '매장 없음'}</Badge>
                            {r.storeCategory && <span className="text-xs text-gray-400">{r.storeCategory}</span>}
                            <span className="text-[10px] text-gray-400">#{r.storeId}</span>
                          </div>
                          <div className="font-medium text-sm mt-1">{r.couponTitle ?? '(삭제된 쿠폰)'}</div>
                          <div className="text-xs text-gray-500 mt-0.5">
                            {r.discountType === 'percentage' && `${r.discountValue}% 할인`}
                            {r.discountType === 'fixed' && `${r.discountValue}원 할인`}
                            {r.discountType === 'freebie' && '무료 증정'}
                            <span className="ml-2">👤 {r.userName ?? r.userEmail ?? '알 수 없음'}</span>
                          </div>
                        </div>
                        <div className="text-xs text-gray-500 shrink-0 text-right">
                          {r.usedAt ? new Date(r.usedAt).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' }) : '-'}
                        </div>
                      </div>
                    ))}
                  </div>
                );
              })()}

              {/* 전체 다운로드 */}
              {overviewDetail === 'totalDownloads' && (() => {
                if (downloadDetail.isLoading) return <p className="text-center text-gray-500 py-8">불러오는 중...</p>;
                if (downloadDetail.error) return <p className="text-center text-red-500 py-8">조회 실패: {String(downloadDetail.error.message ?? '')}</p>;
                const rows = downloadDetail.data ?? [];
                if (rows.length === 0) return <p className="text-center text-gray-400 py-8">기록 없음</p>;
                return (
                  <div className="divide-y">
                    {rows.map((r: any) => (
                      <div key={`d-${r.downloadId}`} className="py-3 flex items-start justify-between gap-3">
                        <div className="flex-1 min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <Badge variant="secondary" className="text-xs">🏪 {r.storeName ?? '매장 없음'}</Badge>
                            {r.storeCategory && <span className="text-xs text-gray-400">{r.storeCategory}</span>}
                            <Badge
                              variant={r.status === 'used' ? 'default' : r.status === 'expired' ? 'destructive' : 'outline'}
                              className="text-[10px]"
                            >
                              {r.status === 'active' ? '활성' : r.status === 'used' ? '사용완료' : '만료'}
                            </Badge>
                          </div>
                          <div className="font-medium text-sm mt-1">{r.couponTitle ?? '(삭제된 쿠폰)'}</div>
                          <div className="text-xs text-gray-500 mt-0.5">
                            👤 {r.userName ?? r.userEmail ?? '알 수 없음'}
                          </div>
                        </div>
                        <div className="text-xs text-gray-500 shrink-0 text-right">
                          {r.downloadedAt ? new Date(r.downloadedAt).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' }) : '-'}
                        </div>
                      </div>
                    ))}
                  </div>
                );
              })()}

              {/* 활성 가게 */}
              {overviewDetail === 'activeStores' && (() => {
                if (activeStoresList.isLoading) return <p className="text-center text-gray-500 py-8">불러오는 중...</p>;
                if (activeStoresList.error) return <p className="text-center text-red-500 py-8">조회 실패: {String(activeStoresList.error.message ?? '')}</p>;
                const rows = activeStoresList.data ?? [];
                if (rows.length === 0) return <p className="text-center text-gray-400 py-8">활성 가게 없음</p>;
                return (
                  <div className="divide-y">
                    {rows.map((s: any) => (
                      <Link key={s.id} href={`/admin/store/${s.id}`}>
                        <div className="py-3 flex items-start justify-between gap-3 cursor-pointer hover:bg-gray-50 rounded px-2 -mx-2">
                          <div className="flex-1 min-w-0">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="font-medium text-sm">{s.name}</span>
                              <Badge variant="secondary" className="text-[10px]">{s.category}</Badge>
                              <span className="text-[10px] text-gray-400">#{s.id}</span>
                            </div>
                            <div className="text-xs text-gray-500 mt-0.5 truncate">{s.address}</div>
                            <div className="text-[11px] text-gray-400 mt-0.5">
                              👤 {s.ownerName ?? s.ownerEmail ?? '(오너 없음)'} · 승인 쿠폰 {s.couponCount}개
                            </div>
                          </div>
                          <div className="text-xs text-gray-400 shrink-0 text-right">
                            {s.createdAt ? new Date(s.createdAt).toLocaleDateString('ko-KR', { timeZone: 'Asia/Seoul' }) : '-'}
                          </div>
                        </div>
                      </Link>
                    ))}
                  </div>
                );
              })()}
            </div>
          </DialogContent>
        </Dialog>

        {/* 사용량 추이 차트 */}
        <Card className="p-6 mb-8">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between mb-6 gap-4">
            <h2 className="text-xl font-bold">쿠폰 사용 추이</h2>
            <div className="flex gap-2">
              <Button
                variant={period === "daily" ? "default" : "outline"}
                size="sm"
                onClick={() => setPeriod("daily")}
              >
                일별
              </Button>
              <Button
                variant={period === "weekly" ? "default" : "outline"}
                size="sm"
                onClick={() => setPeriod("weekly")}
              >
                주별
              </Button>
              <Button
                variant={period === "monthly" ? "default" : "outline"}
                size="sm"
                onClick={() => setPeriod("monthly")}
              >
                월별
              </Button>
            </div>
          </div>
          <div className="overflow-x-auto">
            <div className="min-w-[300px]">
              <ResponsiveContainer width="100%" height={300}>
            <LineChart data={usageTrend || []}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="date" />
              <YAxis />
              <Tooltip />
              <Legend />
              <Line type="monotone" dataKey="usageCount" stroke="#FF6B6B" strokeWidth={2} name="사용량" />
              <Line type="monotone" dataKey="uniqueUsers" stroke="#4ECDC4" strokeWidth={2} name="순사용자" />
            </LineChart>
              </ResponsiveContainer>
            </div>
          </div>
        </Card>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 mb-8">
          {/* 가게별 순위 */}
          <Card className="p-6">
            <h2 className="text-xl font-bold mb-6 flex items-center gap-2">
              <Store className="w-5 h-5" />
              가게별 인기도 {topStoresLimit >= 1000 ? '전체' : `TOP ${topStoresLimit}`}
            </h2>
            <div className="space-y-3 max-h-[600px] overflow-y-auto pr-1">
              {topStores?.map((store: any, index: number) => (
                <Link key={store.id} href={`/admin/store/${store.id}`}>
                  <div
                    className="flex items-center justify-between p-3 bg-gradient-to-r from-peach-50 to-mint-50 rounded-lg cursor-pointer hover:shadow-md transition-shadow"
                  >
                    <div className="flex items-center gap-3">
                      <Badge variant={index < 3 ? "default" : "secondary"} className="w-8 h-8 flex items-center justify-center">
                        {index + 1}
                      </Badge>
                      <div>
                        <div className="font-semibold">{store.name}</div>
                        <div className="text-sm text-muted-foreground">{store.category}</div>
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="font-bold text-primary">{store.usageCount || 0}회</div>
                      <div className="text-xs text-muted-foreground">{store.uniqueUsers || 0}명</div>
                    </div>
                  </div>
                </Link>
              ))}
            </div>
            <div className="flex items-center justify-between mt-4 flex-wrap gap-2">
              <p className="text-sm text-muted-foreground">
                클릭하여 상세 내역 확인
              </p>
              <div className="flex gap-2">
                {topStoresLimit < 50 && (
                  <Button variant="outline" size="sm" onClick={() => setTopStoresLimit(50)}>
                    더보기 (50)
                  </Button>
                )}
                {topStoresLimit < 1000 && (
                  <Button variant="outline" size="sm" onClick={() => setTopStoresLimit(1000)}>
                    전체 보기
                  </Button>
                )}
                {topStoresLimit > 10 && (
                  <Button variant="ghost" size="sm" onClick={() => setTopStoresLimit(10)}>
                    TOP 10으로 접기
                  </Button>
                )}
              </div>
            </div>
          </Card>

          {/* 카테고리별 분포 */}
          <Card className="p-6">
            <h2 className="text-xl font-bold mb-6 flex items-center gap-2">
              <PieChart className="w-5 h-5" />
              카테고리별 사용 비율
            </h2>
            <div className="overflow-x-auto">
              <div className="min-w-[300px]">
                <ResponsiveContainer width="100%" height={300}>
              <RechartsPieChart>
                <Pie
                  data={categoryDist || []}
                  dataKey="count"
                  nameKey="category"
                  cx="50%"
                  cy="50%"
                  outerRadius={100}
                  label
                >
                  {(categoryDist || []).map((entry: any, index: number) => (
                    <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip />
                <Legend />
              </RechartsPieChart>
                </ResponsiveContainer>
              </div>
            </div>
          </Card>
        </div>

        {/* 시간대별 사용 패턴 */}
        <Card className="p-6">
          <h2 className="text-xl font-bold mb-6 flex items-center gap-2">
            <Clock className="w-5 h-5" />
            시간대별 사용 패턴 (최근 30일)
          </h2>
          <div className="overflow-x-auto">
            <div className="min-w-[300px]">
              <ResponsiveContainer width="100%" height={300}>
            <BarChart data={hourlyPattern || []}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="hour" label={{ value: "시간", position: "insideBottom", offset: -5 }} />
              <YAxis label={{ value: "사용량", angle: -90, position: "insideLeft" }} />
              <Tooltip />
              <Bar dataKey="count" fill="#4ECDC4" name="사용량" />
            </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        </Card>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
