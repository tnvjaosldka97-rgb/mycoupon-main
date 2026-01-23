import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { QrCode, CheckCircle2, XCircle, Scan, Camera } from "lucide-react";
import { Link } from "wouter";
import { toast } from "sonner";
import QRScanner from "@/components/QRScanner";

export default function MerchantCouponVerify() {
  const [couponCode, setCouponCode] = useState("");
  const [storeId, setStoreId] = useState<number | null>(null);
  const [verificationResult, setVerificationResult] = useState<any>(null);
  const [showScanner, setShowScanner] = useState(false);

  const { data: myStores } = trpc.stores.myStores.useQuery();
  const verifyMutation = trpc.couponUsage.verify.useMutation({
    onSuccess: () => {
      setVerificationResult({ success: true });
      toast.success("쿠폰이 성공적으로 사용 처리되었습니다!");
      setCouponCode("");
    },
    onError: (error) => {
      setVerificationResult({ success: false, error: error.message });
      toast.error(error.message);
    },
  });

  const handleVerify = () => {
    if (!couponCode.trim()) {
      toast.error("쿠폰 번호를 입력해주세요");
      return;
    }
    if (!storeId) {
      toast.error("가게를 선택해주세요");
      return;
    }

    verifyMutation.mutate({
      couponCode: couponCode.trim(),
      storeId,
    });
  };

  const handleScan = (result: string) => {
    setCouponCode(result);
    setShowScanner(false);
    toast.success("QR 코드 스캔 완료!");
    
    // 자동으로 검증 시작
    if (storeId) {
      setTimeout(() => {
        verifyMutation.mutate({
          couponCode: result.trim(),
          storeId,
        });
      }, 500);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-peach-50 to-mint-50">
      {/* 헤더 */}
      <div className="bg-gradient-to-r from-peach-400 via-pink-400 to-mint-400 text-white py-8 px-4 shadow-lg">
        <div className="container max-w-4xl">
          <Button variant="ghost" size="sm" className="text-white hover:bg-white/20 mb-4" asChild>
            <Link href="/merchant/dashboard">
              ← 대시보드로
            </Link>
          </Button>
          <div className="flex items-center gap-3 mb-2">
            <QrCode className="w-8 h-8" />
            <h1 className="text-3xl font-bold">쿠폰 검증</h1>
          </div>
          <p className="text-white/90">고객의 쿠폰을 확인하고 사용 처리하세요</p>
        </div>
      </div>

      {/* 메인 컨텐츠 */}
      <div className="container max-w-4xl py-8 px-4">
        <Card className="p-6 mb-6">
          <h2 className="text-xl font-bold mb-4">가게 선택</h2>
          <div className="grid gap-3">
            {myStores?.map((store) => (
              <Button
                key={store.id}
                variant={storeId === store.id ? "default" : "outline"}
                className="justify-start h-auto py-3"
                onClick={() => setStoreId(store.id)}
              >
                <div className="text-left">
                  <div className="font-semibold">{store.name}</div>
                  <div className="text-sm opacity-70">{store.address}</div>
                </div>
              </Button>
            ))}
          </div>
        </Card>

        <Card className="p-6 mb-6">
          <h2 className="text-xl font-bold mb-4 flex items-center gap-2">
            <Scan className="w-5 h-5" />
            쿠폰 번호 입력
          </h2>

          <div className="space-y-4">
            <div>
              <Input
                type="text"
                placeholder="CPN-20241209-123456"
                value={couponCode}
                onChange={(e) => setCouponCode(e.target.value)}
                onKeyPress={(e) => e.key === 'Enter' && handleVerify()}
                className="text-lg font-mono"
              />
              <p className="text-sm text-gray-500 mt-2">
                고객의 쿠폰 번호를 입력하거나 QR 코드를 스캔하세요
              </p>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <Button
                onClick={() => setShowScanner(true)}
                disabled={!storeId}
                variant="outline"
                className="h-14 text-base border-2 border-peach-400 text-peach-600 hover:bg-peach-50"
              >
                <Camera className="w-5 h-5 mr-2" />
                QR 스캔
              </Button>
              <Button
                onClick={handleVerify}
                disabled={verifyMutation.isPending || !storeId}
                className="h-14 text-base bg-gradient-to-r from-peach-400 to-pink-400 hover:from-peach-500 hover:to-pink-500"
              >
                {verifyMutation.isPending ? "확인 중..." : "쿠폰 확인"}
              </Button>
            </div>
          </div>
        </Card>

        {/* 검증 결과 */}
        {verificationResult && (
          <Card className="p-6">
            {verificationResult.success ? (
              <div className="text-center">
                <CheckCircle2 className="w-16 h-16 text-green-500 mx-auto mb-4" />
                <h3 className="text-2xl font-bold text-green-700 mb-2">
                  쿠폰 사용 완료!
                </h3>
                <p className="text-gray-600">
                  쿠폰이 성공적으로 사용 처리되었습니다.
                </p>
                <Badge className="mt-4 bg-green-100 text-green-700">
                  사용 완료
                </Badge>
              </div>
            ) : (
              <div className="text-center">
                <XCircle className="w-16 h-16 text-red-500 mx-auto mb-4" />
                <h3 className="text-2xl font-bold text-red-700 mb-2">
                  쿠폰 확인 실패
                </h3>
                <p className="text-gray-600 mb-4">
                  {verificationResult.error}
                </p>
                <Alert variant="destructive">
                  <AlertDescription>
                    쿠폰 번호를 다시 확인해주세요. 이미 사용된 쿠폰이거나 만료된 쿠폰일 수 있습니다.
                  </AlertDescription>
                </Alert>
              </div>
            )}
          </Card>
        )}

        {/* 사용 안내 */}
        <Card className="p-6 mt-6 bg-mint-50 border-mint-200">
          <h3 className="font-bold text-mint-700 mb-3">💡 사용 방법</h3>
          <ol className="space-y-2 text-sm text-mint-600">
            <li>1. 위에서 가게를 선택하세요</li>
            <li>2. 고객에게 쿠폰 QR 코드를 요청하세요</li>
            <li>3. QR 코드를 스캔하거나 쿠폰 번호를 입력하세요</li>
            <li>4. "쿠폰 확인" 버튼을 클릭하세요</li>
            <li>5. 성공 메시지가 나오면 할인을 적용하세요</li>
          </ol>
        </Card>
      </div>

      {/* QR 스캐너 모달 */}
      {showScanner && (
        <QRScanner
          onScan={handleScan}
          onClose={() => setShowScanner(false)}
        />
      )}
    </div>
  );
}
