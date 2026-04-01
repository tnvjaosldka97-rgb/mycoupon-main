import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { AddressAutocomplete } from './AddressAutocomplete';
import { CheckCircle2, ExternalLink, Star } from 'lucide-react';

interface EditStoreModalProps {
  store: any;
  open: boolean;
  onClose: () => void;
  onSubmit: (data: any) => void;
  isPending: boolean;
}

export function EditStoreModal({ store, open, onClose, onSubmit, isPending }: EditStoreModalProps) {
  const [formData, setFormData] = useState({
    name: '',
    category: 'cafe' as 'cafe' | 'restaurant' | 'beauty' | 'hospital' | 'fitness' | 'other',
    address: '',
    phone: '',
    description: '',
    naverPlaceUrl: '',
    rating: 0,
    ratingCount: 0,
  });
  const [gpsCoords, setGpsCoords] = useState<{ lat: number; lng: number } | null>(null);

  useEffect(() => {
    if (store) {
      setFormData({
        name: store.name || '',
        category: store.category || 'cafe',
        address: store.address || '',
        phone: store.phone || '',
        description: store.description || '',
        naverPlaceUrl: store.naverPlaceUrl || '',
        rating: parseFloat(store.rating) || 0,
        ratingCount: store.ratingCount || 0,
      });
      setGpsCoords(null);
    }
  }, [store]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit({
      id: store.id,
      ...formData,
    });
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>가게 정보 수정</DialogTitle>
          <DialogDescription>가게 정보를 수정합니다</DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="edit-name">가게 이름 *</Label>
            <Input
              id="edit-name"
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              placeholder="예: 스타벅스 강남점"
              required
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="edit-category">카테고리 *</Label>
            <Select value={formData.category} onValueChange={(value: any) => setFormData({ ...formData, category: value })}>
              <SelectTrigger id="edit-category">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="cafe">☕ 카페</SelectItem>
                <SelectItem value="restaurant">🍽️ 음식점</SelectItem>
                <SelectItem value="beauty">💅 뷰티</SelectItem>
                <SelectItem value="hospital">🏥 병원</SelectItem>
                <SelectItem value="fitness">💪 헬스장</SelectItem>
                <SelectItem value="other">🎁 기타</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div>
            <AddressAutocomplete
              value={formData.address}
              onChange={(address, coordinates) => {
                setFormData({ ...formData, address });
                if (coordinates) {
                  setGpsCoords(coordinates);
                }
              }}
              label="주소"
              placeholder="주소를 검색하세요"
              required
            />
          </div>

          {gpsCoords && (
            <div className="p-4 bg-green-50 border border-green-200 rounded-lg">
              <div className="flex items-center gap-2 text-green-700">
                <CheckCircle2 className="w-5 h-5" />
                <span className="font-medium">GPS 좌표 변환 성공!</span>
              </div>
              <p className="text-sm text-green-600 mt-1">
                위도: {gpsCoords.lat.toFixed(6)}, 경도: {gpsCoords.lng.toFixed(6)}
              </p>
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="edit-phone">전화번호</Label>
            <Input
              id="edit-phone"
              value={formData.phone}
              onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
              placeholder="02-1234-5678"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="edit-description">내 업체 자랑하기</Label>
            <Textarea
              id="edit-description"
              value={formData.description}
              onChange={(e) => setFormData({ ...formData, description: e.target.value })}
              placeholder="예: 여기는 갈비가 맛있고 직화구이가 일품이에요!"
              rows={3}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="edit-naverPlaceUrl">네이버 플레이스 링크</Label>
            <div className="flex gap-2">
              <Input
                id="edit-naverPlaceUrl"
                value={formData.naverPlaceUrl}
                onChange={(e) => setFormData({ ...formData, naverPlaceUrl: e.target.value })}
                placeholder="https://m.place.naver.com/... 또는 https://map.naver.com/..."
                className="flex-1"
              />
              {formData.naverPlaceUrl && (
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  onClick={() => window.open(formData.naverPlaceUrl, '_blank')}
                >
                  <ExternalLink className="w-4 h-4" />
                </Button>
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              네이버 플레이스 링크를 입력하면 대표 이미지를 자동으로 가져옵니다.
            </p>
            {store?.imageUrl && (
              <div className="mt-2">
                <p className="text-xs text-muted-foreground mb-1">현재 대표 이미지:</p>
                <img 
                  src={store.imageUrl} 
                  alt="대표 이미지" 
                  className="w-32 h-32 object-cover rounded-lg border"
                />
              </div>
            )}
          </div>

          {/* 별점 수동 조정 섹션 */}
          <div className="p-4 bg-amber-50 border border-amber-200 rounded-lg space-y-4">
            <div className="flex items-center gap-2 text-amber-700">
              <Star className="w-5 h-5 fill-amber-500" />
              <span className="font-medium">별점 수동 조정 (관리자 전용)</span>
            </div>
            
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="edit-rating">별점 (0.0 ~ 5.0)</Label>
                <Input
                  id="edit-rating"
                  type="number"
                  step="0.1"
                  min="0"
                  max="5"
                  value={formData.rating}
                  onChange={(e) => {
                    const value = parseFloat(e.target.value) || 0;
                    setFormData({ ...formData, rating: Math.min(5, Math.max(0, value)) });
                  }}
                  placeholder="4.5"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="edit-ratingCount">리뷰 개수</Label>
                <Input
                  id="edit-ratingCount"
                  type="number"
                  min="0"
                  value={formData.ratingCount}
                  onChange={(e) => {
                    const value = parseInt(e.target.value) || 0;
                    setFormData({ ...formData, ratingCount: Math.max(0, value) });
                  }}
                  placeholder="128"
                />
              </div>
            </div>
            
            <div className="flex items-center gap-1 text-sm text-amber-600">
              {[1, 2, 3, 4, 5].map((star) => (
                <Star
                  key={star}
                  className={`w-4 h-4 ${
                    star <= formData.rating
                      ? 'fill-amber-500 text-amber-500'
                      : star - 0.5 <= formData.rating
                      ? 'fill-amber-500/50 text-amber-500'
                      : 'text-gray-300'
                  }`}
                />
              ))}
              <span className="ml-2">{formData.rating.toFixed(1)} ({formData.ratingCount}개 리뷰)</span>
            </div>
          </div>

          <div className="flex gap-2 justify-end">
            <Button type="button" variant="outline" onClick={onClose}>
              취소
            </Button>
            <Button type="submit" className="bg-gradient-to-r from-primary to-accent" disabled={isPending}>
              {isPending ? '수정 중...' : '수정 완료'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
