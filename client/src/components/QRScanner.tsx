import { useState, useRef, useEffect } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Camera, X, AlertCircle } from 'lucide-react';
import { Html5Qrcode } from 'html5-qrcode';
import { toast } from '@/components/ui/sonner';

interface QRScannerProps {
  onScan: (couponCode: string) => void;
  onClose: () => void;
}

/**
 * PR-49 QRScanner — 사장님 쿠폰 검증용 카메라 스캐너 (reusable component).
 *
 * 사장님 명령:
 *   - PIN fallback 절대 보존 (카메라 거부/오류/타임아웃 → 부모가 PIN 입력 노출)
 *   - DB/라우팅/아키텍처 무결성
 *
 * 흐름:
 *   1. mount → 카메라 목록 → 후면 우선 → 자동 스캔 시작
 *   2. 권한 거부 또는 카메라 없음 → cameraError UI + "PIN 입력으로 전환" 버튼
 *   3. 5초 동안 인식 안 되면 toast "PIN 입력으로 사용하세요"
 *   4. QR 인식 → onScan(couponCode) 콜백 → 부모가 preview/verify 처리
 *   5. unmount 시 카메라 정지
 *
 * 부모 (MerchantCouponVerify) 가 storeId / preview / verify mutation 책임.
 */
export default function QRScanner({ onScan, onClose }: QRScannerProps) {
  const [scanning, setScanning] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const scannerRef = useRef<Html5Qrcode | null>(null);
  const [cameraId, setCameraId] = useState<string | null>(null);
  const lastScanTimeRef = useRef<Map<string, number>>(new Map());
  const timeoutWarnedRef = useRef(false);

  // 카메라 목록 가져오기 (권한 거부 시 PIN fallback 안내)
  useEffect(() => {
    Html5Qrcode.getCameras()
      .then((cameras) => {
        if (cameras && cameras.length > 0) {
          const backCamera = cameras.find(
            (c) =>
              c.label.toLowerCase().includes('back') ||
              c.label.toLowerCase().includes('rear'),
          );
          setCameraId(backCamera?.id || cameras[0].id);
        } else {
          setCameraError('카메라를 찾을 수 없습니다.');
        }
      })
      .catch((err) => {
        console.error('[QRScanner] 카메라 권한 거부 또는 오류:', err);
        setCameraError('카메라 권한이 필요합니다.');
      });

    return () => {
      // unmount cleanup
      if (scannerRef.current) {
        scannerRef.current.stop().catch(() => {});
        scannerRef.current = null;
      }
    };
  }, []);

  // 카메라 준비되면 자동 스캔 시작
  useEffect(() => {
    if (cameraId && !scanning && !cameraError) {
      startScanning();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cameraId]);

  // 5초 동안 인식 안 되면 PIN fallback 안내 (사장님 명령 — "혹여나 접속불량이거나하면 핀번호로")
  useEffect(() => {
    if (!scanning) return;
    const t = setTimeout(() => {
      if (!timeoutWarnedRef.current) {
        timeoutWarnedRef.current = true;
        toast.info('QR 인식이 안 되면 창을 닫고 PIN으로 입력하세요', {
          duration: 4000,
        });
      }
    }, 5000);
    return () => clearTimeout(t);
  }, [scanning]);

  const startScanning = async () => {
    if (!cameraId) return;
    try {
      const scanner = new Html5Qrcode('qr-reader');
      scannerRef.current = scanner;
      await scanner.start(
        cameraId,
        { fps: 10, qrbox: { width: 250, height: 250 } },
        async (decodedText) => {
          // 30초 중복 스캔 방지 (사장이 같은 QR 두 번 찍는 것 차단)
          const now = Date.now();
          const last = lastScanTimeRef.current.get(decodedText);
          if (last && now - last < 30000) return;
          lastScanTimeRef.current.set(decodedText, now);

          // 스캔 중지 + 부모 콜백
          await stopScanning();
          onScan(decodedText);
        },
        () => {
          /* 인식 실패 = 계속 시도 (조용) */
        },
      );
      setScanning(true);
    } catch (e) {
      console.error('[QRScanner] 카메라 시작 실패:', e);
      setCameraError('카메라를 시작할 수 없습니다.');
    }
  };

  const stopScanning = async () => {
    if (scannerRef.current) {
      try {
        await scannerRef.current.stop();
        scannerRef.current = null;
      } catch {
        // ignore
      }
    }
    setScanning(false);
  };

  const handleClose = async () => {
    await stopScanning();
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4">
      <Card className="w-full max-w-md">
        <CardContent className="pt-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-bold flex items-center gap-2">
              <Camera className="w-5 h-5" />
              QR 스캔
            </h3>
            <Button variant="ghost" size="icon" onClick={handleClose}>
              <X className="w-5 h-5" />
            </Button>
          </div>

          {cameraError ? (
            <div className="bg-orange-50 border-2 border-orange-300 p-4 rounded-lg text-center">
              <AlertCircle className="w-12 h-12 text-orange-500 mx-auto mb-2" />
              <p className="text-orange-700 font-semibold mb-2">{cameraError}</p>
              <p className="text-sm text-gray-600 mb-3">
                카메라 사용이 어려우시면 창을 닫고
                <br />
                <strong>PIN 6자리</strong>로 입력하세요.
              </p>
              <Button onClick={handleClose} className="w-full">
                PIN 입력으로 전환
              </Button>
            </div>
          ) : (
            <>
              <div id="qr-reader" className="rounded-lg overflow-hidden mb-3"></div>
              <p className="text-sm text-gray-600 text-center">
                사용자 폰의 QR 코드를 카메라 앞에 비춰주세요
              </p>
              <p className="text-xs text-gray-400 text-center mt-2">
                인식이 안 되면 창을 닫고 PIN으로 입력하세요
              </p>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
