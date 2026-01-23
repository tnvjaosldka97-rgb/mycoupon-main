import { useAuth } from "@/_core/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft, Store, TrendingUp, DollarSign, Users } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { Link, useLocation } from "wouter";
import { getLoginUrl } from "@/const";

export default function MerchantDashboard() {
  const [, setLocation] = useLocation();
  const { user, loading } = useAuth();

  const { data: myStores, isLoading: storesLoading } = trpc.stores.myStores.useQuery(undefined, {
    enabled: !!user && (user.role === 'merchant' || user.role === 'admin'),
  });

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p className="text-gray-600">로딩 중...</p>
      </div>
    );
  }

  if (!user || (user.role !== 'merchant' && user.role !== 'admin')) {
    window.location.href = getLoginUrl();
    return null;
  }

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
        {/* Action Buttons */}
        <div className="mb-8 flex gap-4">
          <Button onClick={() => setLocation("/merchant/add-store")}>
            <Store className="mr-2 h-4 w-4" />
            가게 등록하기
          </Button>
          <Button
            variant="outline"
            className="border-peach-400 text-peach-600 hover:bg-peach-50"
            onClick={() => setLocation("/merchant/coupon-verify")}
          >
            쿠폰 검증하기
          </Button>
          <Button
            variant="outline"
            onClick={() => setLocation("/merchant/analytics")}
          >
            <TrendingUp className="mr-2 h-4 w-4" />
            통계 분석
          </Button>
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
              {myStores.map((store) => (
                <Link key={store.id} href={`/merchant/store/${store.id}`}>
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
                            <CardDescription className="mt-1">
                              <Badge variant={store.isActive ? "default" : "secondary"}>
                                {store.isActive ? "활성" : "비활성"}
                              </Badge>
                            </CardDescription>
                          </div>
                          <Badge variant="outline">{store.category}</Badge>
                        </div>
                      </CardHeader>
                      <CardContent>
                        <p className="text-sm text-gray-600 line-clamp-2">
                          {store.description || "설명 없음"}
                        </p>
                      </CardContent>
                    </Card>
                </Link>
              ))}
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
      </div>
    </div>
  );
}
