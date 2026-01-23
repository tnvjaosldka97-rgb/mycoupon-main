import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Gift, TrendingUp, Trophy, Star, CheckCircle2, Clock } from "lucide-react";
import { useAuth } from "@/_core/hooks/useAuth";
import { getLoginUrl } from "@/const";

export default function Rewards() {
  const { user } = useAuth();
  const { data: stats } = trpc.gamification.myStats.useQuery(undefined, {
    enabled: !!user,
  });
  const { data: missions } = trpc.gamification.myMissions.useQuery(undefined, {
    enabled: !!user,
  });
  const { data: pointHistory } = trpc.gamification.pointHistory.useQuery(
    { limit: 20 },
    { enabled: !!user }
  );
  const { data: leaderboard } = trpc.gamification.leaderboard.useQuery({ limit: 10 });

  const checkInMutation = trpc.gamification.checkIn.useMutation({
    onSuccess: () => {
      alert("출석 체크 완료! 포인트를 받았어요 🎉");
      window.location.reload();
    },
    onError: (error) => {
      alert(error.message);
    },
  });

  if (!user) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-orange-50 via-pink-50 to-purple-50 flex items-center justify-center p-4">
        <Card className="max-w-md w-full">
          <CardContent className="pt-6 text-center space-y-4">
            <Gift className="w-16 h-16 mx-auto text-primary" />
            <h2 className="text-2xl font-bold">로그인이 필요해요</h2>
            <p className="text-muted-foreground">
              포인트와 미션 기능을 사용하려면 로그인해주세요
            </p>
            <Button asChild className="w-full">
              <a href={getLoginUrl()}>로그인하기</a>
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const levelNames = ["브론즈", "실버", "골드", "플래티넘"];
  const levelName = levelNames[(stats?.level || 1) - 1] || "브론즈";

  return (
    <div className="min-h-screen bg-gradient-to-br from-orange-50 via-pink-50 to-purple-50 py-8 px-4">
      <div className="container max-w-6xl mx-auto space-y-8">
        {/* 헤더 */}
        <div className="text-center space-y-2">
          <h1 className="text-4xl font-bold bg-gradient-to-r from-orange-500 to-pink-500 bg-clip-text text-transparent">
            리워드 센터
          </h1>
          <p className="text-muted-foreground">쿠폰을 사용하고 포인트를 모아보세요!</p>
        </div>

        {/* 내 포인트 & 레벨 */}
        <div className="grid md:grid-cols-3 gap-4">
          <Card className="md:col-span-2">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Trophy className="w-5 h-5 text-yellow-500" />
                내 포인트 & 레벨
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">현재 포인트</p>
                  <p className="text-4xl font-bold text-primary">{stats?.points || 0}P</p>
                </div>
                <Badge variant="secondary" className="text-lg px-4 py-2">
                  {levelName} Lv.{stats?.level || 1}
                </Badge>
              </div>
              <div className="space-y-2">
                <div className="flex justify-between text-sm">
                  <span>다음 레벨까지</span>
                  <span className="font-medium">
                    {stats?.points || 0} / {((stats?.level || 1) * 1000)}P
                  </span>
                </div>
                <Progress value={((stats?.points || 0) / ((stats?.level || 1) * 1000)) * 100} />
              </div>
              <div className="grid grid-cols-3 gap-4 pt-4 border-t">
                <div className="text-center">
                  <p className="text-2xl font-bold text-primary">{stats?.totalCouponsUsed || 0}</p>
                  <p className="text-xs text-muted-foreground">사용한 쿠폰</p>
                </div>
                <div className="text-center">
                  <p className="text-2xl font-bold text-primary">{stats?.totalCheckIns || 0}</p>
                  <p className="text-xs text-muted-foreground">총 출석일</p>
                </div>
                <div className="text-center">
                  <p className="text-2xl font-bold text-primary">{stats?.consecutiveCheckIns || 0}</p>
                  <p className="text-xs text-muted-foreground">연속 출석</p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <CheckCircle2 className="w-5 h-5 text-green-500" />
                출석 체크
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="text-center space-y-2">
                <p className="text-sm text-muted-foreground">연속 출석</p>
                <p className="text-3xl font-bold">{stats?.consecutiveCheckIns || 0}일</p>
              </div>
              <Button
                className="w-full"
                onClick={() => checkInMutation.mutate()}
                disabled={checkInMutation.isPending}
              >
                {checkInMutation.isPending ? "처리 중..." : "오늘 출석하기"}
              </Button>
              <p className="text-xs text-center text-muted-foreground">
                매일 출석하면 10P 지급!<br />
                7일 연속 +100P, 30일 연속 +500P
              </p>
            </CardContent>
          </Card>
        </div>

        {/* 일일 미션 */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Star className="w-5 h-5 text-yellow-500" />
              일일 미션
            </CardTitle>
          </CardHeader>
          <CardContent>
            {missions && missions.length > 0 ? (
              <div className="space-y-4">
                {missions.map((mission: any) => (
                  <div key={mission.id} className="flex items-center gap-4 p-4 border rounded-lg">
                    <div className="flex-1 space-y-2">
                      <div className="flex items-center justify-between">
                        <h3 className="font-semibold">오늘 쿠폰 3개 사용하기</h3>
                        <Badge variant={mission.isCompleted ? "default" : "secondary"}>
                          {mission.isCompleted ? "완료" : `${mission.progress}/3`}
                        </Badge>
                      </div>
                      <Progress value={(mission.progress / 3) * 100} />
                      <p className="text-sm text-muted-foreground">보상: 50P</p>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-center text-muted-foreground py-8">
                아직 미션이 없어요. 곧 추가될 예정입니다!
              </p>
            )}
          </CardContent>
        </Card>

        {/* 포인트 내역 */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <TrendingUp className="w-5 h-5 text-green-500" />
              포인트 내역
            </CardTitle>
          </CardHeader>
          <CardContent>
            {pointHistory && pointHistory.length > 0 ? (
              <div className="space-y-2">
                {pointHistory.map((transaction: any) => (
                  <div
                    key={transaction.id}
                    className="flex items-center justify-between p-3 border-b last:border-0"
                  >
                    <div className="flex items-center gap-3">
                      <Clock className="w-4 h-4 text-muted-foreground" />
                      <div>
                        <p className="font-medium">{transaction.description}</p>
                        <p className="text-xs text-muted-foreground">
                          {new Date(transaction.createdAt).toLocaleDateString()}
                        </p>
                      </div>
                    </div>
                    <span
                      className={`font-bold ${
                        transaction.amount > 0 ? "text-green-600" : "text-red-600"
                      }`}
                    >
                      {transaction.amount > 0 ? "+" : ""}
                      {transaction.amount}P
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-center text-muted-foreground py-8">
                아직 포인트 내역이 없어요
              </p>
            )}
          </CardContent>
        </Card>

        {/* 리더보드 */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Trophy className="w-5 h-5 text-yellow-500" />
              쿠폰왕 랭킹
            </CardTitle>
          </CardHeader>
          <CardContent>
            {leaderboard && leaderboard.length > 0 ? (
              <div className="space-y-2">
                {leaderboard.map((entry: any, index: number) => (
                  <div
                    key={entry.userId}
                    className="flex items-center gap-4 p-3 border-b last:border-0"
                  >
                    <div
                      className={`w-8 h-8 rounded-full flex items-center justify-center font-bold ${
                        index === 0
                          ? "bg-yellow-500 text-white"
                          : index === 1
                          ? "bg-gray-400 text-white"
                          : index === 2
                          ? "bg-orange-600 text-white"
                          : "bg-gray-200"
                      }`}
                    >
                      {index + 1}
                    </div>
                    <div className="flex-1">
                      <p className="font-semibold">{entry.userName}</p>
                      <p className="text-sm text-muted-foreground">
                        Lv.{entry.level} · 쿠폰 {entry.totalCouponsUsed}개 사용
                      </p>
                    </div>
                    <span className="font-bold text-primary">{entry.points}P</span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-center text-muted-foreground py-8">
                아직 랭킹 정보가 없어요
              </p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
