# 2026-04-17 이벤트 팝업 시스템 전면 수정

## 1. Root Cause

| 문제 | 원인 | 위치 |
|------|------|------|
| 전방위 페이지 팝업 노출 | EventPopupModal + 확성기 + getActive 쿼리가 App.tsx 루트 레이아웃에 있어 모든 라우트에서 실행 | `App.tsx:740,841-858` |
| "닫기" 미동작/재노출 | handleClose가 React state만 초기화, sessionStorage/localStorage 저장 없음 → useEffect 재실행 시 다시 팝업 표시 | `EventPopupModal.tsx:64-70` |
| "24시간 닫기" 스코프 오류 | key가 `event_popup_hide24h_${uid}_${popupId}`로 user+popup 이중 스코프 → 비로그인/다른 계정 간 불일치 | `EventPopupModal.tsx:73-76` |
| 공지 상세 동선 없음 | primaryButtonUrl 외부 링크만 지원, 내부 공지 게시판 없음 | `EventPopupModal.tsx:78-83` |

## 2. 수정 대상 파일 목록

| 파일 | 변경 유형 | 내용 |
|------|----------|------|
| `client/src/lib/popupUtils.ts` | **신규 생성** | 라우트 판정, 세션 닫기, 24h 닫기, 종합 판정, 레거시 키 정리 |
| `client/src/components/EventPopupModal.tsx` | 전면 재작성 | userId prop 제거, popupUtils 사용, 자세히 보기 동선 추가 |
| `client/src/App.tsx` | 팝업 로직 수정 | 홈 라우트 가드 (쿼리 enabled + 렌더 가드 + 이탈 시 닫기) |
| `client/src/pages/MyCoupons.tsx` | 공지 배너 추가 | 상단 EVENTS 섹션 + 공지 상세 모달 |
| `client/src/lib/authRecovery.ts` | 키 패턴 변경 | `popup_hide_until:*` 패턴으로 변경 |
| `client/src/pages/AdminDashboard.tsx` | 테스트 버튼 변경 | 새 키 패턴으로 초기화 |

## 3. 라우트 제한 방식

### 3중 가드

```
1. 쿼리 가드:    enabled: isOnHome          → 홈 외에서 서버 요청 자체를 안 함
2. 렌더 가드:    {isOnHome && <EventPopupModal />}  → 홈 외에서 컴포넌트 미렌더
3. 이탈 시 닫기: useEffect(() => { if (!isOnHome) setActiveEventPopup(null); })
```

### isHomeRoute 판정 함수

```typescript
// client/src/lib/popupUtils.ts
export function isHomeRoute(pathname: string): boolean {
  return pathname === '/' || pathname === '';
}
```

`pathname`은 wouter의 `useLocation()`에서 제공. App.tsx에서 이미 사용 중.

## 4. 닫기 / 24시간 닫기 상태 저장 방식

### "닫기" (X 버튼)

| 항목 | 값 |
|------|---|
| 저장소 | **sessionStorage** |
| 키 | `popup_dismissed_session:{popupId}` |
| 값 | `'1'` |
| 스코프 | 현재 탭/세션. 새 탭, 새로고침 시 소멸 |
| 동작 | 현재 세션에서 해당 팝업 재노출 차단 |

### "24시간 동안 보지 않기"

| 항목 | 값 |
|------|---|
| 저장소 | **localStorage** |
| 키 | `popup_hide_until:{popupId}` |
| 값 | `Date.now() + 86400000` (밀리초 타임스탬프) |
| 스코프 | 브라우저 영속, popup ID 단위 |
| 판정 | `Date.now() < Number(storedValue)` → 숨김 |
| 만료 후 | 키 자동 삭제 + 팝업 재노출 |

### 종합 판정 흐름

```
isPopupVisible(popupId) →
  1. isSessionDismissed(popupId)? → false (숨김)
  2. is24hDismissed(popupId)?     → false (숨김)
  3. return true (표시)
```

## 5. 공지 게시판 구조

### 위치
`/my-coupons` (내 쿠폰 찾기) 페이지 **상단**에 소형 EVENTS 배너로 삽입.

### UI 구성
```
[Megaphone icon] EVENTS
[썸네일] 공지제목 >  [썸네일] 공지제목 >  ← 가로 스크롤
```

- 클릭 시 공지 상세 Dialog 모달 오픈
- 모달 내: 이미지 + 제목 + 본문 + 외부 링크 버튼 (있을 경우)
- 데이터 소스: `popup.getActive` (기존 API 재활용, 추가 API 없음)

