import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { ArrowLeft, Mail, Bell, MapPin } from "lucide-react";

export default function NotificationSettings() {
  const [, setLocation] = useLocation();
  const { data: settings, isLoading, refetch } = trpc.users.getNotificationSettings.useQuery();
  const updateSettings = trpc.users.updateNotificationSettings.useMutation();

  const [emailNotificationsEnabled, setEmailNotificationsEnabled] = useState(true);
  const [newCouponNotifications, setNewCouponNotifications] = useState(true);
  const [expiryNotifications, setExpiryNotifications] = useState(true);
  const [preferredDistrict, setPreferredDistrict] = useState<string | null>(null);

  useEffect(() => {
    if (settings) {
      setEmailNotificationsEnabled(settings.emailNotificationsEnabled);
      setNewCouponNotifications(settings.newCouponNotifications);
      setExpiryNotifications(settings.expiryNotifications);
      setPreferredDistrict(settings.preferredDistrict);
    }
  }, [settings]);

  const handleSave = async () => {
    try {
      await updateSettings.mutateAsync({
        emailNotificationsEnabled,
        newCouponNotifications,
        expiryNotifications,
        preferredDistrict,
      });
      toast.success("알림 설정이 저장되었습니다.");
      refetch();
    } catch (error) {
      toast.error("설정 저장에 실패했습니다.");
      console.error(error);
    }
  };

  const districts = [
    "강남구", "강동구", "강북구", "강서구", "관악구", "광진구", "구로구", "금천구",
    "노원구", "도봉구", "동대문구", "동작구", "마포구", "서대문구", "서초구", "성동구",
    "성북구", "송파구", "양천구", "영등포구", "용산구", "은평구", "종로구", "중구", "중랑구"
  ];

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-orange-50 via-pink-50 to-orange-50 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-orange-500 mx-auto"></div>
          <p className="mt-4 text-gray-600">로딩 중...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-orange-50 via-pink-50 to-orange-50">
      {/* 헤더 */}
      <header className="bg-white shadow-sm sticky top-0 z-10">
        <div className="container mx-auto px-4 py-4 flex items-center gap-4">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setLocation("/")}
          >
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <h1 className="text-xl font-bold bg-gradient-to-r from-orange-500 to-pink-500 bg-clip-text text-transparent">
            이메일 알림 설정
          </h1>
        </div>
      </header>

      {/* 메인 콘텐츠 */}
      <main className="container mx-auto px-4 py-8 max-w-2xl">
        <Card className="shadow-lg">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Mail className="h-5 w-5 text-orange-500" />
              이메일 알림 설정
            </CardTitle>
            <CardDescription>
              쿠폰 알림을 이메일로 받아보세요. 언제든지 설정을 변경할 수 있습니다.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            {/* 전체 알림 설정 */}
            <div className="flex items-center justify-between p-4 bg-gradient-to-r from-orange-50 to-pink-50 rounded-lg">
              <div className="flex-1">
                <Label htmlFor="email-notifications" className="text-base font-semibold">
                  이메일 알림 수신
                </Label>
                <p className="text-sm text-gray-600 mt-1">
                  모든 이메일 알림을 받습니다
                </p>
              </div>
              <Switch
                id="email-notifications"
                checked={emailNotificationsEnabled}
                onCheckedChange={setEmailNotificationsEnabled}
              />
            </div>

            {/* 신규 쿠폰 알림 */}
            <div className="flex items-center justify-between p-4 border rounded-lg">
              <div className="flex-1">
                <Label htmlFor="new-coupon" className="text-base font-semibold flex items-center gap-2">
                  <Bell className="h-4 w-4 text-orange-500" />
                  신규 쿠폰 알림
                </Label>
                <p className="text-sm text-gray-600 mt-1">
                  선호 지역에 새로운 쿠폰이 등록되면 알림을 받습니다
                </p>
              </div>
              <Switch
                id="new-coupon"
                checked={newCouponNotifications}
                onCheckedChange={setNewCouponNotifications}
                disabled={!emailNotificationsEnabled}
              />
            </div>

            {/* 마감 임박 알림 */}
            <div className="flex items-center justify-between p-4 border rounded-lg">
              <div className="flex-1">
                <Label htmlFor="expiry" className="text-base font-semibold flex items-center gap-2">
                  <Bell className="h-4 w-4 text-pink-500" />
                  마감 임박 알림
                </Label>
                <p className="text-sm text-gray-600 mt-1">
                  다운로드한 쿠폰이 24시간 내 만료될 때 알림을 받습니다
                </p>
              </div>
              <Switch
                id="expiry"
                checked={expiryNotifications}
                onCheckedChange={setExpiryNotifications}
                disabled={!emailNotificationsEnabled}
              />
            </div>

            {/* 선호 지역 설정 */}
            <div className="p-4 border rounded-lg space-y-3">
              <Label htmlFor="district" className="text-base font-semibold flex items-center gap-2">
                <MapPin className="h-4 w-4 text-orange-500" />
                선호 지역 설정
              </Label>
              <p className="text-sm text-gray-600">
                선호하는 지역을 설정하면 해당 지역의 신규 쿠폰 알림을 받습니다
              </p>
              <Select
                value={preferredDistrict || "none"}
                onValueChange={(value) => setPreferredDistrict(value === "none" ? null : value)}
                disabled={!emailNotificationsEnabled || !newCouponNotifications}
              >
                <SelectTrigger id="district">
                  <SelectValue placeholder="지역을 선택하세요" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">선택 안 함 (모든 지역)</SelectItem>
                  {districts.map((district) => (
                    <SelectItem key={district} value={district}>
                      {district}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* 알림 발송 시간 안내 */}
            <div className="p-4 bg-blue-50 border border-blue-200 rounded-lg">
              <p className="text-sm text-blue-800 font-semibold mb-2">📧 알림 발송 시간</p>
              <ul className="text-sm text-blue-700 space-y-1">
                <li>• 신규 쿠폰 알림: 매일 오전 9시</li>
                <li>• 마감 임박 알림: 매일 오전 10시</li>
              </ul>
            </div>

            {/* 저장 버튼 */}
            <Button
              onClick={handleSave}
              disabled={updateSettings.isPending}
              className="w-full bg-gradient-to-r from-orange-500 to-pink-500 hover:from-orange-600 hover:to-pink-600"
            >
              {updateSettings.isPending ? "저장 중..." : "설정 저장"}
            </Button>
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
