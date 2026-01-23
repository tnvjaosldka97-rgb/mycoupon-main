import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

interface EditCouponModalProps {
  coupon: any;
  open: boolean;
  onClose: () => void;
  onSubmit: (data: any) => void;
  isPending: boolean;
}

export function EditCouponModal({ coupon, open, onClose, onSubmit, isPending }: EditCouponModalProps) {
  const [formData, setFormData] = useState({
    title: '',
    description: '',
    discountType: 'percentage' as 'percentage' | 'fixed' | 'freebie',
    discountValue: 0,
    totalQuantity: 100,
    remainingQuantity: 100,
    startDate: '',
    endDate: '',
  });

  useEffect(() => {
    if (coupon) {
      // Date 객체를 YYYY-MM-DD 형식으로 변환
      const formatDate = (date: any) => {
        if (!date) return '';
        const d = new Date(date);
        return d.toISOString().split('T')[0];
      };

      setFormData({
        title: coupon.title || '',
        description: coupon.description || '',
        discountType: coupon.discountType || 'percentage',
        discountValue: coupon.discountValue || 0,
        totalQuantity: coupon.totalQuantity || 100,
        remainingQuantity: coupon.remainingQuantity || coupon.totalQuantity || 100,
        startDate: formatDate(coupon.startDate),
        endDate: formatDate(coupon.endDate),
      });
    }
  }, [coupon]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit({
      id: coupon.id,
      ...formData,
    });
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>쿠폰 정보 수정</DialogTitle>
          <DialogDescription>쿠폰 정보를 수정합니다</DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="edit-title">쿠폰 제목 *</Label>
            <Input
              id="edit-title"
              value={formData.title}
              onChange={(e) => setFormData({ ...formData, title: e.target.value })}
              placeholder="예: 아메리카노 30% 할인"
              required
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="edit-discount-type">할인 유형 *</Label>
            <Select value={formData.discountType} onValueChange={(value: any) => setFormData({ ...formData, discountType: value })}>
              <SelectTrigger id="edit-discount-type">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="percentage">% 할인</SelectItem>
                <SelectItem value="fixed">원 할인</SelectItem>
                <SelectItem value="freebie">무료 증정</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {formData.discountType !== 'freebie' && (
            <div className="space-y-2">
              <Label htmlFor="edit-discount-value">
                할인 값 * {formData.discountType === 'percentage' ? '(%)' : '(원)'}
              </Label>
              <Input
                id="edit-discount-value"
                type="number"
                value={formData.discountValue}
                onChange={(e) => setFormData({ ...formData, discountValue: parseInt(e.target.value) })}
                placeholder={formData.discountType === 'percentage' ? '30' : '3000'}
                required
              />
            </div>
          )}

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="edit-quantity">총 발행 수량 *</Label>
              <Input
                id="edit-quantity"
                type="number"
                value={formData.totalQuantity}
                onChange={(e) => {
                  const newTotal = parseInt(e.target.value) || 0;
                  // 총 수량이 변경되면 남은 수량도 비례하여 조정
                  const diff = newTotal - formData.totalQuantity;
                  const newRemaining = Math.max(0, formData.remainingQuantity + diff);
                  setFormData({ ...formData, totalQuantity: newTotal, remainingQuantity: newRemaining });
                }}
                placeholder="100"
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-remaining">남은 수량 *</Label>
              <Input
                id="edit-remaining"
                type="number"
                value={formData.remainingQuantity}
                onChange={(e) => {
                  const newRemaining = parseInt(e.target.value) || 0;
                  // 남은 수량은 총 수량을 초과할 수 없음
                  setFormData({ ...formData, remainingQuantity: Math.min(newRemaining, formData.totalQuantity) });
                }}
                placeholder="100"
                required
              />
              <p className="text-xs text-muted-foreground">
                사용된 수량: {formData.totalQuantity - formData.remainingQuantity}개
              </p>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="edit-start-date">시작일 *</Label>
              <Input
                id="edit-start-date"
                type="date"
                value={formData.startDate}
                onChange={(e) => setFormData({ ...formData, startDate: e.target.value })}
                required
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="edit-end-date">종료일 *</Label>
              <Input
                id="edit-end-date"
                type="date"
                value={formData.endDate}
                onChange={(e) => setFormData({ ...formData, endDate: e.target.value })}
                required
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="edit-coupon-description">쿠폰 설명</Label>
            <Textarea
              id="edit-coupon-description"
              value={formData.description}
              onChange={(e) => setFormData({ ...formData, description: e.target.value })}
              placeholder="쿠폰 사용 조건 및 상세 설명"
              rows={3}
            />
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
