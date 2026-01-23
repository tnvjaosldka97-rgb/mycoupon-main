import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { MapPin, Trophy, Store, TrendingUp } from "lucide-react";
import { toast } from "@/components/ui/sonner";

export function NearbyStoreRanking() {
  const [latitude, setLatitude] = useState<number>(37.5665); // 서울시청 기본값
  const [longitude, setLongitude] = useState<number>(126.9780);
  const [radius, setRadius] = useState<number>(100);
  const [searchParams, setSearchParams] = useState<{ latitude: number; longitude: number; radius: number } | null>(null);

  const { data: ranking, isLoading } = trpc.analytics.nearbyStoreRanking.useQuery(
    searchParams!,
    { enabled: !!searchParams }
  );

  const handleSearch = () => {
    if (!latitude || !longitude) {
      toast.error("위도와 경도를 입력해주세요");
      return;
    }
    setSearchParams({ latitude, longitude, radius });
  };

  const handleCurrentLocation = () => {
    if (!navigator.geolocation) {
      toast.error("브라우저가 위치 정보를 지원하지 않습니다");
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (position) => {
        setLatitude(position.coords.latitude);
        setLongitude(position.coords.longitude);
        toast.success("현재 위치를 가져왔습니다");
      },
      (error) => {
        toast.error("위치 정보를 가져올 수 없습니다");
        console.error(error);
      }
    );
  };

  return (
    <div className="space-y-6">
      {/* 검색 입력 */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <MapPin className="w-5 h-5 text-pink-500" />
            위치 기반 업장 랭킹 검색
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div className="space-y-2">
              <Label htmlFor="latitude">위도</Label>
              <Input
                id="latitude"
                type="number"
                step="0.0001"
                value={latitude}
                onChange={(e) => setLatitude(Number(e.target.value))}
                placeholder="37.5665"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="longitude">경도</Label>
              <Input
                id="longitude"
                type="number"
                step="0.0001"
                value={longitude}
                onChange={(e) => setLongitude(Number(e.target.value))}
                placeholder="126.9780"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="radius">반경 (m)</Label>
              <Input
                id="radius"
                type="number"
                value={radius}
                onChange={(e) => setRadius(Number(e.target.value))}
                placeholder="100"
              />
            </div>
            <div className="space-y-2">
              <Label className="invisible">검색</Label>
              <div className="flex gap-2">
                <Button onClick={handleCurrentLocation} variant="outline" className="flex-1">
                  <MapPin className="w-4 h-4 mr-2" />
                  현재 위치
                </Button>
                <Button onClick={handleSearch} className="flex-1">
                  검색
                </Button>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* 랭킹 결과 */}
      {isLoading && (
        <div className="text-center py-12">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-pink-500 mx-auto mb-4"></div>
          <p className="text-muted-foreground">검색 중...</p>
        </div>
      )}

      {ranking && ranking.length === 0 && (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            <Store className="w-12 h-12 mx-auto mb-4 opacity-30" />
            <p>해당 반경 내에 업장이 없습니다.</p>
          </CardContent>
        </Card>
      )}

      {ranking && ranking.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Trophy className="w-5 h-5 text-yellow-500" />
              {radius}m 반경 내 업장 랭킹 (쿠폰 발행량 기준)
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {ranking.map((store: any, index: number) => (
                <div
                  key={store.id}
                  className="flex items-center justify-between p-4 bg-gradient-to-r from-peach-50 to-mint-50 rounded-lg hover:shadow-md transition-shadow"
                >
                  <div className="flex items-center gap-4">
                    <Badge
                      variant={index < 3 ? "default" : "secondary"}
                      className={`w-10 h-10 flex items-center justify-center text-lg ${
                        index === 0 ? "bg-yellow-500" : index === 1 ? "bg-gray-400" : index === 2 ? "bg-orange-600" : ""
                      }`}
                    >
                      {index + 1}
                    </Badge>
                    <div>
                      <div className="font-semibold text-lg">{store.name}</div>
                      <div className="text-sm text-muted-foreground">{store.category} · {store.address}</div>
                      <div className="text-xs text-muted-foreground mt-1">
                        <MapPin className="w-3 h-3 inline mr-1" />
                        {Math.round(store.distance)}m 거리
                      </div>
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="flex items-center gap-2 text-pink-600 font-bold text-xl">
                      <TrendingUp className="w-5 h-5" />
                      {store.totalIssued || 0}개
                    </div>
                    <div className="text-xs text-muted-foreground">쿠폰 발행량</div>
                    <div className="text-xs text-muted-foreground mt-1">
                      총 {store.totalCoupons || 0}종 쿠폰
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
