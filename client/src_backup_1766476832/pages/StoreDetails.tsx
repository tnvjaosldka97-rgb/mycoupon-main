import { useState } from "react";
import { useParams, useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ArrowLeft, Download, CheckCircle, Clock, TrendingUp, DollarSign, Users, Percent, Calculator, Trophy } from "lucide-react";
import { StoreCompetition } from "@/components/StoreCompetition";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export default function StoreDetails() {
  const params = useParams();
  const [, setLocation] = useLocation();
  const storeId = parseInt(params.id || "0");
  const [activeTab, setActiveTab] = useState("overview");
  
  // 매출 계산용 상태
  const [unitPrice, setUnitPrice] = useState<number>(10000); // 기본 단가 10,000원
  const [multiplier, setMultiplier] = useState<number>(1); // 기본 배수 1배

  const { data, isLoading } = trpc.analytics.storeDetails.useQuery({ storeId });

  if (isLoading) {
    return (
      <div className="container mx-auto p-6">
        <div className="flex items-center justify-center min-h-[400px]">
          <div className="text-center">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-pink-500 mx-auto mb-4"></div>
            <p className="text-muted-foreground">로딩 중...</p>
          </div>
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="container mx-auto p-6">
        <div className="text-center py-12">
          <p className="text-muted-foreground">데이터를 불러올 수 없습니다.</p>
        </div>
      </div>
    );
  }

  const formatDate = (date: string | Date) => {
    return new Date(date).toLocaleString('ko-KR', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const getStatusBadge = (status: string) => {
    const statusMap = {
      active: { label: "사용 가능", variant: "default" as const, className: "bg-green-100 text-green-800" },
      used: { label: "사용 완료", variant: "secondary" as const, className: "bg-gray-100 text-gray-800" },
      expired: { label: "만료됨", variant: "destructive" as const, className: "bg-red-100 text-red-800" },
    };
    const statusInfo = statusMap[status as keyof typeof statusMap] || statusMap.active;
    return <Badge className={statusInfo.className}>{statusInfo.label}</Badge>;
  };

  // 통계 계산
  const totalDownloads = data.downloads?.length || 0;
  const totalUsages = data.usages?.length || 0;
  const usageRate = totalDownloads > 0 ? Math.round((totalUsages / totalDownloads) * 100) : 0;
  
  // 매출 계산 (단가 × 사용 건수 × 배수)
  const estimatedRevenue = unitPrice * totalUsages * multiplier;

  // 고유 사용자 수
  const uniqueUsers = new Set(data.downloads?.map((d: any) => d.userEmail) || []).size;

  return (
    <div className="container mx-auto p-6 max-w-7xl">
      {/* 헤더 */}
      <div className="mb-6">
        <Button
          variant="ghost"
          onClick={() => setLocation("/admin/analytics")}
          className="mb-4"
        >
          <ArrowLeft className="mr-2 h-4 w-4" />
          Analytics로 돌아가기
        </Button>
        <h1 className="text-3xl font-bold">업장 상세 내역</h1>
        <p className="text-muted-foreground mt-2">
          쿠폰 다운로드, 사용 현황 및 매출을 확인하세요
        </p>
      </div>

      {/* 탭 네비게이션 */}
      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
        <TabsList className="grid w-full grid-cols-5 lg:w-[750px]">
          <TabsTrigger value="overview">📊 개요</TabsTrigger>
          <TabsTrigger value="downloads">📥 다운로드</TabsTrigger>
          <TabsTrigger value="usages">✅ 사용 현황</TabsTrigger>
          <TabsTrigger value="revenue">💰 매출</TabsTrigger>
          <TabsTrigger value="competition">🏆 경쟁</TabsTrigger>
        </TabsList>

        {/* 개요 탭 */}
        <TabsContent value="overview" className="space-y-6">
          {/* 100m 반경 경쟁 구도 및 지역별 랭킹 */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* 경쟁 구도 */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Trophy className="h-5 w-5 text-amber-500" />
                  100m 반경 경쟁 구도
                </CardTitle>
              </CardHeader>
              <CardContent>
                {data.nearbyStores && data.nearbyStores.length > 0 ? (
                  <div className="space-y-3">
                    {data.nearbyStores.slice(0, 5).map((store: any, index: number) => (
                      <div
                        key={store.id}
                        className="flex items-center justify-between p-3 bg-gradient-to-r from-peach-50 to-mint-50 rounded-lg"
                      >
                        <div className="flex items-center gap-3">
                          <Badge
                            variant={index < 3 ? "default" : "secondary"}
                            className={`w-8 h-8 flex items-center justify-center ${index === 0 ? "bg-yellow-500" : index === 1 ? "bg-gray-400" : index === 2 ? "bg-orange-600" : ""}`}
                          >
                            {index + 1}
                          </Badge>
                          <div>
                            <div className="font-medium">{store.name}</div>
                            <div className="text-xs text-muted-foreground">
                              {Math.round(store.distance)}m 거리
                            </div>
                          </div>
                        </div>
                        <div className="text-right">
                          <div className="text-sm font-medium text-pink-600">
                            {store.totalIssued || 0}개 발행
                          </div>
                          <div className="text-xs text-muted-foreground">
                            {store.totalCoupons || 0}종 쿠폰
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-center text-muted-foreground py-4">100m 반경 내 경쟁 업장이 없습니다.</p>
                )}
              </CardContent>
            </Card>

            {/* 지역별 랭킹 */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Trophy className="h-5 w-5 text-blue-500" />
                  지역별 랭킹 (100m 반경)
                </CardTitle>
              </CardHeader>
              <CardContent>
                {data.nearbyStores && data.nearbyStores.length > 0 ? (
                  <div className="space-y-3">
                    {/* 현재 업장의 순위 계산 */}
                    {(() => {
                      const currentStoreRank = data.nearbyStores.findIndex((s: any) => s.id === storeId) + 1;
                      const totalStores = data.nearbyStores.length + 1; // 현재 업장 포함
                      return (
                        <div className="p-4 bg-gradient-to-r from-blue-50 to-purple-50 rounded-lg border-2 border-blue-300">
                          <div className="flex items-center justify-between">
                            <div>
                              <div className="text-sm text-muted-foreground">현재 업장 순위</div>
                              <div className="text-3xl font-bold text-blue-600">
                                {currentStoreRank > 0 ? currentStoreRank : totalStores}
                              </div>
                            </div>
                            <div className="text-right">
                              <div className="text-sm text-muted-foreground">총 업장 수</div>
                              <div className="text-2xl font-bold text-purple-600">{totalStores}</div>
                            </div>
                          </div>
                        </div>
                      );
                    })()}
                    
                    {/* 상위 5개 업장 */}
                    <div className="space-y-2">
                      <div className="text-sm font-medium text-muted-foreground">쿠폰 발행량 기준 TOP 5</div>
                      {data.nearbyStores.slice(0, 5).map((store: any, index: number) => (
                        <div key={store.id} className="flex items-center justify-between p-2 bg-muted/30 rounded">
                          <div className="flex items-center gap-2">
                            <span className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold text-white ${
                              index === 0 ? 'bg-yellow-500' : index === 1 ? 'bg-gray-400' : index === 2 ? 'bg-orange-600' : 'bg-gray-300'
                            }`}>
                              {index + 1}
                            </span>
                            <span className="text-sm font-medium">{store.name}</span>
                          </div>
                          <span className="text-sm text-pink-600 font-medium">
                            {store.totalIssued || 0}개
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : (
                  <p className="text-center text-muted-foreground py-4">지역별 랭킹 데이터가 없습니다.</p>
                )}
              </CardContent>
            </Card>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <Card className="bg-gradient-to-br from-blue-50 to-blue-100 border-blue-200">
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium text-blue-800">총 다운로드</CardTitle>
                <Download className="h-4 w-4 text-blue-600" />
              </CardHeader>
              <CardContent>
                <div className="text-3xl font-bold text-blue-900">{totalDownloads}</div>
                <p className="text-xs text-blue-600">최근 100건 기준</p>
              </CardContent>
            </Card>

            <Card className="bg-gradient-to-br from-green-50 to-green-100 border-green-200">
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium text-green-800">총 사용</CardTitle>
                <CheckCircle className="h-4 w-4 text-green-600" />
              </CardHeader>
              <CardContent>
                <div className="text-3xl font-bold text-green-900">{totalUsages}</div>
                <p className="text-xs text-green-600">최근 100건 기준</p>
              </CardContent>
            </Card>

            <Card className="bg-gradient-to-br from-purple-50 to-purple-100 border-purple-200">
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium text-purple-800">사용률</CardTitle>
                <Percent className="h-4 w-4 text-purple-600" />
              </CardHeader>
              <CardContent>
                <div className="text-3xl font-bold text-purple-900">{usageRate}%</div>
                <p className="text-xs text-purple-600">다운로드 대비 사용</p>
              </CardContent>
            </Card>

            <Card className="bg-gradient-to-br from-orange-50 to-orange-100 border-orange-200">
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium text-orange-800">고유 사용자</CardTitle>
                <Users className="h-4 w-4 text-orange-600" />
              </CardHeader>
              <CardContent>
                <div className="text-3xl font-bold text-orange-900">{uniqueUsers}</div>
                <p className="text-xs text-orange-600">쿠폰 다운로드 사용자</p>
              </CardContent>
            </Card>
          </div>

          {/* 최근 활동 요약 */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <Card>
              <CardHeader>
                <CardTitle className="text-lg flex items-center gap-2">
                  <Download className="h-5 w-5 text-blue-500" />
                  최근 다운로드 (5건)
                </CardTitle>
              </CardHeader>
              <CardContent>
                {data.downloads && data.downloads.length > 0 ? (
                  <div className="space-y-3">
                    {data.downloads.slice(0, 5).map((download: any, index: number) => (
                      <div key={index} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                        <div>
                          <p className="font-medium">{download.userName}</p>
                          <p className="text-sm text-muted-foreground">{download.couponTitle}</p>
                        </div>
                        <div className="text-right">
                          <p className="text-sm text-muted-foreground">{formatDate(download.downloadedAt)}</p>
                          {getStatusBadge(download.status)}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-center text-muted-foreground py-4">다운로드 내역이 없습니다.</p>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-lg flex items-center gap-2">
                  <CheckCircle className="h-5 w-5 text-green-500" />
                  최근 사용 (5건)
                </CardTitle>
              </CardHeader>
              <CardContent>
                {data.usages && data.usages.length > 0 ? (
                  <div className="space-y-3">
                    {data.usages.slice(0, 5).map((usage: any, index: number) => (
                      <div key={index} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                        <div>
                          <p className="font-medium">{usage.userName}</p>
                          <p className="text-sm text-muted-foreground">{usage.couponTitle}</p>
                        </div>
                        <div className="text-right">
                          <p className="text-sm text-muted-foreground">{formatDate(usage.usedAt)}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-center text-muted-foreground py-4">사용 내역이 없습니다.</p>
                )}
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* 다운로드 탭 */}
        <TabsContent value="downloads">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Download className="h-5 w-5 text-blue-500" />
                쿠폰 다운로드 내역
                <Badge variant="outline" className="ml-2">{totalDownloads}건</Badge>
              </CardTitle>
            </CardHeader>
            <CardContent>
              {data.downloads && data.downloads.length > 0 ? (
                <div className="rounded-md border overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow className="bg-gray-50">
                        <TableHead className="font-semibold">사용자</TableHead>
                        <TableHead className="font-semibold">이메일</TableHead>
                        <TableHead className="font-semibold">쿠폰명</TableHead>
                        <TableHead className="font-semibold">쿠폰 코드</TableHead>
                        <TableHead className="font-semibold">다운로드 시간</TableHead>
                        <TableHead className="font-semibold">상태</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {data.downloads.map((download: any, index: number) => (
                        <TableRow key={index} className="hover:bg-gray-50">
                          <TableCell className="font-medium">{download.userName}</TableCell>
                          <TableCell className="text-sm text-muted-foreground">
                            {download.userEmail}
                          </TableCell>
                          <TableCell>{download.couponTitle}</TableCell>
                          <TableCell className="font-mono text-sm bg-gray-100 rounded px-2">
                            {download.couponCode}
                          </TableCell>
                          <TableCell className="text-sm">
                            {formatDate(download.downloadedAt)}
                          </TableCell>
                          <TableCell>
                            {getStatusBadge(download.status)}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              ) : (
                <div className="text-center py-12 text-muted-foreground">
                  <Download className="h-12 w-12 mx-auto mb-4 opacity-30" />
                  <p>다운로드 내역이 없습니다.</p>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* 사용 현황 탭 */}
        <TabsContent value="usages">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <CheckCircle className="h-5 w-5 text-green-500" />
                쿠폰 사용 내역
                <Badge variant="outline" className="ml-2">{totalUsages}건</Badge>
              </CardTitle>
            </CardHeader>
            <CardContent>
              {data.usages && data.usages.length > 0 ? (
                <div className="rounded-md border overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow className="bg-gray-50">
                        <TableHead className="font-semibold">사용자</TableHead>
                        <TableHead className="font-semibold">이메일</TableHead>
                        <TableHead className="font-semibold">쿠폰명</TableHead>
                        <TableHead className="font-semibold">쿠폰 코드</TableHead>
                        <TableHead className="font-semibold">사용 시간</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {data.usages.map((usage: any, index: number) => (
                        <TableRow key={index} className="hover:bg-gray-50">
                          <TableCell className="font-medium">{usage.userName}</TableCell>
                          <TableCell className="text-sm text-muted-foreground">
                            {usage.userEmail}
                          </TableCell>
                          <TableCell>{usage.couponTitle}</TableCell>
                          <TableCell className="font-mono text-sm bg-gray-100 rounded px-2">
                            {usage.couponCode}
                          </TableCell>
                          <TableCell className="text-sm">
                            {formatDate(usage.usedAt)}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              ) : (
                <div className="text-center py-12 text-muted-foreground">
                  <CheckCircle className="h-12 w-12 mx-auto mb-4 opacity-30" />
                  <p>사용 내역이 없습니다.</p>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* 매출 탭 */}
        <TabsContent value="revenue">
          <div className="space-y-6">
            {/* 매출 계산 입력 */}
            <Card className="border-2 border-pink-200 bg-gradient-to-br from-pink-50 to-orange-50">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Calculator className="h-5 w-5 text-pink-500" />
                  매출 계산기
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                  <div className="space-y-2">
                    <Label htmlFor="unitPrice" className="text-sm font-medium">
                      평균 객단가 (원)
                    </Label>
                    <Input
                      id="unitPrice"
                      type="number"
                      value={unitPrice}
                      onChange={(e) => setUnitPrice(Number(e.target.value) || 0)}
                      className="text-lg font-semibold"
                      placeholder="10000"
                    />
                    <p className="text-xs text-muted-foreground">
                      쿠폰 사용 고객의 평균 결제 금액
                    </p>
                  </div>
                  
                  <div className="space-y-2">
                    <Label htmlFor="multiplier" className="text-sm font-medium">
                      배수
                    </Label>
                    <Input
                      id="multiplier"
                      type="number"
                      step="0.1"
                      value={multiplier}
                      onChange={(e) => setMultiplier(Number(e.target.value) || 1)}
                      className="text-lg font-semibold"
                      placeholder="1"
                    />
                    <p className="text-xs text-muted-foreground">
                      재방문율 등을 고려한 배수 (기본 1배)
                    </p>
                  </div>
                  
                  <div className="space-y-2">
                    <Label className="text-sm font-medium">총 사용 건수</Label>
                    <div className="text-3xl font-bold text-pink-600 py-2">
                      {totalUsages}건
                    </div>
                    <p className="text-xs text-muted-foreground">
                      쿠폰이 사용된 총 횟수
                    </p>
                  </div>
                </div>
                
                <div className="mt-6 p-4 bg-white rounded-lg border-2 border-pink-300">
                  <div className="text-center">
                    <p className="text-sm text-muted-foreground mb-2">
                      예상 매출 = 객단가 × 사용 건수 × 배수
                    </p>
                    <p className="text-sm text-muted-foreground mb-2">
                      {unitPrice.toLocaleString()}원 × {totalUsages}건 × {multiplier}배
                    </p>
                    <div className="text-4xl font-bold text-pink-600">
                      {estimatedRevenue.toLocaleString()}원
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* 매출 요약 카드 */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <Card className="bg-gradient-to-br from-emerald-50 to-emerald-100 border-emerald-200">
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium text-emerald-800">총 사용 건수</CardTitle>
                  <CheckCircle className="h-4 w-4 text-emerald-600" />
                </CardHeader>
                <CardContent>
                  <div className="text-3xl font-bold text-emerald-900">
                    {totalUsages}건
                  </div>
                  <p className="text-xs text-emerald-600">쿠폰이 실제 사용된 횟수</p>
                </CardContent>
              </Card>

              <Card className="bg-gradient-to-br from-blue-50 to-blue-100 border-blue-200">
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium text-blue-800">설정 객단가</CardTitle>
                  <DollarSign className="h-4 w-4 text-blue-600" />
                </CardHeader>
                <CardContent>
                  <div className="text-3xl font-bold text-blue-900">
                    {unitPrice.toLocaleString()}원
                  </div>
                  <p className="text-xs text-blue-600">위에서 입력한 평균 객단가</p>
                </CardContent>
              </Card>

              <Card className="bg-gradient-to-br from-amber-50 to-amber-100 border-amber-200">
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium text-amber-800">예상 매출</CardTitle>
                  <TrendingUp className="h-4 w-4 text-amber-600" />
                </CardHeader>
                <CardContent>
                  <div className="text-3xl font-bold text-amber-900">
                    {estimatedRevenue.toLocaleString()}원
                  </div>
                  <p className="text-xs text-amber-600">객단가 × 사용 건수 × 배수</p>
                </CardContent>
              </Card>
            </div>

            {/* 매출 상세 안내 */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <DollarSign className="h-5 w-5 text-emerald-500" />
                  매출 분석 안내
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="bg-gray-50 rounded-lg p-6 space-y-4">
                  <div className="flex items-start gap-3">
                    <div className="w-8 h-8 rounded-full bg-emerald-100 flex items-center justify-center flex-shrink-0">
                      <span className="text-emerald-600 font-bold">1</span>
                    </div>
                    <div>
                      <h4 className="font-semibold">평균 객단가 입력</h4>
                      <p className="text-sm text-muted-foreground">
                        쿠폰을 사용한 고객이 평균적으로 결제하는 금액을 입력하세요.
                        예: 카페 5,000원, 음식점 15,000원, 미용실 30,000원
                      </p>
                    </div>
                  </div>
                  <div className="flex items-start gap-3">
                    <div className="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center flex-shrink-0">
                      <span className="text-blue-600 font-bold">2</span>
                    </div>
                    <div>
                      <h4 className="font-semibold">배수 설정</h4>
                      <p className="text-sm text-muted-foreground">
                        재방문율이나 동반 고객 등을 고려한 배수입니다.
                        기본값 1배로 시작하고, 데이터를 보며 조정하세요.
                      </p>
                    </div>
                  </div>
                  <div className="flex items-start gap-3">
                    <div className="w-8 h-8 rounded-full bg-amber-100 flex items-center justify-center flex-shrink-0">
                      <span className="text-amber-600 font-bold">3</span>
                    </div>
                    <div>
                      <h4 className="font-semibold">예상 매출 확인</h4>
                      <p className="text-sm text-muted-foreground">
                        쿠폰 마케팅으로 인한 예상 매출입니다.
                        실제 매출과 비교하여 쿠폰 효과를 분석하세요.
                      </p>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* 경쟁 탭 */}
        <TabsContent value="competition">
          <StoreCompetition storeId={storeId} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
