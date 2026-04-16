# 2026-04-16 공지 팝업 dismiss 버그 수정

## 1. Root Cause Summary

| Bug | Root Cause | 파일:라인 |
|-----|-----------|----------|
| 자동 팝업 미노출 | `setActiveEventPopup` 호출이 의도적으로 제거됨 ("자동 오픈 제거" 주석) | `App.tsx:747` |
| X 닫기 = 24시간 닫기 | `handleClose()`가 `event_popup_seen_${id}`를 localStorage에 영구 저장 | `EventPopupModal.tsx:61` |
| 다른 계정도 dismiss 공유 | localStorage key에 user id 미포함 (`event_popup_seen_${id}`) | `App.tsx:746`, `EventPopupModal.tsx:61` |

## 2. Issue 1 원인 상세

### Bug A: 자동 팝업 노출 불가

```typescript
// App.tsx:747 (수정 전)
// 자동 오픈 제거: setActiveEventPopup 호출 안 함
// 미열람 팝업은 pendingPopup에만 보관 → 사용자 클릭으로만 열림
setPendingPopup(unseen ?? null);
```

`pendingPopup`에만 저장하고 `setActiveEventPopup`을 호출하지 않음 → Dialog는 `activeEventPopup`이 있어야 열리므로 자동 노출 불가. 확성기 클릭 시에만 `setActiveEventPopup(pendingPopup)` 실행.

### Bug B: X 닫기가 영구 저장됨

```typescript
// EventPopupModal.tsx:60-67 (수정 전)
const handleClose = () => {
  localStorage.setItem(`event_popup_seen_${displayPopup.id}`, '1'); // ← 영구 저장
  onClose();
};
```

`event_popup_seen_${id}` = '1'이 localStorage에 저장되면, App.tsx의 auto-show 로직이 해당 팝업을 영원히 skip:

```typescript
// App.tsx:746 (수정 전)
const unseen = popups.find(p => !localStorage.getItem(`event_popup_seen_${p.id}`));
```

### Bug C: 유저 스코프 없음

localStorage key: `event_popup_seen_${popupId}` — user id 미포함.
→ A 계정이 X 닫기 → B 계정 로그인 → 같은 브라우저에서 B도 해당 팝업 미노출.

## 3. Issue 1 수정 파일 목록

| 파일 | 변경 내용 |
|------|----------|
| `client/src/components/EventPopupModal.tsx` | X 닫기에서 localStorage 저장 제거, 24h 키를 user+popup 스코프로 변경, userId prop 추가 |
| `client/src/App.tsx` | 자동 팝업 노출 복구 (`setActiveEventPopup` 호출), 24h 체크를 user 스코프로 변경, 레거시 키 cleanup |
| `client/src/lib/authRecovery.ts` | 정리 대상 키를 `event_popup_seen_*` → `event_popup_hide24h_*`로 변경 |
| `client/src/pages/AdminDashboard.tsx` | 테스트 버튼의 localStorage 키를 신규 키 패턴으로 변경 |

## 4. Issue 1 수정 전/후 동작

### X 닫기 (handleClose)

| | 수정 전 | 수정 후 |
|---|---------|---------|
| localStorage 저장 | `event_popup_seen_${id}` = '1' (영구) | **저장 없음** |
| 새로고침 후 | 팝업 안 뜸 (영구 suppress) | **팝업 다시 뜸** |
| 새 창/새 세션 | 팝업 안 뜸 (localStorage 공유) | **팝업 다시 뜸** |
| 다른 계정 로그인 | 팝업 안 뜸 (user 미구분) | **팝업 뜸** |

### 24시간 닫기 (handleHide24h)

| | 수정 전 | 수정 후 |
|---|---------|---------|
| localStorage key | `event_popup_hide24h_${id}` + `event_popup_seen_${id}` | `event_popup_hide24h_${uid}_${id}` (하나만) |
| 유저 스코프 | 없음 (전역) | **user id 기준** |
| 다른 계정 영향 | 공유됨 | **독립** |
| 24시간 후 | `hide24h` 만료되도 `seen` 키가 남아 영구 차단 | **정상 만료 → 팝업 재노출** |

### 자동 팝업 노출

| | 수정 전 | 수정 후 |
|---|---------|---------|
| 최초 진입 | 확성기만 표시 (자동 오픈 제거됨) | **Dialog 자동 오픈** |
| 24h suppress 중 | 확성기도 안 보임 | 확성기도 안 보임 (정상) |
| X 닫기 직후 | 확성기 사라짐 | **확성기 다시 표시** (수동 재오픈 가능) |

