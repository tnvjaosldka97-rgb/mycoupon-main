/**
 * apps/mobile — AppRouter 타입 접근 smoke test
 *
 * 목적: @server-router paths alias를 통해 AppRouter 타입이
 *       접근 가능한지 검증. 런타임 코드 없음. type import만 사용.
 *
 * 향후 React Native 앱 사용 예시:
 *   import { createTRPCReact } from '@trpc/react-query';
 *   import type { AppRouter } from '@server-router';
 *   export const trpc = createTRPCReact<AppRouter>();
 */

// runtime import 금지 — type import만 허용
import type { AppRouter } from '@server-router';

// AppRouter가 object 타입으로 resolve되면 PASS
type _Check = AppRouter extends object ? 'accessible' : 'inaccessible';
const _assert: _Check = 'accessible';

export type { AppRouter };
export {};
