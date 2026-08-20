/**
 * 인증
 *
 *   GET  /api/auth                                    로그인 상태 확인
 *   POST /api/auth  { action: 'login', username, password }
 *   POST /api/auth  { action: 'logout' }
 *   POST /api/auth  { action: 'password', current, next }   본인 비밀번호 변경
 */
import { one, query } from '../lib/db.js';
import {
  verifyPassword,
  hashPassword,
  setSession,
  clearSession,
  currentUser,
  audit,
  auditAttempt,
  sameOrigin,
} from '../lib/auth.js';

/* 비밀번호를 틀렸을 때 아이디 존재 여부가 드러나지 않도록 응답을 통일합니다. */
const BAD_LOGIN = '아이디 또는 비밀번호가 올바르지 않습니다.';

export default async function handler(req, res) {
  if (req.method === 'GET') {
    const user = await currentUser(req);
    return res.status(200).json({ user });
  }

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: '지원하지 않는 메서드입니다.' });
  }
  if (!sameOrigin(req)) {
    return res.status(403).json({ error: '허용되지 않은 요청 출처입니다.' });
  }

  const { action } = req.body ?? {};

  if (action === 'logout') {
    clearSession(res);
    return res.status(200).json({ ok: true });
  }

  if (action === 'login') {
    const { username, password } = req.body ?? {};
    if (!username || !password) {
      return res.status(400).json({ error: '아이디와 비밀번호를 입력하십시오.' });
    }

    const row = await one(
      `SELECT id, username, name, unit, role, password_hash, active
         FROM users WHERE username = $1`,
      [String(username).trim()]
    );

    /* 계정이 없어도 해시 검증을 한 번 수행해 응답 시간 차이를 줄입니다. */
    const stored = row?.password_hash ?? 'scrypt$00$00';
    const ok = await verifyPassword(String(password), stored);

    /* 실패한 시도도 기록합니다. 계정 존재 여부는 남기지 않습니다 —
       변경 이력은 열람 전용 계정도 볼 수 있어, 어느 아이디가 실재하는지
       구분되면 그 자체가 정보가 됩니다. */
    if (!row || !ok) {
      await auditAttempt(username, 'login.fail', '자격 증명 불일치');
      return res.status(401).json({ error: BAD_LOGIN });
    }
    if (!row.active) {
      await auditAttempt(row.username, 'login.fail', '비활성 계정');
      return res.status(403).json({ error: '비활성화된 계정입니다. 관리자에게 문의하십시오.' });
    }

    await query(`UPDATE users SET last_login_at = now() WHERE id = $1`, [row.id]);
    setSession(res, row.id);

    const user = {
      id: row.id,
      username: row.username,
      name: row.name,
      unit: row.unit,
      role: row.role,
    };
    await audit(user, 'login', row.username, null, null);
    return res.status(200).json({ user });
  }

  if (action === 'password') {
    const user = await currentUser(req);
    if (!user) return res.status(401).json({ error: '로그인이 필요합니다.' });

    const { current, next } = req.body ?? {};
    if (!next || String(next).length < 10) {
      return res.status(400).json({ error: '새 비밀번호는 10자 이상이어야 합니다.' });
    }

    const row = await one(`SELECT password_hash FROM users WHERE id = $1`, [user.id]);
    if (!(await verifyPassword(String(current ?? ''), row.password_hash))) {
      return res.status(401).json({ error: '현재 비밀번호가 올바르지 않습니다.' });
    }

    await query(`UPDATE users SET password_hash = $1 WHERE id = $2`, [
      await hashPassword(String(next)),
      user.id,
    ]);
    await audit(user, 'password.change', user.username, null, null);
    return res.status(200).json({ ok: true });
  }

  return res.status(400).json({ error: '알 수 없는 요청입니다.' });
}
