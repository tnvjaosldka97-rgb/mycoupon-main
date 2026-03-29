/**
 * @mycoupon/api — 타입 전용 터널
 *
 * 목적: apps/mobile 등 외부 앱이 AppRouter 타입을 참조할 수 있도록 하는 통로.
 *       런타임 코드 없음. 서버 로직 미포함.
 *
 * 주의:
 *   - runtime import 금지. 타입 import만 허용.
 *   - server/routers.ts 파일 자체는 수정되지 않았음.
 *   - 이 파일은 타입 시스템에서만 사용됨 (noEmit 환경 기준).
 */
export type { AppRouter } from "../../server/routers";
