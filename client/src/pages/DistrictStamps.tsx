/**
 * 🗺️ District Stamps Page - 동네 도장판
 * Real data from tRPC API + GPS-based filtering
 */

import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { MapPin, Gift, Star, Trophy, CheckCircle, Circle, ArrowLeft } from "lucide-react";
import { useState, useEffect } from "react";
import { toast } from "sonner";
import { useLocation } from "wouter";
import { trpc } from "@/lib/trpc";

export default function DistrictStamps() {
  const { user, loading } = useAuth();
  const [, setLocation] = useLocation();
  const [selectedBoardId, setSelectedBoardId] = useState<number | null>(null);
  const [userLocation, setUserLocation] = useState<{ lat: number; lng: number } | null>(null);

  // Get user's location
  useEffect(() => {
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          setUserLocation({
            lat: position.coords.latitude,
            lng: position.coords.longitude,
          });
          console.log('[Geolocation] 위치 정보 가져오기 성공:', {
            lat: position.coords.latitude,
            lng: position.coords.longitude,
          });
        },
        (error) => {
          console.error('[Geolocation] 위치 정보 가져오기 실패:', error);
        }
      );
    }
  }, []);

  // Fetch stamp boards
  const { data: boards, isLoading: boardsLoading } = trpc.districtStamps.list.useQuery();
  const { data: allProgress } = trpc.districtStamps.myAllProgress.useQuery(undefined, {
    enabled: !!user,
  });

  // Select first board by default
  useEffect(() => {
    if (boards && boards.length > 0 && !selectedBoardId) {
      setSelectedBoardId(boards[0].id);
    }
  }, [boards, selectedBoardId]);

  // Fetch selected board details
  const { data: boardDetails, refetch: refetchBoard } = trpc.districtStamps.getBoard.useQuery(
    { boardId: selectedBoardId! },
    { enabled: !!selectedBoardId }
  );

  // Fetch user's progress for selected board
  const { data: myProgress, refetch: refetchProgress } = trpc.districtStamps.myProgress.useQuery(
    { boardId: selectedBoardId! },
    { enabled: !!selectedBoardId && !!user }
  );

  // Claim reward mutation
  const claimReward = trpc.districtStamps.claimReward.useMutation({
    onSuccess: () => {
      toast.success("축하합니다! 보상 쿠폰이 발급되었습니다.");
      refetchProgress();
      setLocation("/my-coupons");
    },
    onError: (error) => {
      toast.error(error.message);
    },
  });

  const handleClaimReward = () => {
    if (selectedBoardId) {
      claimReward.mutate({ boardId: selectedBoardId });
    }
  };

  if (loading || boardsLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="w-12 h-12 border-4 border-orange-300 border-t-orange-600 rounded-full animate-spin"></div>
      </div>
    );
  }

  if (!user) {
    setLocation("/");
    return null;
  }

  if (!boards || boards.length === 0) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-orange-50 to-pink-50 flex items-center justify-center">
        <Card className="max-w-md">
          <CardContent className="p-8 text-center">
            <Trophy className="w-16 h-16 text-gray-400 mx-auto mb-4" />
            <h3 className="text-xl font-bold mb-2">도장판이 없습니다</h3>
            <p className="text-gray-600">
              관리자가 도장판을 생성하면 여기에 표시됩니다.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const currentBoard = boardDetails;
  const progress = myProgress;

  return (
    <div className="min-h-screen bg-gradient-to-br from-orange-50 via-pink-50 to-purple-50 pb-20">
      {/* Header */}
      <header className="bg-white/80 backdrop-blur-md border-b sticky top-0 z-50">
        <div className="container mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Button variant="ghost" size="icon" onClick={() => setLocation("/")}>
                <ArrowLeft className="w-5 h-5" />
              </Button>
              <div>
                <h1 className="text-2xl font-bold bg-gradient-to-r from-orange-500 to-pink-500 bg-clip-text text-transparent">
                  동네 도장판
                </h1>
                <p className="text-sm text-gray-600">10개 모으면 특별 쿠폰 획득!</p>
              </div>
            </div>
            {progress && (
              <Badge className="bg-gradient-to-r from-orange-500 to-pink-500 text-white">
                <Trophy className="w-3 h-3 mr-1" />
                {progress.collectedStamps}/{currentBoard?.requiredStamps || 10}
              </Badge>
            )}
          </div>
        </div>
      </header>

      <div className="container mx-auto px-4 py-6 space-y-6">
        {/* 도장판 선택 탭 */}
        {boards.length > 1 && (
          <div className="flex gap-2 overflow-x-auto pb-2">
            {boards.map((board) => {
              const boardProgress = allProgress?.find((p) => p.boardId === board.id);
              return (
                <Button
                  key={board.id}
                  variant={selectedBoardId === board.id ? "default" : "outline"}
                  onClick={() => setSelectedBoardId(board.id)}
                  className="whitespace-nowrap"
                >
                  <MapPin className="w-4 h-4 mr-1" />
                  {board.district}
                  {boardProgress && (
                    <Badge variant="secondary" className="ml-2">
                      {boardProgress.collectedStamps}/{board.requiredStamps}
                    </Badge>
                  )}
                </Button>
              );
            })}
          </div>
        )}

        {/* Hero - 현재 진행 중인 도장판 */}
        {currentBoard && progress && (
          <Card className="bg-gradient-to-br from-orange-100 to-pink-100 border-2 border-orange-200">
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle className="text-xl">
                  {currentBoard.district} 도장판
                </CardTitle>
                <Badge className="text-lg font-bold">
                  {progress.collectedStamps}/{currentBoard.requiredStamps}
                </Badge>
              </div>
              <p className="text-sm text-gray-600">{currentBoard.description}</p>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Progress Bar */}
              <div>
                <Progress 
                  value={(progress.collectedStamps / currentBoard.requiredStamps) * 100} 
                  className="h-3"
                />
                <p className="text-sm text-gray-600 mt-2">
                  {currentBoard.requiredStamps - progress.collectedStamps}개만 더 모으면{' '}
                  <strong className="text-orange-600">{currentBoard.rewardDescription}</strong> 획득!
                </p>
              </div>

              {/* 도장판 그리드 */}
              <div className="grid grid-cols-5 gap-3">
                {currentBoard.slots?.map((slot: any, index: number) => {
                  const isStamped = progress.stamps?.some((s: any) => s.slotId === slot.id);
                  const isSponsor = index === 9; // 10번째 칸은 스폰서

                  return (
                    <div key={slot.id} className="text-center">
                      {isSponsor ? (
                        // 스폰서 칸 (10번째)
                        <div className="relative group">
                          <div className={`
                            w-full aspect-square rounded-xl flex items-center justify-center
                            ${isStamped 
                              ? 'bg-gradient-to-br from-yellow-400 to-orange-500 shadow-lg' 
                              : 'bg-gradient-to-br from-gray-200 to-gray-300 border-2 border-dashed border-yellow-500'
                            }
                          `}>
                            {isStamped ? (
                              <Star className="w-8 h-8 text-white" />
                            ) : (
                              <Gift className="w-8 h-8 text-gray-400" />
                            )}
                          </div>
                          <Badge className="absolute -top-2 -right-2 bg-yellow-500 text-white text-xs">
                            💎
                          </Badge>
                        </div>
                      ) : (
                        // 일반 칸
                        <div className={`
                          w-full aspect-square rounded-xl flex items-center justify-center transition-all
                          ${isStamped 
                            ? 'bg-gradient-to-br from-orange-400 to-pink-500 shadow-lg' 
                            : 'bg-white border-2 border-gray-300'
                          }
                        `}>
                          {isStamped ? (
                            <CheckCircle className="w-8 h-8 text-white" />
                          ) : (
                            <Circle className="w-8 h-8 text-gray-300" />
                          )}
                        </div>
                      )}
                      <p className="text-xs text-gray-600 mt-1 truncate">
                        {slot.storeName?.replace(/\s.+$/, '') || '매장'}
                      </p>
                    </div>
                  );
                })}
              </div>

              {/* 완성 보상 */}
              {progress.isCompleted && !progress.rewardClaimed ? (
                <div className="bg-gradient-to-r from-green-100 to-emerald-100 border-2 border-green-300 rounded-xl p-4 text-center">
                  <Trophy className="w-12 h-12 text-green-600 mx-auto mb-2" />
                  <h3 className="text-xl font-bold text-green-700 mb-2">
                    🎉 도장판 완성!
                  </h3>
                  <p className="text-sm text-gray-700 mb-3">
                    {currentBoard.rewardDescription} 획득
                  </p>
                  <Button
                    size="lg"
                    className="bg-green-500 hover:bg-green-600"
                    onClick={handleClaimReward}
                    disabled={claimReward.isPending}
                  >
                    {claimReward.isPending ? "처리 중..." : "보상 받기"}
                  </Button>
                </div>
              ) : progress.rewardClaimed ? (
                <div className="bg-gradient-to-r from-blue-100 to-indigo-100 border-2 border-blue-300 rounded-xl p-4 text-center">
                  <CheckCircle className="w-12 h-12 text-blue-600 mx-auto mb-2" />
                  <h3 className="text-lg font-bold text-blue-700">
                    보상 수령 완료
                  </h3>
                  <p className="text-sm text-gray-700">
                    {new Date(progress.rewardClaimedAt).toLocaleDateString('ko-KR')}
                  </p>
                </div>
              ) : (
                <div className="bg-white/80 rounded-xl p-4 text-center">
                  <p className="text-sm text-gray-600">
                    {currentBoard.district}의 다양한 매장을 방문하고 쿠폰을 사용하면 도장을 받아요!
                  </p>
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {/* 다른 동네 도장판 */}
        <div>
          <h3 className="text-lg font-bold mb-3">다른 동네 도장판</h3>
          <div className="grid gap-3">
            {boards
              .filter((board) => board.id !== selectedBoardId)
              .map((board) => {
                const boardProgress = allProgress?.find((p) => p.boardId === board.id);
                const progressPercent = boardProgress
                  ? (boardProgress.collectedStamps / board.requiredStamps) * 100
                  : 0;

                return (
                  <Card
                    key={board.id}
                    className="hover:border-orange-300 transition-colors cursor-pointer"
                    onClick={() => setSelectedBoardId(board.id)}
                  >
                    <CardContent className="p-4">
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-2">
                          <MapPin className="w-5 h-5 text-orange-500" />
                          <h4 className="font-bold">{board.district}</h4>
                        </div>
                        <Badge variant="outline">
                          {Math.round(progressPercent)}%
                        </Badge>
                      </div>
                      <Progress value={progressPercent} className="h-2 mb-2" />
                      <p className="text-xs text-gray-600">
                        {boardProgress?.collectedStamps || 0}/{board.requiredStamps} 수집 중
                      </p>
                    </CardContent>
                  </Card>
                );
              })}
          </div>
        </div>

        {/* 광고주 안내 배너 */}
        <Card className="bg-gradient-to-r from-purple-100 to-pink-100 border-2 border-purple-200">
          <CardContent className="p-6 text-center">
            <Gift className="w-12 h-12 text-purple-600 mx-auto mb-3" />
            <h3 className="text-lg font-bold mb-2">사장님, 도장판에 입점하세요!</h3>
            <p className="text-sm text-gray-700 mb-4">
              우리 동네 활성 유저에게 자동으로 쿠폰이 노출됩니다.
            </p>
            <Button
              variant="outline"
              className="border-purple-500 text-purple-600 hover:bg-purple-50"
              onClick={() => setLocation("/merchant/dashboard")}
            >
              광고 문의하기
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
