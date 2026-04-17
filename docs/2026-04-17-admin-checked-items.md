# 2026-04-17 신규 요청 확인 상태 시스템

## 작업 목적

슈퍼어드민이 신규 요청을 **어떤 업장에서 온 건인지 즉시 식별**하고,
확인 후에는 **상단 배지 숫자와 하단 `!` 표시가 정합성 있게 함께 사라지는** 구조를 구현.

## 기존 문제

1. 상단 배지 숫자는 있지만, **개별 카드에서 어떤 건이 신규인지 식별 불가**
2. 서버 기준 "확인" 상태가 없어서 새로고침 시 원래대로 복원
3. 확인/미확인 기준이 없어 배지 숫자가 감소하지 않음 (처리 완료까지 유지)

## 새 상태 구조

### DB 테이블: `admin_checked_items`

```sql
CREATE TABLE IF NOT EXISTS admin_checked_items (
  id          SERIAL PRIMARY KEY,
  item_type   VARCHAR(30) NOT NULL,   -- 'store' | 'coupon' | 'pack_order' | 'plan_user'
  item_id     INTEGER NOT NULL,
  checked_by  INTEGER NOT NULL REFERENCES users(id),
  checked_at  TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX idx_admin_checked_type_id ON admin_checked_items(item_type, item_id);
```

- `(item_type, item_id)` unique → 중복 확인 처리 멱등성 보장
- `ON CONFLICT DO UPDATE` → 재확인 시 timestamp/checker 갱신
- 서버 영구 상태 → 새로고침/재접속/다른 관리자도 동일 상태

### API

| Endpoint | 입력 | 설명 |
|----------|------|------|
| `admin.markChecked` | `{ itemType, itemId }` | 해당 건 확인 완료 처리 |
| `admin.getCheckedIds` | `{ itemType }` | 타입별 확인 완료 ID 목록 반환 |

## 확인 기준 (전 탭 통일)

**"운영자가 해당 건의 처리 UI를 열거나 처리 액션을 수행한 시점"**

| 탭 | 확인 트리거 |
|----|-----------|
| 가게 관리 | 수정 버튼 클릭 / 승인 버튼 클릭 |
| 쿠폰 관리 | 수정 버튼 클릭 / 승인 버튼 클릭 |
| 발주요청 | 카드 클릭 (상세 패널 열기) |
| 계급 관리 | 카드 클릭 (편집 패널 열기) |

통일 원칙: **운영자가 해당 건의 내용을 실제로 확인하는 행위** → confirmed

## 적용 범위 표

| 탭 | 배지 기준 (미확인만) | `!` 표시 위치 | 확인 트리거 |
|----|---------------------|--------------|-----------|
| 가게 관리 | 미승인 AND 미확인 가게 | 가게명 옆 | 수정/승인 클릭 |
| 쿠폰 관리 | 미승인 AND 미확인 쿠폰 | 쿠폰명 옆 | 수정/승인 클릭 |
| 발주요청 | REQUESTED AND 미확인 | 이메일 옆 | 카드 클릭 |
| 계급 관리 | 휴면 AND 미확인 유저 | 이메일 옆 | 카드 클릭 |
| 어뷰저 | PENALIZED (기존 유지, 확인 시스템 미적용) | 없음 | - |

## `!` 표시 스펙

- 크기: `w-7 h-7` (28px) 원형
- 색상: `bg-red-500 text-white`
- 폰트: `text-lg font-black` (느낌표 크게)
- 애니메이션: `animate-pulse` (깜빡임)
- 위치: 이름/메일과 같은 `flex` 라인, `gap-2`로 간격

## 상태 정합성

```
미확인 상태 = 상단 배지 카운트 포함 + 하단 카드 `!` 표시
확인 상태   = 상단 배지 카운트 제외 + 하단 카드 `!` 제거
```

**단일 source of truth**: `admin.getCheckedIds` → `checkedXxxSet`
배지 카운트와 `!` 표시가 동일한 Set으로 필터링.

## 테스트 시나리오

| # | 시나리오 | 기대 결과 |
|---|---------|----------|
| A | 신규 발주 생성 → 발주요청 탭 | 배지 +1, 카드에 `!` |
| B | 카드 클릭(상세 열기) | `!` 제거, 배지 -1 |
| C | 새로고침 | 확인 상태 유지 (DB 기준) |
| D | 신규 3건 중 1건만 확인 | 배지 2, 나머지 2건 `!` 유지 |
| E | 검색 상태에서 확인 | 필터 무관하게 배지/`!` 정합 |
| F | 다른 관리자 접속 | 동일한 확인 상태 반영 |
| G | 가게 승인 클릭 | `!` 제거 + 배지 -1 |
| H | 쿠폰 수정 클릭 | `!` 제거 + 배지 -1 |

## 변경 파일 목록

### 서버
- `server/_core/index.ts` — `admin_checked_items` 테이블 마이그레이션
- `server/routers.ts` — `markChecked`, `getCheckedIds` API 추가

### 프론트
- `client/src/pages/AdminDashboard.tsx` — 쿼리/mutation 추가, 배지 카운트 수정, 카드별 `!` 표시, 확인 트리거

## 롤백 시 영향 범위

1. `admin_checked_items` 테이블 DROP → 확인 상태 소실 (배지가 처리 전 상태로 복원)
2. `markChecked`/`getCheckedIds` API 제거 → 프론트에서 404 발생 (빈 배열 fallback 필요)
3. AdminDashboard의 checked 관련 코드 제거 → 배지가 기존 조건(미승인/REQUESTED)으로만 동작
4. **기존 기능에는 영향 없음** — additive 변경만
