import { useState, useEffect } from "react";
import { Link, useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/hooks/useAuth";
import { useBridgeSocket } from "@/hooks/useBridgeSocket";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import {
  ArrowLeft,
  Gift,
  Trophy,
  Star,
  CheckCircle2,
  Clock,
  TrendingUp,
  Bell,
  Ticket,
  Target,
  Calendar,
  Award,
  Zap,
  ChevronRight,
} from "lucide-react";

// 스켈레톤 컴포넌트
function ActivitySkeleton() {
  return (
    <div className="space-y-4">
      {/* 통계 카드 스켈레톤 */}
      <div className="grid grid-cols-2 gap-3">
        {[1, 2, 3, 4].map((i) => (
          <Card key={i} className="bg-white/80 backdrop-blur-sm">
            <CardContent className="p-4">
              <Skeleton className="h-4 w-16 mb-2" />
              <Skeleton className="h-8 w-20" />
            </CardContent>
          </Card>
        ))}
      </div>

      {/* 활동 리스트 스켈레톤 */}
      <Card className="bg-white/80 backdrop-blur-sm">
        <CardHeader>
          <Skeleton className="h-6 w-32" />
        </CardHeader>
        <CardContent className="space-y-3">
          {[1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="flex items-center gap-3 p-3 rounded-lg bg-gray-50">
              <Skeleton className="h-10 w-10 rounded-full" />
              <div className="flex-1">
                <Skeleton className="h-4 w-3/4 mb-2" />
                <Skeleton className="h-3 w-1/2" />
              </div>
              <Skeleton className="h-6 w-16" />
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}

// 활동 아이템 타입
type ActivityItem = {
  id: number;
  type: 'coupon_download' | 'coupon_used' | 'check_in' | 'level_up' | 'badge' | 'mission';
  title: string;
  description: string;
  points?: number;
  createdAt: Date;
  icon: React.ReactNode;
  color: string;
};

export default function ActivityPage() {
  const [, setLocation] = useLocation();
  const { user, loading: authLoading, login } = useAuth();
  const [activeTab, setActiveTab] = useState("activity");
  const [realtimeActivities, setRealtimeActivities] = useState<ActivityItem[]>([]);

  // 브릿지 소켓 연결 (실시간 피드)
  const { isConnected, lastEvent } = useBridgeSocket();

  // API 호출
  const { data: stats, isLoading: statsLoading } = trpc.gamification.myStats.useQuery(undefined, {
    enabled: !!user,
    staleTime: 30 * 1000,
  });

  const { data: pointHistory, isLoading: historyLoading } = trpc.gamification.pointHistory.useQuery(
    { limit: 30 },
    { enabled: !!user, staleTime: 30 * 1000 }
  );

  const { data: missions, isLoading: missionsLoading } = trpc.gamification.myMissions.useQuery(undefined, {
    enabled: !!user,
    staleTime: 60 * 1000,
  });

  const { data: badges, isLoading: badgesLoading } = trpc.gamification.myBadges.useQuery(undefined, {
    enabled: !!user,
    staleTime: 60 * 1000,
  });

  const { data: notifications, isLoading: notificationsLoading } = trpc.gamification.myNotifications.useQuery(
    { limit: 20 },
    { enabled: !!user, staleTime: 30 * 1000 }
  );

  const { data: leaderboard } = trpc.gamification.leaderboard.useQuery({ limit: 5 });

  const checkInMutation = trpc.gamification.checkIn.useMutation({
    onSuccess: () => {
      // 성공 시 통계 갱신
      window.location.reload();
    },
    onError: (error) => {
      alert(error.message);
    },
  });

  // 실시간 이벤트 처리
  useEffect(() => {
    if (lastEvent) {
      const newActivity: ActivityItem = {
        id: Date.now(),
        type: lastEvent.type === 'notification:coupon' ? 'coupon_download' : 'level_up',
        title: lastEvent.data?.title || '새로운 활동',
        description: lastEvent.data?.message || '',
        points: lastEvent.data?.points,
        createdAt: new Date(),
        icon: lastEvent.type === 'notification:coupon' ? <Ticket className="w-5 h-5" /> : <Zap className="w-5 h-5" />,
        color: lastEvent.type === 'notification:coupon' ? 'bg-orange-100 text-orange-600' : 'bg-purple-100 text-purple-600',
      };
      setRealtimeActivities((prev) => [newActivity, ...prev.slice(0, 9)]);
    }
  }, [lastEvent]);

  // 로딩 중
  const isLoading = authLoading || statsLoading || historyLoading;

  // 비로그인 상태
  if (!authLoading && !user) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-orange-50 via-pink-50 to-purple-50 flex items-center justify-center p-4">
        <Card className="max-w-md w-full shadow-lg">
          <CardContent className="pt-6 text-center space-y-4">
            <div className="w-20 h-20 mx-auto bg-gradient-to-br from-orange-400 to-pink-500 rounded-full flex items-center justify-center">
              <Trophy className="w-10 h-10 text-white" />
            </div>
            <h2 className="text-2xl font-bold text-gray-800">로그인이 필요해요</h2>
            <p className="text-gray-500">
              마이쿠폰 활동을 확인하려면 로그인해주세요
            </p>
            <Button onClick={() => login()} className="w-full bg-gradient-to-r from-orange-500 to-pink-500 hover:from-orange-600 hover:to-pink-600">
              로그인하기
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  // 포인트 내역을 활동 아이템으로 변환
  const activities: ActivityItem[] = (pointHistory || []).map((item: any) => ({
    id: item.id,
    type: item.type as ActivityItem['type'],
    title: item.description || getActivityTitle(item.type),
    description: getActivityDescription(item.type, item.amount),
    points: item.amount,
    createdAt: new Date(item.createdAt),
    icon: getActivityIcon(item.type),
    color: getActivityColor(item.type),
  }));

  // 실시간 활동과 기존 활동 병합
  const allActivities = [...realtimeActivities, ...activities];

  return (
    <div className="min-h-screen bg-gradient-to-br from-orange-50 via-pink-50 to-purple-50">
      {/* 헤더 */}
      <header className="sticky top-0 z-50 bg-white/80 backdrop-blur-md border-b border-gray-100">
        <div className="container flex items-center justify-between h-14 px-4">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="icon" onClick={() => setLocation('/')}>
              <ArrowLeft className="w-5 h-5" />
            </Button>
            <h1 className="text-lg font-bold text-gray-800">마이쿠폰 활동</h1>
          </div>
          {isConnected && (
            <Badge variant="outline" className="text-green-600 border-green-300 bg-green-50">
              <span className="w-2 h-2 bg-green-500 rounded-full mr-1.5 animate-pulse" />
              실시간
            </Badge>
          )}
        </div>
      </header>

      <main className="container px-4 py-6 space-y-6">
        {isLoading ? (
          <ActivitySkeleton />
        ) : (
          <>
            {/* 통계 카드 */}
            <div className="grid grid-cols-2 gap-3">
              <Card className="bg-gradient-to-br from-orange-400 to-pink-500 text-white shadow-lg">
                <CardContent className="p-4">
                  <div className="flex items-center gap-2 mb-1">
                    <Star className="w-4 h-4" />
                    <span className="text-sm opacity-90">총 포인트</span>
                  </div>
                  <p className="text-2xl font-bold">{(stats?.points || 0).toLocaleString()}P</p>
                </CardContent>
              </Card>

              <Card className="bg-white/80 backdrop-blur-sm shadow-lg">
                <CardContent className="p-4">
                  <div className="flex items-center gap-2 mb-1">
                    <Trophy className="w-4 h-4 text-yellow-500" />
                    <span className="text-sm text-gray-600">레벨</span>
                  </div>
                  <p className="text-2xl font-bold text-gray-800">Lv.{stats?.level || 1}</p>
                </CardContent>
              </Card>

              <Card className="bg-white/80 backdrop-blur-sm shadow-lg">
                <CardContent className="p-4">
                  <div className="flex items-center gap-2 mb-1">
                    <Calendar className="w-4 h-4 text-blue-500" />
                    <span className="text-sm text-gray-600">연속 출석</span>
                  </div>
                  <p className="text-2xl font-bold text-gray-800">{stats?.consecutiveCheckIns || 0}일</p>
                </CardContent>
              </Card>

              <Card className="bg-white/80 backdrop-blur-sm shadow-lg">
                <CardContent className="p-4">
                  <div className="flex items-center gap-2 mb-1">
                    <Ticket className="w-4 h-4 text-green-500" />
                    <span className="text-sm text-gray-600">사용한 쿠폰</span>
                  </div>
                  <p className="text-2xl font-bold text-gray-800">{stats?.totalCouponsUsed || 0}장</p>
                </CardContent>
              </Card>
            </div>

            {/* 출석 체크 버튼 */}
            <Card className="bg-white/80 backdrop-blur-sm shadow-lg overflow-hidden">
              <CardContent className="p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="font-semibold text-gray-800">오늘의 출석 체크</h3>
                    <p className="text-sm text-gray-500">매일 출석하고 포인트 받으세요!</p>
                  </div>
                  <Button
                    onClick={() => checkInMutation.mutate()}
                    disabled={checkInMutation.isPending}
                    className="bg-gradient-to-r from-orange-500 to-pink-500 hover:from-orange-600 hover:to-pink-600"
                  >
                    {checkInMutation.isPending ? '처리 중...' : '출석하기'}
                  </Button>
                </div>
              </CardContent>
            </Card>

            {/* 탭 네비게이션 */}
            <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
              <TabsList className="grid w-full grid-cols-4 bg-white/80 backdrop-blur-sm">
                <TabsTrigger value="activity" className="text-xs">활동</TabsTrigger>
                <TabsTrigger value="missions" className="text-xs">미션</TabsTrigger>
                <TabsTrigger value="badges" className="text-xs">뱃지</TabsTrigger>
                <TabsTrigger value="ranking" className="text-xs">랭킹</TabsTrigger>
              </TabsList>

              {/* 활동 탭 */}
              <TabsContent value="activity" className="mt-4">
                <Card className="bg-white/80 backdrop-blur-sm shadow-lg">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-lg flex items-center gap-2">
                      <TrendingUp className="w-5 h-5 text-orange-500" />
                      최근 활동
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    {allActivities.length === 0 ? (
                      <div className="text-center py-8 text-gray-500">
                        <Gift className="w-12 h-12 mx-auto mb-3 opacity-50" />
                        <p>아직 활동 내역이 없어요</p>
                        <p className="text-sm">쿠폰을 사용하고 포인트를 모아보세요!</p>
                      </div>
                    ) : (
                      allActivities.slice(0, 15).map((activity) => (
                        <div
                          key={activity.id}
                          className="flex items-center gap-3 p-3 rounded-lg bg-gray-50 hover:bg-gray-100 transition-colors"
                        >
                          <div className={`w-10 h-10 rounded-full flex items-center justify-center ${activity.color}`}>
                            {activity.icon}
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="font-medium text-gray-800 truncate">{activity.title}</p>
                            <p className="text-xs text-gray-500">{formatTimeAgo(activity.createdAt)}</p>
                          </div>
                          {activity.points && (
                            <Badge variant={activity.points > 0 ? "default" : "secondary"} className={activity.points > 0 ? "bg-green-500" : ""}>
                              {activity.points > 0 ? '+' : ''}{activity.points}P
                            </Badge>
                          )}
                        </div>
                      ))
                    )}
                  </CardContent>
                </Card>
              </TabsContent>

              {/* 미션 탭 */}
              <TabsContent value="missions" className="mt-4">
                <Card className="bg-white/80 backdrop-blur-sm shadow-lg">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-lg flex items-center gap-2">
                      <Target className="w-5 h-5 text-blue-500" />
                      진행 중인 미션
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    {missionsLoading ? (
                      <div className="space-y-3">
                        {[1, 2, 3].map((i) => (
                          <Skeleton key={i} className="h-20 w-full" />
                        ))}
                      </div>
                    ) : missions && missions.length > 0 ? (
                      missions.map((mission: any) => (
                        <div key={mission.id} className="p-4 rounded-lg bg-gray-50">
                          <div className="flex items-center justify-between mb-2">
                            <h4 className="font-medium text-gray-800">{mission.title}</h4>
                            <Badge variant="outline">{mission.reward}P</Badge>
                          </div>
                          <p className="text-sm text-gray-500 mb-2">{mission.description}</p>
                          <div className="flex items-center gap-2">
                            <Progress value={(mission.progress / mission.target) * 100} className="flex-1" />
                            <span className="text-xs text-gray-500">{mission.progress}/{mission.target}</span>
                          </div>
                        </div>
                      ))
                    ) : (
                      <div className="text-center py-8 text-gray-500">
                        <Target className="w-12 h-12 mx-auto mb-3 opacity-50" />
                        <p>진행 중인 미션이 없어요</p>
                      </div>
                    )}
                  </CardContent>
                </Card>
              </TabsContent>

              {/* 뱃지 탭 */}
              <TabsContent value="badges" className="mt-4">
                <Card className="bg-white/80 backdrop-blur-sm shadow-lg">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-lg flex items-center gap-2">
                      <Award className="w-5 h-5 text-yellow-500" />
                      획득한 뱃지
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    {badgesLoading ? (
                      <div className="grid grid-cols-4 gap-3">
                        {[1, 2, 3, 4].map((i) => (
                          <Skeleton key={i} className="h-16 w-16 rounded-full" />
                        ))}
                      </div>
                    ) : badges && badges.length > 0 ? (
                      <div className="grid grid-cols-4 gap-3">
                        {badges.map((badge: any) => (
                          <div key={badge.id} className="flex flex-col items-center">
                            <div className="w-16 h-16 rounded-full bg-gradient-to-br from-yellow-400 to-orange-500 flex items-center justify-center text-white text-2xl">
                              {badge.icon || '🏆'}
                            </div>
                            <p className="text-xs text-center mt-1 text-gray-600">{badge.name}</p>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="text-center py-8 text-gray-500">
                        <Award className="w-12 h-12 mx-auto mb-3 opacity-50" />
                        <p>아직 획득한 뱃지가 없어요</p>
                      </div>
                    )}
                  </CardContent>
                </Card>
              </TabsContent>

              {/* 랭킹 탭 */}
              <TabsContent value="ranking" className="mt-4">
                <Card className="bg-white/80 backdrop-blur-sm shadow-lg">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-lg flex items-center gap-2">
                      <Trophy className="w-5 h-5 text-yellow-500" />
                      쿠폰왕 랭킹
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    {leaderboard && leaderboard.length > 0 ? (
                      leaderboard.map((item: any, index: number) => (
                        <div
                          key={item.userId}
                          className={`flex items-center gap-3 p-3 rounded-lg ${
                            index === 0 ? 'bg-yellow-50' : index === 1 ? 'bg-gray-100' : index === 2 ? 'bg-orange-50' : 'bg-gray-50'
                          }`}
                        >
                          <div className={`w-8 h-8 rounded-full flex items-center justify-center font-bold ${
                            index === 0 ? 'bg-yellow-400 text-white' : index === 1 ? 'bg-gray-400 text-white' : index === 2 ? 'bg-orange-400 text-white' : 'bg-gray-200 text-gray-600'
                          }`}>
                            {index + 1}
                          </div>
                          <div className="flex-1">
                            <p className="font-medium text-gray-800">{item.userName || '익명'}</p>
                            <p className="text-xs text-gray-500">Lv.{item.level}</p>
                          </div>
                          <Badge variant="outline">{item.points?.toLocaleString() || 0}P</Badge>
                        </div>
                      ))
                    ) : (
                      <div className="text-center py-8 text-gray-500">
                        <Trophy className="w-12 h-12 mx-auto mb-3 opacity-50" />
                        <p>랭킹 정보가 없어요</p>
                      </div>
                    )}
                  </CardContent>
                </Card>
              </TabsContent>
            </Tabs>
          </>
        )}
      </main>
    </div>
  );
}

// 유틸리티 함수들
function getActivityTitle(type: string): string {
  const titles: Record<string, string> = {
    coupon_download: '쿠폰 다운로드',
    coupon_used: '쿠폰 사용',
    check_in: '출석 체크',
    level_up: '레벨 업',
    badge: '뱃지 획득',
    mission: '미션 완료',
    referral: '친구 초대',
  };
  return titles[type] || '활동';
}

function getActivityDescription(type: string, points: number): string {
  if (points > 0) return `+${points}P 획득`;
  if (points < 0) return `${points}P 사용`;
  return '';
}

function getActivityIcon(type: string): React.ReactNode {
  const icons: Record<string, React.ReactNode> = {
    coupon_download: <Ticket className="w-5 h-5" />,
    coupon_used: <CheckCircle2 className="w-5 h-5" />,
    check_in: <Calendar className="w-5 h-5" />,
    level_up: <TrendingUp className="w-5 h-5" />,
    badge: <Award className="w-5 h-5" />,
    mission: <Target className="w-5 h-5" />,
    referral: <Gift className="w-5 h-5" />,
  };
  return icons[type] || <Star className="w-5 h-5" />;
}

function getActivityColor(type: string): string {
  const colors: Record<string, string> = {
    coupon_download: 'bg-orange-100 text-orange-600',
    coupon_used: 'bg-green-100 text-green-600',
    check_in: 'bg-blue-100 text-blue-600',
    level_up: 'bg-purple-100 text-purple-600',
    badge: 'bg-yellow-100 text-yellow-600',
    mission: 'bg-pink-100 text-pink-600',
    referral: 'bg-teal-100 text-teal-600',
  };
  return colors[type] || 'bg-gray-100 text-gray-600';
}

function formatTimeAgo(date: Date): string {
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return '방금 전';
  if (diffMins < 60) return `${diffMins}분 전`;
  if (diffHours < 24) return `${diffHours}시간 전`;
  if (diffDays < 7) return `${diffDays}일 전`;
  return date.toLocaleDateString('ko-KR');
}
