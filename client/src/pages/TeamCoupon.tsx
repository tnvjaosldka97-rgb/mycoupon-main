/**
 * 🔥 Team Coupon Page - 동네 3인 팟 쿠폰
 * "혼자 10% vs 3명 모여서 30%" → 당근마켓 바이럴 유도
 */

import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Users, Share2, Copy, Check, Clock, MapPin, Percent } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { useLocation } from "wouter";

export default function TeamCoupon() {
  const { user, loading } = useAuth();
  const [, setLocation] = useLocation();
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showJoinModal, setShowJoinModal] = useState(false);
  const [groupCode, setGroupCode] = useState("");
  const [copied, setCopied] = useState(false);

  // Mock data (나중에 tRPC로 교체)
  const myGroups = [
    {
      id: 1,
      groupCode: "TEAM-ABC123",
      couponTitle: "스타벅스 아메리카노",
      originalDiscount: 10,
      bonusDiscount: 20,
      currentMembers: 2,
      maxMembers: 3,
      district: "강남구",
      expiresAt: new Date(Date.now() + 3 * 60 * 60 * 1000), // 3시간 후
      status: "recruiting",
    },
  ];

  const availableCoupons = [
    {
      id: 1,
      title: "스타벅스 아메리카노 30% 할인",
      storeName: "스타벅스 역삼점",
      district: "강남구",
      originalDiscount: 10,
      bonusDiscount: 20,
      minMembers: 3,
    },
    {
      id: 2,
      title: "투썸플레이스 케이크 세트",
      storeName: "투썸플레이스 테헤란점",
      district: "강남구",
      originalDiscount: 15,
      bonusDiscount: 15,
      minMembers: 3,
    },
  ];

  const handleCopyLink = (code: string) => {
    const link = `${window.location.origin}/team-coupon?join=${code}`;
    navigator.clipboard.writeText(link);
    setCopied(true);
    toast.success("링크가 복사되었습니다! 친구에게 공유하세요.");
    setTimeout(() => setCopied(false), 2000);
  };

  const handleShareKakao = (code: string) => {
    toast.info("카카오톡 공유 기능은 준비 중입니다.");
  };

  const handleCreateGroup = (couponId: number) => {
    // TODO: tRPC mutation
    toast.success("팟이 생성되었습니다! 친구들을 초대하세요.");
    setShowCreateModal(false);
  };

  const handleJoinGroup = () => {
    if (!groupCode) {
      toast.error("초대 코드를 입력해주세요.");
      return;
    }
    // TODO: tRPC mutation
    toast.success("팟에 참여했습니다!");
    setShowJoinModal(false);
  };

  const getTimeRemaining = (expiresAt: Date) => {
    const now = Date.now();
    const diff = expiresAt.getTime() - now;
    const hours = Math.floor(diff / (1000 * 60 * 60));
    const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
    
    if (hours > 0) return `${hours}시간 ${minutes}분 남음`;
    return `${minutes}분 남음`;
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
                팀 쿠폰
              </h1>
              <p className="text-sm text-gray-600">3명 모으면 30% 할인!</p>
            </div>
            <Button
              onClick={() => setShowJoinModal(true)}
              className="rounded-xl bg-gradient-to-r from-orange-500 to-pink-500"
            >
              <Users className="w-4 h-4 mr-2" />
              팟 참여하기
            </Button>
          </div>
        </div>
      </header>

      <div className="container mx-auto px-4 py-6 space-y-6">
        {/* Hero Section */}
        <Card className="bg-gradient-to-br from-orange-100 to-pink-100 border-2 border-orange-200">
          <CardContent className="p-6">
            <div className="flex items-start gap-4">
              <div className="w-16 h-16 bg-white rounded-2xl flex items-center justify-center shadow-lg">
                <Users className="w-8 h-8 text-orange-500" />
              </div>
              <div className="flex-1">
                <h2 className="text-xl font-bold mb-2">동네 친구들과 함께하면 더 싸요!</h2>
                <p className="text-gray-700 text-sm mb-3">
                  같은 동네 사람 3명이 모이면 <strong className="text-orange-600">추가 20% 할인</strong>
                </p>
                <div className="flex items-center gap-2 text-xs text-gray-600">
                  <MapPin className="w-3 h-3" />
                  <span>우리 동네 한정 (강남구, 마포구 등)</span>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* 내 팟 목록 */}
        {myGroups.length > 0 && (
          <div>
            <h3 className="text-lg font-bold mb-3">내가 참여한 팟</h3>
            <div className="space-y-3">
              {myGroups.map((group) => (
                <Card key={group.id} className="border-2 border-orange-200">
                  <CardContent className="p-4">
                    <div className="flex items-start justify-between mb-3">
                      <div className="flex-1">
                        <h4 className="font-bold text-lg mb-1">{group.couponTitle}</h4>
                        <div className="flex items-center gap-2 text-sm text-gray-600 mb-2">
                          <MapPin className="w-3 h-3" />
                          <span>{group.district}</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <Badge className="bg-green-500 text-white">
                            {group.originalDiscount}% 기본 할인
                          </Badge>
                          <span className="text-lg font-bold text-orange-600">
                            + {group.bonusDiscount}% 팀 보너스
                          </span>
                        </div>
                      </div>
                      <div className="text-right">
                        <Badge 
                          variant={group.status === "full" ? "default" : "outline"}
                          className={group.status === "full" ? "bg-orange-500 text-white" : ""}
                        >
                          {group.currentMembers}/{group.maxMembers}명
                        </Badge>
                      </div>
                    </div>

                    {/* 타이머 */}
                    <div className="flex items-center gap-2 text-sm text-gray-600 mb-3">
                      <Clock className="w-4 h-4" />
                      <span>{getTimeRemaining(group.expiresAt)}</span>
                    </div>

                    {/* 초대 링크 */}
                    {group.status === "recruiting" && (
                      <div className="space-y-2">
                        <div className="bg-gray-100 rounded-lg p-3 flex items-center justify-between">
                          <code className="text-sm font-mono">{group.groupCode}</code>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => handleCopyLink(group.groupCode)}
                          >
                            {copied ? (
                              <Check className="w-4 h-4 text-green-500" />
                            ) : (
                              <Copy className="w-4 h-4" />
                            )}
                          </Button>
                        </div>
                        <div className="flex gap-2">
                          <Button
                            size="sm"
                            variant="outline"
                            className="flex-1"
                            onClick={() => handleCopyLink(group.groupCode)}
                          >
                            <Copy className="w-3 h-3 mr-1" />
                            링크 복사
                          </Button>
                          <Button
                            size="sm"
                            className="flex-1 bg-yellow-400 hover:bg-yellow-500 text-black"
                            onClick={() => handleShareKakao(group.groupCode)}
                          >
                            <Share2 className="w-3 h-3 mr-1" />
                            카톡 공유
                          </Button>
                        </div>
                      </div>
                    )}

                    {group.status === "full" && (
                      <div className="bg-green-50 border-2 border-green-200 rounded-lg p-3 text-center">
                        <p className="text-green-700 font-bold">
                          ✅ 인원 모집 완료! 쿠폰을 다운로드하세요
                        </p>
                        <Button
                          className="mt-2 w-full bg-green-500 hover:bg-green-600"
                        >
                          쿠폰 다운로드
                        </Button>
                      </div>
                    )}
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        )}

        {/* 이용 가능한 팀 쿠폰 */}
        <div>
          <h3 className="text-lg font-bold mb-3">팀 쿠폰 만들기</h3>
          <p className="text-sm text-gray-600 mb-4">
            친구들과 함께 받으면 더 큰 할인 혜택!
          </p>
          <div className="grid gap-4">
            {availableCoupons.map((coupon) => (
              <Card key={coupon.id} className="border-2 hover:border-orange-300 transition-colors">
                <CardContent className="p-4">
                  <div className="flex items-start justify-between mb-3">
                    <div className="flex-1">
                      <h4 className="font-bold mb-1">{coupon.title}</h4>
                      <p className="text-sm text-gray-600 mb-2">{coupon.storeName}</p>
                      <div className="flex items-center gap-2 text-xs text-gray-500">
                        <MapPin className="w-3 h-3" />
                        <span>{coupon.district}</span>
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 mb-3">
                    <Badge variant="outline" className="bg-gray-100">
                      혼자: {coupon.originalDiscount}%
                    </Badge>
                    <span className="text-gray-400">→</span>
                    <Badge className="bg-gradient-to-r from-orange-500 to-pink-500 text-white">
                      {coupon.minMembers}명: {coupon.originalDiscount + coupon.bonusDiscount}%
                    </Badge>
                  </div>

                  <Button
                    className="w-full bg-gradient-to-r from-orange-500 to-pink-500"
                    onClick={() => handleCreateGroup(coupon.id)}
                  >
                    <Users className="w-4 h-4 mr-2" />
                    팟 만들기 (친구 초대)
                  </Button>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>

        {/* 사용 방법 */}
        <Card className="bg-blue-50 border-2 border-blue-200">
          <CardHeader>
            <CardTitle className="text-lg">팀 쿠폰 사용 방법</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div className="flex items-start gap-3">
              <div className="w-6 h-6 bg-blue-500 text-white rounded-full flex items-center justify-center font-bold flex-shrink-0">
                1
              </div>
              <p>원하는 쿠폰으로 <strong>팟 만들기</strong></p>
            </div>
            <div className="flex items-start gap-3">
              <div className="w-6 h-6 bg-blue-500 text-white rounded-full flex items-center justify-center font-bold flex-shrink-0">
                2
              </div>
              <p>초대 링크를 <strong>친구/동네 카페에 공유</strong></p>
            </div>
            <div className="flex items-start gap-3">
              <div className="w-6 h-6 bg-blue-500 text-white rounded-full flex items-center justify-center font-bold flex-shrink-0">
                3
              </div>
              <p>3명 모이면 <strong>30% 할인 쿠폰 자동 발급!</strong></p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* 팟 참여 모달 */}
      <Dialog open={showJoinModal} onOpenChange={setShowJoinModal}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>팟 참여하기</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <label className="text-sm font-medium mb-2 block">초대 코드 입력</label>
              <Input
                placeholder="TEAM-ABC123"
                value={groupCode}
                onChange={(e) => setGroupCode(e.target.value.toUpperCase())}
                className="text-center font-mono text-lg"
              />
            </div>
            <Button
              className="w-full bg-gradient-to-r from-orange-500 to-pink-500"
              onClick={handleJoinGroup}
            >
              참여하기
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
