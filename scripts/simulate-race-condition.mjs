/**
 * BUG-1 경쟁 조건 재현 시뮬레이션
 *
 * 실 PostgreSQL 없이 JavaScript async 동시성을 이용해
 * SELECT FOR UPDATE 유무에 따른 race condition 차이를 증명합니다.
 *
 * 핵심 원리:
 *   - 버그: read → check → [async gap] → write  (gap에서 다른 요청이 끼어들 수 있음)
 *   - 수정: lock → read → check → write → unlock (lock 동안 다른 요청은 대기)
 *
 * 실행:
 *   node scripts/simulate-race-condition.mjs
 */

// ─── 공유 DB 상태 시뮬레이션 ─────────────────────────────────────────────────
const db = {
  daily_used_count: 0,
  daily_limit: 5,
  remaining_quantity: 100,
  issued_records: [],
};

function resetDb() {
  db.daily_used_count = 0;
  db.remaining_quantity = 100;
  db.issued_records = [];
}

// async delay: PostgreSQL I/O 왕복 지연 시뮬레이션 (0~3ms)
const ioDelay = () => new Promise(r => setTimeout(r, Math.random() * 3));

// ─── SELECT FOR UPDATE 시뮬레이션용 Mutex ───────────────────────────────────
class RowLock {
  #queue = [];
  #locked = false;

  async acquire() {
    if (!this.#locked) {
      this.#locked = true;
      return;
    }
    // 이미 잠긴 경우 대기
    await new Promise(resolve => this.#queue.push(resolve));
  }

  release() {
    if (this.#queue.length > 0) {
      const next = this.#queue.shift();
      next();
    } else {
      this.#locked = false;
    }
  }
}

const couponRowLock = new RowLock();

// ─── 버그 버전: 체크와 증가가 트랜잭션 밖에서 분리 ──────────────────────────
async function downloadCoupon_BUGGY(userId) {
  // 1. pre-check (트랜잭션 밖 — stale read 허용)
  await ioDelay(); // DB 조회 지연
  const snapshot_count = db.daily_used_count;
  const snapshot_limit = db.daily_limit;

  if (snapshot_count >= snapshot_limit) {
    return { ok: false, reason: 'daily_limit_precheck' };
  }

  // ★ Race Window: 체크 통과 후 증가 전에 다른 요청이 끼어들 수 있음
  await ioDelay(); // 트랜잭션 처리 시간

  // 2. 트랜잭션 내부 (remainingQuantity만 처리)
  if (db.remaining_quantity <= 0) {
    return { ok: false, reason: 'out_of_stock' };
  }
  db.remaining_quantity--;
  db.issued_records.push(userId);

  // 3. ★ 트랜잭션 밖에서 daily_used_count 증가 (원자성 없음)
  await ioDelay(); // 별도 UPDATE 지연
  db.daily_used_count++;

  return { ok: true };
}

// ─── 수정 버전: SELECT FOR UPDATE 내부에서 원자적 체크+증가 ─────────────────
async function downloadCoupon_FIXED(userId) {
  // SELECT FOR UPDATE 획득
  await couponRowLock.acquire();
  try {
    await ioDelay(); // lock된 상태에서 DB 읽기

    // lock 내부에서 체크 — 이 시점의 값은 다른 트랜잭션이 변경 불가
    if (db.daily_used_count >= db.daily_limit) {
      return { ok: false, reason: 'daily_limit_in_lock' };
    }

    if (db.remaining_quantity <= 0) {
      return { ok: false, reason: 'out_of_stock' };
    }

    // lock 내부에서 원자 증가
    db.daily_used_count++;
    db.remaining_quantity--;
    db.issued_records.push(userId);

    await ioDelay(); // commit 지연

    return { ok: true };
  } finally {
    couponRowLock.release();
  }
}

// ─── 동시 실행 테스트 ────────────────────────────────────────────────────────
async function runTest(label, downloadFn, concurrency) {
  resetDb();
  couponRowLock['#queue'] = []; // reset lock state

  const results = await Promise.all(
    Array.from({ length: concurrency }, (_, i) => downloadFn(i + 1))
  );

  const succeeded = results.filter(r => r.ok).length;
  const overIssued = db.issued_records.length > db.daily_limit;

  console.log(`\n${'═'.repeat(55)}`);
  console.log(`[${label}]`);
  console.log(`  동시 요청: ${concurrency}개 | dailyLimit: ${db.daily_limit}`);
  console.log(`  성공 응답: ${succeeded}개`);
  console.log(`  DB 발급 레코드: ${db.issued_records.length}개`);
  console.log(`  DB daily_used_count: ${db.daily_used_count}`);

  const failReasons = [...new Set(results.filter(r => !r.ok).map(r => r.reason))];
  console.log(`  실패 사유: ${failReasons.join(', ') || '없음'}`);

  if (overIssued) {
    console.log(`  ❌ 초과 발급 발생! (${db.issued_records.length}건 > dailyLimit ${db.daily_limit})`);
    console.log(`     → race condition 재현됨`);
  } else {
    console.log(`  ✅ 초과 발급 없음 (${db.issued_records.length}건 <= dailyLimit ${db.daily_limit})`);
  }

  return { label, succeeded, issued: db.issued_records.length, overIssued };
}

// ─── main ─────────────────────────────────────────────────────────────────────
async function main() {
  console.log('BUG-1 경쟁 조건 시뮬레이션 (PostgreSQL SELECT FOR UPDATE 원리 증명)');
  console.log('주의: 실 DB 없이 JavaScript async로 동시성 패턴을 시뮬레이션함');

  // 같은 테스트를 5번 반복해 확률적 race 재현 가능성 높임
  const RUNS = 5;
  const CONCURRENCY = 10; // dailyLimit(5)의 2배

  let buggy_triggered = 0;
  let fixed_triggered = 0;

  for (let i = 0; i < RUNS; i++) {
    const buggy = await runTest(`수정 전 (BUGGY) run ${i + 1}`, downloadCoupon_BUGGY, CONCURRENCY);
    if (buggy.overIssued) buggy_triggered++;
  }

  for (let i = 0; i < RUNS; i++) {
    const fixed = await runTest(`수정 후 (FIXED) run ${i + 1}`, downloadCoupon_FIXED, CONCURRENCY);
    if (fixed.overIssued) fixed_triggered++;
  }

  console.log(`\n${'═'.repeat(55)}`);
  console.log('종합 결과');
  console.log(`  수정 전: ${RUNS}회 중 ${buggy_triggered}회 초과 발급 발생 ${buggy_triggered > 0 ? '❌' : '⚠️ (미재현)'}`);
  console.log(`  수정 후: ${RUNS}회 중 ${fixed_triggered}회 초과 발급 발생 ${fixed_triggered === 0 ? '✅ (차단됨)' : '❌'}`);

  console.log('\n[검증 등급]');
  console.log('  (B) JavaScript async 시뮬레이션 — PostgreSQL I/O 지연과 동시성 패턴을 모방');
  console.log('  (C) 실 PostgreSQL SELECT FOR UPDATE 동작은 로컬/스테이징 DB 연결 시 확인 필요');
  console.log('      → scripts/test-daily-limit-concurrency.mjs (Docker PostgreSQL 준비 시 실행)');
}

main().catch(e => { console.error(e); process.exit(1); });
