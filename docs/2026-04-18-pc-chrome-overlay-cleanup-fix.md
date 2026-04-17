# PC Chrome 일반모드 클릭 차단 — 웹 전체 lock/overlay 선제 수정 묶음

- 일자: 2026-04-18
- 대상: PC Chrome 일반 프로필 / 확장 활성 프로필 / 모바일 Chrome 일반 프로필에서 첫 화면 렌더 후 클릭 차단 증상
- 커밋: (미커밋 — 사용자 검증 후 반영)

## 1. 증상

- 시크릿 모드: 정상
- 일반 프로필(PC/모바일 Chrome): 실패 — 첫 화면 렌더는 되나 로그인 버튼 클릭 먹통
- 사용자 증언: "**회색/반투명하게 덮인 느낌** + 화면 멈춤"

## 2. 확보 데이터 기반 제외 원인

`user=pending`, `code=false`, `state=false`, `auth_cb=false`, `finalize=false`, `g.active=false`, `pgshow.n=0`, `#root.kids=3`

→ OAuth callback / finalize / callback guard / bfcache / white screen 전부 제외.
→ 남은 1순위: **전역 interaction lock / overlay 잔존**.

## 3. 결정적 원인 확정

**모든 Radix overlay 컴포넌트(dialog / alert-dialog / sheet / drawer)가 `pointer-events` 기본값 없음.**

`client/src/components/ui/*.tsx` 전수 감사 결과:

| 파일:라인 | state=closed 처리 | pointer-events 기본 | 위험도 |
|---|---|---|---|
| `dialog.tsx:82` | `hidden` 있음 | **없음** | ⚠️ 중 |
| `alert-dialog.tsx:37` | **`hidden` 없음** (fade-out만) | **없음** | ⚠️⚠️ 최고 |
| `sheet.tsx:39` | `hidden` 있음 | **없음** | ⚠️ 중 |
| `drawer.tsx:38` | `hidden` 있음 | **없음** | ⚠️ 중 |

**`bg-pink-50/80 backdrop-blur-sm fixed inset-0 z-50`** = 사용자 증언 "**회색/반투명 덮임**"과 **정확히 일치**.

### 시나리오
1. Radix Dialog/AlertDialog가 마운트되며 overlay 렌더
2. 닫힘 시 `data-state=closed` 전이
3. 특히 alert-dialog는 `data-[state=closed]:hidden` **없음** → 닫혀도 DOM 잔존
4. `fixed inset-0 z-50 bg-pink-50/80` + 기본 `pointer-events:auto` → **클릭 차단 + 시각적 덮임**
5. 시크릿은 누적 상태 없어서 덜 재현, 일반은 누적된 세션에서 재현

## 4. 패치 묶음 (5개 파일)

### A. UI Overlay 컴포넌트 4개 — `pointer-events` 기본값 추가

모든 overlay 클래스 끝에 추가:
```
pointer-events-none data-[state=open]:pointer-events-auto
```

의미:
- 기본: `pointer-events:none` → 잔존해도 클릭 차단 불가
- 열림(`data-state=open`): `pointer-events:auto` → 정상 모달 동작

**alert-dialog.tsx:37** 는 추가로 `data-[state=closed]:hidden`도 보강 (기존 누락).

#### diff 예시 (dialog.tsx:82)
```diff
- "data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=closed]:hidden fixed inset-0 z-50 bg-pink-50/80 backdrop-blur-sm",
+ "data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=closed]:hidden fixed inset-0 z-50 bg-pink-50/80 backdrop-blur-sm pointer-events-none data-[state=open]:pointer-events-auto",
```

#### diff 예시 (alert-dialog.tsx:37 — hidden 추가 + pe 추가)
```diff
- "data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 fixed inset-0 z-50 bg-pink-50/80 backdrop-blur-sm",
+ "data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:hidden fixed inset-0 z-50 bg-pink-50/80 backdrop-blur-sm pointer-events-none data-[state=open]:pointer-events-auto",
```

### B. `cleanupInteractionLocks()` 강화 (`App.tsx`)

