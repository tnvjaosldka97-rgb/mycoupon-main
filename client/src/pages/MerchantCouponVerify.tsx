import { useState, useEffect } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  QrCode,
  CheckCircle2,
  Camera,
  KeyRound,
  Clock,
  User,
  AlertCircle,
  RotateCcw,
  ArrowRight,
} from "lucide-react";
import { Link } from "wouter";
import { toast } from "@/components/ui/sonner";
import QRScanner from "@/components/QRScanner";

/**
 * PR-49 MerchantCouponVerify — 사장님 쿠폰 검증 페이지
 *
 * 사장님 명령:
 *   - QR 스캔 + PIN 6자리 동시 지원 (PIN fallback 절대 보존)
 *   - 5분 내 취소 가능 (실수 무조건 발생)
 *   - DB/라우팅/아키텍처 무결성
 *
 * 흐름 (3 모드):
 *   idle    → 매장 선택 + QR 스캔 / PIN 입력 진입
 *   preview → 쿠폰 정보 미리보기 + 사용 처리 / 취소 버튼
 *   success → 처리 완료 + 5분 countdown + 잘못 처리 취소 / 다음 손님 버튼
 */

type VerifyMode = "idle" | "preview" | "success";
type InputMode = "qr" | "pin";

interface PreviewData {
  couponCode: string;
  couponTitle: string;
  description: string | null;
  discountType: "percentage" | "fixed" | "freebie";
  discountValue: number;
  minPurchase: number | null;
  maxDiscount: number | null;
  expiresAt: Date | string;
  userName: string;
  status: string;          // 서버 응답 정합 (routers.ts:2191)
  storeName: string;
  storeAddress: string;
  storeCategory: string;   // 서버 응답 정합 (routers.ts:2195)
  // 호출 input 보존 (verify mutation 시 동일 입력 재사용)
  _inputType: "qr" | "pin";
  _inputValue: string;
}

interface SuccessData {
  userCouponId: number;
  couponTitle: string;
  userName: string;
  processedAt: Date;
}

const CANCEL_WINDOW_SECONDS = 5 * 60; // 5분

