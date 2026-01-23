# Service Worker 자동 버전 관리 시스템

## 개요

이 시스템은 **배포할 때마다 자동으로 Service Worker 버전을 갱신**하여 사용자에게 항상 최신 버전의 앱을 제공합니다.

더 이상 수동으로 버전을 올릴 필요가 없습니다! 🎉

---

## 작동 원리

### 1. 빌드 전 자동 버전 생성

`pnpm build` 명령을 실행하면 **prebuild 스크립트**가 자동으로 실행됩니다.

```json
{
  "scripts": {
    "prebuild": "node scripts/inject-version.cjs",
    "build": "vite build && esbuild ..."
  }
}
```

### 2. 타임스탬프 기반 버전 생성

`scripts/inject-version.cjs` 스크립트가 **현재 시각을 기반으로 고유한 버전**을 생성합니다.

**버전 형식:** `vYYYYMMDD-HHMMSS`

**예시:**
- `v20241219-015611` (2024년 12월 19일 01시 56분 11초)
- `v20241220-143022` (2024년 12월 20일 14시 30분 22초)

### 3. 자동 버전 주입

생성된 버전이 **두 곳에 자동으로 주입**됩니다:

#### (1) Service Worker (`client/public/sw.js`)

```javascript
// 자동으로 업데이트됨
const CACHE_VERSION = 'v20241219-015611';
```

#### (2) 메인 HTML (`client/index.html`)

```javascript
// 자동으로 업데이트됨
const CURRENT_SW_VERSION = 'v20241219-015611';
```

### 4. 캐시 자동 갱신

빌드된 앱을 배포하면:

1. 사용자가 앱을 열 때 `index.html`의 `CURRENT_SW_VERSION`과 `localStorage`에 저장된 버전을 비교
2. 버전이 다르면 **모든 Service Worker 제거 및 캐시 삭제**
3. 새로운 Service Worker 등록 및 **최신 버전 캐시**
4. 페이지 자동 새로고침 (한 번만)

---

## 사용 방법

### 개발 중

```bash
pnpm dev
```

개발 서버를 실행합니다. 버전 주입은 **빌드 시에만** 실행됩니다.

### 배포 전 빌드

```bash
pnpm build
```

1. **prebuild 스크립트 자동 실행** → 타임스탬프 기반 버전 생성 및 주입
2. **vite build** → 프론트엔드 빌드
3. **esbuild** → 백엔드 빌드

**콘솔 출력 예시:**

```
> local_recommendation_engine@1.0.0 prebuild /home/ubuntu/local_recommendation_engine
> node scripts/inject-version.cjs

[inject-version] 생성된 버전: v20241219-015611
[inject-version] Service Worker 버전 주입 완료: /home/ubuntu/local_recommendation_engine/client/public/sw.js
[inject-version] index.html 버전 주입 완료: /home/ubuntu/local_recommendation_engine/client/index.html
[inject-version] 버전 주입 완료: v20241219-015611

> local_recommendation_engine@1.0.0 build /home/ubuntu/local_recommendation_engine
> vite build && esbuild ...
```

### 배포

빌드 완료 후 체크포인트를 저장하고 **Publish 버튼**을 클릭하면 자동으로 배포됩니다.

---

## 장점

### ✅ 수동 작업 제거

- 더 이상 `v1`, `v2`, `v3`... 수동으로 버전을 올릴 필요 없음
- `index.html`과 `sw.js`의 버전을 일일이 동기화할 필요 없음

### ✅ 배포할 때마다 자동 갱신

- 빌드할 때마다 **고유한 타임스탬프 버전** 생성
- 사용자가 앱을 열면 **자동으로 최신 버전 감지 및 캐시 갱신**

### ✅ 캐시 문제 완전 해결

- "예상치 못한 즐거운 일" 같은 이전 캐시가 남아있는 문제 완전 해결
- 항상 최신 버전의 앱이 사용자에게 제공됨

### ✅ 실수 방지

- 수동으로 버전을 올리다가 실수로 동기화를 놓치는 문제 방지
- 빌드 프로세스에 통합되어 **자동으로 실행**

---

## 파일 구조

```
local_recommendation_engine/
├── scripts/
│   └── inject-version.cjs         # 자동 버전 주입 스크립트
├── client/
│   ├── index.html                 # CURRENT_SW_VERSION 자동 주입
│   └── public/
│       └── sw.js                  # CACHE_VERSION 자동 주입
└── package.json                   # prebuild 스크립트 등록
```

---

## 주의사항

### ⚠️ 수동으로 버전을 수정하지 마세요

`sw.js`와 `index.html`의 버전은 **빌드 시 자동으로 생성**됩니다.

수동으로 수정하면 다음 빌드 시 **자동으로 덮어씌워집니다**.

### ⚠️ 개발 중에는 버전이 변경되지 않습니다

`pnpm dev` 명령은 **prebuild 스크립트를 실행하지 않습니다**.

버전 갱신은 **`pnpm build` 시에만** 실행됩니다.

---

## 문제 해결

### Q1. 빌드 시 버전이 주입되지 않아요

**확인 사항:**
1. `scripts/inject-version.cjs` 파일이 존재하는지 확인
2. `package.json`에 `prebuild` 스크립트가 등록되어 있는지 확인
3. `pnpm build` 명령 실행 시 콘솔에 `[inject-version]` 로그가 출력되는지 확인

### Q2. 사용자에게 여전히 이전 버전이 표시돼요

**해결 방법:**
1. 체크포인트를 저장하고 **Publish 버튼**을 클릭하여 배포
2. 사용자가 앱을 열면 자동으로 버전 체크 및 캐시 갱신
3. 만약 여전히 이전 버전이 표시되면 **브라우저 캐시 완전 삭제** (설정 → 인터넷 사용 기록 삭제)

### Q3. 버전 형식을 변경하고 싶어요

`scripts/inject-version.cjs` 파일에서 버전 생성 로직을 수정하세요:

```javascript
// 현재 형식: vYYYYMMDD-HHMMSS
const version = `v${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}-${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}${String(now.getSeconds()).padStart(2, '0')}`;

// 예시: vYYYYMMDD 형식으로 변경
const version = `v${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`;
```

---

## 결론

이제 **배포할 때마다 자동으로 Service Worker 버전이 갱신**됩니다! 🎉

더 이상 수동으로 버전을 올리거나 캐시 문제를 걱정할 필요가 없습니다.

**빌드 → 배포 → 자동 캐시 갱신** 프로세스가 완전히 자동화되었습니다.
