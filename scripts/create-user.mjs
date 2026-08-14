/**
 * 계정 생성 · 비밀번호 재설정
 *
 *   POSTGRES_URL="..." node scripts/create-user.mjs <username> <성명> <권한> [소속유닛]
 *
 * 예)
 *   node scripts/create-user.mjs hhkim 김홍현 admin QA유닛
 *   node scripts/create-user.mjs jylee 이지영 member QA유닛
 *   node scripts/create-user.mjs auditor 감사담당 viewer TA유닛
 *
 * 권한
 *   admin  계정 관리, 배포 건 삭제 표시
 *   member 대장 작성, 월간 점검 수행
 *   viewer 열람 전용 (통제검토부서·감사인 계정)
 *
 * 비밀번호는 임의로 생성해 화면에 한 번만 출력합니다. 본인에게 전달한 뒤
 * 최초 로그인 시 변경하도록 안내하십시오. 이미 있는 계정이면 비밀번호를
 * 재설정하며, 기존 대장 기록은 그대로 유지됩니다.
 */
import { randomBytes, scrypt as _scrypt } from 'node:crypto';
import { promisify } from 'node:util';
import { connect } from './_client.mjs';

const scrypt = promisify(_scrypt);

const [username, name, role = 'member', unit = null] = process.argv.slice(2);

if (!username || !name) {
  console.error('사용법: node scripts/create-user.mjs <username> <성명> [권한] [소속유닛]');
  process.exit(1);
}
if (!['admin', 'member', 'viewer'].includes(role)) {
  console.error(`권한은 admin / member / viewer 중 하나여야 합니다. 입력값: ${role}`);
  process.exit(1);
}

/* 사람이 옮겨 적을 수 있도록 혼동되는 글자(0/O, 1/l/I)를 뺀 문자집합을 씁니다. */
const ALPHABET = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const password = Array.from(randomBytes(16))
  .map((b) => ALPHABET[b % ALPHABET.length])
  .join('');

const salt = randomBytes(16).toString('hex');
const key = await scrypt(password, salt, 64);
const hash = `scrypt$${salt}$${key.toString('hex')}`;

const client = await connect();
try {
  const { rows } = await client.query(
    `INSERT INTO users (username, name, unit, role, password_hash)
          VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (username) DO UPDATE
            SET name = EXCLUDED.name,
                unit = EXCLUDED.unit,
                role = EXCLUDED.role,
                password_hash = EXCLUDED.password_hash,
                active = TRUE
       RETURNING id, username, name, unit, role, (xmax = 0) AS created`,
    [username, name, unit, role, hash]
  );
  const u = rows[0];
  console.log(u.created ? '계정을 생성했습니다.' : '계정을 갱신하고 비밀번호를 재설정했습니다.');
  console.log(`  아이디   ${u.username}`);
  console.log(`  성명     ${u.name}`);
  console.log(`  소속     ${u.unit ?? '-'}`);
  console.log(`  권한     ${u.role}`);
  console.log(`  비밀번호 ${password}`);
  console.log('\n이 비밀번호는 다시 확인할 수 없습니다. 본인에게 전달한 뒤 이 출력은 남기지 마십시오.');
} finally {
  await client.end();
}
