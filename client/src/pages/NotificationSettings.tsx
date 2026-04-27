import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "@/components/ui/sonner";
import { ArrowLeft, Mail, Bell, MapPin, Utensils, X } from "lucide-react";

// 선호 음식 카테고리 목록
const FOOD_CATEGORIES = [
  "제육볶음", "돈까스", "백반", "커피", "햄버거", "치킨", "피자",
  "국밥", "초밥/일식", "라멘", "분식", "디저트/케이크", "파스타",
  "샌드위치", "쌀국수/베트남", "마라탕", "순대국", "냉면",
  "삼겹살/고기", "짜장면/중식", "닭발/포차", "카페/음료",
] as const;

const PICK_LABELS = ["1픽", "2픽", "3픽"];

export default function NotificationSettings() {
  const [, setLocation] = useLocation();
  const { data: settings, isLoading, refetch } = trpc.users.getNotificationSettings.useQuery();
  const updateSettings = trpc.users.updateNotificationSettings.useMutation();

  const [emailNotificationsEnabled, setEmailNotificationsEnabled] = useState(true);
  const [pushNotificationsEnabled, setPushNotificationsEnabled] = useState(true); // 앱 푸시 마스터 스위치
  const [newCouponNotifications, setNewCouponNotifications] = useState(true);
  const [expiryNotifications, setExpiryNotifications] = useState(true);
  const [preferredDistrict, setPreferredDistrict] = useState<string | null>(null);
  const [locationNotificationsEnabled, setLocationNotificationsEnabled] = useState(false);
  const [notificationRadius, setNotificationRadius] = useState<number>(200);
  const [favoriteFoodTop3, setFavoriteFoodTop3] = useState<string[]>([]);

  useEffect(() => {
    if (settings) {
      setEmailNotificationsEnabled(settings.emailNotificationsEnabled);
      setPushNotificationsEnabled((settings as any).pushNotificationsEnabled ?? true);
      setNewCouponNotifications(settings.newCouponNotifications);
      setExpiryNotifications(settings.expiryNotifications);
      setPreferredDistrict(settings.preferredDistrict);
      setLocationNotificationsEnabled(settings.locationNotificationsEnabled || false);
      setNotificationRadius(settings.notificationRadius || 200);
      setFavoriteFoodTop3((settings as any).favoriteFoodTop3 || []);
    }
  }, [settings]);

  const handleSave = async () => {
    try {
      await updateSettings.mutateAsync({
        emailNotificationsEnabled,
        pushNotificationsEnabled,
        newCouponNotifications,
        expiryNotifications,
        preferredDistrict,
        locationNotificationsEnabled,
        notificationRadius,
        favoriteFoodTop3,
      });
      toast.success("알림 설정이 저장되었습니다.");
      refetch();
    } catch (error) {
      toast.error("설정 저장에 실패했습니다.");
      console.error(error);
    }
  };

  // 음식 칩 토글 — 3개 제한
  const toggleFood = (food: string) => {
    if (favoriteFoodTop3.includes(food)) {
      setFavoriteFoodTop3(favoriteFoodTop3.filter((f) => f !== food));
    } else {
      if (favoriteFoodTop3.length >= 3) {
        toast("3개까지 선택 가능합니다.", { duration: 2000 });
        return;
      }
      setFavoriteFoodTop3([...favoriteFoodTop3, food]);
    }
  };

  const removeFood = (idx: number) => {
    setFavoriteFoodTop3(favoriteFoodTop3.filter((_, i) => i !== idx));
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
          <Button variant="ghost" size="icon" onClick={() => setLocation("/")}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <h1 className="text-xl font-bold bg-gradient-to-r from-orange-500 to-pink-500 bg-clip-text text-transparent">
            알림 설정
          </h1>
        </div>
      </header>

      {/* 메인 콘텐츠 */}
      <main className="container mx-auto px-4 py-8 max-w-2xl space-y-6">
        {/* ── 앱 푸시 마스터 스위치 ───────────────────────────────────────── */}
        <Card className="shadow-lg">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Bell className="h-5 w-5 text-orange-500" />
              앱 푸시 알림
            </CardTitle>
            <CardDescription>
              앱 푸시를 받지 않으려면 OFF — 단골 매장 신규 쿠폰, 조르기 응답 등 모든 푸시가 차단됩니다
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex items-center justify-between p-4 bg-gradient-to-r from-orange-50 to-pink-50 rounded-lg">
              <div className="flex-1">
                <Label htmlFor="push-master" className="text-base font-semibold">
                  앱 푸시 받기
                </Label>
                <p className="text-sm text-gray-600 mt-1">
                  {pushNotificationsEnabled
                    ? "ON — 단골 매장 활동, 조르기 응답 등 푸시 수신"
                    : "OFF — 모든 앱 푸시 차단"}
                </p>
              </div>
              <Switch
                id="push-master"
                checked={pushNotificationsEnabled}
                onCheckedChange={setPushNotificationsEnabled}
              />
            </div>
          </CardContent>
        </Card>

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
                <p className="text-sm text-gray-600 mt-1">모든 이메일 알림을 받습니다</p>
              </div>
              <Switch
                id="email-notifications"
                checked={emailNotificationsEnabled}
                onCheckedChange={setEmailNotificationsEnabled}
                disabled={!pushNotificationsEnabled}
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
                disabled={!pushNotificationsEnabled || !emailNotificationsEnabled}
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
                disabled={!pushNotificationsEnabled || !emailNotificationsEnabled}
              />
            </div>

            {/* ── 선호 음식 Top3 ─────────────────────────────────────────── */}
            <div className="p-4 border rounded-lg space-y-4">
              <div>
                <Label className="text-base font-semibold flex items-center gap-2">
                  <Utensils className="h-4 w-4 text-orange-500" />
                  내가 좋아하는 음식은?
                  <span className="ml-auto text-xs font-normal text-gray-400">최대 3개</span>
                </Label>
                <p className="text-sm text-gray-600 mt-1">
                  선택한 음식 카테고리의 신규 쿠폰을 추천 알림으로 받습니다 (선호 지역과 무관)
                </p>
              </div>

              {/* 선택된 Top3 배지 */}
              {favoriteFoodTop3.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {favoriteFoodTop3.map((food, idx) => (
                    <span
                      key={food}
                      className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-sm font-semibold bg-orange-100 text-orange-800 border border-orange-300"
                    >
                      <span className="text-xs font-bold text-orange-500">{PICK_LABELS[idx]}</span>
                      {food}
                      <button
                        type="button"
                        onClick={() => removeFood(idx)}
                        className="ml-1 text-orange-400 hover:text-orange-700"
                        aria-label={`${food} 제거`}
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </span>
                  ))}
                </div>
              )}

              {/* 음식 칩 목록 */}
              <div className="flex flex-wrap gap-2">
                {FOOD_CATEGORIES.map((food) => {
                  const selected = favoriteFoodTop3.includes(food);
                  return (
                    <button
                      key={food}
                      type="button"
                      onClick={() => toggleFood(food)}
                      disabled={!pushNotificationsEnabled}
                      className={`rounded-full px-3 py-1 text-sm border transition-all ${
                        selected
                          ? "bg-orange-500 text-white border-orange-500 font-semibold"
                          : "bg-white text-gray-700 border-gray-300 hover:border-orange-400 hover:text-orange-600"
                      } disabled:opacity-50 disabled:cursor-not-allowed`}
                    >
                      {food}
                    </button>
                  );
                })}
              </div>

              {favoriteFoodTop3.length === 0 && (
                <p className="text-xs text-gray-400">아직 선택된 음식이 없습니다.</p>
              )}
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
                disabled={!pushNotificationsEnabled || !emailNotificationsEnabled || !newCouponNotifications}
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

            {/* 위치 기반 알림 설정 */}
            <div className="p-4 border rounded-lg space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <MapPin className="h-4 w-4 text-orange-500" />
                  <Label htmlFor="location-notifications" className="text-base font-semibold">
                    위치 기반 근처 가게 알림
                  </Label>
                </div>
                <Switch
                  id="location-notifications"
                  checked={locationNotificationsEnabled}
                  disabled={!pushNotificationsEnabled}
                  onCheckedChange={(checked) => {
                    setLocationNotificationsEnabled(checked);
                    // 유저 명시적 OFF 의사 = localStorage 기록.
                    // MapPage 의 거리 필터 자동 ON 이 이를 존중함 (덮어쓰기 방지).
                    try {
                      if (checked) {
                        localStorage.removeItem('user_explicit_loc_off');
                      } else {
                        localStorage.setItem('user_explicit_loc_off', 'true');
                      }
                    } catch { /* graceful */ }
                  }}
                />
              </div>
              <p className="text-sm text-gray-600">
                현재 위치 기반으로 설정한 반경 내 가게가 있으면 알림을 받습니다
              </p>

              {locationNotificationsEnabled && (
                <div className="space-y-3 pl-6">
                  <Label className="text-sm font-medium">알림 받을 거리</Label>
                  <div className="space-y-2">
                    {[
                      { value: 100, label: "100m 이내 (가까운 거리)" },
                      { value: 200, label: "200m 이내 (추천, 기본값)" },
                      { value: 500, label: "500m 이내 (넓은 범위)" },
                    ].map(({ value, label }) => (
                      <div key={value} className="flex items-center space-x-2">
                        <input
                          type="radio"
                          id={`radius-${value}`}
                          name="radius"
                          value={String(value)}
                          checked={notificationRadius === value}
                          onChange={(e) => setNotificationRadius(Number(e.target.value))}
                          className="w-4 h-4 text-orange-500"
                        />
                        <Label htmlFor={`radius-${value}`} className="text-sm cursor-pointer">
                          {label}
                        </Label>
                      </div>
                    ))}
                  </div>
                  <div className="p-3 bg-orange-50 border border-orange-200 rounded-md">
                    <p className="text-xs text-orange-800">
                      💡 현재 위치가 변경될 때마다 설정한 반경 내 가게를 확인하여 알림을 보냅니다.
                      (마포 → 강동으로 이동하면 강동 기준으로 알림)
                    </p>
                  </div>
                </div>
              )}
            </div>

            {/* 알림 발송 시간 안내 */}
            <div className="p-4 bg-blue-50 border border-blue-200 rounded-lg">
              <p className="text-sm text-blue-800 font-semibold mb-2">📧 알림 발송 시간</p>
              <ul className="text-sm text-blue-700 space-y-1">
                <li>• 신규 쿠폰 알림: 매일 오전 9시</li>
                <li>• 마감 임박 알림: 매일 오전 10시</li>
                <li>• 위치 기반 알림: 위치 변경 시 즉시</li>
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