export default function MerchantCouponVerify() {
  const [verifyMode, setVerifyMode] = useState<VerifyMode>("idle");
  const [inputMode, setInputMode] = useState<InputMode>("qr");
  const [storeId, setStoreId] = useState<number | null>(null);
  const [pinCode, setPinCode] = useState("");
  const [showScanner, setShowScanner] = useState(false);
  const [preview, setPreview] = useState<PreviewData | null>(null);
  const [success, setSuccess] = useState<SuccessData | null>(null);
  const [cancelCountdown, setCancelCountdown] = useState(CANCEL_WINDOW_SECONDS);
  const [processing, setProcessing] = useState(false);

  const utils = trpc.useUtils();
  const { data: myStores } = trpc.stores.myStores.useQuery();
  const verifyMutation = trpc.couponUsage.verify.useMutation();
  const cancelMutation = trpc.couponUsage.cancelUsage.useMutation();

  // 매장 1개면 자동 선택
  useEffect(() => {
    if (myStores && myStores.length === 1 && !storeId) {
      setStoreId(myStores[0].id);
    }
  }, [myStores, storeId]);

  // PR-54 (사장님 명세 2026-05-04): URL query ?code=... 자동 진입 (사장님 카메라 → 사이트 진입 흐름)
  // 매장 자동 선택 + verifyMode='idle' 일 때만 진입. 1회 처리 후 query 정리 (새로고침/뒤로가기 안전).
  // PR-53 무결성 가드 (server) 가 매장 꼬임 차단 → 클라이언트는 단순 자동 트리거만.
  const [autoScanned, setAutoScanned] = useState(false);
  useEffect(() => {
    if (autoScanned) return;
    const params = new URLSearchParams(window.location.search);
    const code = params.get('code');
    if (code && storeId && verifyMode === 'idle' && !processing) {
      setAutoScanned(true);
      handleScan(code);
      // query 정리 (history.replaceState — 뒤로가기 / 새로고침 시 중복 진입 방지)
      window.history.replaceState({}, '', '/merchant/coupon-verify');
    }
  }, [storeId, verifyMode, processing, autoScanned]);

  // 5분 countdown (success 모드일 때만)
  useEffect(() => {
    if (verifyMode !== "success") return;
    if (cancelCountdown <= 0) return;
    const t = setInterval(() => {
      setCancelCountdown((c) => Math.max(0, c - 1));
    }, 1000);
    return () => clearInterval(t);
  }, [verifyMode, cancelCountdown]);

  // QR 스캔 결과 → preview
  const handleScan = async (couponCode: string) => {
    setShowScanner(false);
    if (!storeId) {
      toast.error("매장을 선택해주세요");
      return;
    }
    setProcessing(true);
    try {
      const data = await utils.couponUsage.preview.fetch({ couponCode, storeId });
      setPreview({
        ...data,
        _inputType: "qr",
        _inputValue: couponCode,
      } as PreviewData);
      setVerifyMode("preview");
    } catch (e: any) {
      toast.error(e?.message || "쿠폰 정보를 가져올 수 없습니다");
    } finally {
      setProcessing(false);
    }
  };

  // PIN 입력 → preview
  const handlePinSubmit = async () => {
    if (!/^\d{6}$/.test(pinCode)) {
      toast.error("PIN 6자리 숫자를 입력해주세요");
      return;
    }
    if (!storeId) {
      toast.error("매장을 선택해주세요");
      return;
    }
    setProcessing(true);
    try {
      const data = await utils.couponUsage.preview.fetch({ pinCode, storeId });
      setPreview({
        ...data,
        _inputType: "pin",
        _inputValue: pinCode,
      } as PreviewData);
      setVerifyMode("preview");
    } catch (e: any) {
      toast.error(e?.message || "PIN 코드 확인 실패");
    } finally {
      setProcessing(false);
    }
  };

  // confirm 사용 처리 → success
  const handleConfirm = async () => {
    if (!preview || !storeId) return;
    setProcessing(true);
    try {
      const result = await verifyMutation.mutateAsync(
        preview._inputType === "pin"
          ? { pinCode: preview._inputValue, storeId }
          : { couponCode: preview._inputValue, storeId },
      );
      setSuccess({
        userCouponId: result.userCouponId,
        couponTitle: result.couponTitle,
        userName: preview.userName,
        processedAt: new Date(),
      });
      setVerifyMode("success");
      setCancelCountdown(CANCEL_WINDOW_SECONDS);
      setPreview(null);
      setPinCode("");
      toast.success("쿠폰 사용 처리 완료!");
    } catch (e: any) {
      toast.error(e?.message || "사용 처리 실패");
    } finally {
      setProcessing(false);
    }
  };

  // 취소 (5분 내)
  const handleCancel = async () => {
    if (!success) return;
    if (!window.confirm("정말 사용 처리를 취소하시겠습니까?\n쿠폰이 사용 가능한 상태로 복구됩니다.")) {
      return;
    }
    setProcessing(true);
    try {
      await cancelMutation.mutateAsync({ userCouponId: success.userCouponId });
      toast.success("사용 처리가 취소되었습니다. 쿠폰이 복구되었습니다.");
      handleNext();
    } catch (e: any) {
      toast.error(e?.message || "취소 실패");
    } finally {
      setProcessing(false);
    }
  };

  // 다음 손님 (idle 으로 복귀)
  const handleNext = () => {
    setVerifyMode("idle");
    setSuccess(null);
    setPreview(null);
    setPinCode("");
    setCancelCountdown(CANCEL_WINDOW_SECONDS);
  };

  // 미리보기 취소 (잘못 찍었을 때)
  const handlePreviewCancel = () => {
    setPreview(null);
    setVerifyMode("idle");
    setPinCode("");
  };

  const formatDiscount = (type: string, value: number, maxDiscount: number | null) => {
    if (type === "percentage") {
      return `${value}% 할인${maxDiscount ? ` (최대 ${maxDiscount.toLocaleString()}원)` : ""}`;
    } else if (type === "fixed") {
      return `${value.toLocaleString()}원 할인`;
    } else {
      return "무료 증정";
    }
  };

  const formatCountdown = (sec: number) => {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${m}분 ${s.toString().padStart(2, "0")}초`;
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-peach-50 to-mint-50">
      {/* 헤더 */}
      <div className="bg-gradient-to-r from-peach-400 via-pink-400 to-mint-400 text-white py-8 px-4 shadow-lg">
        <div className="container max-w-4xl">
          <Button variant="ghost" size="sm" className="text-white hover:bg-white/20 mb-4" asChild>
            <Link href="/merchant/dashboard">← 대시보드로</Link>
          </Button>
          <div className="flex items-center gap-3 mb-2">
            <QrCode className="w-8 h-8" />
            <h1 className="text-3xl font-bold">쿠폰 검증</h1>
          </div>
          <p className="text-white/90">고객의 쿠폰을 QR 스캔 또는 PIN 6자리로 사용 처리</p>
        </div>
      </div>

      <div className="container max-w-4xl py-8 px-4">
        {/* 매장 선택 (다매장 시 dropdown, 1개면 자동) */}
        {(!myStores || myStores.length === 0) ? (
          <Card className="p-6 mb-6">
            <p className="text-gray-600 text-center">매장이 없습니다. 먼저 매장을 등록해주세요.</p>
          </Card>
        ) : myStores.length > 1 ? (
          <Card className="p-6 mb-6">
            <h2 className="text-xl font-bold mb-4">가게 선택</h2>
            <div className="grid gap-3">
              {myStores.map((store) => (
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
        ) : (
          <Card className="p-4 mb-6 bg-mint-50 border-mint-200">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="w-5 h-5 text-mint-600" />
              <span className="font-semibold">매장: {myStores[0].name}</span>
            </div>
          </Card>
        )}

        {/* idle 모드 — QR/PIN 입력 */}
        {verifyMode === "idle" && storeId && (
          <Card className="p-6 mb-6">
            <h2 className="text-xl font-bold mb-4">쿠폰 입력 방식</h2>
            <div className="grid grid-cols-2 gap-3 mb-6">
              <Button
                variant={inputMode === "qr" ? "default" : "outline"}
                onClick={() => setInputMode("qr")}
                className="h-14"
              >
                <Camera className="w-5 h-5 mr-2" />
                QR 스캔
              </Button>
              <Button
                variant={inputMode === "pin" ? "default" : "outline"}
                onClick={() => setInputMode("pin")}
                className="h-14"
              >
                <KeyRound className="w-5 h-5 mr-2" />
                PIN 6자리
              </Button>
            </div>

            {inputMode === "qr" ? (
              <div className="space-y-3">
                <p className="text-sm text-gray-600">
                  사용자 폰의 쿠폰 QR 코드를 카메라로 스캔하세요.
                </p>
                <Button
                  onClick={() => setShowScanner(true)}
                  disabled={processing}
                  className="w-full h-14 text-base bg-gradient-to-r from-peach-400 to-pink-400 hover:from-peach-500 hover:to-pink-500"
                >
                  <Camera className="w-5 h-5 mr-2" />
                  카메라 시작
                </Button>
                <p className="text-xs text-gray-500 text-center">
                  카메라 권한이 거부되거나 인식이 안 되면 PIN 입력으로 전환하세요
                </p>
              </div>
            ) : (
              <div className="space-y-3">
                <p className="text-sm text-gray-600">
                  사용자 폰 화면에 표시된 PIN 6자리 숫자를 입력하세요.
                </p>
                <Input
                  type="tel"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  maxLength={6}
                  placeholder="123456"
                  value={pinCode}
                  onChange={(e) => setPinCode(e.target.value.replace(/\D/g, ""))}
                  onKeyDown={(e) => e.key === "Enter" && handlePinSubmit()}
                  className="text-center text-2xl font-mono tracking-widest h-14"
                />
                <Button
                  onClick={handlePinSubmit}
                  disabled={processing || pinCode.length !== 6}
                  className="w-full h-14 text-base bg-gradient-to-r from-peach-400 to-pink-400 hover:from-peach-500 hover:to-pink-500"
                >
                  {processing ? "확인 중..." : "쿠폰 확인"}
                </Button>
              </div>
            )}
          </Card>
        )}

        {/* preview 모드 — 미리보기 + confirm */}
        {verifyMode === "preview" && preview && (
          <Card className="p-6 mb-6 border-2 border-peach-400">
            <div className="flex items-center gap-2 mb-4 text-peach-600">
              <AlertCircle className="w-6 h-6" />
              <h2 className="text-xl font-bold">쿠폰 정보 확인</h2>
            </div>

            {/* 가게 + 쿠폰 정보 */}
            <div className="bg-gradient-to-r from-orange-50 to-pink-50 p-4 rounded-lg space-y-3 mb-4">
              <div>
                <div className="text-sm text-gray-600">🏪 매장</div>
                <div className="font-semibold">{preview.storeName}</div>
              </div>
              <div>
                <div className="text-sm text-gray-600">🎁 쿠폰</div>
                <div className="font-semibold text-lg">{preview.couponTitle}</div>
                <div className="text-peach-600 font-bold mt-1">
                  {formatDiscount(preview.discountType, preview.discountValue, preview.maxDiscount)}
                </div>
              </div>
              {preview.minPurchase && preview.minPurchase > 0 ? (
                <div className="text-sm text-gray-600">
                  최소 구매 {preview.minPurchase.toLocaleString()}원
                </div>
              ) : null}
              <div className="flex items-center gap-2 text-sm text-gray-600">
                <User className="w-4 h-4" />
                <span>{preview.userName}</span>
              </div>
              <div className="flex items-center gap-2 text-sm text-gray-600">
                <Clock className="w-4 h-4" />
                <span>유효 ~ {new Date(preview.expiresAt).toLocaleDateString()}</span>
              </div>
            </div>

            {/* 사용 처리 / 취소 */}
            <div className="grid grid-cols-2 gap-3">
              <Button
                variant="outline"
                onClick={handlePreviewCancel}
                disabled={processing}
                className="h-14"
              >
                ❌ 취소 (잘못 찍음)
              </Button>
              <Button
                onClick={handleConfirm}
                disabled={processing}
                className="h-14 bg-gradient-to-r from-green-500 to-green-600 hover:from-green-600 hover:to-green-700"
              >
                {processing ? "처리 중..." : "✅ 사용 완료 처리"}
              </Button>
            </div>
          </Card>
        )}

        {/* success 모드 — 처리 완료 + 5분 countdown + 취소 */}
        {verifyMode === "success" && success && (
          <Card className="p-6 mb-6 border-2 border-green-500">
            <div className="text-center mb-4">
              <CheckCircle2 className="w-16 h-16 text-green-500 mx-auto mb-2" />
              <h2 className="text-2xl font-bold text-green-700">사용 처리 완료</h2>
            </div>

            <div className="bg-green-50 p-4 rounded-lg space-y-2 mb-4">
              <div>
                <div className="text-sm text-gray-600">쿠폰</div>
                <div className="font-semibold text-lg">{success.couponTitle}</div>
              </div>
              <div className="flex items-center gap-2 text-sm text-gray-700">
                <User className="w-4 h-4" />
                <span>{success.userName}</span>
              </div>
              <div className="flex items-center gap-2 text-sm text-gray-700">
                <Clock className="w-4 h-4" />
                <span>처리 시각: {success.processedAt.toLocaleTimeString()}</span>
              </div>
            </div>

            {/* 5분 countdown 영역 */}
            {cancelCountdown > 0 ? (
              <Alert className="mb-4 border-orange-300 bg-orange-50">
                <RotateCcw className="w-4 h-4" />
                <AlertDescription>
                  <strong>실수로 처리하셨다면 {formatCountdown(cancelCountdown)} 안에 취소 가능합니다.</strong>
                  <br />
                  <span className="text-xs text-gray-600">5분 지나면 취소 불가</span>
                </AlertDescription>
              </Alert>
            ) : (
              <Alert className="mb-4 border-gray-300 bg-gray-50">
                <AlertDescription className="text-gray-600">
                  취소 가능 시간(5분)이 지났습니다.
                </AlertDescription>
              </Alert>
            )}

            {/* 취소 / 다음 손님 */}
            <div className="grid grid-cols-2 gap-3">
              {cancelCountdown > 0 ? (
                <Button
                  variant="outline"
                  onClick={handleCancel}
                  disabled={processing}
                  className="h-14 border-orange-400 text-orange-600 hover:bg-orange-50"
                >
                  <RotateCcw className="w-5 h-5 mr-2" />
                  ↩️ 잘못 처리했어요
                </Button>
              ) : (
                <div />
              )}
              <Button
                onClick={handleNext}
                disabled={processing}
                className={`h-14 ${cancelCountdown > 0 ? "" : "col-span-2"} bg-gradient-to-r from-peach-400 to-pink-400 hover:from-peach-500 hover:to-pink-500`}
              >
                <ArrowRight className="w-5 h-5 mr-2" />
                다음 손님
              </Button>
            </div>

            <Badge className="mt-4 bg-green-100 text-green-700">사용 완료</Badge>
          </Card>
        )}

        {/* 사용 안내 */}
        {verifyMode === "idle" && (
          <Card className="p-6 mt-6 bg-mint-50 border-mint-200">
            <h3 className="font-bold text-mint-700 mb-3">💡 사용 방법</h3>
            <ol className="space-y-2 text-sm text-mint-700">
              <li>1. 고객에게 "내 쿠폰북" 화면을 열어달라고 요청</li>
              <li>2. <strong>QR 스캔</strong> — 사용자 폰 QR 화면을 카메라로 비춤 (1초)</li>
              <li>
                3. <strong>또는 PIN 입력</strong> — 사용자 폰 화면의 6자리 숫자 입력 (카메라 안 될 때)
              </li>
              <li>4. 쿠폰 정보 확인 후 "사용 완료 처리" 클릭</li>
              <li className="text-orange-700 font-semibold">
                5. 실수 시 5분 안에 "잘못 처리했어요" 클릭하면 복구됩니다
              </li>
            </ol>
          </Card>
        )}
      </div>

      {/* QR 스캐너 모달 */}
      {showScanner && (
        <QRScanner onScan={handleScan} onClose={() => setShowScanner(false)} />
      )}
    </div>
  );
}
