import { useRoute, useLocation } from 'wouter';
import { trpc } from '@/lib/trpc';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ArrowLeft, Calendar, Ticket, QrCode } from 'lucide-react';
import { useEffect, useState } from 'react';

export default function MyCouponDetail() {
  const [, params] = useRoute('/my-coupons/:id');
  const [, setLocation] = useLocation();
  const couponId = parseInt(params?.id || '0');
  
  const { data: coupons, isLoading } = trpc.coupons.myCoupons.useQuery();
  const coupon = coupons?.find((c: any) => c.id === couponId);
  const [qrCodeUrl, setQrCodeUrl] = useState<string>('');

  useEffect(() => {
    if (coupon && coupon.qrCode) {
      // QR 코드 이미지 생성
      import('qrcode').then((QRCode) => {
        const canvas = document.createElement('canvas');
        QRCode.toCanvas(canvas, coupon.qrCode!, { width: 300 }, (error: any) => {
          if (error) console.error(error);
          setQrCodeUrl(canvas.toDataURL());
        });
      });
    }
  }, [coupon]);

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-orange-50 to-pink-50 flex items-center justify-center">
        <div className="w-8 h-8 border-4 border-primary/30 border-t-primary rounded-full animate-spin"></div>
      </div>
    );
  }

  if (!coupon) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-orange-50 to-pink-50 flex items-center justify-center p-4">
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle>쿠폰을 찾을 수 없습니다</CardTitle>
            <CardDescription>쿠폰이 삭제되었거나 존재하지 않습니다.</CardDescription>
          </CardHeader>
          <CardContent>
            <Button onClick={() => setLocation('/gamification')} className="w-full">
              돌아가기
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-orange-50 to-pink-50 p-4">
      <div className="container mx-auto max-w-2xl">
        {/* Header */}
        <div className="mb-6 flex items-center gap-4">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setLocation('/gamification')}
            className="rounded-full"
          >
            <ArrowLeft className="w-5 h-5" />
          </Button>
          <div>
            <h1 className="text-2xl font-bold bg-gradient-to-r from-orange-600 to-pink-600 bg-clip-text text-transparent">
              내 쿠폰
            </h1>
            <p className="text-sm text-gray-600">쿠폰 상세 정보</p>
          </div>
        </div>

        {/* Coupon Card */}
        <Card className="mb-6">
          <CardHeader>
            <div className="flex items-start justify-between">
              <div className="flex-1">
                <CardTitle className="flex items-center gap-2 mb-2">
                  <Ticket className="w-6 h-6 text-primary" />
                  {coupon.title}
                </CardTitle>

              </div>
              
              <div className="text-right">
                <Badge className="bg-gradient-to-r from-primary to-accent text-white text-lg px-4 py-2">
                  {coupon.status === 'active' ? '사용 가능' : coupon.status === 'used' ? '사용 완료' : '만료'}
                </Badge>
              </div>
            </div>
            <CardDescription>쿠폰 코드: {coupon.couponCode}</CardDescription>
          </CardHeader>

          <CardContent className="space-y-6">
            {/* QR Code */}
            {qrCodeUrl && coupon.status === 'active' && (
              <div className="bg-white p-6 rounded-lg border-2 border-dashed border-primary/30">
                <div className="text-center mb-4">
                  <QrCode className="w-6 h-6 text-primary mx-auto mb-2" />
                  <h3 className="font-bold text-lg">매장에서 이 QR 코드를 보여주세요</h3>
                  <p className="text-sm text-gray-600">사장님이 스캔하면 자동으로 사용 처리됩니다</p>
                </div>
                <div className="flex justify-center">
                  <img src={qrCodeUrl} alt="QR Code" className="w-64 h-64" />
                </div>
                <div className="text-center mt-4">
                  <p className="text-xs text-gray-500 font-mono">{coupon.qrCode}</p>
                </div>
              </div>
            )}

            {/* Used Badge */}
            {coupon.status !== 'active' && (
              <div className="bg-gray-100 p-6 rounded-lg text-center">
                <Badge variant="secondary" className="text-lg px-4 py-2 mb-2">
                  {coupon.status === 'used' ? '사용 완료' : '만료됨'}
                </Badge>
                <p className="text-sm text-gray-600">
                  {coupon.status === 'used' ? '이 쿠폰은 이미 사용되었습니다' : '이 쿠폰은 만료되었습니다'}
                </p>
              </div>
            )}

            {/* Coupon Details */}
            <div className="space-y-3 pt-4 border-t">
              <div className="flex items-center gap-2 text-sm">
                <Calendar className="w-4 h-4 text-gray-500" />
                <span className="text-gray-600">만료일:</span>
                <span className="font-medium">
                  {new Date(coupon.expiresAt).toLocaleDateString()}
                </span>
              </div>

              {coupon.downloadedAt && (
                <div className="flex items-center gap-2 text-sm">
                  <span className="text-gray-600">다운로드 날짜:</span>
                  <span className="font-medium">{new Date(coupon.downloadedAt).toLocaleDateString()}</span>
                </div>
              )}
            </div>

            {/* Store Info */}


            {/* Action Buttons */}
            <div className="pt-4">
              <Button
                className="w-full bg-gradient-to-r from-primary to-accent"
                onClick={() => setLocation('/gamification')}
              >
                내 활동으로 돌아가기
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
