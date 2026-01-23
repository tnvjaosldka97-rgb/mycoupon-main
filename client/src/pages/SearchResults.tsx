import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Search, MapPin, ArrowLeft } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { useState, useEffect } from "react";
import { Link, useLocation } from "wouter";

export default function SearchResults() {
  const [, setLocation] = useLocation();
  const [searchQuery, setSearchQuery] = useState("");
  const [actualQuery, setActualQuery] = useState("");

  // URL에서 검색어 가져오기
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const q = params.get("q") || "";
    setSearchQuery(q);
    setActualQuery(q);
  }, []);

  const { data: results, isLoading } = trpc.stores.search.useQuery(
    { query: actualQuery },
    { enabled: !!actualQuery }
  );

  const handleSearch = () => {
    if (searchQuery.trim()) {
      setActualQuery(searchQuery);
      window.history.pushState({}, "", `/search?q=${encodeURIComponent(searchQuery)}`);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="border-b bg-white">
        <div className="container mx-auto px-4 py-4">
          <Button variant="ghost" onClick={() => setLocation("/")}>
            <ArrowLeft className="mr-2 h-4 w-4" />
            홈으로
          </Button>
        </div>
      </header>

      <div className="container mx-auto px-4 py-8">
        {/* Search Bar */}
        <div className="max-w-2xl mx-auto mb-8">
          <div className="flex gap-2">
            <Input
              type="text"
              placeholder="가게 이름, 카테고리 검색..."
              className="flex-1 h-12 text-lg"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleSearch()}
            />
            <Button size="lg" onClick={handleSearch}>
              <Search className="mr-2 h-5 w-5" />
              검색
            </Button>
          </div>
        </div>

        {/* Results */}
        <div>
          <h2 className="text-2xl font-bold text-gray-900 mb-6">
            {actualQuery ? `"${actualQuery}" 검색 결과` : "검색 결과"}
          </h2>

          {isLoading ? (
            <div className="text-center py-12">
              <p className="text-gray-600">검색 중...</p>
            </div>
          ) : results && results.length > 0 ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {results.map((store) => (
                <Link key={store.id} href={`/store/${store.id}`}>
                  <a>
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
                            <CardDescription className="flex items-center gap-1 mt-1">
                              <MapPin className="h-4 w-4" />
                              {store.address}
                            </CardDescription>
                          </div>
                          <Badge variant="secondary">{store.category}</Badge>
                        </div>
                      </CardHeader>
                    </Card>
                  </a>
                </Link>
              ))}
            </div>
          ) : (
            <div className="text-center py-12">
              <p className="text-gray-600">검색 결과가 없습니다.</p>
              <Button className="mt-4" onClick={() => setLocation("/")}>
                홈으로 돌아가기
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