## 5. Issue 1에서 유지한 기존 규칙 목록

| 규칙 | 유지 여부 | 근거 |
|------|----------|------|
| 팝업 노출 대상 판정 (target: ALL/MERCHANT 등) | ✅ 유지 | 서버 `popup.getActive` 로직 미변경 |
| isActive / startsAt / endsAt 날짜 범위 | ✅ 유지 | 서버 로직 미변경 |
| dismissible 속성 | ✅ 유지 | 컴포넌트 로직 동일 |
| 확성기 표시 조건 (`pendingPopup && !activeEventPopup`) | ✅ 유지 | 조건문 미변경 |
| 다중 팝업 순서 보장 (popup-recheck event) | ✅ 유지 | handleClose에서 동일하게 dispatch |
| DB 스키마 (event_popups 테이블) | ✅ 유지 | 변경 없음 |
| API 계약 (popup.getActive) | ✅ 유지 | 변경 없음 |
| 모바일 크롬 웹 skip (`!isMobileChromeWeb()`) | ✅ 유지 | 조건문 미변경 |

## 6. Issue 2 원인

**이미 수정되어 있음.** `AdminDashboard.tsx:1789`:

```tsx
{selectedPlanUser.name} ({selectedPlanUser.email}) – 계급 편집
```

상단 패널에 이름 + 이메일이 이미 표시 중. 이전 커밋(227f995)에서 반영됨.

## 7. Issue 2 수정 파일 목록

없음 (이미 반영됨).

## 8. Issue 2 수정 전/후 UI

| 위치 | 현재 (이미 반영) |
|------|-----------------|
| 상단 편집 패널 | `이준혁 (sakuradaezun7229@gmail.com) – 계급 편집` |
| 하단 리스트 카드 | `이준혁` + `sakuradaezun7229@gmail.com` (우측) |
| 이메일 없을 때 | `이준혁 (null) – 계급 편집` → fallback 필요 시 별도 이슈 |

## 9. 회귀 테스트 시나리오

### Issue 1 팝업

| # | 시나리오 | 기대 결과 | PASS/FAIL 기준 |
|---|---------|----------|---------------|
| 1 | 로그인 → 활성 팝업 존재 | Dialog 자동 오픈 | 확성기만 뜨면 FAIL |
| 2 | X 닫기 → 새로고침 | 팝업 다시 자동 오픈 | 안 뜨면 FAIL |
| 3 | X 닫기 → 같은 탭에서 계속 | 팝업 안 뜸 + 확성기 표시 | 정상 |
| 4 | 24시간 닫기 → 새로고침 | 팝업 안 뜸 (24h suppress) | 뜨면 FAIL |
| 5 | 24시간 닫기 → 다른 계정 로그인 | 팝업 뜸 (다른 유저) | 안 뜨면 FAIL |
| 6 | A계정 X 닫기 → B계정 로그인 | B에게 팝업 자동 오픈 | 안 뜨면 FAIL |
| 7 | 새 창/시크릿 창 → 로그인 | 팝업 자동 오픈 | 안 뜨면 FAIL |
| 8 | 확성기 클릭 | Dialog 수동 오픈 | 안 열리면 FAIL |
| 9 | 비로그인 상태 → 활성 팝업 | 팝업 자동 오픈 (uid=anon) | 안 뜨면 FAIL |

### Issue 2 계급관리

| # | 시나리오 | 기대 결과 |
|---|---------|----------|
| 1 | 유저 선택 전 | 상단 패널 미표시 |
| 2 | 유저 선택 후 | 이름 + (이메일) 표시 |
| 3 | 검색 후 선택 | 동일하게 이름 + 이메일 |

## 10. git diff --stat

```
 client/src/App.tsx                        | 24 ++++++++++++++++++------
 client/src/components/EventPopupModal.tsx | 25 ++++++++++++++-----------
 client/src/lib/authRecovery.ts            |  4 ++--
 client/src/pages/AdminDashboard.tsx       |  5 +++--
 4 files changed, 37 insertions(+), 21 deletions(-)
```

## 변경 요약

| 변경 | 범위 | DB | API | 라우팅 |
|------|------|----|----|--------|
| X 닫기 localStorage 저장 제거 | 프론트만 | 없음 | 없음 | 없음 |
| 24h 키 user 스코프 추가 | 프론트만 | 없음 | 없음 | 없음 |
| 자동 팝업 노출 복구 | 프론트만 | 없음 | 없음 | 없음 |
| 레거시 키 cleanup | 프론트만 | 없음 | 없음 | 없음 |
| EventPopupModal userId prop | 프론트만 | 없음 | 없음 | 없음 |
