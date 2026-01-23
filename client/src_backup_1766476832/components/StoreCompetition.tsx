import { trpc } from '@/lib/trpc';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Trophy, TrendingUp, Star, Download, Target, Medal, Users } from 'lucide-react';
import { Progress } from '@/components/ui/progress';

const CATEGORY_LABELS: Record<string, string> = {
  cafe: '☕ 카페',
  restaurant: '🍽️ 맛집',
  beauty: '💅 뷰티',
  hospital: '🏥 병원',
  fitness: '💪 헬스장',
  other: '🎁 기타',
};

interface StoreCompetitionProps {
  storeId: number;
}

export function StoreCompetition({ storeId }: StoreCompetitionProps) {
  const { data, isLoading } = trpc.analytics.storeCompetition.useQuery({ storeId });

  if (isLoading) {
    return (
      <div className="text-center py-8 text-muted-foreground">
        경쟁 현황을 불러오는 중...
      </div>
    );
  }

  if (!data || !data.storeRank) {
    return (
      <div className="text-center py-8 text-muted-foreground">
        경쟁 현황 데이터를 불러올 수 없습니다.
      </div>
    );
  }

  const { storeRank, competitors } = data;

  // 순위 백분율 계산
  const downloadRankPercent = storeRank.total_stores > 0 
    ? ((storeRank.total_stores - storeRank.overall_download_rank + 1) / storeRank.total_stores) * 100 
    : 0;
  const categoryRankPercent = storeRank.category_stores > 0 
    ? ((storeRank.category_stores - storeRank.category_download_rank + 1) / storeRank.category_stores) * 100 
    : 0;

  return (
    <div className="space-y-6">
      {/* 순위 요약 */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* 전체 순위 */}
        <Card className="bg-gradient-to-br from-amber-50 to-amber-100 border-amber-200">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-amber-800 flex items-center gap-2">
              <Trophy className="w-4 h-4" />
              전체 다운로드 순위
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-baseline gap-2">
              <span className="text-4xl font-bold text-amber-900">
                {storeRank.overall_download_rank}
              </span>
              <span className="text-amber-700">/ {storeRank.total_stores}위</span>
            </div>
            <Progress value={downloadRankPercent} className="mt-2 h-2" />
            <p className="text-xs text-amber-600 mt-1">
              상위 {(100 - downloadRankPercent).toFixed(0)}%
            </p>
          </CardContent>
        </Card>

        {/* 카테고리 내 순위 */}
        <Card className="bg-gradient-to-br from-blue-50 to-blue-100 border-blue-200">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-blue-800 flex items-center gap-2">
              <Medal className="w-4 h-4" />
              {CATEGORY_LABELS[storeRank.category] || storeRank.category} 내 순위
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-baseline gap-2">
              <span className="text-4xl font-bold text-blue-900">
                {storeRank.category_download_rank}
              </span>
              <span className="text-blue-700">/ {storeRank.category_stores}위</span>
            </div>
            <Progress value={categoryRankPercent} className="mt-2 h-2" />
            <p className="text-xs text-blue-600 mt-1">
              카테고리 상위 {(100 - categoryRankPercent).toFixed(0)}%
            </p>
          </CardContent>
        </Card>

        {/* 사용률 순위 */}
        <Card className="bg-gradient-to-br from-green-50 to-green-100 border-green-200">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-green-800 flex items-center gap-2">
              <TrendingUp className="w-4 h-4" />
              사용률
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-baseline gap-2">
              <span className="text-4xl font-bold text-green-900">
                {storeRank.usage_rate || 0}%
              </span>
            </div>
            <Progress value={Number(storeRank.usage_rate) || 0} className="mt-2 h-2" />
            <p className="text-xs text-green-600 mt-1">
              다운로드 {storeRank.download_count}건 중 {storeRank.usage_count}건 사용
            </p>
          </CardContent>
        </Card>
      </div>

      {/* 현재 업장 상세 */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Target className="w-5 h-5 text-primary" />
            현재 업장 성과
          </CardTitle>
          <CardDescription>{storeRank.name}</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="p-3 bg-muted/50 rounded-lg text-center">
              <div className="text-2xl font-bold text-blue-600">{storeRank.download_count}</div>
              <div className="text-xs text-muted-foreground">다운로드</div>
            </div>
            <div className="p-3 bg-muted/50 rounded-lg text-center">
              <div className="text-2xl font-bold text-green-600">{storeRank.usage_count}</div>
              <div className="text-xs text-muted-foreground">사용</div>
            </div>
            <div className="p-3 bg-muted/50 rounded-lg text-center">
              <div className="flex items-center justify-center gap-1">
                <Star className="w-5 h-5 fill-amber-500 text-amber-500" />
                <span className="text-2xl font-bold text-amber-600">
                  {parseFloat(storeRank.rating || 0).toFixed(1)}
                </span>
              </div>
              <div className="text-xs text-muted-foreground">별점</div>
            </div>
            <div className="p-3 bg-muted/50 rounded-lg text-center">
              <div className="text-2xl font-bold text-purple-600">{storeRank.ratingCount || 0}</div>
              <div className="text-xs text-muted-foreground">리뷰 수</div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* 경쟁 업장 비교 */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Users className="w-5 h-5 text-primary" />
            동일 카테고리 경쟁 업장
          </CardTitle>
          <CardDescription>
            {CATEGORY_LABELS[storeRank.category] || storeRank.category} 카테고리 상위 업장
          </CardDescription>
        </CardHeader>
        <CardContent>
          {competitors && competitors.length > 0 ? (
            <div className="space-y-3">
              {competitors.map((competitor: any, index: number) => (
                <div 
                  key={competitor.id} 
                  className="flex items-center justify-between p-3 bg-muted/30 rounded-lg"
                >
                  <div className="flex items-center gap-3">
                    <span className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold text-white ${
                      index === 0 ? 'bg-amber-500' : index === 1 ? 'bg-gray-400' : 'bg-amber-700'
                    }`}>
                      {index + 1}
                    </span>
                    <div>
                      <div className="font-medium">{competitor.name}</div>
                      <div className="flex items-center gap-1 text-xs text-muted-foreground">
                        <Star className="w-3 h-3 fill-amber-500 text-amber-500" />
                        {parseFloat(competitor.rating || 0).toFixed(1)}
                        <span>({competitor.ratingCount || 0})</span>
                      </div>
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="flex items-center gap-4 text-sm">
                      <div>
                        <span className="text-blue-600 font-medium">{competitor.download_count}</span>
                        <span className="text-muted-foreground ml-1">다운</span>
                      </div>
                      <div>
                        <span className="text-green-600 font-medium">{competitor.usage_count}</span>
                        <span className="text-muted-foreground ml-1">사용</span>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center py-8 text-muted-foreground">
              동일 카테고리에 다른 경쟁 업장이 없습니다.
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
