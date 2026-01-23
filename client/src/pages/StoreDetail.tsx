import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { MapPin, Phone, Clock, Star, ArrowLeft } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { useState } from "react";
import { Link, useParams, useLocation } from "wouter";
import { toast } from "@/components/ui/sonner";
import { getLoginUrl } from "@/lib/const";

export default function StoreDetail() {
  const { id } = useParams<{ id: string }>();
  const [, setLocation] = useLocation();
  const { user } = useAuth();
  const [rating, setRating] = useState(5);
  const [reviewContent, setReviewContent] = useState("");

  const storeId = parseInt(id || "0");
  const { data: store, isLoading } = trpc.stores.get.useQuery({ id: storeId });
  const createVisit = trpc.visits.create.useMutation();
  const createReview = trpc.reviews.create.useMutation({
    onSuccess: () => {
      toast.success("리뷰가 작성되었습니다!");
      setReviewContent("");
      setRating(5);
      // 리뷰 목록 새로고침
      trpcUtils.stores.get.invalidate({ id: storeId });
    },
  });

  const trpcUtils = trpc.useUtils();

  // 페이지 로드 시 방문 기록
  useState(() => {
    if (storeId) {
      createVisit.mutate({
        storeId,
        source: "direct",
      });
    }
  });

  const handleSubmitReview = () => {
    if (!user) {
      toast.error("로그인이 필요합니다.");
      window.location.href = getLoginUrl();
      return;
    }

    createReview.mutate({
      storeId,
      rating,
      content: reviewContent,
    });
  };

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p className="text-gray-600">로딩 중...</p>
      </div>
    );
  }

  if (!store) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p className="text-gray-600">가게를 찾을 수 없습니다.</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="border-b bg-white">
        <div className="container mx-auto px-4 py-4">
          <Button variant="ghost" onClick={() => setLocation("/")}>
            <ArrowLeft className="mr-2 h-4 w-4" />
            돌아가기
          </Button>
        </div>
      </header>

      <div className="container mx-auto px-4 py-8">
        {/* Store Info */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          <div className="lg:col-span-2">
            {store.imageUrl && (
              <div className="h-96 overflow-hidden rounded-lg mb-6">
                <img
                  src={store.imageUrl}
                  alt={store.name}
                  className="w-full h-full object-cover"
                />
              </div>
            )}

            <Card>
              <CardHeader>
                <div className="flex items-start justify-between">
                  <div>
                    <CardTitle className="text-3xl">{store.name}</CardTitle>
                    <CardDescription className="text-lg mt-2">
                      <Badge variant="secondary" className="text-base">{store.category}</Badge>
                    </CardDescription>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                {store.description && (
                  <p className="text-gray-700">{store.description}</p>
                )}

                <div className="flex items-start gap-2 text-gray-600">
                  <MapPin className="h-5 w-5 mt-0.5 flex-shrink-0" />
                  <span>{store.address}</span>
                </div>

                {store.phone && (
                  <div className="flex items-center gap-2 text-gray-600">
                    <Phone className="h-5 w-5 flex-shrink-0" />
                    <span>{store.phone}</span>
                  </div>
                )}

                {store.openingHours && (
                  <div className="flex items-start gap-2 text-gray-600">
                    <Clock className="h-5 w-5 mt-0.5 flex-shrink-0" />
                    <span>{store.openingHours}</span>
                  </div>
                )}

                {/* 별점 표시 */}
                <div className="flex items-center gap-2">
                  <div className="flex items-center gap-0.5">
                    {[1, 2, 3, 4, 5].map((star) => (
                      <Star
                        key={star}
                        className={`w-5 h-5 ${
                          star <= parseFloat(store.rating || '0')
                            ? 'fill-amber-500 text-amber-500'
                            : star - 0.5 <= parseFloat(store.rating || '0')
                            ? 'fill-amber-500/50 text-amber-500'
                            : 'text-gray-300'
                        }`}
                      />
                    ))}
                  </div>
                  <span className="text-lg font-bold text-amber-600">
                    {parseFloat(store.rating || '0').toFixed(1)}
                  </span>
                  <span className="text-sm text-muted-foreground">
                    ({store.ratingCount || 0}개 리뷰)
                  </span>
                </div>

                <div className="pt-4 border-t">
                  <p className="text-sm text-gray-500">
                    총 방문 수: <span className="font-semibold text-gray-700">{store.visitCount}</span>
                  </p>
                </div>
              </CardContent>
            </Card>

            {/* Reviews */}
            <Card className="mt-6">
              <CardHeader>
                <CardTitle>리뷰</CardTitle>
              </CardHeader>
              <CardContent>
                {store.reviews && store.reviews.length > 0 ? (
                  <div className="space-y-4">
                    {store.reviews.map((review) => (
                      <div key={review.id} className="border-b pb-4 last:border-b-0">
                        <div className="flex items-center gap-2 mb-2">
                          <div className="flex">
                            {Array.from({ length: review.rating }).map((_, i) => (
                              <Star key={i} className="h-4 w-4 fill-yellow-400 text-yellow-400" />
                            ))}
                          </div>
                          <span className="text-sm text-gray-500">
                            {new Date(review.createdAt).toLocaleDateString()}
                          </span>
                        </div>
                        {review.content && (
                          <p className="text-gray-700">{review.content}</p>
                        )}
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-gray-500">아직 리뷰가 없습니다.</p>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Write Review */}
          <div>
            <Card className="sticky top-4">
              <CardHeader>
                <CardTitle>리뷰 작성</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <Label>평점</Label>
                  <div className="flex gap-1 mt-2">
                    {[1, 2, 3, 4, 5].map((star) => (
                      <button
                        key={star}
                        onClick={() => setRating(star)}
                        className="focus:outline-none"
                      >
                        <Star
                          className={`h-8 w-8 ${
                            star <= rating
                              ? "fill-yellow-400 text-yellow-400"
                              : "text-gray-300"
                          }`}
                        />
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <Label htmlFor="review-content">내용</Label>
                  <Textarea
                    id="review-content"
                    placeholder="이 가게에 대한 경험을 공유해주세요..."
                    rows={5}
                    value={reviewContent}
                    onChange={(e) => setReviewContent(e.target.value)}
                    className="mt-2"
                  />
                </div>

                <Button
                  className="w-full"
                  onClick={handleSubmitReview}
                  disabled={createReview.isPending}
                >
                  {createReview.isPending ? "작성 중..." : "리뷰 작성"}
                </Button>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}
