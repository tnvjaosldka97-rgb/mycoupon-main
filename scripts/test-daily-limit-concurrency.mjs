/**
 * BUG-1 동시성 검증 스크립트
 * dailyLimit 설정 쿠폰에서 SELECT FOR UPDATE 원자 체크가 실제로 초과 발급을 막는지 확인
 *
 * 사전 조건:
 *   docker run -d --name pg-test -e POSTGRES_PASSWORD=test -p 5433:5432 postgres:16
 *
 * 실행:
 *   DATABASE_URL=postgres://postgres:test@localhost:5433/postgres node scripts/test-daily-limit-concurrency.mjs
 */

import pg from 'pg';
const { Pool } = pg;

const DATABASE_URL = process.env.DATABASE_URL || 'postgres://postgres:test@localhost:5433/postgres';
const DAILY_LIMIT = 5;
const CONCURRENT_REQUESTS = 10;  // dailyLimit의 2배

const pool = new Pool({ connectionString: DATABASE_URL, max: 20 });

// ─── Schema bootstrap ───────────────────────────────────────────────────────

async function setup() {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS test_coupons (
        id SERIAL PRIMARY KEY,
        remaining_quantity INTEGER NOT NULL DEFAULT 100,
        daily_limit INTEGER,
        daily_used_count INTEGER NOT NULL DEFAULT 0,
        is_active BOOLEAN NOT NULL DEFAULT TRUE
      )
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS test_user_coupons (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL,
        coupon_id INTEGER NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    // 매 실행마다 초기화
    await client.query(`DELETE FROM test_user_coupons`);
    await client.query(`DELETE FROM test_coupons`);
    await client.query(`
      INSERT INTO test_coupons (remaining_quantity, daily_limit, daily_used_count)
      VALUES ($1, $2, 0)
    `, [100, DAILY_LIMIT]);
    console.log(`✅ Setup: coupon created (dailyLimit=${DAILY_LIMIT}, remainingQty=100)`);
  } finally {
    client.release();
  }
}

// ─── 수정 전 시뮬레이션: 체크와 증가가 트랜잭션 밖에서 분리된 경우 ──────────

async function downloadCoupon_BUGGY(userId, couponId) {
  const client = await pool.connect();
  try {
    // pre-check (트랜잭션 밖 — stale read)
    const precheck = await client.query(
      `SELECT daily_used_count, daily_limit FROM test_coupons WHERE id = $1`, [couponId]
    );
    const row = precheck.rows[0];
    if (row.daily_used_count >= row.daily_limit) {
      return { ok: false, reason: 'daily_limit_exceeded_precheck' };
    }

    // 트랜잭션: remainingQuantity만 처리 (dailyUsedCount 증가는 트랜잭션 밖)
    await client.query('BEGIN');
    const locked = await client.query(
      `SELECT remaining_quantity FROM test_coupons WHERE id = $1 FOR UPDATE`, [couponId]
    );
    if (locked.rows[0].remaining_quantity <= 0) {
      await client.query('ROLLBACK');
      return { ok: false, reason: 'out_of_stock' };
    }
    await client.query(
      `INSERT INTO test_user_coupons (user_id, coupon_id) VALUES ($1, $2)`, [userId, couponId]
    );
    await client.query(
      `UPDATE test_coupons SET remaining_quantity = remaining_quantity - 1 WHERE id = $1`, [couponId]
    );
    await client.query('COMMIT');

    // ★ 버그: 트랜잭션 밖에서 daily_used_count 증가 (race condition 발생 지점)
    await client.query(
      `UPDATE test_coupons SET daily_used_count = daily_used_count + 1 WHERE id = $1`, [couponId]
    );

    return { ok: true };
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    return { ok: false, reason: e.message };
  } finally {
    client.release();
  }
}

// ─── 수정 후: SELECT FOR UPDATE 내부에서 원자적 체크+증가 ────────────────────

async function downloadCoupon_FIXED(userId, couponId) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // SELECT FOR UPDATE: 락 획득
    const locked = await client.query(
      `SELECT remaining_quantity, daily_limit, daily_used_count
       FROM test_coupons WHERE id = $1 FOR UPDATE`, [couponId]
    );
    const coupon = locked.rows[0];

    if (coupon.remaining_quantity <= 0) {
      await client.query('ROLLBACK');
      return { ok: false, reason: 'out_of_stock' };
    }

    // ★ 수정: SELECT FOR UPDATE 락 내부에서 dailyLimit 체크 (원자적)
    if (coupon.daily_limit !== null && coupon.daily_used_count >= coupon.daily_limit) {
      await client.query('ROLLBACK');
      return { ok: false, reason: 'daily_limit_exceeded' };
    }

    await client.query(
      `INSERT INTO test_user_coupons (user_id, coupon_id) VALUES ($1, $2)`, [userId, couponId]
    );

    // ★ 수정: 동일 트랜잭션 내에서 daily_used_count 원자 증가
    await client.query(
      `UPDATE test_coupons
       SET remaining_quantity = remaining_quantity - 1,
           daily_used_count = daily_used_count + 1
       WHERE id = $1`, [couponId]
    );

    await client.query('COMMIT');
    return { ok: true };
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    return { ok: false, reason: e.message };
  } finally {
    client.release();
  }
}

