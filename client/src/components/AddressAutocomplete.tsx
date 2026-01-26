import { useState, useEffect, useRef } from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { loadGoogleMapsScript } from '@/lib/googleMapsLoader';

interface AddressAutocompleteProps {
  value: string;
  onChange: (address: string, coordinates?: { lat: number; lng: number }) => void;
  label?: string;
  placeholder?: string;
  required?: boolean;
}

export function AddressAutocomplete({
  value,
  onChange,
  label = '주소',
  placeholder = '주소를 입력하세요',
  required = false,
}: AddressAutocompleteProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const autocompleteRef = useRef<google.maps.places.Autocomplete | null>(null);
  const isInitializedRef = useRef(false); // 🔒 중복 초기화 방지

  useEffect(() => {
    if (!inputRef.current) return;
    
    // 🚨 CRITICAL: 이미 초기화되었으면 스킵 (React Strict Mode 대응)
    if (isInitializedRef.current || autocompleteRef.current) {
      console.log('[AddressAutocomplete] Already initialized, skipping...');
      return;
    }

    // Google Maps API 로드 확인
    const initAutocomplete = async () => {
      await loadGoogleMapsScript();
      if (!inputRef.current || !window.google) return;
      
      // 🔒 중복 체크 (다시 한번)
      if (autocompleteRef.current) {
        console.log('[AddressAutocomplete] Already initialized during load, skipping...');
        return;
      }

      console.log('[AddressAutocomplete] Initializing Google Places...');

      // Google Places Autocomplete 초기화
      autocompleteRef.current = new window.google.maps.places.Autocomplete(inputRef.current, {
        componentRestrictions: { country: 'kr' }, // 한국만
        fields: ['formatted_address', 'geometry', 'name'],
        types: ['establishment', 'geocode'], // 건물, 주소
      });

      // 초기화 완료 플래그
      isInitializedRef.current = true;

      // 🚫 Google 로고 강제 제거 (DOM 조작)
      setTimeout(() => {
        const logos = document.querySelectorAll('.pac-logo, .pac-icon, [class*="pac-logo"]');
        logos.forEach(logo => {
          (logo as HTMLElement).style.display = 'none';
          logo.remove();
        });
        console.log('[AddressAutocomplete] Google logos removed');
      }, 100);

      // 주소 선택 시 이벤트 리스너
      autocompleteRef.current.addListener('place_changed', () => {
        const place = autocompleteRef.current?.getPlace();
        if (!place || !place.geometry || !place.geometry.location) {
          return;
        }

        const address = place.formatted_address || place.name || '';
        const lat = place.geometry.location.lat();
        const lng = place.geometry.location.lng();

        console.log('[AddressAutocomplete] Place selected:', address);
        onChange(address, { lat, lng });
      });
    };

    initAutocomplete();

    return () => {
      // Cleanup
      if (autocompleteRef.current) {
        console.log('[AddressAutocomplete] Cleaning up...');
        google.maps.event.clearInstanceListeners(autocompleteRef.current);
        autocompleteRef.current = null;
        isInitializedRef.current = false;
      }
    };
  }, []);

  return (
    <div className="space-y-2">
      <Label htmlFor="address">
        {label} {required && '*'}
      </Label>
      <Input
        ref={inputRef}
        id="address"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onBlur={(e) => {
          // 🔧 클릭 이벤트가 처리될 시간 확보 (Focus Trap 방지)
          setTimeout(() => {
            // onBlur는 지연 실행
          }, 200);
        }}
        placeholder={placeholder}
        required={required}
        autoComplete="off"
        autoCorrect="off"
        autoCapitalize="off"
        spellCheck="false"
      />
      <p className="text-xs text-gray-500">주소를 입력하면 자동완성 목록이 표시됩니다</p>
    </div>
  );
}
