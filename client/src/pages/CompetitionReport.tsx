import { trpc } from '@/lib/trpc';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Trophy, TrendingUp, Star, Download, Target, Medal } from 'lucide-react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from 'recharts';

const CATEGORY_LABELS: Record<string, string> = {
  cafe: '☕ 카페',
  restaurant: '🍽️ 맛집',
  beauty: '💅 뷰티',
  hospital: '🏥 병원',
  fitness: '💪 헬스장',
  other: '🎁 기타',
};

const RANK_COLORS = ['#FFD700', '#C0C0C0', '#CD7F32', '#4ECDC4', '#95E1D3'];

export function CompetitionReport() {
  const { data: competition, isLoading } = trpc.analytics.competition.useQuery();

  if (isLoading) {
    return (
      <div className="text-center py-8 text-muted-foreground">
        경쟁 분석 데이터를 불러오는 중...
      </div>
    );
  }

  if (!competition) {
    return (
      <div className="text-center py-8 text-muted-foreground">
        데이터를 불러올 수 없습니다.
      </div>
    );
  }

  const { rankings, categoryLeaders, summary } = competition;

  // 차트 데이터 준비 (상위 10개)
  const chartData = (rankings || []).slice(0, 10).map((store: any, index: number) => ({
    name: store.name.length > 8 ? store.name.slice(0, 8) + '...' : store.name,
    fullName: store.name,
    downloads: Number(store.download_count) || 0,
    usages: Number(store.usage_count) || 0,
    rating: parseFloat(store.rating) || 0,
    rank: index + 1,
  }));

  // 카테고리별 리더 그룹화
  const leadersByCategory: Record<string, any[]> = {};
  (categoryLeaders || []).forEach((leader: any) => {
    if (!leadersByCategory[leader.category]) {
      leadersByCategory[leader.category] = [];
    }
    leadersByCategory[leader.category].push(leader);
  });

  return (
    <div className="space-y-6">
      {/* 전체 요약 */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card className="p-4 bg-gradient-to-br from-blue-50 to-blue-100">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-blue-500 rounded-lg">
              <Target className="w-5 h-5 text-white" />
            </div>
            <div>
              <div className="text-2xl font-bold text-blue-700">
                {summary?.total_stores || 0}
              </div>
              <div className="text-sm text-blue-600">총 업장 수</div>
            </div>
          </div>
        </Card>

        <Card className="p-4 bg-gradient-to-br from-green-50 to-green-100">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-green-500 rounded-lg">
              <Download className="w-5 h-5 text-white" />
            </div>
            <div>
              <div className="text-2xl font-bold text-green-700">
                {summary?.total_downloads || 0}
              </div>
              <div className="text-sm text-green-600">총 다운로드</div>
            </div>
          </div>
        </Card>

        <Card className="p-4 bg-gradient-to-br from-purple-50 to-purple-100">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-purple-500 rounded-lg">
              <TrendingUp className="w-5 h-5 text-white" />
            </div>
            <div>
              <div className="text-2xl font-bold text-purple-700">
                {summary?.total_usages || 0}
              </div>
              <div className="text-sm text-purple-600">총 사용 건수</div>
            </div>
          </div>
        </Card>

        <Card className="p-4 bg-gradient-to-br from-amber-50 to-amber-100">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-amber-500 rounded-lg">
              <Star className="w-5 h-5 text-white" />
            </div>
            <div>
              <div className="text-2xl font-bold text-amber-700">
                {summary?.avg_rating?.toFixed(1) || '0.0'}
              </div>
              <div className="text-sm text-amber-600">평균 별점</div>
            </div>
          </div>
        </Card>
      </div>

      {/* 다운로드 순위 차트 */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Trophy className="w-5 h-5 text-amber-500" />
            다운로드 순위 TOP 10
          </CardTitle>
          <CardDescription>쿠폰 다운로드 수 기준 상위 업장</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="h-80">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData} layout="vertical" margin={{ left: 20, right: 20 }}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis type="number" />
                <YAxis type="category" dataKey="name" width={80} />
                <Tooltip
                  formatter={(value: any, name: string) => [
                    value,
                    name === 'downloads' ? '다운로드' : '사용',
                  ]}
                  labelFormatter={(label: any, payload: any) => 
                    payload?.[0]?.payload?.fullName || label
                  }
                />
                <Bar dataKey="downloads" name="다운로드" radius={[0, 4, 4, 0]}>
                  {chartData.map((entry: any, index: number) => (
                    <Cell 
                      key={`cell-${index}`} 
                      fill={RANK_COLORS[Math.min(index, RANK_COLORS.length - 1)]} 
                    />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </CardContent>
      </Card>

      {/* 전체 순위 테이블 */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Medal className="w-5 h-5 text-primary" />
            전체 업장 경쟁 순위
          </CardTitle>
          <CardDescription>다운로드, 사용률, 별점 기준 종합 순위</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/50">
                  <th className="text-left p-3">순위</th>
                  <th className="text-left p-3">업장명</th>
                  <th className="text-left p-3">카테고리</th>
                  <th className="text-right p-3">다운로드</th>
                  <th className="text-right p-3">사용</th>
                  <th className="text-right p-3">사용률</th>
                  <th className="text-right p-3">별점</th>
                </tr>
              </thead>
              <tbody>
                {(rankings || []).map((store: any, index: number) => (
                  <tr key={store.id} className="border-b hover:bg-muted/30">
                    <td className="p-3">
                      {index < 3 ? (
                        <span className={`inline-flex items-center justify-center w-6 h-6 rounded-full text-white text-xs font-bold ${
                          index === 0 ? 'bg-amber-500' : index === 1 ? 'bg-gray-400' : 'bg-amber-700'
                        }`}>
                          {index + 1}
                        </span>
                      ) : (
                        <span className="text-muted-foreground">{index + 1}</span>
                      )}
                    </td>
                    <td className="p-3 font-medium">{store.name}</td>
                    <td className="p-3">
                      <Badge variant="outline">
                        {CATEGORY_LABELS[store.category] || store.category}
                      </Badge>
                    </td>
                    <td className="p-3 text-right font-medium text-blue-600">
                      {store.download_count}
                    </td>
                    <td className="p-3 text-right font-medium text-green-600">
                      {store.usage_count}
                    </td>
                    <td className="p-3 text-right">
                      <Badge variant={Number(store.usage_rate) >= 50 ? 'default' : 'secondary'}>
                        {store.usage_rate}%
                      </Badge>
                    </td>
                    <td className="p-3 text-right">
                      <div className="flex items-center justify-end gap-1">
                        <Star className="w-4 h-4 fill-amber-500 text-amber-500" />
                        <span>{parseFloat(store.rating || 0).toFixed(1)}</span>
                        <span className="text-muted-foreground text-xs">
                          ({store.ratingCount || 0})
                        </span>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* 카테고리별 리더 */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Trophy className="w-5 h-5 text-amber-500" />
            카테고리별 TOP 3
          </CardTitle>
          <CardDescription>각 카테고리에서 가장 인기 있는 업장</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {Object.entries(leadersByCategory).map(([category, leaders]) => (
              <div key={category} className="p-4 border rounded-lg">
                <h4 className="font-bold mb-3 text-lg">
                  {CATEGORY_LABELS[category] || category}
                </h4>
                <div className="space-y-2">
                  {leaders.map((leader: any, idx: number) => (
                    <div 
                      key={leader.id} 
                      className="flex items-center justify-between p-2 bg-muted/50 rounded"
                    >
                      <div className="flex items-center gap-2">
                        <span className={`w-5 h-5 rounded-full flex items-center justify-center text-xs font-bold text-white ${
                          idx === 0 ? 'bg-amber-500' : idx === 1 ? 'bg-gray-400' : 'bg-amber-700'
                        }`}>
                          {idx + 1}
                        </span>
                        <span className="font-medium text-sm">{leader.name}</span>
                      </div>
                      <div className="flex items-center gap-1 text-xs text-muted-foreground">
                        <Download className="w-3 h-3" />
                        {leader.download_count}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
