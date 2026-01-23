import { useState } from 'react';
import { trpc } from '@/lib/trpc';
import { useAuth } from '@/hooks/useAuth';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Star, MessageSquare, Send, User } from 'lucide-react';

interface StoreReviewsProps {
  storeId: number;
  storeName: string;
  rating?: number;
  ratingCount?: number;
}

export function StoreReviews({ storeId, storeName, rating = 0, ratingCount = 0 }: StoreReviewsProps) {
  const { user } = useAuth();
  const [newReview, setNewReview] = useState('');
  const [newRating, setNewRating] = useState(5);
  const [hoverRating, setHoverRating] = useState(0);

  const utils = trpc.useUtils();
  const { data: reviews, isLoading } = trpc.reviews.byStore.useQuery({ storeId });
  const createReview = trpc.reviews.create.useMutation({
    onSuccess: () => {
      utils.reviews.byStore.invalidate({ storeId });
      setNewReview('');
      setNewRating(5);
    },
  });

  const handleSubmitReview = () => {
    if (!newReview.trim()) return;
    createReview.mutate({
      storeId,
      rating: newRating,
      content: newReview,
    });
  };

  const displayRating = parseFloat(String(rating)) || 0;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <MessageSquare className="w-5 h-5" />
          리뷰 및 댓글
        </CardTitle>
        
        {/* 별점 표시 */}
        <div className="flex items-center gap-2 mt-2">
          <div className="flex items-center gap-0.5">
            {[1, 2, 3, 4, 5].map((star) => (
              <Star
                key={star}
                className={`w-5 h-5 ${
                  star <= displayRating
                    ? 'fill-amber-500 text-amber-500'
                    : star - 0.5 <= displayRating
                    ? 'fill-amber-500/50 text-amber-500'
                    : 'text-gray-300'
                }`}
              />
            ))}
          </div>
          <span className="text-lg font-bold text-amber-600">{displayRating.toFixed(1)}</span>
          <span className="text-sm text-muted-foreground">({ratingCount}개 리뷰)</span>
        </div>
      </CardHeader>

      <CardContent className="space-y-6">
        {/* 리뷰 작성 폼 */}
        {user ? (
          <div className="p-4 bg-muted/50 rounded-lg space-y-4">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium">별점:</span>
              <div className="flex items-center gap-0.5">
                {[1, 2, 3, 4, 5].map((star) => (
                  <button
                    key={star}
                    type="button"
                    onClick={() => setNewRating(star)}
                    onMouseEnter={() => setHoverRating(star)}
                    onMouseLeave={() => setHoverRating(0)}
                    className="focus:outline-none"
                  >
                    <Star
                      className={`w-6 h-6 transition-colors ${
                        star <= (hoverRating || newRating)
                          ? 'fill-amber-500 text-amber-500'
                          : 'text-gray-300 hover:text-amber-300'
                      }`}
                    />
                  </button>
                ))}
              </div>
              <span className="text-sm text-muted-foreground">({newRating}점)</span>
            </div>
            
            <Textarea
              value={newReview}
              onChange={(e) => setNewReview(e.target.value)}
              placeholder={`${storeName}에 대한 리뷰를 작성해주세요...`}
              rows={3}
            />
            
            <Button
              onClick={handleSubmitReview}
              disabled={!newReview.trim() || createReview.isPending}
              className="w-full"
            >
              <Send className="w-4 h-4 mr-2" />
              {createReview.isPending ? '등록 중...' : '리뷰 등록'}
            </Button>
          </div>
        ) : (
          <div className="p-4 bg-muted/50 rounded-lg text-center">
            <p className="text-muted-foreground">리뷰를 작성하려면 로그인이 필요합니다.</p>
          </div>
        )}

        {/* 리뷰 목록 */}
        <div className="space-y-4">
          {isLoading ? (
            <div className="text-center py-8 text-muted-foreground">
              리뷰를 불러오는 중...
            </div>
          ) : reviews && reviews.length > 0 ? (
            reviews.map((review) => (
              <div key={review.id} className="p-4 border rounded-lg space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className="w-8 h-8 bg-primary/10 rounded-full flex items-center justify-center">
                      <User className="w-4 h-4 text-primary" />
                    </div>
                    <span className="font-medium">{review.userName || '익명'}</span>
                  </div>
                  <div className="flex items-center gap-1">
                    {[1, 2, 3, 4, 5].map((star) => (
                      <Star
                        key={star}
                        className={`w-4 h-4 ${
                          star <= review.rating
                            ? 'fill-amber-500 text-amber-500'
                            : 'text-gray-300'
                        }`}
                      />
                    ))}
                  </div>
                </div>
                
                {review.content && (
                  <p className="text-sm text-foreground/80">{review.content}</p>
                )}
                
                <p className="text-xs text-muted-foreground">
                  {new Date(review.createdAt).toLocaleDateString('ko-KR', {
                    year: 'numeric',
                    month: 'long',
                    day: 'numeric',
                  })}
                </p>
              </div>
            ))
          ) : (
            <div className="text-center py-8 text-muted-foreground">
              아직 리뷰가 없습니다. 첫 번째 리뷰를 작성해보세요!
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
