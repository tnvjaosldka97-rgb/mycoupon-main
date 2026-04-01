# DEPRECATED — React Native 경로 폐기

이 디렉토리(`apps/mobile`)는 **개발 대상이 아닙니다.**

## 결정 이유
- React Native 빌드가 안정적으로 동작하지 않음 (metro, auth, expo 오류 다수)
- Capacitor Android 래퍼(`android/`)가 이미 프로덕션 수준으로 동작 중
- 두 모바일 전략 병행은 유지보수 비용만 증가시킴

## 유일한 모바일 제품
```
android/   ← Capacitor 6 + WebView (com.mycoupon.app)
```

## 빌드 커맨드
```bash
pnpm cap:build    # vite build + cap sync android
pnpm cap:open     # Android Studio 열기
```

이 디렉토리는 삭제하지 않고 보존 중 (히스토리 참조용).
새 기능 개발 금지. PR 머지 금지.
