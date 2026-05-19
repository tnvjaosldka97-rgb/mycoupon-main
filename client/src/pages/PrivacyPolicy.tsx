/**
 * 공개 약관·개인정보처리방침 페이지 (인증 불필요)
 * - 구글플레이 제출용 공개 URL: /privacy
 * - 개인정보처리방침(보강 정식본) + 기존 약관 5종(terms.ts 원문) 통합 열람
 * - 로그인 가드 없음 — 비로그인/심사자 접근 가능 (핵심 요건)
 */
import { useState } from 'react';
import { useLocation } from 'wouter';
import { Button } from '@/components/ui/button';
import { ArrowLeft } from 'lucide-react';
import { PRIVACY_POLICY, PRIVACY_POLICY_UPDATED_AT } from '@/constants/privacyPolicy';
import {
  TERMS_SERVICE,
  TERMS_LOCATION,
  TERMS_MARKETING,
  TERMS_TRANSACTIONAL_PUSH,
} from '@/constants/terms';

const DOCS = [
  { id: 'privacy', label: '개인정보처리방침', content: PRIVACY_POLICY },
  { id: 'service', label: '서비스 이용약관', content: TERMS_SERVICE },
  { id: 'location', label: '위치기반서비스', content: TERMS_LOCATION },
  { id: 'push', label: '알림 수신', content: TERMS_TRANSACTIONAL_PUSH },
  { id: 'marketing', label: '마케팅 (선택)', content: TERMS_MARKETING },
] as const;

type DocId = typeof DOCS[number]['id'];

export default function PrivacyPolicy() {
  const [, setLocation] = useLocation();
  const [active, setActive] = useState<DocId>('privacy');
  const current = DOCS.find((d) => d.id === active) ?? DOCS[0];

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="sticky top-0 z-10 border-b bg-white/90 backdrop-blur-md">
        <div className="mx-auto flex max-w-3xl items-center gap-2 px-4 py-3">
          <Button
            variant="ghost"
            size="sm"
            className="shrink-0"
            onClick={() => setLocation('/')}
          >
            <ArrowLeft className="mr-1 h-4 w-4" />
            홈
          </Button>
          <h1 className="truncate text-base font-bold text-gray-900 sm:text-lg">
            마이쿠폰 약관 및 개인정보처리방침
          </h1>
        </div>
        {/* 문서 선택 탭 — 모바일 가로 스크롤 */}
        <div className="mx-auto max-w-3xl overflow-x-auto px-4 pb-2">
          <div className="flex gap-1.5">
            {DOCS.map((d) => (
              <button
                key={d.id}
                type="button"
                onClick={() => setActive(d.id)}
                className={`shrink-0 rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${
                  active === d.id
                    ? 'bg-orange-500 text-white'
                    : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                }`}
              >
                {d.label}
              </button>
            ))}
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-4 py-6">
        <div className="rounded-2xl border bg-white p-5 shadow-sm sm:p-7">
          <h2 className="mb-1 text-lg font-bold text-gray-900">{current.label}</h2>
          <p className="mb-4 text-xs text-gray-400">
            최종 개정일 {PRIVACY_POLICY_UPDATED_AT}
          </p>
          <pre className="whitespace-pre-wrap break-words font-sans text-[13px] leading-relaxed text-gray-700 sm:text-sm">
            {current.content}
          </pre>
        </div>
        <p className="mt-6 text-center text-xs text-gray-400">
          주식회사 온리업코퍼레이션 · 사업자등록번호 112-88-03123
        </p>
      </main>
    </div>
  );
}
