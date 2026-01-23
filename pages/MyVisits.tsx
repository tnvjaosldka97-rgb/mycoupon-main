import { useAuth } from "@/_core/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft, MapPin } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { Link, useLocation } from "wouter";
import { getLoginUrl } from "@/const";

export default function MyVisits() {
  const [, setLocation] = useLocation();
  const { user, loading } = useAuth();

  const { data: visits, isLoading } = trpc.visits.myVisits.useQuery(undefined, {
    enabled: !!user,
  });

  if (loading || isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p className="text-gray-600">로딩 중...</p>
      </div>
    );
  }

  if (!user) {
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
          <h1 className="text-2xl font-bold text-gray-900">내 방문 기록</h1>
          <div className="w-24"></div>
        </div>
      </header>

      <div className="container mx-auto px-4 py-8 max-w-4xl">
        {visits && visits.length > 0 ? (
          <div className="space-y-4">
            {visits.map((visit) => (
              <Card key={visit.id}>
                <CardHeader>
                  <div className="flex items-start justify-between">
                    <div>
                      <CardTitle>가게 ID: {visit.storeId}</CardTitle>
                      <CardDescription className="mt-1">
                        {new Date(visit.visitedAt).toLocaleString()}
                      </CardDescription>
                    </div>
                    <Badge variant="outline">
                      {visit.source === 'search' ? '검색' : 
                       visit.source === 'recommendation' ? 'AI 추천' : 
                       '직접 방문'}
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent>
                  <Link href={`/store/${visit.storeId}`}>
                    <a>
                      <Button variant="outline" size="sm">
                        가게 보기
                      </Button>
                    </a>
                  </Link>
                </CardContent>
              </Card>
            ))}
          </div>
        ) : (
          <Card>
            <CardContent className="text-center py-12">
              <MapPin className="h-12 w-12 text-gray-400 mx-auto mb-4" />
              <p className="text-gray-600 mb-4">아직 방문 기록이 없습니다.</p>
              <Button onClick={() => setLocation("/")}>
                가게 둘러보기
              </Button>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
