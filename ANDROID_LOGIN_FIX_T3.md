# Android 앱 로그인 크리티컬 패스 수정 — T3 (2026-04-14)

## 0. 이번 수정 요약

**증상**: OAuth 완료 → 앱 복귀 → 로그인 안 됨
**원인**: 3개의 구조적 결함이 동시에 작용
**수정**: 코드 4개 파일, 5개 변경점

---

## 1. 발견된 근본 원인 3건

### 1-1. `browserFinished` 핸들러가 exchange 도중 guard를 리셋 (CRITICAL)

**파일**: `client/src/hooks/useAuth.ts` line 549
**코드**: `_isRefetchingFromOAuth = false; // 강제 리셋 (안전망)`

**문제 시퀀스**:
1. 브리지 → intent:// → Android가 intent 수신 → `appUrlOpen` 발화
2. `handleAppTicket` 시작 → `_isRefetchingFromOAuth = true` → exchange POST 시작
3. Chrome Custom Tabs 닫힘 → `browserFinished` 발화 → **`_isRefetchingFromOAuth = false`**
4. exchange 아직 진행 중인데 guard가 풀림
5. 5초 fallback 타이머 발화 → `_oauthInProgress = false` → `meQuery.data` null → bare `refetchAndStore()` 호출
6. bare refetch는 쿠키 없이 실행 → null 반환
7. redirect useEffect의 `_oauthInProgress` / `_isRefetchingFromOAuth` 가드 둘 다 false → **로그인 페이지로 리다이렉트**

**수정**:
- `browserFinished`에서 `_isRefetchingFromOAuth = false` 제거
- 5초 fallback 타이머에 `_isRefetchingFromOAuth` 체크 추가 (exchange 진행 중이면 skip)

### 1-2. `onNewIntent`에서 `setIntent(intent)` 누락 (CRITICAL)

**파일**: `android/.../MainActivity.kt`

**문제**:
- Android `Activity.onNewIntent(intent)`는 `getIntent()`를 자동 갱신하지 않음
- Capacitor의 `App.getLaunchUrl()`은 `getIntent().getData()`를 호출
- warm start에서 deep link intent가 도착해도 `getIntent()`는 이전 intent 반환
- `getLaunchUrl()` 경로에서 stale URL 또는 null 반환 → ticket 미처리

**수정**: `super.onNewIntent(intent)` 호출 전에 `setIntent(intent)` 추가

### 1-3. `com.mycoupon.app://` 이중 스킴 잔존

**파일**: `AndroidManifest.xml`, `server/_core/oauth.ts`

**문제**:
- 서버는 항상 `mycoupon://auth?app_ticket=TOKEN` 생성
- 그런데 AndroidManifest에 `com.mycoupon.app://auth` intent-filter가 남아있음
- `sendDeepLinkBridge`에 `com.mycoupon.app://` 분기가 dead code로 남아있음
- Android OS의 intent resolution에서 두 스킴이 경합 가능

**수정**:
- AndroidManifest에서 `com.mycoupon.app://auth` intent-filter 제거
- `sendDeepLinkBridge`에서 `com.mycoupon.app://` 분기 제거
- MainActivity `storeDeepLink`에서는 legacy 인식 유지 (캐시된 브리지 방어)

---

## 2. 변경 파일 목록

| 파일 | 변경 내용 |
|------|-----------|
| `client/src/hooks/useAuth.ts` | browserFinished race fix, 빌드 핑거프린트 T3 |
| `android/.../MainActivity.kt` | `setIntent(intent)` 추가, storeDeepLink 주석 정리 |
| `android/.../AndroidManifest.xml` | `com.mycoupon.app://auth` intent-filter 제거 |
| `server/_core/oauth.ts` | `com.mycoupon.app://` dead branch 제거, 빌드 핑거프린트 T3 |

---

## 3. 최종 단일 계약 (코드 일치 확인됨)

### custom scheme
```
mycoupon://auth?app_ticket=<opaque-token>
```

### intent fallback
```
intent://auth?app_ticket=<opaque-token>#Intent;scheme=mycoupon;package=com.mycoupon.app;S.browser_fallback_url=<encoded>;end
```

### exchange request body
```json
{ "app_ticket": "<opaque-token>" }
```

### AndroidManifest intent-filter (유효)
- `mycoupon://auth` (custom scheme)
- `https://my-coupon-bridge.com` (App Links, autoVerify)

### AndroidManifest intent-filter (제거됨)
- ~~`com.mycoupon.app://auth`~~

---

## 4. 수정 후 타이밍 시퀀스 (정상 경로)

```
[1] login() → _oauthInProgress=true → Browser.open(Custom Tabs)
[2] Google OAuth → server callback → insertAppTicket → sendDeepLinkBridge
[3] Bridge: intent://auth?app_ticket=TOKEN#Intent;scheme=mycoupon;...
[4] Android: onNewIntent → setIntent(intent) → storeDeepLink → super.onNewIntent
[5] appUrlOpen fires → consumeFromRaw → extractAppTicket → handleAppTicket
    ├─ _isRefetchingFromOAuth = true
    ├─ POST /api/oauth/app-exchange { app_ticket }
    ├─ Set-Cookie issued (sameSite:none, secure:true)
    ├─ 300ms delay → meQuery.refetch()
    ├─ retry 1x if null → meQuery.refetch()
    └─ success → localStorage + gate release
[6] browserFinished fires (Custom Tabs 닫힘)
    ├─ _isRefetchingFromOAuth NOT reset (T3 fix)
    ├─ 5s fallback timer starts
    └─ 5s 후: _isRefetchingFromOAuth=true → fallback skip
[7] handleAppTicket finally → _isRefetchingFromOAuth=false, _oauthInProgress=false
[8] 사용자 로그인 완료 상태
```

---

## 5. 빌드 산출물

- **빌드 태그**: `20260414-T3`
- **APK**: `android/app/build/outputs/apk/release/app-release.apk`
- **주요 수정**: browserFinished race + setIntent + single scheme

---

## 6. 실기기 테스트 체크리스트 (사용자용)

- [ ] APK 설치 후 앱 실행
- [ ] `[APP-BUILD-1] build=20260414-T3` 로그 확인 (chrome://inspect)
- [ ] 로그인 버튼 클릭 → Chrome Custom Tabs 열림
- [ ] Google 계정 선택 → 브리지 페이지 표시 → 앱 복귀
- [ ] 홈 화면에 로그인 상태 표시 확인
- [ ] 앱 종료 후 재실행 → 로그인 유지 확인
