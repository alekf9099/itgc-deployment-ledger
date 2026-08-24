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
  revokeSessions,
  audit,
  auditAttempt,
  sameOrigin,
} from '../lib/auth.js';

/* 비밀번호를 틀렸을 때 아이디 존재 여부가 드러나지 않도록 응답을 통일합니다. */
const BAD_LOGIN = '아이디 또는 비밀번호가 올바르지 않습니다.';

/**
 * 로그인 시도 제한
 *
 * 제한이 없으면 비밀번호를 무제한으로 추측할 수 있습니다. 최근 실패 횟수를
 * audit_log 에서 세어 판단합니다. 시도 기록이 곧 제한의 근거가 되므로
 * 별도 테이블을 두지 않습니다.
 *
 * 계정을 영구 잠그지는 않습니다. 잠금 해제를 관리자에게 의존하게 만들면
 * 관리자가 한 명일 때 업무가 멈춥니다.
 */
const LOCK_WINDOW_MIN = 15;
const LOCK_THRESHOLD = 5;

async function recentFailures(username) {
  const row = await one(
    `SELECT count(*)::int AS n FROM audit_log
      WHERE action = 'login.fail' AND actor = $1
        AND at > now() - ($2 || ' minutes')::interval`,
    [username, String(LOCK_WINDOW_MIN)]
  );
  return row?.n ?? 0;
}

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

    const id = String(username).trim();

    /* 실패가 쌓이면 잠시 막습니다. 계정 존재 여부와 무관하게 같은 기준을
       적용해, 이 응답으로 아이디 실재를 알 수 없게 합니다. */
    const fails = await recentFailures(id);
    if (fails >= LOCK_THRESHOLD) {
      await auditAttempt(id, 'login.block', `연속 실패 ${fails}회로 차단`);
      return res.status(429).json({
        error: `로그인 시도가 ${LOCK_THRESHOLD}회 실패했습니다. ${LOCK_WINDOW_MIN}분 후 다시 시도하거나 관리자에게 비밀번호 재설정을 요청하십시오.`,
      });
    }

    const row = await one(
      `SELECT id, username, name, unit, role, password_hash, active, session_epoch
         FROM users WHERE username = $1`,
      [id]
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
    setSession(res, row.id, row.session_epoch);

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

    /* 비밀번호를 바꾸면 다른 곳에 남아 있던 세션을 모두 끊습니다. 그러지
       않으면 세션이 탈취된 경우 비밀번호를 바꿔도 접근이 유지됩니다.
       바꾼 본인은 새 세대로 쿠키를 다시 심어 로그아웃되지 않게 합니다. */
    const epoch = await revokeSessions(user.id);
    setSession(res, user.id, epoch);

    await audit(user, 'password.change', user.username, null, '기존 세션 전체 해제');
    return res.status(200).json({ ok: true });
  }

  return res.status(400).json({ error: '알 수 없는 요청입니다.' });
}
