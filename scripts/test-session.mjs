/**
 * 세션 토큰 검증
 *
 *   node scripts/test-session.mjs
 *
 * 세션은 무상태 서명 토큰이라 DB 없이 서명·검증 규칙만 확인할 수 있습니다.
 * lib/auth.js 는 DB 를 가져오므로, 같은 규칙을 여기서 다시 구성해 검사합니다.
 * 규칙이 갈리면 이 검사가 통과하고 실제는 실패할 수 있으니, 토큰 형식을
 * 바꿀 때는 양쪽을 함께 고쳐야 합니다.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';

const SECRET = 'x'.repeat(48);
const MAX_AGE = 60 * 60 * 12;

const sign = (p) => createHmac('sha256', SECRET).update(p).digest('base64url');

function makeToken(userId, epoch, ageOverride) {
  const exp = Math.floor(Date.now() / 1000) + (ageOverride ?? MAX_AGE);
  const payload = `${userId}.${epoch}.${exp}`;
  return `${payload}.${sign(payload)}`;
}

function readToken(token) {
  if (!token) return null;
  const i = token.lastIndexOf('.');
  if (i < 0) return null;
  const payload = token.slice(0, i);
  const mac = token.slice(i + 1);
  const expected = sign(payload);
  if (mac.length !== expected.length || !timingSafeEqual(Buffer.from(mac), Buffer.from(expected))) {
    return null;
  }
  const [userId, epoch, exp] = payload.split('.');
  if (!userId || epoch === undefined || !exp) return null;
  if (Number(exp) < Math.floor(Date.now() / 1000)) return null;
  return { userId: Number(userId), epoch: Number(epoch) };
}

let pass = 0;
const fails = [];
const eq = (a, b, label) => {
  const x = JSON.stringify(a), y = JSON.stringify(b);
  if (x === y) pass++;
  else fails.push(`${label}\n      기대 ${y}\n      실제 ${x}`);
};

/* 정상 */
eq(readToken(makeToken(7, 0)), { userId: 7, epoch: 0 }, '발급한 토큰은 읽힘');
eq(readToken(makeToken(7, 3)), { userId: 7, epoch: 3 }, '세대가 보존됨');

/* 위조 */
eq(readToken(makeToken(7, 0).replace(/.$/, 'A') ), null, '서명이 바뀌면 거부');
const t = makeToken(7, 0);
const [uid, ep, exp, mac] = t.split('.');
eq(readToken(`8.${ep}.${exp}.${mac}`), null, '사용자를 바꾸면 서명이 맞지 않아 거부');
eq(readToken(`${uid}.9.${exp}.${mac}`), null, '세대를 바꾸면 거부');
eq(readToken(`${uid}.${ep}.${Number(exp) + 99999}.${mac}`), null, '만료를 늘리면 거부');

/* 만료 */
eq(readToken(makeToken(7, 0, -10)), null, '만료된 토큰은 거부');

/* 형식 */
eq(readToken(''), null, '빈 값은 거부');
eq(readToken('abc'), null, '점이 없으면 거부');
/* 세대가 없는 옛 형식(userId.exp) — 서명을 맞춰도 거부해야 합니다. */
const legacyPayload = `7.${Math.floor(Date.now() / 1000) + MAX_AGE}`;
eq(readToken(`${legacyPayload}.${sign(legacyPayload)}`), null,
  '세대 없는 옛 토큰은 서명이 맞아도 거부 (재로그인 유도)');

/* 세대 비교가 실제 무효화로 이어지는지 — currentUser 의 조건을 모사 */
const stored = { id: 7, session_epoch: 2 };
const match = (tok) => {
  const r = readToken(tok);
  return !!r && r.userId === stored.id && r.epoch === stored.session_epoch;
};
eq(match(makeToken(7, 2)), true, '세대가 같으면 통과');
eq(match(makeToken(7, 1)), false, '비밀번호 변경 전 토큰은 통과하지 못함');
stored.session_epoch = 3;
eq(match(makeToken(7, 2)), false, '세대가 올라가면 이전 토큰이 모두 무효');

if (fails.length) {
  console.error(`세션 토큰 검증 실패 — ${pass}건 통과, ${fails.length}건 실패\n`);
  fails.forEach((f) => console.error(`  - ${f}`));
  process.exit(1);
}
console.log(`세션 토큰 검증 통과 · ${pass}건`);
