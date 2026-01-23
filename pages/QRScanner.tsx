import { useState, useRef, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { QrCode, Camera, CheckCircle2, XCircle, ArrowLeft, AlertCircle, Clock, User } from 'lucide-react';
import { Link, useLocation } from 'wouter';
import { trpc } from '@/lib/trpc';
import { toast } from 'sonner';
import { Html5Qrcode } from 'html5-qrcode';
import { saveOfflineCoupon, getOfflineCouponCount, registerBackgroundSync } from '@/lib/offlineDB';

interface CouponPreview {
  couponCode: string;
  couponTitle: string;
  description: string | null;
  discountType: 'percentage' | 'fixed' | 'freebie';
  discountValue: number;
  minPurchase: number | null;
  maxDiscount: number | null;
  expiresAt: Date;
  userName: string;
  status: string;
  // 가게 정보
  storeName: string;
  storeAddress: string;
  storeCategory: string;
}

export default function QRScanner() {
  const [, setLocation] = useLocation();
  const [scanning, setScanning] = useState(false);
  const [preview, setPreview] = useState<CouponPreview | null>(null);
  const [result, setResult] = useState<{ success: boolean; message: string; couponTitle?: string } | null>(null);
  const scannerRef = useRef<Html5Qrcode | null>(null);
  const [cameraId, setCameraId] = useState<string | null>(null);
  const [processing, setProcessing] = useState(false);
  const [scannedHistory, setScannedHistory] = useState<Set<string>>(new Set());
  const lastScanTimeRef = useRef<Map<string, number>>(new Map());
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [offlineQueueCount, setOfflineQueueCount] = useState(0);

  const previewCoupon = trpc.couponUsage.preview.useQuery(
    { 
      couponCode: preview?.couponCode || '', 
      storeId: 1 // TODO: 실제 매장 ID로 교체
    },
    { enabled: false }
  );
  
  const verifyCoupon = trpc.couponUsage.verify.useMutation();

  useEffect(() => {
    // 카메라 목록 가져오기
    Html5Qrcode.getCameras().then(cameras => {
      if (cameras && cameras.length > 0) {
        // 후면 카메라 우선 선택
        const backCamera = cameras.find(camera => 
          camera.label.toLowerCase().includes('back') || 
          camera.label.toLowerCase().includes('rear')
        );
        setCameraId(backCamera?.id || cameras[0].id);
      }
    }).catch(err => {
      console.error('카메라 목록 가져오기 실패:', err);
    });
    
    // 온라인/오프라인 상태 모니터링
    const handleOnline = () => {
      setIsOnline(true);
      toast.success('네트워크가 복구되었습니다. 동기화를 시작합니다.');
      registerBackgroundSync();
      updateOfflineQueueCount();
    };
    
    const handleOffline = () => {
      setIsOnline(false);
      toast.warning('오프라인 모드입니다. 스캔한 데이터는 나중에 동기화됩니다.');
    };
    
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    
    // Service Worker 메시지 수신
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.addEventListener('message', (event) => {
        if (event.data.type === 'SYNC_COMPLETE') {
          toast.success(`${event.data.syncedCount}개의 쿠폰이 동기화되었습니다.`);
          updateOfflineQueueCount();
        }
      });
    }
    
    // 초기 오프라인 큐 카운트 로드
    updateOfflineQueueCount();
    
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);
  
  const updateOfflineQueueCount = async () => {
    try {
      const count = await getOfflineCouponCount();
      setOfflineQueueCount(count);
    } catch (error) {
      console.error('Failed to get offline queue count:', error);
    }
  };

  const checkDuplicateScan = (couponCode: string): boolean => {
    const now = Date.now();
    const lastScanTime = lastScanTimeRef.current.get(couponCode);
    
    // 30초 이내에 같은 쿠폰을 스캔한 경우
    if (lastScanTime && (now - lastScanTime) < 30000) {
      const remainingSeconds = Math.ceil((30000 - (now - lastScanTime)) / 1000);
      toast.error(`이 쿠폰은 ${remainingSeconds}초 후에 다시 스캔할 수 있습니다.`);
      return true;
    }

    // 오늘 이미 스캔한 쿠폰인 경우 경고
    if (scannedHistory.has(couponCode)) {
      toast.warning('⚠️ 오늘 이미 스캔한 쿠폰입니다. 확인 후 진행하세요.');
    }

    return false;
  };

  const addToScanHistory = (couponCode: string) => {
    const now = Date.now();
    lastScanTimeRef.current.set(couponCode, now);
    
    const newHistory = new Set(scannedHistory);
    newHistory.add(couponCode);
    setScannedHistory(newHistory);
    
    // 로컬 스토리지에 저장
    const today = new Date().toDateString();
    localStorage.setItem(`scan_history_${today}`, JSON.stringify(Array.from(newHistory)));
  };

  const startScanning = async () => {
    if (!cameraId) {
      toast.error('카메라를 찾을 수 없습니다.');
      return;
    }

    try {
      const scanner = new Html5Qrcode('qr-reader');
      scannerRef.current = scanner;

      await scanner.start(
        cameraId,
        {
          fps: 10,
          qrbox: { width: 250, height: 250 }
        },
        async (decodedText) => {
          // QR 코드 스캔 성공
          console.log('QR 코드 스캔:', decodedText);
          
          // 중복 스캔 체크
          if (checkDuplicateScan(decodedText)) {
            return;
          }

          // 스캔 중지
          await stopScanning();
          setProcessing(true);

          // 쿠폰 코드 파싱
          const couponCode = decodedText;

          // 매장 ID (TODO: 실제 로그인한 사장님의 매장 ID로 교체)
          const storeIdStr = prompt('매장 ID를 입력하세요:');
          if (!storeIdStr) {
            setProcessing(false);
            setResult({
              success: false,
              message: '매장 ID가 필요합니다.'
            });
            return;
          }
          const storeId = parseInt(storeIdStr);

          try {
            // 쿠폰 정보 미리보기
            const response = await fetch(`/api/trpc/couponUsage.preview?input=${encodeURIComponent(JSON.stringify({ couponCode, storeId }))}`, {
              credentials: 'include'
            });
            
            if (!response.ok) {
              throw new Error('쿠폰 정보를 가져올 수 없습니다.');
            }

            const data = await response.json();
            const couponData = data.result.data;

            setPreview({
              couponCode,
              couponTitle: couponData.couponTitle,
              description: couponData.description,
              discountType: couponData.discountType,
              discountValue: couponData.discountValue,
              minPurchase: couponData.minPurchase,
              maxDiscount: couponData.maxDiscount,
              expiresAt: new Date(couponData.expiresAt),
              userName: couponData.userName,
              status: couponData.status,
              storeName: couponData.storeName,
              storeAddress: couponData.storeAddress,
              storeCategory: couponData.storeCategory,
            });

            // 히스토리에 추가 (미리보기 단계에서)
            addToScanHistory(couponCode);
            setProcessing(false);
          } catch (error: any) {
            setProcessing(false);
            setResult({
              success: false,
              message: error.message || '쿠폰 정보를 가져오는데 실패했습니다.'
            });
            toast.error(error.message || '쿠폰 정보 가져오기 실패');
          }
        },
        (errorMessage) => {
          // 스캔 실패 (계속 시도)
        }
      );

      setScanning(true);
      toast.success('카메라가 시작되었습니다. QR 코드를 비춰주세요.');
    } catch (error) {
      toast.error('카메라 시작에 실패했습니다.');
      console.error('Camera error:', error);
    }
  };

  const stopScanning = async () => {
    if (scannerRef.current) {
      try {
        await scannerRef.current.stop();
        scannerRef.current = null;
      } catch (err) {
        console.error('스캐너 정지 실패:', err);
      }
    }
    setScanning(false);
  };

  const handleConfirmUsage = async () => {
    if (!preview) return;

    setProcessing(true);

    // 매장 ID (TODO: 실제 로그인한 사장님의 매장 ID로 교체)
    const storeIdStr = prompt('매장 ID를 입력하세요:');
    if (!storeIdStr) {
      setProcessing(false);
      return;
    }
    const storeId = parseInt(storeIdStr);

    try {
      // PIN 코드 또는 QR 코드로 검증
      const response = await verifyCoupon.mutateAsync({ 
        couponCode: preview.couponCode, 
        storeId 
      });
      
      setResult({
        success: true,
        message: '쿠폰이 성공적으로 사용되었습니다!',
        couponTitle: response.couponTitle || '쿠폰'
      });
      toast.success('쿠폰 사용 완료!');
      setPreview(null);
    } catch (error: any) {
      // 오프라인 상태이거나 네트워크 오류인 경우 IndexedDB에 저장
      if (!isOnline || error.message?.includes('network') || error.message?.includes('fetch')) {
        try {
          await saveOfflineCoupon({
            couponCode: preview.couponCode,
            storeId,
            timestamp: Date.now(),
            data: {
              couponCode: preview.couponCode,
              storeId,
            },
          });
          
          setResult({
            success: true,
            message: '오프라인 모드: 쿠폰이 저장되었습니다. 네트워크 복구 시 자동으로 동기화됩니다.',
            couponTitle: preview.couponTitle
          });
          toast.info('오프라인 모드: 나중에 동기화됩니다.');
          updateOfflineQueueCount();
          setPreview(null);
        } catch (dbError) {
          console.error('Failed to save offline coupon:', dbError);
          setResult({
            success: false,
            message: '쿠폰 저장에 실패했습니다.'
          });
          toast.error('쿠폰 저장 실패');
          setPreview(null);
        }
      } else {
        setResult({
          success: false,
          message: error.message || '쿠폰 검증에 실패했습니다.'
        });
        toast.error(error.message || '쿠폰 검증 실패');
        setPreview(null);
      }
    } finally {
      setProcessing(false);
    }
  };

  const handleCancelPreview = () => {
    setPreview(null);
    setProcessing(false);
  };

  const handleManualInput = async () => {
    // PIN 코드 또는 QR 코드 선택
    const inputType = confirm('PIN 코드로 입력하시겠습니까?\n\n확인: PIN 코드 (6자리)\n취소: QR 코드');
    
    let couponCode = '';
    let pinCode = '';
    
    if (inputType) {
      // PIN 코드 입력
      const input = prompt('PIN 코드 6자리를 입력하세요:');
      if (!input) return;
      if (input.length !== 6 || !/^\d{6}$/.test(input)) {
        toast.error('6자리 숫자를 입력해주세요.');
        return;
      }
      pinCode = input;
    } else {
      // QR 코드 입력 (레거시)
      const input = prompt('쿠폰 코드를 입력하세요 (예: CPN-20251212-882740):');
      if (!input) return;
      couponCode = input;
    }

    // 중복 스캔 체크
    const checkCode = pinCode || couponCode;
    if (checkDuplicateScan(checkCode)) {
      return;
    }

    const storeIdStr = prompt('매장 ID를 입력하세요:');
    if (!storeIdStr) return;
    const storeId = parseInt(storeIdStr);

    setProcessing(true);

    try {
      // 쿠폰 정보 미리보기 (PIN 코드 또는 QR 코드)
      const requestData = pinCode 
        ? { pinCode, storeId } 
        : { couponCode, storeId };
      
      const response = await fetch(`/api/trpc/couponUsage.preview?input=${encodeURIComponent(JSON.stringify(requestData))}`, {
        credentials: 'include'
      });
      
      if (!response.ok) {
        throw new Error('쿠폰 정보를 가져올 수 없습니다.');
      }

      const data = await response.json();
      const couponData = data.result.data;

      setPreview({
        couponCode: couponData.couponCode,
        couponTitle: couponData.couponTitle,
        description: couponData.description,
        discountType: couponData.discountType,
        discountValue: couponData.discountValue,
        minPurchase: couponData.minPurchase,
        maxDiscount: couponData.maxDiscount,
        expiresAt: new Date(couponData.expiresAt),
        userName: couponData.userName,
        status: couponData.status,
        storeName: couponData.storeName,
        storeAddress: couponData.storeAddress,
        storeCategory: couponData.storeCategory,
      });

      // 히스토리에 추가
      addToScanHistory(couponCode);
      setProcessing(false);
    } catch (error: any) {
      setProcessing(false);
      setResult({
        success: false,
        message: error.message || '쿠폰 정보를 가져오는데 실패했습니다.'
      });
      toast.error(error.message || '쿠폰 정보 가져오기 실패');
    }
  };

  const formatDiscount = (type: string, value: number, maxDiscount: number | null) => {
    if (type === 'percentage') {
      return `${value}% 할인${maxDiscount ? ` (최대 ${maxDiscount.toLocaleString()}원)` : ''}`;
    } else if (type === 'fixed') {
      return `${value.toLocaleString()}원 할인`;
    } else {
      return '무료 증정';
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-orange-50 to-pink-50 p-4">
      <div className="container mx-auto max-w-2xl">
        {/* Header */}
        <div className="mb-6 flex items-center gap-4">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setLocation('/')}
            className="rounded-full"
          >
            <ArrowLeft className="w-5 h-5" />
          </Button>
          <div className="flex-1">
            <h1 className="text-2xl font-bold bg-gradient-to-r from-orange-600 to-pink-600 bg-clip-text text-transparent">
              QR 코드 스캔
            </h1>
            <div className="flex items-center gap-2">
              <p className="text-sm text-gray-600">쿠폰을 스캔하여 사용하세요</p>
              {!isOnline && (
                <span className="text-xs bg-orange-100 text-orange-700 px-2 py-1 rounded-full">
                  오프라인
                </span>
              )}
              {offlineQueueCount > 0 && (
                <span className="text-xs bg-blue-100 text-blue-700 px-2 py-1 rounded-full">
                  동기화 대기: {offlineQueueCount}
                </span>
              )}
            </div>
          </div>
        </div>

        {/* 쿠폰 미리보기 */}
        {preview && !result && (
          <Card className="mb-6 border-2 border-primary">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-primary">
                <AlertCircle className="w-6 h-6" />
                쿠폰 확인
              </CardTitle>
              <CardDescription>
                아래 쿠폰 정보를 확인하고 사용 처리하세요
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* 가게 정보 */}
              <div className="bg-white border-2 border-orange-200 p-4 rounded-lg space-y-2">
                <div className="flex items-start gap-3">
                  <div className="bg-orange-100 p-2 rounded-lg">
                    <span className="text-2xl">🏪</span>
                  </div>
                  <div className="flex-1">
                    <h4 className="text-lg font-bold text-gray-900">{preview.storeName}</h4>
                    <p className="text-sm text-gray-600">🏷️ {preview.storeCategory}</p>
                    {preview.storeAddress && (
                      <p className="text-sm text-gray-500 mt-1">📍 {preview.storeAddress}</p>
                    )}
                  </div>
                </div>
              </div>

              {/* 쿠폰 정보 */}
              <div className="bg-gradient-to-r from-orange-50 to-pink-50 p-4 rounded-lg space-y-3">
                <div>
                  <h3 className="text-xl font-bold text-gray-900">{preview.couponTitle}</h3>
                  {preview.description && (
                    <p className="text-sm text-gray-600 mt-1">{preview.description}</p>
                  )}
                </div>

                <div className="flex items-center gap-2 text-primary font-semibold text-lg">
                  <span className="text-2xl">🎁</span>
                  {formatDiscount(preview.discountType, preview.discountValue, preview.maxDiscount)}
                </div>

                {preview.minPurchase && preview.minPurchase > 0 && (
                  <p className="text-sm text-gray-600">
                    최소 구매 금액: {preview.minPurchase.toLocaleString()}원
                  </p>
                )}

                <div className="flex items-center gap-2 text-sm text-gray-600">
                  <User className="w-4 h-4" />
                  <span>사용자: {preview.userName}</span>
                </div>

                <div className="flex items-center gap-2 text-sm text-gray-600">
                  <Clock className="w-4 h-4" />
                  <span>유효기간: {new Date(preview.expiresAt).toLocaleDateString()}</span>
                </div>

                <div className="text-xs text-gray-500 font-mono bg-white px-2 py-1 rounded">
                  {preview.couponCode}
                </div>
              </div>

              {/* 확인 버튼 */}
              <div className="flex gap-3">
                <Button
                  onClick={handleConfirmUsage}
                  disabled={processing}
                  className="flex-1 bg-gradient-to-r from-green-500 to-green-600 hover:from-green-600 hover:to-green-700"
                >
                  {processing ? '처리 중...' : '✓ 사용 확인'}
                </Button>
                <Button
                  onClick={handleCancelPreview}
                  disabled={processing}
                  variant="outline"
                  className="flex-1"
                >
                  취소
                </Button>
              </div>

              {scannedHistory.has(preview.couponCode) && (
                <div className="flex items-center gap-2 text-sm text-amber-600 bg-amber-50 p-2 rounded">
                  <AlertCircle className="w-4 h-4" />
                  <span>⚠️ 오늘 이미 스캔한 쿠폰입니다</span>
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {/* Scanner Card */}
        {!preview && !result && (
          <Card className="mb-6">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <QrCode className="w-6 h-6 text-primary" />
                쿠폰 스캔
              </CardTitle>
              <CardDescription>
                QR 코드를 카메라에 비추거나 수동으로 코드를 입력하세요
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* QR Reader Container */}
              <div id="qr-reader" className={scanning ? '' : 'hidden'}></div>

              {/* Placeholder when not scanning */}
              {!scanning && !processing && (
                <div className="aspect-square bg-gray-100 rounded-lg flex items-center justify-center">
                  <div className="text-center">
                    <Camera className="w-16 h-16 text-gray-400 mx-auto mb-4" />
                    <p className="text-gray-600">카메라를 시작하려면 버튼을 누르세요</p>
                  </div>
                </div>
              )}

              {/* Processing */}
              {processing && (
                <div className="aspect-square bg-gray-100 rounded-lg flex items-center justify-center">
                  <div className="text-center">
                    <div className="animate-spin rounded-full h-16 w-16 border-b-2 border-primary mx-auto mb-4"></div>
                    <p className="text-gray-600">쿠폰 정보를 가져오는 중...</p>
                  </div>
                </div>
              )}

              {/* Action Buttons */}
              <div className="flex gap-3">
                {!scanning && !processing && (
                  <>
                    <Button
                      onClick={startScanning}
                      className="flex-1 bg-gradient-to-r from-primary to-accent"
                      disabled={!cameraId}
                    >
                      <Camera className="w-4 h-4 mr-2" />
                      카메라 시작
                    </Button>
                    <Button
                      onClick={handleManualInput}
                      variant="outline"
                      className="flex-1"
                    >
                      <QrCode className="w-4 h-4 mr-2" />
                      수동 입력
                    </Button>
                  </>
                )}

                {scanning && (
                  <Button
                    onClick={stopScanning}
                    variant="destructive"
                    className="w-full"
                  >
                    스캔 중지
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Result Display */}
        {result && (
          <Card className="mb-6">
            <CardContent className="pt-6">
              <div className={`p-6 rounded-lg text-center ${
                result.success 
                  ? 'bg-green-50 border-2 border-green-500' 
                  : 'bg-red-50 border-2 border-red-500'
              }`}>
                {result.success ? (
                  <CheckCircle2 className="w-16 h-16 text-green-500 mx-auto mb-4" />
                ) : (
                  <XCircle className="w-16 h-16 text-red-500 mx-auto mb-4" />
                )}
                <h3 className={`text-xl font-bold mb-2 ${
                  result.success ? 'text-green-700' : 'text-red-700'
                }`}>
                  {result.success ? '사용 완료!' : '사용 실패'}
                </h3>
                {result.couponTitle && (
                  <p className="text-lg font-semibold text-gray-800 mb-2">{result.couponTitle}</p>
                )}
                <p className="text-gray-700">{result.message}</p>
              </div>

              <Button
                onClick={() => {
                  setResult(null);
                  setScanning(false);
                }}
                className="w-full mt-4"
              >
                다시 스캔하기
              </Button>
            </CardContent>
          </Card>
        )}

        {/* Instructions */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">사용 방법</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm text-gray-600">
            <p>1. "카메라 시작" 버튼을 눌러 카메라를 활성화하세요</p>
            <p>2. QR 코드를 화면 중앙의 사각형 안에 맞추세요</p>
            <p>3. 자동으로 인식되면 쿠폰 정보가 표시됩니다</p>
            <p>4. 쿠폰 정보를 확인하고 "사용 확인" 버튼을 누르세요</p>
            <p>5. 또는 "수동 입력"으로 쿠폰 코드를 직접 입력할 수 있습니다</p>
            <p className="text-amber-600 font-semibold">⚠️ 같은 쿠폰은 30초 후에 다시 스캔할 수 있습니다</p>
          </CardContent>
        </Card>

        {/* 오늘 스캔한 쿠폰 수 */}
        {scannedHistory.size > 0 && (
          <Card className="mt-4">
            <CardContent className="pt-6">
              <div className="text-center">
                <p className="text-sm text-gray-600">오늘 스캔한 쿠폰</p>
                <p className="text-3xl font-bold text-primary">{scannedHistory.size}개</p>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