// ─── 동시 요청 실행기 ────────────────────────────────────────────────────────

async function runConcurrent(label, downloadFn, couponId) {
  // DB 초기화
  await pool.query(`UPDATE test_coupons SET daily_used_count = 0, remaining_quantity = 100`);
  await pool.query(`DELETE FROM test_user_coupons`);

  const promises = Array.from({ length: CONCURRENT_REQUESTS }, (_, i) =>
    downloadFn(i + 1, couponId)
  );

  const start = Date.now();
  const results = await Promise.allSettled(promises);
  const elapsed = Date.now() - start;

  const succeeded = results.filter(r => r.status === 'fulfilled' && r.value.ok).length;
  const failReasons = results
    .filter(r => r.status === 'fulfilled' && !r.value.ok)
    .map(r => r.value.reason);
  const errors = results.filter(r => r.status === 'rejected');

  // DB 최종 상태 확인
  const dbState = await pool.query(`SELECT daily_used_count, remaining_quantity FROM test_coupons WHERE id = $1`, [couponId]);
  const dbDailyUsed = dbState.rows[0].daily_used_count;

  const issuedInDb = await pool.query(`SELECT COUNT(*) FROM test_user_coupons WHERE coupon_id = $1`, [couponId]);
  const issuedCount = parseInt(issuedInDb.rows[0].count);

  const overIssued = issuedCount > DAILY_LIMIT;

  console.log(`\n${'═'.repeat(60)}`);
  console.log(`[${label}]`);
  console.log(`  동시 요청: ${CONCURRENT_REQUESTS}개 | dailyLimit: ${DAILY_LIMIT}`);
  console.log(`  성공 응답: ${succeeded}개`);
  console.log(`  실패 사유: ${[...new Set(failReasons)].join(', ') || '없음'}`);
  console.log(`  DB 발급 레코드: ${issuedCount}개`);
  console.log(`  DB daily_used_count: ${dbDailyUsed}`);
  console.log(`  경과: ${elapsed}ms`);
  if (errors.length > 0) {
    console.log(`  ⚠️  rejected promises: ${errors.length}개`);
    errors.forEach(e => console.log(`    - ${e.reason}`));
  }

  if (overIssued) {
    console.log(`  ❌ 초과 발급 발생! (${issuedCount} > ${DAILY_LIMIT}) — BUG 재현됨`);
  } else {
    console.log(`  ✅ 초과 발급 없음 (${issuedCount} <= ${DAILY_LIMIT}) — 정상`);
  }

  return { label, succeeded, issuedCount, dbDailyUsed, overIssued, elapsed };
}

// ─── main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log('BUG-1 dailyLimit 동시성 검증 시작');
  console.log(`DATABASE_URL: ${DATABASE_URL.replace(/:\/\/.*@/, '://<hidden>@')}`);

  // 연결 테스트
  try {
    await pool.query('SELECT 1');
    console.log('✅ DB 연결 성공\n');
  } catch (e) {
    console.error('❌ DB 연결 실패:', e.message);
    console.error('   실행 방법: docker run -d --name pg-test -e POSTGRES_PASSWORD=test -p 5433:5432 postgres:16');
    process.exit(1);
  }

  await setup();

  // couponId 획득
  const couponRow = await pool.query(`SELECT id FROM test_coupons LIMIT 1`);
  const couponId = couponRow.rows[0].id;

  const buggyResult = await runConcurrent('수정 전 (BUGGY)', downloadCoupon_BUGGY, couponId);
  const fixedResult = await runConcurrent('수정 후 (FIXED)', downloadCoupon_FIXED, couponId);

  console.log(`\n${'═'.repeat(60)}`);
  console.log('최종 판정');
  console.log(`  수정 전 초과 발급: ${buggyResult.overIssued ? `❌ YES (${buggyResult.issuedCount}건 / limit ${DAILY_LIMIT})` : '✅ NO (미재현)'}`);
  console.log(`  수정 후 초과 발급: ${fixedResult.overIssued ? `❌ YES (${fixedResult.issuedCount}건 / limit ${DAILY_LIMIT})` : '✅ NO (차단됨)'}`);

  if (!buggyResult.overIssued) {
    console.log('\n  ⚠️  수정 전에도 초과 발급이 재현되지 않았습니다.');
    console.log('      원인: 로컬 동시성이 낮아 race window가 발생하지 않을 수 있음.');
    console.log('      더 높은 동시성(CONCURRENT_REQUESTS=50+) 또는 지연 삽입으로 재실험 권장.');
  }

  await pool.end();
}

main().catch(e => { console.error(e); process.exit(1); });
