# packages/

## packages/api — 비활성화됨

packages/api 방식은 소비자 검증에서 실패하여 제거됨.

### 실패 원인
- `export type { AppRouter } from "../../server/routers"` 방식은
  TypeScript가 server 전체 의존성 그래프를 pull-in하여
  server의 pre-existing 타입 에러를 packages/api 컴파일에 전파시킴.
- packages/api는 독립적인 타입 터널로 동작할 수 없었음.

### 대체 방식
apps/mobile/tsconfig.json의 `paths` alias를 사용하여
컴파일 단위 분리 없이 AppRouter 타입을 참조함.

참고 커밋: d0cffbb (packages/api 최초 추가)
