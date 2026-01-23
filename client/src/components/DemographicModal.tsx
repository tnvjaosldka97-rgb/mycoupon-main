import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { trpc } from '@/lib/trpc';
import { Users, Gift, MapPin } from 'lucide-react';

interface DemographicModalProps {
  open: boolean;
  onClose: () => void;
}

// 서울 25개 구 목록
const SEOUL_DISTRICTS = [
  '강남구', '강동구', '강북구', '강서구', '관악구', '광진구', '구로구', '금천구',
  '노원구', '도봉구', '동대문구', '동작구', '마포구', '서대문구', '서초구', '성동구', '성북구',
  '송파구', '양천구', '영등포구', '용산구', '은평구', '종로구', '중구', '중랑구'
];

export function DemographicModal({ open, onClose }: DemographicModalProps) {
  const [ageGroup, setAgeGroup] = useState<string>('');
  const [gender, setGender] = useState<string>('');
  const [preferredDistrict, setPreferredDistrict] = useState<string>('');

  const utils = trpc.useUtils();
  const updateProfile = trpc.users.updateProfile.useMutation({
    onSuccess: () => {
      utils.auth.me.invalidate();
      onClose();
    },
  });

  const handleSubmit = () => {
    if (!ageGroup || !gender || !preferredDistrict) {
      alert('연령대, 성별, 주로 활동하는 지역을 모두 선택해주세요.');
      return;
    }

    updateProfile.mutate({
      ageGroup: ageGroup as any,
      gender: gender as any,
      preferredDistrict,
    });
  };

  const handleSkip = () => {
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <div className="flex items-center gap-2 mb-2">
            <Gift className="w-6 h-6 text-primary" />
            <DialogTitle>더 나은 추천을 위해 알려주세요</DialogTitle>
          </div>
          <DialogDescription>
            연령대, 성별, 주로 활동하는 지역 정보를 입력하시면 더 맞춤화된 쿠폰을 추천해드릴 수 있습니다.
            <br />
            <span className="text-xs text-muted-foreground">(선택 사항이며, 언제든지 건너뛸 수 있습니다)</span>
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6 py-4">
          {/* 연령대 선택 */}
          <div className="space-y-3">
            <Label className="text-base font-semibold">연령대</Label>
            <RadioGroup value={ageGroup} onValueChange={setAgeGroup}>
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="10s" id="age-10s" />
                <Label htmlFor="age-10s" className="cursor-pointer">10대</Label>
              </div>
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="20s" id="age-20s" />
                <Label htmlFor="age-20s" className="cursor-pointer">20대</Label>
              </div>
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="30s" id="age-30s" />
                <Label htmlFor="age-30s" className="cursor-pointer">30대</Label>
              </div>
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="40s" id="age-40s" />
                <Label htmlFor="age-40s" className="cursor-pointer">40대</Label>
              </div>
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="50s" id="age-50s" />
                <Label htmlFor="age-50s" className="cursor-pointer">50대 이상</Label>
              </div>
            </RadioGroup>
          </div>

          {/* 성별 선택 */}
          <div className="space-y-3">
            <Label className="text-base font-semibold">성별</Label>
            <RadioGroup value={gender} onValueChange={setGender}>
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="male" id="gender-male" />
                <Label htmlFor="gender-male" className="cursor-pointer">남성</Label>
              </div>
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="female" id="gender-female" />
                <Label htmlFor="gender-female" className="cursor-pointer">여성</Label>
              </div>
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="other" id="gender-other" />
                <Label htmlFor="gender-other" className="cursor-pointer">선택 안 함</Label>
              </div>
            </RadioGroup>
          </div>

          {/* 주로 활동하는 지역 선택 */}
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <MapPin className="w-4 h-4 text-primary" />
              <Label className="text-base font-semibold">주로 활동하는 지역</Label>
            </div>
            <Select value={preferredDistrict} onValueChange={setPreferredDistrict}>
              <SelectTrigger>
                <SelectValue placeholder="지역을 선택해주세요" />
              </SelectTrigger>
              <SelectContent>
                {SEOUL_DISTRICTS.map((district) => (
                  <SelectItem key={district} value={district}>
                    {district}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              해당 지역에 신규 쿠폰이 등록되면 알림을 받을 수 있습니다.
            </p>
          </div>
        </div>

        <div className="flex gap-2 justify-end">
          <Button variant="outline" onClick={handleSkip}>
            건너뛰기
          </Button>
          <Button 
            onClick={handleSubmit} 
            disabled={!ageGroup || !gender || !preferredDistrict || updateProfile.isPending}
          >
            {updateProfile.isPending ? '저장 중...' : '저장'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
