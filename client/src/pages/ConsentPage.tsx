/**
 * 가입 동의 / 온보딩 페이지
 * - 구글 로그인 후 signupCompletedAt이 없는 신규 사용자가 진입
 * - [필수] 3개: 이용약관, 개인정보, 위치기반서비스
 * - [선택] 1개: 마케팅 동의
 * - 각 항목 클릭 시 전문 내용을 스크롤 가능한 모달로 표시
 */
import { useState, useEffect, useRef } from 'react';
import { useLocation, useSearch } from 'wouter';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useAuth } from '@/hooks/useAuth';
import { trpc } from '@/lib/trpc';
import { toast } from '@/components/ui/sonner';
import { CheckCircle2, Circle, ChevronRight } from 'lucide-react';
import { TERMS_SERVICE, TERMS_PRIVACY, TERMS_LOCATION, TERMS_MARKETING } from '@/constants/terms';

// ── 약관 항목 정의 ────────────────────────────────────────────────────────────
const TERM_ITEMS = [
  {
    id: 'terms' as const,
    label: '마이쿠폰 가맹점 서비스 이용약관 동의',
    required: true,
    content: TERMS_SERVICE,
  },
  {
    id: 'privacy' as const,
    label: '개인정보 수집·이용 동의 (가입 및 계약 체결 목적)',
    required: true,
    content: TERMS_PRIVACY,
  },
  {
    id: 'lbs' as const,
    label: '위치기반서비스(LBS) 이용약관 동의',
    required: true,
    content: TERMS_LOCATION,
  },
  {
    id: 'marketing' as const,
    label: '마케팅 정보 수신 및 영업 목적 이용 동의',
    required: false,
    content: TERMS_MARKETING,
  },
] as const;

type TermId = typeof TERM_ITEMS[number]['id'];

