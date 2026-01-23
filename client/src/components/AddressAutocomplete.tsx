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

  useEffect(() => {
    if (!inputRef.current) return;

    // Google Maps API 로드 확인
    const initAutocomplete = async () => {
      await loadGoogleMapsScript();
      if (!inputRef.current || !window.google) return;

    // Google Places Autocomplete 초기화
    autocompleteRef.current = new window.google.maps.places.Autocomplete(inputRef.current, {
      componentRestrictions: { country: 'kr' }, // 한국만
      fields: ['formatted_address', 'geometry', 'name'],
      types: ['establishment', 'geocode'], // 건물, 주소
    });

    // 주소 선택 시 이벤트 리스너
    autocompleteRef.current.addListener('place_changed', () => {
      const place = autocompleteRef.current?.getPlace();
      if (!place || !place.geometry || !place.geometry.location) {
        return;
      }

      const address = place.formatted_address || place.name || '';
      const lat = place.geometry.location.lat();
      const lng = place.geometry.location.lng();

      onChange(address, { lat, lng });
    });

      return () => {
        if (autocompleteRef.current) {
          google.maps.event.clearInstanceListeners(autocompleteRef.current);
        }
      };
    };

    initAutocomplete();
  }, [onChange]);

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
        placeholder={placeholder}
        required={required}
        autoComplete="off"
      />
      <p className="text-xs text-gray-500">주소를 입력하면 자동완성 목록이 표시됩니다</p>
    </div>
  );
}