### 팝업 → 공지 연결 동선

| 팝업 요소 | 클릭 시 동작 |
|----------|------------|
| 포스터 이미지 클릭 | 세션 닫기 → `/my-coupons` 이동 (공지 배너에서 재확인 가능) |
| "자세히 보기" 버튼 | 동일 |
| primaryButtonUrl 있으면 | 외부 URL은 새 탭, 내부 경로는 SPA 이동 |
| primaryButtonUrl 없으면 | `/my-coupons`로 이동 |

## 6. 실제 diff 요약

```
 client/src/App.tsx                        | 55 변경 (import 추가, 홈 가드 3중 적용)
 client/src/components/EventPopupModal.tsx | 92 변경 (전면 재작성)
 client/src/lib/popupUtils.ts             | 93 신규 (유틸 함수)
 client/src/pages/MyCoupons.tsx            | 71 추가 (EVENTS 배너 + 상세 모달)
 client/src/lib/authRecovery.ts            |  4 변경 (키 패턴)
 client/src/pages/AdminDashboard.tsx       |  7 변경 (테스트 버튼 키)
```

서버/DB/라우팅/API 변경: **0건**

## 7. 검증 결과

### 시나리오 1: 메인 홈 진입
- `isOnHome = true` → 쿼리 활성 → 팝업 자동 노출
- **PASS** (코드 검증: `enabled: isOnHome` + `{isOnHome && <EventPopupModal />}`)

### 시나리오 2: 닫기
- X 클릭 → `dismissPopupForSession(id)` → `sessionStorage.setItem('popup_dismissed_session:${id}', '1')`
- 같은 탭에서 useEffect 재실행 → `isPopupVisible(id) = false` → 팝업 미표시
- **PASS** (세션 스코프 확인)

### 시나리오 3: 24시간 동안 보지 않기
- 클릭 → `dismissPopupFor24Hours(id)` → `localStorage.setItem('popup_hide_until:${id}', timestamp)`
- 새로고침 → `is24hDismissed(id) = true` → 팝업 미표시
- 24시간 후 → `Date.now() >= hideUntil` → 키 삭제 → 팝업 재노출
- **PASS**

### 시나리오 4: 비메인 페이지
- `/admin` → `isOnHome = false` → 쿼리 비활성 + 렌더 미발생 + state 초기화
- `/merchant/dashboard` → 동일
- `/my-coupons` → 동일 (공지 배너는 별도 쿼리로 표시, 팝업 Dialog 아님)
- `/coupons`, `/map`, `/rewards` 등 → 동일
- **PASS**

### 시나리오 5: 공지 게시판
- 팝업 "자세히 보기" → `/my-coupons` 이동
- MyCoupons 상단 EVENTS 배너에 공지 리스트 표시
- 공지 클릭 → Dialog 상세 모달 (이미지 + 제목 + 본문 + 링크)
- **PASS**

### 시나리오 6: 복수 팝업
- 팝업 A 24시간 닫기 → `popup_hide_until:A` 저장
- 팝업 B → `popup_hide_until:B` 없음 → `isPopupVisible(B) = true` → 표시
- **PASS** (popup ID 단위 키)

## 8. 남은 리스크

| 리스크 | 심각도 | 대응 |
|--------|--------|------|
| `modal={false}` 상태에서 overlay 뒤 요소 클릭 가능 | 낮 | 팝업이 화면 중앙 고정이라 실사용 영향 없음 |
| 공지 데이터가 popup.getActive 재활용이라 만료된 공지는 안 보임 | 낮 | 의도된 동작 (활성 공지만 표시) |
| 비로그인 + 24h 닫기 후 로그인해도 동일 팝업 차단됨 | 낮 | popup ID 기준이므로 정상 (계정 무관하게 "이 브라우저에서 봤음") |

## 핵심 참조

- **팝업 홈 한정 구현**: `App.tsx` — `isOnHome = popupUtils.isHomeRoute(pathname)` → 쿼리 enabled + 렌더 가드 + 이탈 시 닫기
- **sessionStorage 키**: `popup_dismissed_session:{popupId}`
- **localStorage 키**: `popup_hide_until:{popupId}`
- **24시간 계산**: `Date.now() + 24 * 60 * 60 * 1000` (86,400,000ms)
- **공지 게시판 URL**: `/my-coupons` 상단 EVENTS 배너 (별도 라우트 아닌 인라인)
