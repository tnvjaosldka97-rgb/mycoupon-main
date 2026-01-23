import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { 
  Calendar, 
  Trophy, 
  Star, 
  Gift, 
  Users, 
  TrendingUp,
  Award,
  Zap
} from "lucide-react";
import { Link } from "wouter";
import { toast } from "sonner";
import MyCouponsTab from "@/components/MyCouponsTab";

export default function Gamification() {
  const { data: stats } = trpc.gamification.myStats.useQuery();
  const { data: badges } = trpc.gamification.myBadges.useQuery();
  const { data: checkIns } = trpc.gamification.myCheckIns.useQuery();
  const { data: todayCheckIn } = trpc.gamification.todayCheckIn.useQuery();

  const checkInMutation = trpc.gamification.checkIn.useMutation({
    onSuccess: (data) => {
      toast.success(`출석 완료! ${data.points} 포인트 획득!`);
    },
  });

  const handleCheckIn = () => {
    checkInMutation.mutate();
  };

  // 레벨 계산
  const level = stats?.level || 1;
  const points = stats?.points || 0;
  const nextLevelPoints = level * 100;
  const progress = (points % nextLevelPoints) / nextLevelPoints * 100;

  // 레벨 이름
  const getLevelName = (level: number) => {
    if (level >= 10) return "💎 다이아몬드";
    if (level >= 7) return "🥇 골드";
    if (level >= 4) return "🥈 실버";
    return "🥉 브론즈";
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-peach-50 to-mint-50">
      {/* 헤더 */}
      <div className="bg-gradient-to-r from-peach-400 via-pink-400 to-mint-400 text-white py-8 px-4 shadow-lg">
        <div className="container max-w-4xl">
          <Button variant="ghost" size="sm" className="text-white hover:bg-white/20 mb-4" asChild>
            <Link href="/">
              ← 홈으로
            </Link>
          </Button>
          <div className="flex items-center gap-3 mb-2">
            <Trophy className="w-8 h-8" />
            <h1 className="text-3xl font-bold">나의 활동</h1>
          </div>
          <p className="text-white/90">출석하고, 뱃지를 모으고, 레벨업 하세요!</p>
        </div>
      </div>

      <div className="container max-w-4xl py-8 px-4">
        {/* 레벨 & 포인트 카드 */}
        <Card className="p-6 mb-6 bg-gradient-to-br from-yellow-50 to-orange-50 border-2 border-yellow-200">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-2xl font-bold text-yellow-800">
                {getLevelName(level)}
              </h2>
              <p className="text-yellow-600">레벨 {level}</p>
            </div>
            <div className="text-right">
              <div className="text-3xl font-bold text-yellow-700">{points}</div>
              <p className="text-sm text-yellow-600">포인트</p>
            </div>
          </div>

          <div className="space-y-2">
            <div className="flex justify-between text-sm text-yellow-600">
              <span>다음 레벨까지</span>
              <span>{nextLevelPoints - (points % nextLevelPoints)} 포인트</span>
            </div>
            <Progress value={progress} className="h-3" />
          </div>
        </Card>

        {/* 탭 */}
        <Tabs defaultValue="checkin" className="w-full">
          <TabsList className="grid w-full grid-cols-2 mb-6">
            <TabsTrigger value="coupons">
              <Gift className="w-4 h-4 mr-2" />
              내 쿠폰북
            </TabsTrigger>
            <TabsTrigger value="checkin">
              <Calendar className="w-4 h-4 mr-2" />
              나의 활동
            </TabsTrigger>
          </TabsList>

          {/* 내 쿠폰북 */}
          <TabsContent value="coupons">
            <MyCouponsTab />
          </TabsContent>

          {/* 나의 활동 (출석 + 배지 + 통계) */}
          <TabsContent value="checkin">
            <Card className="p-6 mb-4">
              <div className="text-center mb-6">
                <Calendar className="w-16 h-16 text-peach-400 mx-auto mb-4" />
                <h3 className="text-2xl font-bold mb-2">매일 출석 체크!</h3>
                <p className="text-gray-600">
                  연속 출석: <span className="font-bold text-peach-600">{stats?.consecutiveCheckIns || 0}일</span>
                </p>
                <p className="text-sm text-gray-500">
                  총 출석: {stats?.totalCheckIns || 0}일
                </p>
              </div>

              {todayCheckIn ? (
                <div className="bg-green-50 border-2 border-green-200 rounded-lg p-4 text-center">
                  <p className="text-green-700 font-medium">✅ 오늘 출석 완료!</p>
                  <p className="text-sm text-green-600 mt-1">
                    {todayCheckIn.points} 포인트를 획득했어요
                  </p>
                </div>
              ) : (
                <Button
                  onClick={handleCheckIn}
                  disabled={checkInMutation.isPending}
                  className="w-full bg-gradient-to-r from-peach-400 to-pink-400 hover:from-peach-500 hover:to-pink-500 text-lg py-6"
                >
                  {checkInMutation.isPending ? "처리 중..." : "출석 체크하기 🎁"}
                </Button>
              )}
            </Card>

            {/* 출석 보상 안내 */}
            <Card className="p-6 bg-mint-50 border-mint-200">
              <h4 className="font-bold text-mint-700 mb-3 flex items-center gap-2">
                <Gift className="w-5 h-5" />
                출석 보상
              </h4>
              <div className="space-y-2 text-sm text-mint-600">
                <div className="flex justify-between">
                  <span>• 1일 출석</span>
                  <span className="font-semibold">+10 포인트</span>
                </div>
                <div className="flex justify-between">
                  <span>• 7일 연속 출석</span>
                  <span className="font-semibold">+100 포인트 보너스</span>
                </div>
                <div className="flex justify-between">
                  <span>• 30일 연속 출석</span>
                  <span className="font-semibold">+500 포인트 보너스</span>
                </div>
              </div>
            </Card>
            
            {/* 배지 섹션 */}
            <div className="mt-6">
              <h3 className="text-xl font-bold mb-4">🏆 나의 배지</h3>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
              {badges && badges.length > 0 ? (
                badges.map((userBadge: any) => (
                  <Card key={userBadge.id} className="p-4 text-center">
                    <div className="text-4xl mb-2">{userBadge.badge.icon}</div>
                    <h4 className="font-bold text-sm mb-1">{userBadge.badge.name}</h4>
                    <p className="text-xs text-gray-600 mb-2">
                      {userBadge.badge.description}
                    </p>
                    <Badge className="text-xs bg-green-100 text-green-700">
                      획득 완료
                    </Badge>
                  </Card>
                ))
              ) : (
                <div className="col-span-full text-center py-12">
                  <Trophy className="w-16 h-16 text-gray-300 mx-auto mb-4" />
                  <p className="text-gray-500">아직 획득한 뱃지가 없어요</p>
                  <p className="text-sm text-gray-400 mt-2">
                    쿠폰을 사용하고 뱃지를 모아보세요!
                  </p>
                </div>
              )}

              {/* 잠긴 뱃지 예시 */}
              <Card className="p-4 text-center opacity-50">
                <div className="text-4xl mb-2 grayscale">🎯</div>
                <h4 className="font-bold text-sm mb-1">첫 쿠폰 사용</h4>
                <p className="text-xs text-gray-600 mb-2">
                  첫 쿠폰을 사용하세요
                </p>
                <Badge variant="secondary" className="text-xs">
                  미획득
                </Badge>
              </Card>

              <Card className="p-4 text-center opacity-50">
                <div className="text-4xl mb-2 grayscale">☕</div>
                <h4 className="font-bold text-sm mb-1">카페 마스터</h4>
                <p className="text-xs text-gray-600 mb-2">
                  카페 쿠폰 10개 사용
                </p>
                <Badge variant="secondary" className="text-xs">
                  미획득
                </Badge>
              </Card>

              <Card className="p-4 text-center opacity-50">
                <div className="text-4xl mb-2 grayscale">🏆</div>
                <h4 className="font-bold text-sm mb-1">쿠폰 헌터</h4>
                <p className="text-xs text-gray-600 mb-2">
                  쿠폰 50개 사용
                </p>
                <Badge variant="secondary" className="text-xs">
                  미획득
                </Badge>
              </Card>
              </div>
            </div>

            {/* 통계 섹션 */}
            <div className="mt-6">
              <h3 className="text-xl font-bold mb-4">📊 나의 통계</h3>
              <div className="grid gap-4">
              <Card className="p-6">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-12 h-12 bg-peach-100 rounded-full flex items-center justify-center">
                      <Gift className="w-6 h-6 text-peach-600" />
                    </div>
                    <div>
                      <p className="text-sm text-gray-600">다운로드한 쿠폰</p>
                      <p className="text-2xl font-bold">{stats?.totalCouponsDownloaded || 0}</p>
                    </div>
                  </div>
                </div>
              </Card>

              <Card className="p-6">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-12 h-12 bg-mint-100 rounded-full flex items-center justify-center">
                      <Zap className="w-6 h-6 text-mint-600" />
                    </div>
                    <div>
                      <p className="text-sm text-gray-600">사용한 쿠폰</p>
                      <p className="text-2xl font-bold">{stats?.totalCouponsUsed || 0}</p>
                    </div>
                  </div>
                </div>
              </Card>

              <Card className="p-6">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-12 h-12 bg-pink-100 rounded-full flex items-center justify-center">
                      <Users className="w-6 h-6 text-pink-600" />
                    </div>
                    <div>
                      <p className="text-sm text-gray-600">초대한 친구</p>
                      <p className="text-2xl font-bold">{stats?.totalReferrals || 0}</p>
                    </div>
                  </div>
                </div>
              </Card>

              {/* 친구 초대 */}
              <Card className="p-6 bg-gradient-to-br from-purple-50 to-pink-50 border-2 border-purple-200">
                <div className="text-center">
                  <Users className="w-12 h-12 text-purple-500 mx-auto mb-3" />
                  <h3 className="text-xl font-bold mb-2">친구 초대하고 포인트 받기!</h3>
                  <p className="text-sm text-gray-600 mb-4">
                    친구가 가입하면 둘 다 100 포인트를 받아요
                  </p>
                  <div className="bg-white rounded-lg p-3 mb-4">
                    <p className="text-xs text-gray-500 mb-1">내 추천 코드</p>
                    <p className="text-lg font-mono font-bold text-purple-600">
                      {stats?.referralCode || "LOADING..."}
                    </p>
                  </div>
                  <Button
                    variant="outline"
                    className="border-purple-400 text-purple-600 hover:bg-purple-50"
                    onClick={() => {
                      navigator.clipboard.writeText(stats?.referralCode || "");
                      toast.success("추천 코드가 복사되었습니다!");
                    }}
                  >
                    코드 복사하기
                  </Button>
                </div>
              </Card>
            </div>
            </div>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
