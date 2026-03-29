/**
 * apps/mobile — AppRouter 타입 접근 smoke test
 *
 * 목적:
 *   - @server-router paths alias를 통해 AppRouter 타입이 접근 가능한지 검증
 *   - 런타임 코드 없음. type import만 사용.
 *   - 이 파일은 검증 문서로 유지한다.
 *
 * 검증 기준:
 *   - 이 파일 자체에서 발생하는 에러: 0개
 *   - AppRouter 타입이 object 타입으로 resolve되면 PASS
 *
 * 사용 예시 (향후 React Native 앱):
 *   import { createTRPCReact } from '@trpc/react-query';
 *   import type { AppRouter } from '@server-router';
 *   export const trpc = createTRPCReact<AppRouter>();
 */

import type { AppRouter } from '@server-router';

// AppRouter가 object 타입으로 resolve되는지 검증
// 'accessible'이 할당 가능하면 타입이 유효하게 resolve됨을 의미
type _AppRouterCheck = AppRouter extends object ? 'accessible' : 'inaccessible';
const _check: _AppRouterCheck = 'accessible';

// 외부 소비를 위한 re-export (타입 only)
export type { AppRouter };

// 런타임 진입점 없음 — 이 파일은 타입 검증 전용
export {};
