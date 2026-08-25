/**
 * 계정 관리 (admin 전용)
 *
 *   GET    /api/users                                   계정 목록
 *   POST   /api/users  { username, name, unit, role, password? }  계정 생성
 *   POST   /api/users  { action:'reset', id, password? }          비밀번호 재설정
 *
 * password 를 주면 그 값으로, 주지 않으면 임의로 만듭니다. 어느 쪽이든
 * must_change_password 를 세워 최초 로그인 시 변경하게 합니다. 발급한
 * 비밀번호는 관리자가 알고 있는 값이라, 바꾸기 전까지는 그 계정의 기록이
 * 본인 것이라고 단정할 수 없습니다.
 *   PATCH  /api/users  { id, name?, unit?, role?, active? }
 *
 * 계정은 삭제하지 않습니다. 비활성화만 합니다. 그 계정이 남긴 변경 이력의
 * 수행자 정보를 보존해야 하기 때문입니다.
 *
 * 발급·회수·권한 변경은 모두 audit_log 에 남습니다. 스크립트로만 계정을
 * 관리하면 이 기록이 남지 않아 계정 관리 절차를 증명할 수 없습니다.
 */
import { randomBytes } from 'node:crypto';
import { query, one } from '../lib/db.js';
import { requireUser, hashPassword, audit, sameOrigin, revokeSessions } from '../lib/auth.js';

const ROLES = ['admin', 'member', 'viewer'];

/* 사람이 옮겨 적을 수 있도록 혼동되는 글자(0/O, 1/l/I)를 뺀 문자집합을 씁니다. */
const ALPHABET = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function tempPassword() {
  return Array.from(randomBytes(16))
    .map((b) => ALPHABET[b % ALPHABET.length])
    .join('');
}

const LIST = `SELECT id, username, name, unit, role, active, created_at, last_login_at,
                     must_change_password
                FROM users ORDER BY active DESC, role, username`;

const MIN_LENGTH = 10;

/**
 * 관리자가 지정한 비밀번호를 검사합니다.
 *
 * 지정 값은 관리자가 알고 있으므로 최초 로그인 시 변경을 강제합니다.
 * 그래도 첫 로그인까지는 쓰이는 값이라 최소 조건은 봅니다.
 */
function checkGiven(password, username) {
  const p = String(password);
  if (p.length < MIN_LENGTH) return `비밀번호는 ${MIN_LENGTH}자 이상이어야 합니다.`;
  if (username && p.toLowerCase() === String(username).toLowerCase()) {
    return '비밀번호를 아이디와 같게 정할 수 없습니다.';
  }
  return null;
}

