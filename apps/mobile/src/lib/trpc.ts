/**
 * tRPC 클라이언트 — 임시 자리
 *
 * 현재: AppRouter가 any로 선언됨 (typed integration 미완료)
 *
 * TODO: Option B 완료 후 아래로 교체
 *   import type { AppRouter } from '@server-router';
 *   export const trpc = createTRPCReact<AppRouter>();
 *
 * 실제 연동 전까지는 이 파일의 trpc 객체를 직접 사용하지 않는다.
 * 화면은 apps/mobile/src/mock/ 데이터로만 동작한다.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyRouter = any;

// tRPC 연결 자리 — 실제 import는 아직 하지 않음
// import { createTRPCReact } from '@trpc/react-query';
// export const trpc = createTRPCReact<AnyRouter>();

export const API_URL = 'https://my-coupon-bridge.com/api/trpc';