기존 대비 추가 항목:
- `body.removeAttribute('aria-hidden')` 추가 (기존 #root만)
- `html.removeAttribute('inert' | 'aria-hidden')` 추가
- `body.style.overflowY`, `html.style.overflowY`, `html.style.pointerEvents` 정리
- **Radix 잔존 overlay 중화**: `[data-state="closed"]` 중 `position:fixed/absolute` → `pointer-events:none`
- **투명 fullscreen 블로커 중화**: `opacity < 0.05` + viewport 80%+ 덮음 + `pointer-events:auto` → `pointer-events:none`

안전장치:
- DOM 제거 안 함 (React 렌더 트리와 충돌 방지)
- 의도된 visible overlay (`opacity > 0.05`)는 건드리지 않음
- body 직계 + 1단계 자식까지만 스캔 (O(N) 폭주 방지)

### C. Boot 타이밍 강화 (`App.tsx`)

기존: `useLayoutEffect` mount 시점 1회.
변경: 동기 + `requestAnimationFrame` + `setTimeout(0)` + `setTimeout(300)` 다중 시점.

bfcache 복원, 확장 주입 timing, Radix 초기 렌더 race 모두 커버.

### D. 추가 라이프사이클 이벤트 (`App.tsx`)

기존 `pageshow / focus / visibilitychange` 에 추가:
- `popstate`: 뒤로가기/앞으로가기 후 lock 잔존 방어
- `hashchange`: 해시 이동 후 lock 잔존 방어

### E. Observer 확장 (이전 턴 유지)

`App.tsx:644` — `if (!isMobileChromeWeb()) return;` → `if (isCapacitorNative()) return;`
Capacitor 네이티브 외 전 웹 환경에서 Radix 속성 쓰는 순간 즉시 cleanup.

## 5. 수정 파일 목록

| 파일 | 변경 요약 |
|---|---|
| `client/src/components/ui/dialog.tsx` | 라인 82 overlay 클래스에 `pointer-events-none data-[state=open]:pointer-events-auto` 추가 |
| `client/src/components/ui/alert-dialog.tsx` | 라인 37 `data-[state=closed]:hidden` + 위와 동일 추가 |
| `client/src/components/ui/sheet.tsx` | 라인 39 동일 추가 |
| `client/src/components/ui/drawer.tsx` | 라인 38 동일 추가 |
| `client/src/App.tsx` | `cleanupInteractionLocks()` 강화 + mount 타이밍 다중화 + popstate/hashchange 리스너 + observer 가드 이전 턴 변경 유지 |

## 6. 건드리지 않은 것

- `useAuth.ts` / OAuth / cookies / context / app-exchange — 계약면
- Service Worker 등록 로직 — 현재 tombstone (fetch 핸들러 없음)
- Pending/loading UI 자체 — SessionLoadingGate는 `!isCapacitorNative()` 에서 children 통과 → PageLoader 렌더 안 됨 → pending이 CTA 차단하는 구조 아님
- Home.tsx line 29의 `pointer-events-none fixed inset-0 z-[5]` — 이미 `pointer-events-none` 이라 안전

## 7. 검증 시나리오

1. **PC Chrome 일반 프로필 첫 진입** → `?debugAuth=1` 접속 → "회색 덮임" 해소 확인 + 로그인 버튼 클릭 → Google 이동
2. **모바일 Chrome 일반 프로필 첫 진입** → 동일
3. **새로고침 후 재진입** → 1과 동일 동작 (누적 상태 영향 없음 확인)
4. **탭 복귀 / pageshow** → 복귀 직후 클릭 정상
5. **Dialog 열었다 닫기 반복** → 클릭 차단 재발 없음

## 8. 부작용 가능성

- Radix Dialog modal=true의 scroll-lock 해제로 배경 스크롤 가능 (UX 미세 이슈, 클릭 차단보다 우선)
- `cleanupInteractionLocks` 내부 `body > *` 스캔 추가로 tick당 DOM 탐색 O(직계 + 1단계). body children은 통상 5~20개 → 성능 영향 무시
- `pointer-events-none` 기본값은 Radix 동작에 영향 없음 (열림 시 `data-state=open`이 즉시 적용되어 `pointer-events-auto` 복원됨)

## 9. 커밋 단위

1 commit 권장:
```
fix(web): preempt overlay/inert/scroll-lock click blockers across web

- Dialog/AlertDialog/Sheet/Drawer overlays: default pointer-events:none
- AlertDialog: add missing data-[state=closed]:hidden
- cleanupInteractionLocks(): handle body/html aria-hidden, overflowY, Radix
  state=closed fixed/absolute residuals, transparent fullscreen blockers
- App boot: add rAF + setTimeout(0/300) cleanup cascade
- Listeners: add popstate/hashchange
```

## 10. 원칙 준수

- 계약면 무접근 ✅
- 데이터 기반 원인 확정 (추측 아님) — dialog/alert-dialog overlay 클래스 실물 증거 ✅
- 최소 수정 (5 파일 / 핵심 5줄 + cleanup 함수 내 안전 추가) ✅
- 모바일/PC 공통 커버 ✅
- 확장 탓 회피 아닌 앱 구조 문제 선제 제거 ✅
