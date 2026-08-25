/**
 * 인증 · 세션
 *
 * 비밀번호는 scrypt 로 해시하고, 세션은 서버 서명(HMAC-SHA256)된 쿠키로 유지합니다.
 * 세션 테이블을 두지 않는 대신 만료 시각을 서명에 포함해 위조를 막습니다.
 *
 * SESSION_SECRET 이 바뀌면 기존 세션은 모두 무효가 됩니다.
 */
import {
  randomBytes,
  scrypt as _scrypt,
  timingSafeEqual,
  createHmac,
} from 'node:crypto';
import { promisify } from 'node:util';
import { one, query } from './db.js';

const scrypt = promisify(_scrypt);

const SECRET = process.env.SESSION_SECRET;
if (!SECRET || SECRET.length < 32) {
  throw new Error(
    'SESSION_SECRET 환경변수가 없거나 너무 짧습니다. 32자 이상의 임의 문자열을 설정하십시오.'
  );
}

const COOKIE = 'ledger_session';
const MAX_AGE = 60 * 60 * 12; // 12시간. 업무일 기준으로 하루 안에 만료됩니다.

/* ── 비밀번호 ── */

export async function hashPassword(plain) {
  const salt = randomBytes(16).toString('hex');
  const key = await scrypt(plain, salt, 64);
  return `scrypt$${salt}$${key.toString('hex')}`;
}

export async function verifyPassword(plain, stored) {
  const [algo, salt, hex] = (stored || '').split('$');
  if (algo !== 'scrypt' || !salt || !hex) return false;
  const key = await scrypt(plain, salt, 64);
  const expected = Buffer.from(hex, 'hex');
  return key.length === expected.length && timingSafeEqual(key, expected);
}

/* ── 세션 쿠키 ── */

function sign(payload) {
  return createHmac('sha256', SECRET).update(payload).digest('base64url');
}

/**
 * 세션 토큰
 *
 * 세대(epoch)를 함께 서명합니다. 비밀번호가 바뀌면 users.session_epoch 가
 * 올라가 이전에 발급된 토큰이 모두 맞지 않게 됩니다. 무상태 토큰이라
 * 서버에 세션 목록이 없어도 이 방법으로 일괄 무효화할 수 있습니다.
 */
function makeToken(userId, epoch) {
  const exp = Math.floor(Date.now() / 1000) + MAX_AGE;
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
  if (
    mac.length !== expected.length ||
    !timingSafeEqual(Buffer.from(mac), Buffer.from(expected))
  ) {
    return null;
  }
  const [userId, epoch, exp] = payload.split('.');
  /* 세대가 없는 옛 토큰은 받지 않습니다. 한 번 다시 로그인하면 됩니다. */
  if (!userId || epoch === undefined || !exp) return null;
  if (Number(exp) < Math.floor(Date.now() / 1000)) return null;
  return { userId: Number(userId), epoch: Number(epoch) };
}

function parseCookies(req) {
  const out = {};
  for (const part of (req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

export function setSession(res, userId, epoch) {
  const flags = [
    `${COOKIE}=${makeToken(userId, epoch)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${MAX_AGE}`,
  ];
  if (process.env.VERCEL) flags.push('Secure');
  res.setHeader('Set-Cookie', flags.join('; '));
}

export function clearSession(res) {
  res.setHeader('Set-Cookie', `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
}

/** 로그인한 사용자를 반환합니다. 세션이 없거나 비활성 계정이면 null */
export async function currentUser(req) {
  const token = readToken(parseCookies(req)[COOKIE]);
  if (!token) return null;
  /* 세대가 다르면 비밀번호가 바뀐 뒤 발급된 토큰이 아니므로 거부합니다. */
  return one(
    `SELECT id, username, name, unit, role, active, must_change_password
       FROM users
      WHERE id = $1 AND active AND session_epoch = $2`,
    [token.userId, token.epoch]
  );
}

/**
 * 그 계정의 기존 세션을 모두 끊습니다. 비밀번호 변경·재설정 시 부릅니다.
 * 새 세대를 돌려주므로, 본인이 바꾼 경우 그 값으로 쿠키를 다시 심으면
 * 로그아웃되지 않습니다.
 */
export async function revokeSessions(userId) {
  const row = await one(
    `UPDATE users SET session_epoch = session_epoch + 1
      WHERE id = $1 RETURNING session_epoch`,
    [userId]
  );
  return row?.session_epoch ?? 0;
}

/**
 * 인증 가드. 통과하면 사용자 객체를, 실패하면 응답을 보내고 null 을 반환합니다.
 * minRole 로 최소 권한을 지정합니다.
 */
const RANK = { viewer: 0, member: 1, admin: 2 };

export async function requireUser(req, res, minRole = 'viewer') {
  const user = await currentUser(req);
  if (!user) {
    res.status(401).json({ error: '로그인이 필요합니다.' });
    return null;
  }
  if (RANK[user.role] < RANK[minRole]) {
    res.status(403).json({ error: '권한이 없습니다.' });
    return null;
  }

  /* 발급·재설정된 비밀번호는 관리자가 알고 있는 값입니다. 바꾸기 전에는
     대장을 쓰지 못하게 막아, 그 계정의 기록이 본인 것임을 담보합니다.
     비밀번호 변경 경로는 requireUser 를 쓰지 않으므로 막히지 않습니다. */
  if (user.must_change_password) {
    res.status(403).json({
      error: '최초 로그인입니다. 비밀번호를 변경한 뒤 이용하십시오.',
      mustChangePassword: true,
    });
    return null;
  }

  return user;
}

/** 변경 이력 기록 */
export async function audit(user, action, target, changed, note) {
  await query(
    `INSERT INTO audit_log (actor, actor_name, action, target, changed, note)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [user.username, user.name, action, target ?? null, changed ?? null, note ?? null]
  );
}

/**
 * 로그인하지 않은 상태의 시도를 기록합니다.
 *
 * 실패한 접근 시도가 남지 않으면 무단 접근을 확인할 수 없습니다. 성공만
 * 기록하면 "시도가 없었다"와 "막혔다"를 구분할 수 없습니다.
 *
 * 기록 자체가 실패해도 응답을 막지 않습니다. 로그를 남기지 못하는 것보다
 * 로그인 경로가 죽는 편이 더 큰 문제입니다.
 */
export async function auditAttempt(username, action, note) {
  try {
    await query(
      `INSERT INTO audit_log (actor, actor_name, action, target, note)
       VALUES ($1, NULL, $2, $1, $3)`,
      [String(username ?? '').trim().slice(0, 200) || '(미입력)', action, note ?? null]
    );
  } catch (e) {
    console.error('[audit] 시도 기록 실패', e);
  }
}

/**
 * 교차 사이트 요청 차단.
 * SameSite=Lax 로 대부분 막히지만, 상태를 바꾸는 요청은 Origin 도 함께 확인합니다.
 */
export function sameOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return true; // 같은 출처 폼/스크립트가 아닌 서버 간 호출
  try {
    return new URL(origin).host === req.headers.host;
  } catch {
    return false;
  }
}
