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

  const { data: dailySignups } = trpc.analytics.dailySignups.useQuery({ days });
  const { data: dailyActiveUsers } = trpc.analytics.dailyActiveUsers.useQuery({ days });
  const { data: cumulativeUsers } = trpc.analytics.cumulativeUsers.useQuery({ days });
  const { data: demographics } = trpc.analytics.demographicDistribution.useQuery();

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
      {/* 기간 선택 버튼 */}
      <div className="flex gap-2 justify-end">
        <Button
          variant={days === 7 ? 'default' : 'outline'}
          size="sm"
          onClick={() => setDays(7)}
        >
          7일
        </Button>
        <Button
          variant={days === 30 ? 'default' : 'outline'}
          size="sm"
          onClick={() => setDays(30)}
        >
          30일
        </Button>
        <Button
          variant={days === 90 ? 'default' : 'outline'}
          size="sm"
          onClick={() => setDays(90)}
        >
          90일
        </Button>
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
              tickFormatter={(value) => {
                const date = new Date(value);
                return `${date.getMonth() + 1}/${date.getDate()}`;
              }}
            />
            <YAxis />
            <Tooltip 
              labelFormatter={(value) => new Date(value).toLocaleDateString('ko-KR')}
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
              tickFormatter={(value) => {
                const date = new Date(value);
                return `${date.getMonth() + 1}/${date.getDate()}`;
              }}
            />
            <YAxis />
            <Tooltip 
              labelFormatter={(value) => new Date(value).toLocaleDateString('ko-KR')}
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
              tickFormatter={(value) => {
                const date = new Date(value);
                return `${date.getMonth() + 1}/${date.getDate()}`;
              }}
            />
            <YAxis />
            <Tooltip 
              labelFormatter={(value) => new Date(value).toLocaleDateString('ko-KR')}
            />
            <Legend />
            <Line 
              type="monotone" 
              dataKey="cumulative_count" 
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
