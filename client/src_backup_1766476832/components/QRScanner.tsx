import { useEffect, useRef, useState } from "react";
import { Html5Qrcode } from "html5-qrcode";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Camera, X } from "lucide-react";

interface QRScannerProps {
  onScan: (result: string) => void;
  onClose: () => void;
}

export default function QRScanner({ onScan, onClose }: QRScannerProps) {
  const [isScanning, setIsScanning] = useState(false);
  const scannerRef = useRef<Html5Qrcode | null>(null);
  const [error, setError] = useState<string>("");

  useEffect(() => {
    startScanning();
    return () => {
      stopScanning();
    };
  }, []);

  const startScanning = async () => {
    try {
      const scanner = new Html5Qrcode("qr-reader");
      scannerRef.current = scanner;

      await scanner.start(
        { facingMode: "environment" }, // 후면 카메라 사용
        {
          fps: 10, // 초당 프레임 수
          qrbox: { width: 250, height: 250 }, // 스캔 영역 크기
        },
        (decodedText) => {
          // QR 코드 스캔 성공
          onScan(decodedText);
          stopScanning();
        },
        (errorMessage) => {
          // 스캔 실패 (무시)
        }
      );

      setIsScanning(true);
      setError("");
    } catch (err: any) {
      console.error("QR Scanner error:", err);
      setError(err.message || "카메라를 시작할 수 없습니다. 카메라 권한을 확인해주세요.");
      setIsScanning(false);
    }
  };

  const stopScanning = async () => {
    if (scannerRef.current) {
      try {
        await scannerRef.current.stop();
        scannerRef.current.clear();
      } catch (err) {
        console.error("Error stopping scanner:", err);
      }
      scannerRef.current = null;
    }
    setIsScanning(false);
  };

  const handleClose = () => {
    stopScanning();
    onClose();
  };

  return (
    <div className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4">
      <Card className="w-full max-w-md p-6 relative">
        <Button
          variant="ghost"
          size="icon"
          className="absolute top-4 right-4"
          onClick={handleClose}
        >
          <X className="w-5 h-5" />
        </Button>

        <div className="mb-4">
          <h2 className="text-xl font-bold flex items-center gap-2">
            <Camera className="w-6 h-6" />
            QR 코드 스캔
          </h2>
          <p className="text-sm text-gray-600 mt-1">
            고객의 QR 코드를 카메라로 스캔하세요
          </p>
        </div>

        {error && (
          <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
            {error}
          </div>
        )}

        <div
          id="qr-reader"
          className="w-full rounded-lg overflow-hidden bg-gray-900"
          style={{ minHeight: "300px" }}
        />

        {isScanning && (
          <div className="mt-4 text-center">
            <div className="inline-flex items-center gap-2 text-sm text-gray-600">
              <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse" />
              스캔 중...
            </div>
          </div>
        )}

        <div className="mt-4 p-3 bg-mint-50 border border-mint-200 rounded-lg">
          <p className="text-xs text-mint-700">
            💡 QR 코드를 카메라 중앙에 맞춰주세요. 자동으로 인식됩니다.
          </p>
        </div>
      </Card>
    </div>
  );
}
