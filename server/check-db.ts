// server/check-db.ts
import { getDb } from "./db";
import { sql } from "drizzle-orm";

async function check() {
  console.log("🔍 DB 연결 시도 중...");
  const db = await getDb();
  
  if (!db) {
    console.error("❌ DB 연결 실패");
    return;
  }

  // 1. 테이블 목록 조회 (PostgreSQL 전용)
  console.log("\n📋 [테이블 목록 확인]");
  const tables = await db.execute(sql`
    SELECT table_name 
    FROM information_schema.tables 
    WHERE table_schema = 'public'
    ORDER BY table_name;
  `);
  
  const tableNames = tables.rows.map((r: any) => r.table_name);
  console.log("발견된 테이블:", tableNames);

  // 2. 주요 테이블 데이터 개수 확인
  console.log("\n📊 [데이터 개수 확인]");
  for (const tableName of tableNames) {
    try {
      // user_coupons, coupons 등 테이블별 데이터 개수 조회
      const count = await db.execute(sql.raw(`SELECT COUNT(*) as cnt FROM "${tableName}"`));
      console.log(`- ${tableName}: ${count.rows[0].cnt}개`);
    } catch (e) {
      console.log(`- ${tableName}: 조회 불가 (권한 없음 등)`);
    }
  }
}

check().then(() => process.exit(0));
