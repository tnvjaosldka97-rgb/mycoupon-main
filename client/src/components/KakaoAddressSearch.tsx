/**
 * KakaoAddressSearch — Daum/Kakao 우편번호 API 기반 주소 검색
 * - 무료, API 키 불필요
 * - 한국 도로명/지번 주소 정확하게 반환
 * - 모바일 팝업 방식으로 UX 우수
 */
import { useEffect, useRef, useState } from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Search } from 'lucide-react';

declare global {
  interface Window {
    daum?: {
      Postcode: new (options: {
        oncomplete: (data: DaumPostcodeResult) => void;
        onclose?: () => void;
        width?: string | number;
        height?: string | number;
      }) => { open: () => void };
    };
  }
}

interface DaumPostcodeResult {
  address: string;       // 도로명 주소
  addressType: string;   // 주소 타입
  bname: string;         // 법정동/법정리 이름
  buildingName: string;  // 건물명
  zonecode: string;      // 우편번호
  jibunAddress: string;  // 지번 주소
  roadAddress: string;   // 도로명 주소
}

interface KakaoAddressSearchProps {
  value: string;
  onChange: (address: string, coordinates?: { lat: number; lng: number }) => void;
  label?: string;
  placeholder?: string;
  required?: boolean;
}

function loadKakaoPostcodeScript(): Promise<void> {
  return new Promise((resolve) => {
    if (window.daum?.Postcode) {
      resolve();
      return;
    }
    const existing = document.querySelector('script[src*="postcode.v2.js"]');
    if (existing) {
      existing.addEventListener('load', () => resolve());
      return;
    }
    const script = document.createElement('script');
    script.src = 'https://t1.daumcdn.net/mapjsapi/bundle/postcode/prod/postcode.v2.js';
    script.async = true;
    script.onload = () => resolve();
    document.head.appendChild(script);
  });
}

export function KakaoAddressSearch({
  value,
  onChange,
  label = '주소',
  placeholder = '주소 검색 버튼을 클릭하세요',
  required = false,
}: KakaoAddressSearchProps) {
  const [isLoading, setIsLoading] = useState(false);
  const detailRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    // 미리 스크립트 로드
    loadKakaoPostcodeScript().catch(() => {});
  }, []);

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

    new window.daum.Postcode({
      oncomplete: (data: DaumPostcodeResult) => {
        const fullAddress = data.roadAddress || data.address;
        onChange(fullAddress);
        // 주소 선택 후 상세 주소 입력 필드에 포커스
        setTimeout(() => {
          detailRef.current?.focus();
        }, 100);
      },
    }).open();
  };

  return (
    <div className="space-y-2">
      <Label htmlFor="address">
        {label} {required && <span className="text-red-500">*</span>}
      </Label>
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
      <p className="text-xs text-gray-500">도로명 주소로 검색합니다</p>
    </div>
  );
}
