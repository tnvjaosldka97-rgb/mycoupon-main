/**
 * 가입 동의 / 온보딩 페이지
 * - 구글 로그인 후 signupCompletedAt이 없는 신규 사용자가 진입
 * - 필수: 이용약관 + 개인정보처리방침 / 선택: 마케팅 동의
 * - 완료 시 ?next= 파라미터 목적지 or /merchant/dashboard 로 이동
 */
import { useState, useEffect, useRef } from 'react';
import { useLocation, useSearch } from 'wouter';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { useAuth } from '@/hooks/useAuth';
import { trpc } from '@/lib/trpc';
import { toast } from '@/components/ui/sonner';
import { CheckCircle2, Circle } from 'lucide-react';

function CheckItem({
  checked,
  onChange,
  label,
  required,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  required?: boolean;
}) {
  return (
    <button
      type="button"
      className="flex items-start gap-3 w-full text-left py-2"
      onClick={() => onChange(!checked)}
    >
      {checked ? (
        <CheckCircle2 className="h-5 w-5 text-orange-500 shrink-0 mt-0.5" />
      ) : (
        <Circle className="h-5 w-5 text-gray-300 shrink-0 mt-0.5" />
      )}
      <span className="text-sm text-gray-700 leading-relaxed">
        {required && <span className="text-red-500 font-bold mr-1">[필수]</span>}
        {!required && <span className="text-gray-400 mr-1">[선택]</span>}
        {label}
      </span>
    </button>
  );
}

export default function ConsentPage() {
  const [, setLocation] = useLocation();
  const searchStr = useSearch(); // ?next=/merchant/dashboard 등
  const { user, loading } = useAuth();
  const utils = trpc.useUtils();

  // 동의 완료 후 이동할 목적지 파싱 (?next= 파라미터)
  const nextUrl = (() => {
    try {
      const params = new URLSearchParams(searchStr);
      const raw = params.get('next');
      if (raw) {
        const decoded = decodeURIComponent(raw);
        // 안전 체크: 외부 URL 방지 (상대 경로만 허용)
        if (decoded.startsWith('/') && !decoded.startsWith('//')) return decoded;
      }
    } catch (_) { /* ignore */ }
    return '/merchant/dashboard';
  })();

  const [termsAgreed,     setTermsAgreed]     = useState(false);
  const [privacyAgreed,   setPrivacyAgreed]   = useState(false);
  const [marketingAgreed, setMarketingAgreed] = useState(false);
  const [allChecked,      setAllChecked]      = useState(false);

  const completeSignup = trpc.auth.completeSignup.useMutation({
    onSuccess: () => {
      toast.success('가입이 완료되었습니다! 서비스를 이용해 보세요.');
      // 동의 완료 후 auth.me 캐시 갱신 (role='merchant' 반영)
      // → 갱신 없으면 MerchantDashboard에서 여전히 role='user'로 인식해 루프 발생
      utils.auth.me.invalidate().finally(() => {
        setLocation(nextUrl);
      });
    },
    onError: (error) => {
      toast.error(error.message || '동의 저장 중 오류가 발생했습니다.');
    },
  });

  // ── render body 의 side-effect (navigation)를 useEffect로 이동 ─────────────
  const redirectedRef = useRef(false);
  useEffect(() => {
    if (loading) return;
    if (redirectedRef.current) return;

    if (!user) {
      redirectedRef.current = true;
      setLocation('/');
      return;
    }
    if ((user as any).signupCompletedAt) {
      redirectedRef.current = true;
      setLocation(nextUrl);
    }
  }, [loading, user, nextUrl, setLocation]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p className="text-gray-500">로딩 중...</p>
      </div>
    );
  }

  // 이미 동의 완료한 계정 or 비로그인 → useEffect에서 처리, 여기선 null 반환
  if (!user || (user as any).signupCompletedAt) return null;

  const handleToggleAll = (v: boolean) => {
    setAllChecked(v);
    setTermsAgreed(v);
    setPrivacyAgreed(v);
    setMarketingAgreed(v);
  };

  const canSubmit = termsAgreed && privacyAgreed;

  const handleSubmit = () => {
    if (!canSubmit) {
      toast.error('필수 약관에 동의해야 합니다.');
      return;
    }
    completeSignup.mutate({ termsAgreed, privacyAgreed, marketingAgreed });
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-orange-50 via-pink-50 to-purple-50 flex items-center justify-center px-4">
      <Card className="w-full max-w-md shadow-xl">
        <CardHeader className="text-center pb-4">
          <div className="mx-auto mb-3 w-14 h-14 bg-orange-100 rounded-full flex items-center justify-center">
            <span className="text-3xl">🍊</span>
          </div>
          <CardTitle className="text-2xl font-bold text-gray-900">마이쿠폰 시작하기</CardTitle>
          <CardDescription className="text-gray-500 mt-1">
            서비스 이용을 위해 아래 약관에 동의해 주세요.
            <br />
            가입 시 <strong>7일 무료 체험</strong>이 시작됩니다.
          </CardDescription>
        </CardHeader>

        <CardContent className="space-y-4">
          {/* 전체 동의 */}
          <div className="border rounded-xl p-3 bg-orange-50">
            <CheckItem
              checked={allChecked}
              onChange={handleToggleAll}
              label="전체 동의 (필수 + 선택 포함)"
            />
          </div>

          {/* 개별 항목 */}
          <div className="border rounded-xl p-3 space-y-1">
            <CheckItem
              checked={termsAgreed}
              onChange={(v) => { setTermsAgreed(v); if (!v) setAllChecked(false); }}
              label="마이쿠폰 이용약관 동의"
              required
            />
            <hr className="border-gray-100" />
            <CheckItem
              checked={privacyAgreed}
              onChange={(v) => { setPrivacyAgreed(v); if (!v) setAllChecked(false); }}
              label="개인정보 처리방침 동의"
              required
            />
            <hr className="border-gray-100" />
            <CheckItem
              checked={marketingAgreed}
              onChange={(v) => { setMarketingAgreed(v); if (!v) setAllChecked(false); }}
              label="마케팅 정보 수신 동의 (할인 혜택, 이벤트 안내 등)"
            />
          </div>

          <Button
            className="w-full bg-gradient-to-r from-orange-500 to-pink-500 hover:from-orange-600 hover:to-pink-600 text-white font-bold py-3"
            onClick={handleSubmit}
            disabled={!canSubmit || completeSignup.isPending}
          >
            {completeSignup.isPending ? '처리 중...' : '동의하고 시작하기'}
          </Button>

          <p className="text-xs text-center text-gray-400">
            필수 항목에 동의하지 않으면 서비스를 이용할 수 없습니다.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
