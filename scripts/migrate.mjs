/**
 * 스키마 적용
 *
 *   POSTGRES_URL="..." node scripts/migrate.mjs
 *
 * db/schema.sql 은 모두 IF NOT EXISTS 이므로 여러 번 실행해도 안전합니다.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import pg from 'pg';

const here = dirname(fileURLToPath(import.meta.url));
const sql = readFileSync(join(here, '..', 'db', 'schema.sql'), 'utf8');

const connectionString =
  process.env.POSTGRES_URL || process.env.DATABASE_URL;

if (!connectionString) {
  console.error('POSTGRES_URL 또는 DATABASE_URL 환경변수를 설정하십시오.');
  process.exit(1);
}

const client = new pg.Client({
  connectionString,
  ssl: { rejectUnauthorized: false },
});

await client.connect();
try {
  await client.query(sql);
  const { rows } = await client.query(
    `SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public' ORDER BY table_name`
  );
  console.log('스키마 적용 완료');
  rows.forEach((r) => console.log(`  - ${r.table_name}`));
} finally {
  await client.end();
}
