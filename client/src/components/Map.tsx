/**
 * GOOGLE MAPS FRONTEND INTEGRATION - ESSENTIAL GUIDE
 *
 * USAGE FROM PARENT COMPONENT:
 * ======
 *
 * const mapRef = useRef<google.maps.Map | null>(null);
 *
 * <MapView
 *   initialCenter={{ lat: 40.7128, lng: -74.0060 }}
 *   initialZoom={15}
 *   onMapReady={(map) => {
 *     mapRef.current = map; // Store to control map from parent anytime, google map itself is in charge of the re-rendering, not react state.
 * </MapView>
 *
 * ======
 * Available Libraries and Core Features:
 * -------------------------------
 * 📍 MARKER (from `marker` library)
 * - Attaches to map using { map, position }
 * new google.maps.marker.AdvancedMarkerElement({
 *   map,
 *   position: { lat: 37.7749, lng: -122.4194 },
 *   title: "San Francisco",
 * });
 *
 * -------------------------------
 * 🏢 PLACES (from `places` library)
 * - Does not attach directly to map; use data with your map manually.
 * const place = new google.maps.places.Place({ id: PLACE_ID });
 * await place.fetchFields({ fields: ["displayName", "location"] });
 * map.setCenter(place.location);
 * new google.maps.marker.AdvancedMarkerElement({ map, position: place.location });
 *
 * -------------------------------
 * 🧭 GEOCODER (from `geocoding` library)
 * - Standalone service; manually apply results to map.
 * const geocoder = new google.maps.Geocoder();
 * geocoder.geocode({ address: "New York" }, (results, status) => {
 *   if (status === "OK" && results[0]) {
 *     map.setCenter(results[0].geometry.location);
 *     new google.maps.marker.AdvancedMarkerElement({
 *       map,
 *       position: results[0].geometry.location,
 *     });
 *   }
 * });
 *
 * -------------------------------
 * 📐 GEOMETRY (from `geometry` library)
 * - Pure utility functions; not attached to map.
 * const dist = google.maps.geometry.spherical.computeDistanceBetween(p1, p2);
 *
 * -------------------------------
 * 🛣️ ROUTES (from `routes` library)
 * - Combines DirectionsService (standalone) + DirectionsRenderer (map-attached)
 * const directionsService = new google.maps.DirectionsService();
 * const directionsRenderer = new google.maps.DirectionsRenderer({ map });
 * directionsService.route(
 *   { origin, destination, travelMode: "DRIVING" },
 *   (res, status) => status === "OK" && directionsRenderer.setDirections(res)
 * );
 *
 * -------------------------------
 * 🌦️ MAP LAYERS (attach directly to map)
 * - new google.maps.TrafficLayer().setMap(map);
 * - new google.maps.TransitLayer().setMap(map);
 * - new google.maps.BicyclingLayer().setMap(map);
 *
 * -------------------------------
 * ✅ SUMMARY
 * - “map-attached” → AdvancedMarkerElement, DirectionsRenderer, Layers.
 * - “standalone” → Geocoder, DirectionsService, DistanceMatrixService, ElevationService.
 * - “data-only” → Place, Geometry utilities.
 */

/// <reference types="@types/google.maps" />

import { useEffect, useRef } from "react";
import { usePersistFn } from "@/hooks/usePersistFn";
import { cn } from "@/lib/utils";
import { loadGoogleMapsScript } from "@/lib/googleMapsLoader";

declare global {
  interface Window {
    google?: typeof google;
  }
}



interface MapViewProps {
  className?: string;
  initialCenter?: google.maps.LatLngLiteral;
  initialZoom?: number;
  onMapReady?: (map: google.maps.Map) => void;
}

export function MapView({
  className,
  initialCenter = { lat: 37.7749, lng: -122.4194 },
  initialZoom = 12,
  onMapReady,
}: MapViewProps) {
  const mapContainer = useRef<HTMLDivElement>(null);
  const map = useRef<google.maps.Map | null>(null);

  const init = usePersistFn(async () => {
    console.log('[MAP] 지도 SDK 로드 시작 (loadGoogleMapsScript)');
    await loadGoogleMapsScript();
    console.log('[MAP] 지도 SDK 로드 완료');

    if (!mapContainer.current) {
      console.error('[MAP] ❌ mapContainer.current가 null — DOM이 준비되지 않음');
      return;
    }

    const containerRect = mapContainer.current.getBoundingClientRect();
    console.log('[MAP] 지도 컨테이너 크기 → width:', containerRect.width, 'height:', containerRect.height);

    if (containerRect.height === 0 || containerRect.width === 0) {
      console.error('[MAP] ❌ 지도 컨테이너 크기가 0 — 레이아웃 붕괴 가능성');
    }

    console.log('[MAP] 지도 인스턴스 생성 시작');
    map.current = new window.google.maps.Map(mapContainer.current, {
      zoom: initialZoom,
      center: initialCenter,
      mapTypeControl: false,
      fullscreenControl: false,
      zoomControl: false,
      streetViewControl: false,
      gestureHandling: 'greedy',
      // 지하철역 + 주요 랜드마크만 남기고 나머지 POI/도로명 숨김
      styles: [
        // 일반 POI 전부 숨김 (편의점, 식당, 카페 레이블 등)
        { featureType: 'poi', elementType: 'labels', stylers: [{ visibility: 'off' }] },
        // 공원/자연 POI 숨김
        { featureType: 'poi.park', elementType: 'labels.text', stylers: [{ visibility: 'off' }] },
        // 지하철/교통 역은 표시 유지
        { featureType: 'transit.station', elementType: 'labels', stylers: [{ visibility: 'on' }] },
        { featureType: 'transit.station.rail', elementType: 'labels', stylers: [{ visibility: 'on' }] },
        // 버스 정류장은 숨김 (지저분함)
        { featureType: 'transit.station.bus', elementType: 'labels', stylers: [{ visibility: 'off' }] },
        // 골목길/소로 레이블 숨김
        { featureType: 'road.local', elementType: 'labels', stylers: [{ visibility: 'off' }] },
        // 도로 번호(원효로2가 식 레이블) 숨김
        { featureType: 'road', elementType: 'labels.icon', stylers: [{ visibility: 'off' }] },
        // 주요 도로 레이블은 단순화
        { featureType: 'road.arterial', elementType: 'labels.text', stylers: [{ visibility: 'simplified' }] },
      ],
    });
    console.log('[MAP] ✅ 지도 인스턴스 생성 완료');
    if (onMapReady) {
      onMapReady(map.current);
    }
  });

  useEffect(() => {
    init();
  }, [init]);

  // Google Maps Attribution 마스킹 레이아웃
  //   - 외부 wrapper: 지정 높이 유지 + overflow: hidden
  //   - 내부 지도 컨테이너: absolute + bottom: -28px 로 Google 저작권/로고/키보드 단축키 버튼이
  //     wrapper 외부로 밀려 시각적으로 잘림 (DOM 요소 자체는 유지 — ToS 필수 표기 보존)
  //   - React/Google Maps 아키텍처 미변경, 순수 CSS 레이아웃만 조정
  return (
    <div className={cn("w-full h-[500px] overflow-hidden relative", className)}>
      <div
        ref={mapContainer}
        className="gmap-attribution-mask absolute inset-x-0 top-0"
        style={{ bottom: '-28px' }}
      />
    </div>
  );
}
