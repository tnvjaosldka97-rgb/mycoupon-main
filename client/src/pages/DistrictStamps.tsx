/**
 * 🗺️ District Stamps Page - 동네 도장판
 * "강남구 도장 10개 모으면 스타벅스 쿠폰" → 마지막 칸은 광고주가 구매
 */

import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { MapPin, Gift, Star, Trophy, CheckCircle, Circle } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { useLocation } from "wouter";

export default function DistrictStamps() {
  const { user, loading } = useAuth();
  const [, setLocation] = useLocation();

  // Mock data (나중에 tRPC로 교체)
  const myStamps = {
    gangnam: {
      district: "강남구",
      stampCount: 7,
      maxStamps: 10,
      stores: [
        { id: 1, name: "스타벅스 역삼점", stamped: true },
        { id: 2, name: "투썸플레이스 테헤란점", stamped: true },
        { id: 3, name: "이디야커피 강남점", stamped: true },
        { id: 4, name: "메가커피 역삼점", stamped: true },
        { id: 5, name: "빽다방 테헤란점", stamped: true },
        { id: 6, name: "할리스커피 강남점", stamped: true },
        { id: 7, name: "커피빈 역삼점", stamped: true },
        { id: 8, name: "엔제리너스 강남점", stamped: false },
        { id: 9, name: "파스쿠찌 역삼점", stamped: false },
        { id: 10, name: "🎁 스폰서 칸 (광고주)", stamped: false, isSponsor: true },
      ],
      rewardCoupon: "스타벅스 아메리카노 무료",
      sponsorStore: "스타벅스 강남역점",
      sponsorCoupon: "아이스 아메리카노 톨 사이즈 무료",
    },
  };

  const availableDistricts = [
    { name: "강남구", progress: 70, stores: 8 },
    { name: "마포구", progress: 30, stores: 8 },
    { name: "성동구", progress: 0, stores: 8 },
  ];

  const handleClaimReward = () => {
    toast.success("축하합니다! 보상 쿠폰이 발급되었습니다.");
    setLocation("/my-coupons");
  };

  if (loading) {
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

  return (
    <div className="min-h-screen bg-gradient-to-br from-orange-50 via-pink-50 to-purple-50 pb-20">
      {/* Header */}
      <header className="bg-white/80 backdrop-blur-md border-b sticky top-0 z-50">
        <div className="container mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold bg-gradient-to-r from-orange-500 to-pink-500 bg-clip-text text-transparent">
                동네 도장판
              </h1>
              <p className="text-sm text-gray-600">10개 모으면 특별 쿠폰 획득!</p>
            </div>
            <Badge className="bg-gradient-to-r from-orange-500 to-pink-500 text-white">
              <Trophy className="w-3 h-3 mr-1" />
              레벨 {Math.floor(myStamps.gangnam.stampCount / 3) + 1}
            </Badge>
          </div>
        </div>
      </header>

      <div className="container mx-auto px-4 py-6 space-y-6">
        {/* Hero - 현재 진행 중인 도장판 */}
        <Card className="bg-gradient-to-br from-orange-100 to-pink-100 border-2 border-orange-200">
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="text-xl">
                {myStamps.gangnam.district} 도장판
              </CardTitle>
              <Badge className="text-lg font-bold">
                {myStamps.gangnam.stampCount}/{myStamps.gangnam.maxStamps}
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Progress Bar */}
            <div>
              <Progress 
                value={(myStamps.gangnam.stampCount / myStamps.gangnam.maxStamps) * 100} 
                className="h-3"
              />
              <p className="text-sm text-gray-600 mt-2">
                {myStamps.gangnam.maxStamps - myStamps.gangnam.stampCount}개만 더 모으면 <strong className="text-orange-600">{myStamps.gangnam.rewardCoupon}</strong> 획득!
              </p>
            </div>

            {/* 도장판 그리드 */}
            <div className="grid grid-cols-5 gap-3">
              {myStamps.gangnam.stores.map((store, index) => (
                <div key={store.id} className="text-center">
                  {store.isSponsor ? (
                    // 스폰서 칸 (10번째)
                    <div className="relative group">
                      <div className={`
                        w-full aspect-square rounded-xl flex items-center justify-center
                        ${store.stamped 
                          ? 'bg-gradient-to-br from-yellow-400 to-orange-500 shadow-lg' 
                          : 'bg-gradient-to-br from-gray-200 to-gray-300 border-2 border-dashed border-yellow-500'
                        }
                      `}>
                        {store.stamped ? (
                          <Star className="w-8 h-8 text-white" />
                        ) : (
                          <Gift className="w-8 h-8 text-gray-400" />
                        )}
                      </div>
                      <Badge className="absolute -top-2 -right-2 bg-yellow-500 text-white text-xs">
                        💎
                      </Badge>
                      {/* 호버 시 스폰서 정보 */}
                      <div className="absolute top-full left-1/2 -translate-x-1/2 mt-2 px-3 py-2 bg-gray-900 text-white text-xs rounded-lg opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none whitespace-nowrap z-50">
                        <p className="font-bold">스폰서: {myStamps.gangnam.sponsorStore}</p>
                        <p>{myStamps.gangnam.sponsorCoupon}</p>
                        <div className="absolute -top-1 left-1/2 -translate-x-1/2 w-2 h-2 bg-gray-900 rotate-45"></div>
                      </div>
                    </div>
                  ) : (
                    // 일반 칸
                    <div className={`
                      w-full aspect-square rounded-xl flex items-center justify-center transition-all
                      ${store.stamped 
                        ? 'bg-gradient-to-br from-orange-400 to-pink-500 shadow-lg' 
                        : 'bg-white border-2 border-gray-300'
                      }
                    `}>
                      {store.stamped ? (
                        <CheckCircle className="w-8 h-8 text-white" />
                      ) : (
                        <Circle className="w-8 h-8 text-gray-300" />
                      )}
                    </div>
                  )}
                  <p className="text-xs text-gray-600 mt-1 truncate">
                    {store.name.replace(/\s.+$/, '')}
                  </p>
                </div>
              ))}
            </div>

            {/* 완성 보상 */}
            {myStamps.gangnam.stampCount >= myStamps.gangnam.maxStamps ? (
              <div className="bg-gradient-to-r from-green-100 to-emerald-100 border-2 border-green-300 rounded-xl p-4 text-center">
                <Trophy className="w-12 h-12 text-green-600 mx-auto mb-2" />
                <h3 className="text-xl font-bold text-green-700 mb-2">
                  🎉 도장판 완성!
                </h3>
                <p className="text-sm text-gray-700 mb-3">
                  {myStamps.gangnam.rewardCoupon} 획득
                </p>
                <Button
                  size="lg"
                  className="bg-green-500 hover:bg-green-600"
                  onClick={handleClaimReward}
                >
                  보상 받기
                </Button>
              </div>
            ) : (
              <div className="bg-white/80 rounded-xl p-4 text-center">
                <p className="text-sm text-gray-600">
                  {myStamps.gangnam.district}의 다양한 매장을 방문하고 쿠폰을 사용하면 도장을 받아요!
                </p>
              </div>
            )}
          </CardContent>
        </Card>

        {/* 다른 동네 도장판 */}
        <div>
          <h3 className="text-lg font-bold mb-3">다른 동네 도장판</h3>
          <div className="grid gap-3">
            {availableDistricts.map((district) => (
              <Card key={district.name} className="hover:border-orange-300 transition-colors cursor-pointer">
                <CardContent className="p-4">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <MapPin className="w-5 h-5 text-orange-500" />
                      <h4 className="font-bold">{district.name}</h4>
                    </div>
                    <Badge variant="outline">
                      {district.progress}%
                    </Badge>
                  </div>
                  <Progress value={district.progress} className="h-2 mb-2" />
                  <p className="text-xs text-gray-600">
                    {district.stores}개 매장 참여 중
                  </p>
                </CardContent>
              </Card>
            ))}
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
            >
              광고 문의하기
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