export default async function handler(req, res) {
  const user = await requireUser(req, res, 'admin');
  if (!user) return;

  if (req.method === 'GET') {
    const { rows } = await query(LIST);
    return res.status(200).json({ users: rows });
  }

  if (!sameOrigin(req)) {
    return res.status(403).json({ error: '허용되지 않은 요청 출처입니다.' });
  }

  if (req.method === 'POST') {
    const body = req.body ?? {};

    /* 비밀번호 재설정 */
    if (body.action === 'reset') {
      const target = await one(`SELECT id, username, name FROM users WHERE id = $1`, [
        Number(body.id),
      ]);
      if (!target) return res.status(404).json({ error: '계정을 찾을 수 없습니다.' });

      /* 값을 주지 않으면 임의로 만듭니다. */
      const given = String(body.password ?? '').trim();
      if (given) {
        const bad = checkGiven(given, target.username);
        if (bad) return res.status(400).json({ error: bad });
      }
      const password = given || tempPassword();

      await query(
        `UPDATE users SET password_hash = $1, must_change_password = TRUE WHERE id = $2`,
        [await hashPassword(password), target.id]
      );
      /* 재설정한 계정이 다른 곳에 로그인해 있다면 즉시 끊습니다. 비밀번호를
         바꿔도 기존 세션이 남으면 회수가 되지 않습니다. */
      await revokeSessions(target.id);
      await audit(user, 'user.reset', target.username, null,
        `${target.name} · ${given ? '지정 비밀번호' : '임의 비밀번호'} · 기존 세션 해제`);
      return res.status(200).json({ username: target.username, password });
    }

    /* 계정 생성 */
    const username = String(body.username ?? '').trim();
    const name = String(body.name ?? '').trim();
    const unit = String(body.unit ?? '').trim() || null;
    const role = String(body.role ?? 'member');

    if (!username || !name) {
      return res.status(400).json({ error: '아이디와 성명을 입력하십시오.' });
    }
    if (!ROLES.includes(role)) {
      return res.status(400).json({ error: '권한 값이 올바르지 않습니다.' });
    }
    if (await one(`SELECT 1 FROM users WHERE username = $1`, [username])) {
      return res.status(409).json({ error: '이미 사용 중인 아이디입니다.' });
    }

    const given = String(body.password ?? '').trim();
    if (given) {
      const bad = checkGiven(given, username);
      if (bad) return res.status(400).json({ error: bad });
    }
    const password = given || tempPassword();

    const row = await one(
      `INSERT INTO users (username, name, unit, role, password_hash, must_change_password)
            VALUES ($1, $2, $3, $4, $5, TRUE)
         RETURNING id, username, name, unit, role, active, created_at, last_login_at,
                   must_change_password`,
      [username, name, unit, role, await hashPassword(password)]
    );

    await audit(user, 'user.create', username, { 권한: ['', role] },
      `${name} · ${given ? '지정 비밀번호' : '임의 비밀번호'}`);
    return res.status(200).json({ user: row, password });
  }

  if (req.method === 'PATCH') {
    const body = req.body ?? {};
    const id = Number(body.id);
    const target = await one(
      `SELECT id, username, name, unit, role, active FROM users WHERE id = $1`,
      [id]
    );
    if (!target) return res.status(404).json({ error: '계정을 찾을 수 없습니다.' });

    /* 마지막 관리자가 스스로 권한을 내리거나 계정을 잠그면 아무도 계정을
       관리할 수 없게 됩니다. 자기 자신에 대한 두 조작만 막습니다. */
    if (target.id === user.id) {
      if (body.role !== undefined && body.role !== target.role) {
        return res.status(400).json({ error: '자신의 권한은 변경할 수 없습니다.' });
      }
      if (body.active === false) {
        return res.status(400).json({ error: '자신의 계정은 비활성화할 수 없습니다.' });
      }
    }

    const changed = {};
    const next = { ...target };

    if (body.name !== undefined && String(body.name).trim() !== target.name) {
      next.name = String(body.name).trim();
      if (!next.name) return res.status(400).json({ error: '성명은 비울 수 없습니다.' });
      changed['성명'] = [target.name, next.name];
    }
    if (body.unit !== undefined && (String(body.unit).trim() || null) !== target.unit) {
      next.unit = String(body.unit).trim() || null;
      changed['소속'] = [target.unit ?? '', next.unit ?? ''];
    }
    if (body.role !== undefined && body.role !== target.role) {
      if (!ROLES.includes(body.role)) {
        return res.status(400).json({ error: '권한 값이 올바르지 않습니다.' });
      }
      next.role = body.role;
      changed['권한'] = [target.role, next.role];
    }
    if (body.active !== undefined && Boolean(body.active) !== target.active) {
      next.active = Boolean(body.active);
      changed['상태'] = [target.active ? '활성' : '비활성', next.active ? '활성' : '비활성'];
    }

    if (!Object.keys(changed).length) {
      return res.status(200).json({ user: target, unchanged: true });
    }

    const row = await one(
      `UPDATE users SET name = $2, unit = $3, role = $4, active = $5
        WHERE id = $1
    RETURNING id, username, name, unit, role, active, created_at, last_login_at`,
      [id, next.name, next.unit, next.role, next.active]
    );

    await audit(user, 'user.update', target.username, changed, target.name);
    return res.status(200).json({ user: row });
  }

  res.setHeader('Allow', 'GET, POST, PATCH');
  return res.status(405).json({ error: '지원하지 않는 메서드입니다.' });
}
