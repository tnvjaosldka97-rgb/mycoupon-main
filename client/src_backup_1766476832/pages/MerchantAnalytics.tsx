import { useAuth } from "@/_core/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ArrowLeft, TrendingUp, DollarSign, Users, Download, FileSpreadsheet, Banknote } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { useLocation } from "wouter";
import { getLoginUrl } from "@/const";
import { useState } from "react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { toast } from "sonner";

// 금액 포맷팅 함수
const formatCurrency = (amount: number) => {
  return new Intl.NumberFormat('ko-KR', { style: 'currency', currency: 'KRW' }).format(amount);
};

export default function MerchantAnalytics() {
  const [, setLocation] = useLocation();
  const { user, loading } = useAuth();

  const { data: myStores } = trpc.stores.myStores.useQuery(undefined, {
    enabled: !!user && (user.role === 'merchant' || user.role === 'admin'),
  });

  const [selectedStoreId, setSelectedStoreId] = useState<number | null>(null);

  // 선택된 가게의 통계
  const { data: summary } = trpc.merchantAnalytics.summary.useQuery(
    { storeId: selectedStoreId! },
    { enabled: !!selectedStoreId }
  );

  const { data: couponStats } = trpc.merchantAnalytics.couponStats.useQuery(
    { storeId: selectedStoreId! },
    { enabled: !!selectedStoreId }
  );

  const { data: hourlyPattern } = trpc.merchantAnalytics.hourlyPattern.useQuery(
    { storeId: selectedStoreId! },
    { enabled: !!selectedStoreId }
  );

  const { data: recentUsage } = trpc.merchantAnalytics.recentUsage.useQuery(
    { storeId: selectedStoreId!, limit: 10 },
    { enabled: !!selectedStoreId }
  );

  const { data: popularCoupons } = trpc.merchantAnalytics.popularCoupons.useQuery(
    { storeId: selectedStoreId!, limit: 5 },
    { enabled: !!selectedStoreId }
  );

  // 예상 매출 통계
  const { data: revenueStats } = trpc.merchantAnalytics.revenueStats.useQuery(
    { storeId: selectedStoreId! },
    { enabled: !!selectedStoreId }
  );

  // 엑셀 다운로드용 데이터
  const { refetch: refetchDownloadHistory } = trpc.merchantAnalytics.downloadHistory.useQuery(
    { storeId: selectedStoreId! },
    { enabled: false } // 수동으로 호출
  );

  const { refetch: refetchUsageHistory } = trpc.merchantAnalytics.usageHistory.useQuery(
    { storeId: selectedStoreId! },
    { enabled: false } // 수동으로 호출
  );

  // 첫 번째 가게 자동 선택
  if (!selectedStoreId && myStores && myStores.length > 0) {
    setSelectedStoreId(myStores[0].id);
  }

  // 총 예상 매출 계산
  const totalEstimatedRevenue = revenueStats?.reduce((sum, stat) => sum + stat.estimatedRevenue, 0) || 0;
  const totalEstimatedDiscount = revenueStats?.reduce((sum, stat) => sum + stat.estimatedDiscount, 0) || 0;
  const totalAmount = revenueStats?.reduce((sum, stat) => sum + (stat.totalAmount || 0), 0) || 0;

  // CSV 생성 및 다운로드 함수
  const downloadCSV = (data: any[], filename: string, headers: string[], keys: string[]) => {
    if (!data || data.length === 0) {
      toast.error('다운로드할 데이터가 없습니다.');
      return;
    }

    // BOM 추가 (한글 깨짐 방지)
    const BOM = '\uFEFF';
    
    // 헤더 행
    let csvContent = BOM + headers.join(',') + '\n';
    
    // 데이터 행
    data.forEach(row => {
      const values = keys.map(key => {
        let value = row[key];
        
        // 날짜 포맷팅
        if (key.includes('At') && value) {
          value = new Date(value).toLocaleString('ko-KR');
        }
        
        // 상태 한글화
        if (key === 'status') {
          value = value === 'used' ? '사용완료' : value === 'active' ? '미사용' : value === 'expired' ? '만료' : value;
        }
        
        // 할인 타입 한글화
        if (key === 'discountType') {
          value = value === 'percentage' ? '퍼센트' : value === 'fixed' ? '정액' : '증정';
        }
        
        // CSV 이스케이프 처리
        if (value === null || value === undefined) {
          value = '';
        }
        value = String(value).replace(/"/g, '""');
        if (value.includes(',') || value.includes('"') || value.includes('\n')) {
          value = `"${value}"`;
        }
        
        return value;
      });
      csvContent += values.join(',') + '\n';
    });

    // 다운로드
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    link.setAttribute('href', url);
    link.setAttribute('download', filename);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    
    toast.success('엑셀 파일이 다운로드되었습니다.');
  };

  // 다운로드 내역 엑셀 다운로드
  const handleDownloadHistory = async () => {
    if (!selectedStoreId) return;
    
    toast.info('데이터를 불러오는 중...');
    const result = await refetchDownloadHistory();
    
    if (result.data) {
      const storeName = myStores?.find(s => s.id === selectedStoreId)?.name || '가게';
      const today = new Date().toISOString().split('T')[0];
      
      downloadCSV(
        result.data,
        `${storeName}_쿠폰다운로드내역_${today}.csv`,
        ['번호', '쿠폰명', '할인타입', '할인값', '사용자명', '이메일', 'PIN코드', '상태', '다운로드일시', '사용일시', '만료일시'],
        ['id', 'couponTitle', 'discountType', 'discountValue', 'userName', 'userEmail', 'pinCode', 'status', 'downloadedAt', 'usedAt', 'expiresAt']
      );
    }
  };

  // 사용 내역 엑셀 다운로드
  const handleUsageHistory = async () => {
    if (!selectedStoreId) return;
    
    toast.info('데이터를 불러오는 중...');
    const result = await refetchUsageHistory();
    
    if (result.data) {
      const storeName = myStores?.find(s => s.id === selectedStoreId)?.name || '가게';
      const today = new Date().toISOString().split('T')[0];
      
      downloadCSV(
        result.data,
        `${storeName}_쿠폰사용내역_${today}.csv`,
        ['번호', '쿠폰명', '할인타입', '할인값', '사용자명', '이메일', 'PIN코드', '사용일시'],
        ['id', 'couponTitle', 'discountType', 'discountValue', 'userName', 'userEmail', 'pinCode', 'usedAt']
      );
    }
  };

  // 매출 통계 엑셀 다운로드
  const handleRevenueExport = () => {
    if (!revenueStats || revenueStats.length === 0) {
      toast.error('다운로드할 데이터가 없습니다.');
      return;
    }

    const storeName = myStores?.find(s => s.id === selectedStoreId)?.name || '가게';
    const today = new Date().toISOString().split('T')[0];
    
    downloadCSV(
      revenueStats,
      `${storeName}_예상매출통계_${today}.csv`,
      ['쿠폰명', '할인타입', '할인값', '최소구매금액', '다운로드수', '사용수', '총액(할인전)', '할인액', '예상총매출'],
      ['couponTitle', 'discountType', 'discountValue', 'minPurchase', 'totalDownloads', 'totalUsed', 'totalAmount', 'estimatedDiscount', 'estimatedRevenue']
    );
  };

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
          <Button variant="ghost" onClick={() => setLocation("/merchant/dashboard")}>
            <ArrowLeft className="mr-2 h-4 w-4" />
            대시보드로
          </Button>
          <div className="flex items-center gap-4">
            <h1 className="text-2xl font-bold text-gray-900">쿠폰 사용 통계</h1>
            {myStores && myStores.length > 0 && (
              <Select
                value={selectedStoreId?.toString()}
                onValueChange={(value) => setSelectedStoreId(parseInt(value))}
              >
                <SelectTrigger className="w-[200px]">
                  <SelectValue placeholder="가게 선택" />
                </SelectTrigger>
                <SelectContent>
                  {myStores?.map((store) => (
                    <SelectItem key={store.id} value={store.id.toString()}>
                      {store.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>
          <div className="w-[100px]" />
        </div>
      </header>

      <div className="container mx-auto px-4 py-8">
        {/* 엑셀 다운로드 버튼 */}
        <div className="flex justify-end gap-3 mb-6">
          <Button
            variant="outline"
            onClick={handleDownloadHistory}
            disabled={!selectedStoreId}
            className="gap-2"
          >
            <FileSpreadsheet className="h-4 w-4" />
            다운로드 내역
          </Button>
          <Button
            variant="outline"
            onClick={handleUsageHistory}
            disabled={!selectedStoreId}
            className="gap-2"
          >
            <FileSpreadsheet className="h-4 w-4" />
            사용 내역
          </Button>
          <Button
            variant="outline"
            onClick={handleRevenueExport}
            disabled={!selectedStoreId || !revenueStats || revenueStats.length === 0}
            className="gap-2"
          >
            <FileSpreadsheet className="h-4 w-4" />
            매출 통계
          </Button>
        </div>

        {/* 요약 통계 */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">등록된 쿠폰</CardTitle>
              <TrendingUp className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{summary?.totalCoupons || 0}개</div>
              <p className="text-xs text-muted-foreground">
                현재 활성 쿠폰
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">총 다운로드</CardTitle>
              <Download className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{summary?.totalDownloads || 0}회</div>
              <p className="text-xs text-muted-foreground">
                사용자가 다운받은 쿠폰
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">사용 완료</CardTitle>
              <Users className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{summary?.totalUsed || 0}회</div>
              <p className="text-xs text-muted-foreground">
                실제 사용된 쿠폰
              </p>
            </CardContent>
          </Card>
        </div>

        {/* 예상 매출 통계 */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
          <Card className="bg-gradient-to-br from-green-50 to-green-100 border-green-200">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium text-green-800">총액 (할인 전)</CardTitle>
              <Banknote className="h-4 w-4 text-green-600" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-green-700">{formatCurrency(totalAmount)}</div>
              <p className="text-xs text-green-600">
                쿠폰 사용 기반 추정
              </p>
            </CardContent>
          </Card>

          <Card className="bg-gradient-to-br from-orange-50 to-orange-100 border-orange-200">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium text-orange-800">총 할인 제공액</CardTitle>
              <DollarSign className="h-4 w-4 text-orange-600" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-orange-700">{formatCurrency(totalEstimatedDiscount)}</div>
              <p className="text-xs text-orange-600">
                고객에게 제공한 할인
              </p>
            </CardContent>
          </Card>

          <Card className="bg-gradient-to-br from-blue-50 to-blue-100 border-blue-200">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium text-blue-800">예상 총매출</CardTitle>
              <TrendingUp className="h-4 w-4 text-blue-600" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-blue-700">{formatCurrency(totalEstimatedRevenue)}</div>
              <p className="text-xs text-blue-600">
                매출 - 할인액
              </p>
            </CardContent>
          </Card>
        </div>

        {/* 쿠폰별 예상 매출 테이블 */}
        <Card className="mb-8">
          <CardHeader>
            <CardTitle>쿠폰별 예상 매출</CardTitle>
            <CardDescription>각 쿠폰의 사용 현황과 예상 매출을 확인하세요</CardDescription>
          </CardHeader>
          <CardContent>
            {revenueStats && revenueStats.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b bg-gray-50">
                      <th className="text-left p-3 font-medium">쿠폰명</th>
                      <th className="text-center p-3 font-medium">할인</th>
                      <th className="text-center p-3 font-medium">다운로드</th>
                      <th className="text-center p-3 font-medium">사용</th>
                      <th className="text-right p-3 font-medium">총액(할인전)</th>
                      <th className="text-right p-3 font-medium">할인액</th>
                      <th className="text-right p-3 font-medium">예상총매출</th>
                    </tr>
                  </thead>
                  <tbody>
                    {revenueStats.map((stat) => (
                      <tr key={stat.couponId} className="border-b hover:bg-gray-50">
                        <td className="p-3 font-medium">{stat.couponTitle}</td>
                        <td className="p-3 text-center">
                          {stat.discountType === 'percentage' 
                            ? `${stat.discountValue}%` 
                            : stat.discountType === 'fixed'
                            ? formatCurrency(stat.discountValue)
                            : `${stat.discountValue}원 상당`}
                        </td>
                        <td className="p-3 text-center">{stat.totalDownloads}회</td>
                        <td className="p-3 text-center">{stat.totalUsed}회</td>
                        <td className="p-3 text-right text-gray-600">{formatCurrency(stat.totalAmount || 0)}</td>
                        <td className="p-3 text-right text-orange-600">{formatCurrency(stat.estimatedDiscount)}</td>
                        <td className="p-3 text-right text-green-600 font-medium">{formatCurrency(stat.estimatedRevenue)}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="bg-gray-100 font-bold">
                      <td className="p-3" colSpan={4}>합계</td>
                      <td className="p-3 text-right text-gray-700">{formatCurrency(totalAmount)}</td>
                      <td className="p-3 text-right text-orange-700">{formatCurrency(totalEstimatedDiscount)}</td>
                      <td className="p-3 text-right text-green-700">{formatCurrency(totalEstimatedRevenue)}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            ) : (
              <p className="text-center text-muted-foreground py-8">데이터가 없습니다</p>
            )}
          </CardContent>
        </Card>

        {/* 차트 */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
          {/* 쿠폰별 사용률 */}
          <Card>
            <CardHeader>
              <CardTitle>쿠폰별 사용 현황</CardTitle>
              <CardDescription>다운로드 대비 사용률</CardDescription>
            </CardHeader>
            <CardContent className="overflow-x-auto">
              {couponStats && couponStats.length > 0 ? (
                <div className="min-w-[300px]">
                  <ResponsiveContainer width="100%" height={300}>
                    <BarChart data={couponStats}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="couponTitle" />
                      <YAxis />
                      <Tooltip />
                      <Legend />
                      <Bar dataKey="totalDownloads" fill="#FF9800" name="다운로드" />
                      <Bar dataKey="totalUsed" fill="#4CAF50" name="사용 완료" />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              ) : (
                <p className="text-center text-muted-foreground py-8">데이터가 없습니다</p>
              )}
            </CardContent>
          </Card>

          {/* 시간대별 사용 패턴 */}
          <Card>
            <CardHeader>
              <CardTitle>시간대별 사용 패턴</CardTitle>
              <CardDescription>어느 시간대에 가장 많이 사용되나요?</CardDescription>
            </CardHeader>
            <CardContent className="overflow-x-auto">
              {hourlyPattern && hourlyPattern.length > 0 ? (
                <div className="min-w-[300px]">
                  <ResponsiveContainer width="100%" height={300}>
                    <BarChart data={hourlyPattern}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="hour" label={{ value: '시간', position: 'insideBottom', offset: -5 }} />
                      <YAxis />
                      <Tooltip />
                      <Bar dataKey="count" fill="#FF6B9D" name="사용 횟수" />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              ) : (
                <p className="text-center text-muted-foreground py-8">데이터가 없습니다</p>
              )}
            </CardContent>
          </Card>
        </div>

        {/* 인기 쿠폰 및 최근 사용 내역 */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <Card>
            <CardHeader>
              <CardTitle>인기 쿠폰 TOP 5</CardTitle>
              <CardDescription>다운로드 기준</CardDescription>
            </CardHeader>
            <CardContent>
              {popularCoupons && popularCoupons.length > 0 ? (
                <div className="space-y-4">
                  {popularCoupons.map((coupon, index) => (
                    <div key={coupon.couponId} className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center font-bold text-primary">
                          {index + 1}
                        </div>
                        <div>
                          <p className="font-medium">{coupon.couponTitle}</p>
                          <p className="text-sm text-muted-foreground">
                            다운로드 {coupon.downloadCount}회 · 사용 {coupon.usedCount}회
                          </p>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-center text-muted-foreground py-8">데이터가 없습니다</p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>최근 사용 내역</CardTitle>
              <CardDescription>최근 10건</CardDescription>
            </CardHeader>
            <CardContent>
              {recentUsage && recentUsage.length > 0 ? (
                <div className="space-y-3">
                  {recentUsage.map((usage) => (
                    <div key={usage.id} className="flex items-center justify-between border-b pb-2">
                      <div>
                        <p className="font-medium">{usage.couponTitle}</p>
                        <p className="text-sm text-muted-foreground">
                          {usage.userName} · PIN: {usage.pinCode}
                        </p>
                      </div>
                      <p className="text-sm text-muted-foreground">
                        {usage.usedAt ? new Date(usage.usedAt).toLocaleString('ko-KR') : '-'}
                      </p>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-center text-muted-foreground py-8">데이터가 없습니다</p>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
