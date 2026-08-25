/**
 * lib/pem.js 검증
 *
 *   node scripts/test-pem.mjs
 *
 * 환경변수에 키를 붙여넣는 방식이 사람마다 달라, 어느 형태로 들어와도
 * 같은 PEM 이 나와야 합니다. 실제로 만들어 본 키로 서명까지 되는지 확인합니다.
 */
import { generateKeyPairSync, createSign } from 'node:crypto';
import { normalizePem } from '../lib/pem.js';

let pass = 0;
const fails = [];
const ok = (cond, label) => { if (cond) pass++; else fails.push(label); };
const eq = (a, b, label) => ok(JSON.stringify(a) === JSON.stringify(b), `${label}\n      기대 ${JSON.stringify(b)}\n      실제 ${JSON.stringify(a)}`);

/* 서비스 계정 키와 같은 형식(PKCS#8)으로 실제 키를 만들어 씁니다. */
const { privateKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  publicKeyEncoding: { type: 'spki', format: 'pem' },
});
const PEM = privateKey.trim();

/** 정리한 키로 실제 서명이 되는지 */
function canSign(value) {
  try {
    const s = createSign('RSA-SHA256');
    s.update('test');
    s.sign(normalizePem(value));
    return true;
  } catch {
    return false;
  }
}

/* ── 들어올 수 있는 형태들 ── */
ok(canSign(PEM), '실제 줄바꿈이 든 PEM');
ok(canSign(`${PEM}\n`), '끝에 줄바꿈이 있어도 됨');
ok(canSign(`  ${PEM}  `), '앞뒤 공백이 있어도 됨');

/* JSON 에서 복사한 그대로 — 줄바꿈이 \n 으로 escape 된 형태 */
const escaped = PEM.split('\n').join('\\n');
ok(canSign(escaped), 'escape 된 줄바꿈 (JSON 에서 복사한 형태)');
ok(canSign(`"${escaped}"`), '값 전체가 큰따옴표로 감싸인 경우');
ok(canSign(`'${escaped}'`), '값 전체가 작은따옴표로 감싸인 경우');

/* 키 JSON 을 통째로 붙여넣은 경우 */
ok(canSign(JSON.stringify({ type: 'service_account', private_key: PEM })),
  '키 JSON 을 통째로 붙여넣은 경우');

/* base64 로 감싼 경우 */
ok(canSign(Buffer.from(PEM, 'utf8').toString('base64')), 'base64 로 감싼 경우');

/* CRLF 가 섞인 경우 */
ok(canSign(PEM.split('\n').join('\r\n')), 'CRLF 줄바꿈');

/* 결과가 항상 같은 PEM 인지 */
eq(normalizePem(escaped), normalizePem(PEM), '형태가 달라도 같은 결과');
ok(normalizePem(escaped).endsWith('\n'), 'PEM 은 줄바꿈으로 끝남');
ok(normalizePem(escaped).startsWith('-----BEGIN'), 'BEGIN 으로 시작');

/* ── 잘못된 값은 원인을 알려야 합니다 ── */
function reason(value) {
  try { normalizePem(value); return null; } catch (e) { return e.message; }
}

ok(reason('') !== null, '빈 값은 거부');
ok(reason('그냥 아무 문자열') !== null, '아무 문자열은 거부');
ok(reason(undefined) !== null, 'undefined 는 거부');

/* 앞부분만 붙여넣어 END 가 빠진 경우 — 가장 흔한 실수입니다. */
const truncated = PEM.slice(0, 200);
const msg = reason(truncated);
ok(msg !== null, '잘린 키는 거부');
ok(msg.includes('BEGIN 있음'), '잘린 키의 원인 안내에 BEGIN 상태 표시');
ok(msg.includes('END 없음'), '잘린 키의 원인 안내에 END 없음 표시');
ok(msg.includes('현재 길이'), '길이를 알려 값이 잘렸는지 판단하게 함');
ok(!msg.includes(PEM.slice(50, 80)), '오류 메시지에 키 내용을 담지 않음');

/* PEM 형식이지만 내용이 깨진 경우 — 서명 단계에서 걸러집니다. */
const broken = `-----BEGIN PRIVATE KEY-----\nAAAA\n-----END PRIVATE KEY-----`;
ok(reason(broken) === null, '형식만 맞으면 정리는 통과');
ok(canSign(broken) === false, '내용이 깨졌으면 서명에서 실패');

if (fails.length) {
  console.error(`비공개 키 정리 검증 실패 — ${pass}건 통과, ${fails.length}건 실패\n`);
  fails.forEach((f) => console.error(`  - ${f}`));
  process.exit(1);
}
console.log(`비공개 키 정리 검증 통과 · ${pass}건`);
