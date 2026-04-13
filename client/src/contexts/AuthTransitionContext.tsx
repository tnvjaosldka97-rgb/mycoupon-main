import { createContext, useContext } from 'react';

// ── Auth Transition Stabilization Context ───────────────────────────────────
// mobile chrome web 전용.
// user identity (null ↔ non-null) 전환 후 ~250ms 동안 true.
// 이 기간 동안 auth-only UI(DropdownMenu 등) 마운트를 지연시켜
// React 렌더와 Android Chrome GPU 컴포지팅 레이어 재건 race를 방지한다.
export const AuthTransitionContext = createContext<boolean>(false);

export function useAuthTransitionStabilizing(): boolean {
  return useContext(AuthTransitionContext);
}
