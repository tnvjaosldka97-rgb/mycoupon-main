import { useState } from "react";
import { useAuth } from '@/_core/hooks/useAuth';
import { trpc } from "@/lib/trpc";
import { Card, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
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
import { CompetitionReport } from "@/components/CompetitionReport";
import { NearbyStoreRanking } from "@/components/NearbyStoreRanking";
import { UserStatistics } from "@/components/UserStatistics";
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

export default function AdminAnalytics() {
  const { user } = useAuth();
  const [period, setPeriod] = useState<"daily" | "weekly" | "monthly">("daily");

  // 모든 Hooks를 먼저 호출 (조건문 이전에)
  const { data: overview } = trpc.analytics.overview.useQuery(undefined, {
    enabled: user?.role === 'admin',
  });
  const { data: usageTrend } = trpc.analytics.usageTrend.useQuery(
    { period },
    { enabled: user?.role === 'admin' }
  );
  const { data: topStores } = trpc.analytics.topStores.useQuery(undefined, {
    enabled: user?.role === 'admin',
  });
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
        {/* 실시간 현황 카드 */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4 mb-8">
          <Card className="p-6">
            <div className="flex items-center justify-between mb-2">
              <div className="text-sm text-muted-foreground">오늘 사용량</div>
              <TrendingUp className="w-5 h-5 text-primary" />
            </div>
            <div className="text-3xl font-bold">{overview?.todayUsage || 0}</div>
            <div className="text-xs text-muted-foreground mt-1">개</div>
          </Card>

          <Card className="p-6">
            <div className="flex items-center justify-between mb-2">
              <div className="text-sm text-muted-foreground">전체 다운로드</div>
              <Users className="w-5 h-5 text-accent" />
            </div>
            <div className="text-3xl font-bold">{overview?.totalDownloads || 0}</div>
            <div className="text-xs text-muted-foreground mt-1">개</div>
          </Card>

          <Card className="p-6">
            <div className="flex items-center justify-between mb-2">
              <div className="text-sm text-muted-foreground">전체 사용</div>
              <BarChart3 className="w-5 h-5 text-secondary" />
            </div>
            <div className="text-3xl font-bold">{overview?.totalUsage || 0}</div>
            <div className="text-xs text-muted-foreground mt-1">개</div>
          </Card>

          <Card className="p-6">
            <div className="flex items-center justify-between mb-2">
              <div className="text-sm text-muted-foreground">활성 가게</div>
              <Store className="w-5 h-5 text-primary" />
            </div>
            <div className="text-3xl font-bold">{overview?.activeStores || 0}</div>
            <div className="text-xs text-muted-foreground mt-1">곳</div>
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
              <XAxis dataKey={period === "daily" ? "date" : period === "weekly" ? "week" : "month"} />
              <YAxis />
              <Tooltip />
              <Legend />
              <Line type="monotone" dataKey="count" stroke="#FF6B6B" strokeWidth={2} name="사용량" />
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
              가게별 인기도 TOP 10
            </h2>
            <div className="space-y-3">
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
                      <div className="font-bold text-primary">{store.usage_count}회</div>
                      <div className="text-xs text-muted-foreground">{store.unique_users}명</div>
                    </div>
                  </div>
                </Link>
              ))}
            </div>
            <p className="text-sm text-muted-foreground mt-4 text-center">
              클릭하여 상세 내역 확인
            </p>
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
