/**
 * Postgres 연결
 *
 * 서버리스 함수는 인스턴스가 재사용되므로 풀을 모듈 스코프에 두어
 * 같은 인스턴스로 들어온 요청이 연결을 나눠 쓰게 합니다.
 *
 * 연결 문자열은 Vercel Postgres 의 POSTGRES_URL 또는 Neon 의 DATABASE_URL 중
 * 존재하는 값을 사용합니다. 연결 수 고갈을 피하려면 풀링된(-pooler) 문자열을
 * 쓰십시오.
 */
import pg from 'pg';

const connectionString =
  process.env.POSTGRES_URL ||
  process.env.DATABASE_URL ||
  process.env.POSTGRES_PRISMA_URL;

if (!connectionString) {
  throw new Error(
    'DB 연결 문자열이 없습니다. POSTGRES_URL 또는 DATABASE_URL 환경변수를 설정하십시오.'
  );
}

/* DATE 컬럼을 Date 객체가 아닌 'YYYY-MM-DD' 문자열로 받습니다.
   화면과 판정 로직이 전부 문자열 날짜를 전제로 하고 있어, 여기서 변환하면
   시간대 차이로 하루가 밀리는 문제가 생깁니다. */
pg.types.setTypeParser(1082, (v) => v);

const pool = new pg.Pool({
  connectionString,
  ssl: { rejectUnauthorized: false },
  max: 3,
  idleTimeoutMillis: 10_000,
  connectionTimeoutMillis: 10_000,
});

pool.on('error', (err) => {
  console.error('[db] 유휴 연결 오류', err);
});

export function query(text, params) {
  return pool.query(text, params);
}

/** 단일 행 조회. 없으면 null */
export async function one(text, params) {
  const { rows } = await pool.query(text, params);
  return rows[0] ?? null;
}

/** 여러 문을 한 트랜잭션으로 실행 */
export async function tx(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

export default pool;
