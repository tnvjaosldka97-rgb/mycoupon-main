/**
 * KakaoAddressSearch — Daum/Kakao 우편번호 API 기반 주소 검색
 * 모바일: 팝업 대신 인라인 embed 모드 사용 (팝업이 Capacitor WebView에서 레이아웃 깨짐)
 * 데스크톱: 팝업 모드 (기존 동작)
 */
import { useEffect, useRef, useState } from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Search, X } from 'lucide-react';

declare global {
  interface Window {
    daum?: {
      Postcode: new (options: {
        oncomplete: (data: DaumPostcodeResult) => void;
        onclose?: () => void;
        width?: string | number;
        height?: string | number;
      }) => { open: () => void; embed: (el: HTMLElement, opts?: { autoClose?: boolean }) => void };
    };
  }
}

interface DaumPostcodeResult {
  address: string;
  addressType: string;
  bname: string;
  buildingName: string;
  zonecode: string;
  jibunAddress: string;
  roadAddress: string;
}

interface KakaoAddressSearchProps {
  value: string;
  onChange: (address: string) => void;
  label?: string;
  placeholder?: string;
  required?: boolean;
}

function loadKakaoPostcodeScript(): Promise<void> {
  return new Promise((resolve) => {
    if (window.daum?.Postcode) { resolve(); return; }
    const existing = document.querySelector('script[src*="postcode.v2.js"]');
    if (existing) { existing.addEventListener('load', () => resolve()); return; }
    const script = document.createElement('script');
    script.src = 'https://t1.daumcdn.net/mapjsapi/bundle/postcode/prod/postcode.v2.js';
    script.async = true;
    script.onload = () => resolve();
    document.head.appendChild(script);
  });
}

function isMobile(): boolean {
  return /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
}

export function KakaoAddressSearch({
  value,
  onChange,
  label = '주소',
  placeholder = '주소 검색 버튼을 클릭하세요',
  required = false,
}: KakaoAddressSearchProps) {
  const [isLoading, setIsLoading] = useState(false);
  const [showEmbed, setShowEmbed]  = useState(false);
  const embedRef   = useRef<HTMLDivElement>(null);

  useEffect(() => {
    loadKakaoPostcodeScript().catch(() => {});
  }, []);

  // embed 모드: 모바일에서 인라인으로 주소 검색창 표시
  useEffect(() => {
    if (!showEmbed || !embedRef.current || !window.daum?.Postcode) return;
    const container = embedRef.current;
    container.innerHTML = ''; // 이전 내용 초기화

    new window.daum.Postcode({
      oncomplete: (data: DaumPostcodeResult) => {
        const fullAddress = data.roadAddress || data.address;
        onChange(fullAddress);
        setShowEmbed(false);
      },
      onclose: () => setShowEmbed(false),
    }).embed(container, { autoClose: true });
  }, [showEmbed, onChange]);

  const handleSearch = async () => {
    setIsLoading(true);
    try {
      await loadKakaoPostcodeScript();
    } finally {
      setIsLoading(false);
    }

    if (!window.daum?.Postcode) {
      alert('주소 검색 서비스를 불러오지 못했습니다. 잠시 후 다시 시도해주세요.');
      return;
    }

    if (isMobile()) {
      // 모바일: embed 모드로 인라인 표시
      setShowEmbed(true);
    } else {
      // 데스크톱: 팝업 모드
      new window.daum.Postcode({
        oncomplete: (data: DaumPostcodeResult) => {
          const fullAddress = data.roadAddress || data.address;
          onChange(fullAddress);
        },
      }).open();
    }
  };

  return (
    <div className="space-y-2">
      <Label htmlFor="address">
        {label} {required && <span className="text-red-500">*</span>}
      </Label>

      {/* 검색 인풋 + 버튼 */}
      <div className="flex gap-2">
        <Input
          id="address"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          required={required}
          readOnly
          className="flex-1 bg-gray-50 cursor-pointer"
          onClick={handleSearch}
        />
        <Button
          type="button"
          variant="outline"
          onClick={handleSearch}
          disabled={isLoading}
          className="shrink-0 px-3"
        >
          <Search className="w-4 h-4 mr-1" />
          {isLoading ? '로딩...' : '검색'}
        </Button>
      </div>

      {/* 모바일 embed 주소 검색창 */}
      {showEmbed && (
        <div className="relative mt-2 rounded-lg overflow-hidden border border-gray-200 shadow-lg"
          style={{ zIndex: 9999 }}>
          {/* 닫기 버튼 */}
          <div className="flex items-center justify-between px-3 py-2 bg-gray-100 border-b">
            <span className="text-sm font-semibold text-gray-700">주소 검색</span>
            <button
              type="button"
              onClick={() => setShowEmbed(false)}
              className="p-1 rounded hover:bg-gray-200 transition-colors"
              aria-label="닫기"
            >
              <X className="w-4 h-4 text-gray-600" />
            </button>
          </div>
          {/* Daum 주소 검색 embed 영역 */}
          <div
            ref={embedRef}
            style={{ width: '100%', height: '400px' }}
          />
        </div>
      )}

      <p className="text-xs text-gray-500">도로명 주소로 검색합니다</p>
    </div>
  );
}