// ── 약관 뷰어 모달 ──────────────────────────────────────────────────────────
function TermsModal({
  item,
  onClose,
}: {
  item: typeof TERM_ITEMS[number] | null;
  onClose: () => void;
}) {
  if (!item) return null;
  return (
    <Dialog open={!!item} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-lg w-[95vw] max-h-[80vh] flex flex-col p-0">
        <DialogHeader className="px-5 pt-5 pb-3 border-b flex-shrink-0">
          <DialogTitle className="text-base font-bold leading-snug pr-8">
            {item.required && <span className="text-orange-500 mr-1">[필수]</span>}
            {!item.required && <span className="text-gray-400 mr-1">[선택]</span>}
            {item.label}
          </DialogTitle>
        </DialogHeader>
        {/* 스크롤 가능한 약관 전문 영역 */}
        <div className="flex-1 overflow-y-auto px-5 py-4">
          <pre className="text-sm text-gray-700 leading-relaxed whitespace-pre-wrap font-sans">
            {item.content}
          </pre>
        </div>
        <div className="px-5 py-4 border-t flex-shrink-0">
          <Button
            className="w-full bg-gradient-to-r from-orange-500 to-pink-500 text-white font-bold"
            onClick={onClose}
          >
            확인
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── 체크 항목 ─────────────────────────────────────────────────────────────────
function CheckItem({
  checked,
  onChange,
  label,
  required,
  onViewTerms,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  required?: boolean;
  onViewTerms?: () => void;
}) {
  return (
    <div className="flex items-center gap-2 w-full py-2.5">
      <button
        type="button"
        className="flex items-center gap-3 flex-1 text-left"
        onClick={() => onChange(!checked)}
      >
        {checked ? (
          <CheckCircle2 className="h-5 w-5 text-orange-500 shrink-0" />
        ) : (
          <Circle className="h-5 w-5 text-gray-300 shrink-0" />
        )}
        <span className="text-sm text-gray-700 leading-relaxed">
          {required ? (
            <span className="text-red-500 font-bold mr-1">[필수]</span>
          ) : (
            <span className="text-gray-400 mr-1">[선택]</span>
          )}
          {label}
        </span>
      </button>
      {onViewTerms && (
        <button
          type="button"
          onClick={onViewTerms}
          className="shrink-0 flex items-center gap-0.5 text-xs text-gray-400 hover:text-orange-500 transition-colors"
          aria-label="약관 보기"
        >
          보기
          <ChevronRight className="w-3.5 h-3.5" />
        </button>
      )}
    </div>
  );
}

// ── 메인 페이지 ──────────────────────────────────────────────────────────────
export default function ConsentPage() {
  const [, setLocation] = useLocation();
  const searchStr = useSearch();
  const { user, loading } = useAuth();
  const utils = trpc.useUtils();

  // 동의 완료 후 항상 home(/) 으로 이동.
  // - 구글 로그인 시점엔 사장님/일반 유저 구분 불가 (한 사람이 둘 다일 수도).
  // - 동의 받은 다음 사용자가 직접 메뉴 선택하는 게 맞음.
  // - 진입점들의 ?next=/merchant/dashboard 파라미터는 무시 (legacy URL 호환).
  const nextUrl = '/';

  // 체크 상태
  const [checks, setChecks] = useState<Record<TermId, boolean>>({
    terms: false,
    privacy: false,
    lbs: false,
    marketing: false,
  });
  const [allChecked, setAllChecked] = useState(false);

  // 약관 뷰어 모달 상태
  const [viewingItem, setViewingItem] = useState<typeof TERM_ITEMS[number] | null>(null);

  // mode=app: Capacitor 앱 Custom Tabs 컨텍스트에서 동의 중임을 의미
  // 동의 완료 후 WebView 세션 주입이 필요한 경우
  const isAppMode = (() => {
    try {
      const params = new URLSearchParams(searchStr);
      return params.get('mode') === 'app';
    } catch (_) { return false; }
  })();

  const completeSignup = trpc.auth.completeSignup.useMutation({
    onSuccess: () => {
      toast.success('가입이 완료되었습니다! 서비스를 이용해 보세요.');
      if (isAppMode) {
        // Custom Tabs에서 동의 완료 → 서버 엔드포인트가 딥링크로 WebView 세션 주입
        // WebView의 appUrlOpen 핸들러 → /api/oauth/app-exchange → WebView 쿠키 설정
        console.log('[ConsentPage] app mode consent 완료 → WebView 세션 주입 시작');
        window.location.href = '/api/auth/app-ticket-from-session';
        return;
      }
      utils.auth.me.invalidate().finally(() => {
        setLocation(nextUrl);
      });
    },
    onError: (error) => {
      toast.error(error.message || '동의 저장 중 오류가 발생했습니다.');
    },
  });

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
  if (!user || (user as any).signupCompletedAt) return null;

  const handleToggleAll = (v: boolean) => {
    setAllChecked(v);
    setChecks({ terms: v, privacy: v, lbs: v, marketing: v });
  };

  const handleSingleCheck = (id: TermId, v: boolean) => {
    const next = { ...checks, [id]: v };
    setChecks(next);
    const allRequired = TERM_ITEMS.filter(i => i.required).every(i => next[i.id]);
    const allOptional = TERM_ITEMS.filter(i => !i.required).every(i => next[i.id]);
    setAllChecked(allRequired && allOptional);
  };

  const requiredAllChecked = checks.terms && checks.privacy && checks.lbs;

  const handleSubmit = () => {
    if (!requiredAllChecked) {
      toast.error('필수 약관에 모두 동의해야 합니다.');
      return;
    }
    completeSignup.mutate({
      termsAgreed: checks.terms,
      privacyAgreed: checks.privacy,
      lbsAgreed: checks.lbs,
      marketingAgreed: checks.marketing,
      termsVersion: 'v1',
      privacyVersion: 'v1',
    });
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-orange-50 via-pink-50 to-purple-50 flex items-center justify-center px-4 py-8">
      <Card className="w-full max-w-md shadow-xl">
        <CardHeader className="text-center pb-4">
          <div className="mx-auto mb-3 w-14 h-14 bg-orange-100 rounded-full flex items-center justify-center">
            <span className="text-3xl">🍊</span>
          </div>
          <CardTitle className="text-2xl font-bold text-gray-900">마이쿠폰 시작하기</CardTitle>
          <CardDescription className="text-gray-500 mt-1">
            서비스 이용을 위해 아래 약관에 동의해 주세요.
            <br />
            첫 쿠폰 등록 시 <strong>7일 무료 체험</strong>이 시작됩니다.
          </CardDescription>
        </CardHeader>

        <CardContent className="space-y-3">
          {/* 전체 동의 */}
          <div className="border rounded-xl px-3 bg-orange-50">
            <CheckItem
              checked={allChecked}
              onChange={handleToggleAll}
              label="전체 동의 (필수 + 선택 포함)"
            />
          </div>

          {/* 개별 항목 */}
          <div className="border rounded-xl px-3 divide-y divide-gray-100">
            {TERM_ITEMS.map((item) => (
              <CheckItem
                key={item.id}
                checked={checks[item.id]}
                onChange={(v) => handleSingleCheck(item.id, v)}
                label={item.label}
                required={item.required}
                onViewTerms={() => setViewingItem(item)}
              />
            ))}
          </div>

          <Button
            className="w-full bg-gradient-to-r from-orange-500 to-pink-500 hover:from-orange-600 hover:to-pink-600 text-white font-bold py-3 mt-2"
            onClick={handleSubmit}
            disabled={!requiredAllChecked || completeSignup.isPending}
          >
            {completeSignup.isPending ? '처리 중...' : '동의하고 시작하기'}
          </Button>

          <p className="text-xs text-center text-gray-400">
            필수 항목에 동의하지 않으면 서비스를 이용할 수 없습니다.
          </p>
        </CardContent>
      </Card>

      {/* 약관 전문 모달 */}
      <TermsModal item={viewingItem} onClose={() => setViewingItem(null)} />
    </div>
  );
}
