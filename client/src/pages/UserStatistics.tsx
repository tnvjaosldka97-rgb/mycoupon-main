import { useState } from 'react';
import { trpc } from '@/lib/trpc';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
  LineChart,
  Line,
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts';
import { Users, TrendingUp, Activity, PieChart as PieChartIcon } from 'lucide-react';

export function UserStatistics() {
  const [days, setDays] = useState(30);
  const [granularity, setGranularity] = useState<'day' | 'month'>('day');
  const [months, setMonths] = useState(6);

  const seriesInput = { days, granularity, months };
  const { data: dailySignups } = trpc.analytics.dailySignups.useQuery(seriesInput);
  const { data: dailyActiveUsers } = trpc.analytics.dailyActiveUsers.useQuery(seriesInput);
  const { data: cumulativeUsers } = trpc.analytics.cumulativeUsers.useQuery(seriesInput);
  const { data: demographics } = trpc.analytics.demographicDistribution.useQuery();

  // 백엔드가 KST 기준 'YYYY-MM-DD'(일) / 'YYYY-MM'(월) 문자열 반환.
  // new Date() 미사용 — 브라우저 로컬 타임존 재흔들림 차단.
  const fmtTick = (value: string) => {
    if (granularity === 'month') return value;
    const [, m, d] = value.split('-');
    return `${Number(m)}/${Number(d)}`;
  };
  const fmtLabel = (value: string) => {
    if (granularity === 'month') {
      const [y, m] = value.split('-');
      return `${y}년 ${Number(m)}월`;
    }
    const [y, m, d] = value.split('-');
    return `${y}. ${Number(m)}. ${Number(d)}.`;
  };

  const COLORS = ['#FF6B6B', '#4ECDC4', '#FFE66D', '#95E1D3', '#F38181'];

  // 연령대 한글 변환
  const ageGroupLabels: Record<string, string> = {
    '10s': '10대',
    '20s': '20대',
    '30s': '30대',
    '40s': '40대',
    '50s': '50대 이상',
  };

  // 성별 한글 변환
  const genderLabels: Record<string, string> = {
    'male': '남성',
    'female': '여성',
    'other': '선택 안 함',
  };

  return (
    <div className="space-y-6">
      {/* 기간 선택: 일별 / 월별 */}
      <div className="flex flex-wrap gap-2 justify-end items-center">
        <span className="text-xs text-muted-foreground mr-1">일별</span>
        {[7, 30, 90].map((n) => (
          <Button
            key={`d${n}`}
            variant={granularity === 'day' && days === n ? 'default' : 'outline'}
            size="sm"
            onClick={() => { setGranularity('day'); setDays(n); }}
          >
            {n}일
          </Button>
        ))}
        <span className="text-xs text-muted-foreground mx-1">월별</span>
        {[6, 12].map((n) => (
          <Button
            key={`m${n}`}
            variant={granularity === 'month' && months === n ? 'default' : 'outline'}
            size="sm"
            onClick={() => { setGranularity('month'); setMonths(n); }}
          >
            {n}개월
          </Button>
        ))}
      </div>

      {/* 프로필 완성률 카드 */}
      {demographics && (
        <Card className="p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-semibold">프로필 완성률</h3>
            <Users className="w-5 h-5 text-primary" />
          </div>
          <div className="grid grid-cols-3 gap-4">
            <div>
              <div className="text-sm text-muted-foreground">전체 사용자</div>
              <div className="text-2xl font-bold">{demographics.profileCompletion.total}</div>
            </div>
            <div>
              <div className="text-sm text-muted-foreground">프로필 완성</div>
              <div className="text-2xl font-bold text-green-600">
                {demographics.profileCompletion.completed}
              </div>
            </div>
            <div>
              <div className="text-sm text-muted-foreground">완성률</div>
              <div className="text-2xl font-bold text-blue-600">
                {demographics.profileCompletion.total > 0
                  ? Math.round((demographics.profileCompletion.completed / demographics.profileCompletion.total) * 100)
                  : 0}%
              </div>
            </div>
          </div>
        </Card>
      )}

      {/* 일별 신규 가입자 차트 */}
      <Card className="p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold">일별 신규 가입자</h3>
          <TrendingUp className="w-5 h-5 text-primary" />
        </div>
        <ResponsiveContainer width="100%" height={300}>
          <LineChart data={dailySignups || []}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis
              dataKey="date"
              tickFormatter={fmtTick}
            />
            <YAxis />
            <Tooltip
              labelFormatter={fmtLabel}
            />
            <Legend />
            <Line 
              type="monotone" 
              dataKey="count" 
              stroke="#FF6B6B" 
              strokeWidth={2}
              name="신규 가입자"
            />
          </LineChart>
        </ResponsiveContainer>
      </Card>

      {/* DAU (Daily Active Users) 차트 */}
      <Card className="p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold">일별 활성 사용자 (DAU)</h3>
          <Activity className="w-5 h-5 text-primary" />
        </div>
        <ResponsiveContainer width="100%" height={300}>
          <LineChart data={dailyActiveUsers || []}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis
              dataKey="date"
              tickFormatter={fmtTick}
            />
            <YAxis />
            <Tooltip
              labelFormatter={fmtLabel}
            />
            <Legend />
            <Line 
              type="monotone" 
              dataKey="count" 
              stroke="#4ECDC4" 
              strokeWidth={2}
              name="활성 사용자"
            />
          </LineChart>
        </ResponsiveContainer>
      </Card>

      {/* 누적 가입자 차트 */}
      <Card className="p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold">누적 가입자 추이</h3>
          <TrendingUp className="w-5 h-5 text-primary" />
        </div>
        <ResponsiveContainer width="100%" height={300}>
          <LineChart data={cumulativeUsers || []}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis
              dataKey="date"
              tickFormatter={fmtTick}
            />
            <YAxis />
            <Tooltip
              labelFormatter={fmtLabel}
            />
            <Legend />
            <Line 
              type="monotone" 
              dataKey="cumulative" 
              stroke="#FFE66D" 
              strokeWidth={2}
              name="누적 가입자"
            />
          </LineChart>
        </ResponsiveContainer>
      </Card>

      {/* 연령/성별 분포 차트 */}
      {demographics && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* 연령대 분포 */}
          <Card className="p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold">연령대 분포</h3>
              <PieChartIcon className="w-5 h-5 text-primary" />
            </div>
            <ResponsiveContainer width="100%" height={300}>
              <PieChart>
                <Pie
                  data={demographics.ageDistribution.map((item: any) => ({
                    name: ageGroupLabels[item.ageGroup] || item.ageGroup,
                    value: item.count,
                  }))}
                  cx="50%"
                  cy="50%"
                  labelLine={false}
                  label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                  outerRadius={80}
                  fill="#8884d8"
                  dataKey="value"
                >
                  {demographics.ageDistribution.map((_: any, index: number) => (
                    <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip />
              </PieChart>
            </ResponsiveContainer>
          </Card>

          {/* 성별 분포 */}
          <Card className="p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold">성별 분포</h3>
              <PieChartIcon className="w-5 h-5 text-primary" />
            </div>
            <ResponsiveContainer width="100%" height={300}>
              <PieChart>
                <Pie
                  data={demographics.genderDistribution.map((item: any) => ({
                    name: genderLabels[item.gender] || item.gender,
                    value: item.count,
                  }))}
                  cx="50%"
                  cy="50%"
                  labelLine={false}
                  label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                  outerRadius={80}
                  fill="#8884d8"
                  dataKey="value"
                >
                  {demographics.genderDistribution.map((_: any, index: number) => (
                    <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip />
              </PieChart>
            </ResponsiveContainer>
          </Card>
        </div>
      )}
    </div>
  );
}
