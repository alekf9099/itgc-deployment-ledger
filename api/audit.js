/**
 * 변경 이력 조회
 *
 *   GET /api/audit?target=<식별자>&limit=200
 *
 * 누가 언제 어떤 항목을 어떤 값으로 바꿨는지가 PC-01 변경 통제의 증거입니다.
 * 기록은 조회만 가능하며 화면에서 수정하거나 지울 수 없습니다.
 */
import { query } from '../lib/db.js';
import { requireUser } from '../lib/auth.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: '지원하지 않는 메서드입니다.' });
  }

  const user = await requireUser(req, res, 'viewer');
  if (!user) return;

  const target = String(req.query?.target ?? '').trim();
  const limit = Math.min(Number(req.query?.limit) || 200, 1000);

  const { rows } = target
    ? await query(
        `SELECT at, actor, actor_name, action, target, changed, note
           FROM audit_log WHERE target = $1 ORDER BY at DESC LIMIT $2`,
        [target, limit]
      )
    : await query(
        `SELECT at, actor, actor_name, action, target, changed, note
           FROM audit_log ORDER BY at DESC LIMIT $1`,
        [limit]
      );

  return res.status(200).json({ log: rows });
}
