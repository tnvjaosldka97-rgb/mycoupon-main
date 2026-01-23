# 마이쿠폰 카테고리 아이콘 이미지 생성 가이드

## 📐 이미지 사양
- **크기**: 128x128px (PNG 형식)
- **배경**: 투명 배경 (PNG alpha channel)
- **스타일**: 파스텔 톤, 아기자기한 일러스트 스타일
- **색상 팔레트**: 마이쿠폰 브랜드 컬러 (오렌지 #FF9800, 핑크 #E91E63, 민트 #4ECDC4, 퍼플 #9C27B0)

## 🎨 카테고리별 아이콘 프롬프트

### 1. 카페 (cafe)
**파일명**: `icon-cafe.png`

**프롬프트**:
```
A cute, minimalist coffee cup icon in pastel colors. The cup should be steaming with small heart-shaped steam clouds. Use soft orange (#FF9800) and cream colors. Flat illustration style with rounded edges, kawaii aesthetic. Transparent background. 128x128px. Simple, clean design suitable for a map marker icon.
```

**한글 설명**: 파스텔 오렌지 색상의 귀여운 커피잔 아이콘. 하트 모양 김이 올라오는 모습. 둥근 모서리, 플랫 일러스트 스타일.

---

### 2. 음식점 (restaurant)
**파일명**: `icon-restaurant.png`

**프롬프트**:
```
A cute fork and spoon crossed icon in pastel colors. Use soft pink (#E91E63) and coral tones. Flat illustration style with rounded edges, kawaii aesthetic. Add small sparkles around the utensils. Transparent background. 128x128px. Simple, clean design suitable for a map marker icon.
```

**한글 설명**: 파스텔 핑크 색상의 귀여운 포크와 스푼이 교차된 아이콘. 주변에 작은 반짝임 효과. 둥근 모서리, 플랫 일러스트 스타일.

---

### 3. 뷰티 (beauty)
**파일명**: `icon-beauty.png`

**프롬프트**:
```
A cute lipstick and makeup brush icon in pastel colors. Use soft purple (#9C27B0) and pink tones. Flat illustration style with rounded edges, kawaii aesthetic. Add small stars or sparkles around. Transparent background. 128x128px. Simple, clean design suitable for a map marker icon.
```

**한글 설명**: 파스텔 퍼플 색상의 귀여운 립스틱과 메이크업 브러시 아이콘. 주변에 별이나 반짝임. 둥근 모서리, 플랫 일러스트 스타일.

---

### 4. 병원 (hospital)
**파일명**: `icon-hospital.png`

**프롬프트**:
```
A cute medical cross or stethoscope icon in pastel colors. Use soft mint green (#4ECDC4) and white tones. Flat illustration style with rounded edges, kawaii aesthetic. Add a small heart symbol. Transparent background. 128x128px. Simple, clean design suitable for a map marker icon.
```

**한글 설명**: 파스텔 민트 색상의 귀여운 의료 십자가 또는 청진기 아이콘. 작은 하트 심볼 포함. 둥근 모서리, 플랫 일러스트 스타일.

---

### 5. 헬스장 (fitness)
**파일명**: `icon-fitness.png`

**프롬프트**:
```
A cute dumbbell or flexed arm icon in pastel colors. Use soft orange (#FF9800) and yellow tones. Flat illustration style with rounded edges, kawaii aesthetic. Add small energy sparkles or stars. Transparent background. 128x128px. Simple, clean design suitable for a map marker icon.
```

**한글 설명**: 파스텔 오렌지 색상의 귀여운 덤벨 또는 팔 근육 아이콘. 에너지 반짝임이나 별 효과. 둥근 모서리, 플랫 일러스트 스타일.

---

### 6. 기타 (other)
**파일명**: `icon-other.png`

**프롬프트**:
```
A cute gift box or star icon in pastel colors. Use soft pink (#E91E63) and purple tones. Flat illustration style with rounded edges, kawaii aesthetic. Add small sparkles around. Transparent background. 128x128px. Simple, clean design suitable for a map marker icon.
```

**한글 설명**: 파스텔 핑크 색상의 귀여운 선물 상자 또는 별 아이콘. 주변에 작은 반짝임. 둥근 모서리, 플랫 일러스트 스타일.

---

## 📦 파일 저장 위치
생성된 이미지 파일을 다음 경로에 저장하세요:
```
/home/ubuntu/local_recommendation_engine/client/public/
```

## 🔧 코드 적용 방법
이미지 생성 후, 다음 파일들을 수정하여 아이콘을 적용합니다:
1. `client/src/pages/MapPage.tsx` - 지도 마커 아이콘
2. `client/src/pages/Admin.tsx` - 관리자 페이지 카테고리 선택
3. 필터 UI 컴포넌트

## ✅ 체크리스트
- [ ] 6개 카테고리 아이콘 이미지 생성 완료
- [ ] 이미지 파일을 `/client/public/` 폴더에 저장
- [ ] 투명 배경 확인 (PNG alpha channel)
- [ ] 파일 크기 최적화 (각 파일 50KB 이하 권장)
- [ ] 코드에 아이콘 경로 적용
- [ ] 지도에서 마커 아이콘 정상 표시 확인
