/**
 * 월간 점검
 *
 *   GET    /api/checks             점검 이력 + 조치 내용 초안
 *   POST   /api/checks  { snapshot }   점검 결과 확정 저장
 *   PATCH  /api/checks  { draft }      조치 내용 초안 저장 (확정 전 임시)
 *   DELETE /api/checks?id=...          점검 이력 삭제 (admin)
 */
import { query, one } from '../lib/db.js';
import { requireUser, audit, sameOrigin } from '../lib/auth.js';

function toClient(row) {
  return {
    id: row.id,
    from: row.period_from ?? '',
    to: row.period_to ?? '',
    date: row.performed_on ?? '',
    by: row.performed_by ?? '',
    app: row.approved_by ?? '',
    popCount: row.pop_count ?? '',
    ledCount: row.ledger_count ?? 0,
    pop: row.ledger_count ?? 0,
    popNote: row.pop_note ?? '',
    sample: row.sample ?? '',
    opinion: row.opinion ?? '',
    flagged: row.flagged ?? 0,
    defects: row.defects ?? 0,
    items: row.items ?? [],
    createdBy: row.created_by,
    createdAt: row.created_at,
  };
}

const num = (v) => (v === '' || v === null || v === undefined ? null : Number(v));
const date = (v) => (v ? String(v) : null);

export default async function handler(req, res) {
  if (req.method === 'GET') {
    const user = await requireUser(req, res, 'viewer');
    if (!user) return;

    const [{ rows }, draft] = await Promise.all([
      query(`SELECT * FROM checks ORDER BY period_from ASC, created_at ASC`),
      one(`SELECT data FROM check_draft WHERE id = 1`),
    ]);
    return res.status(200).json({
      hist: rows.map(toClient),
      draft: draft?.data ?? {},
    });
  }

  if (!sameOrigin(req)) {
    return res.status(403).json({ error: '허용되지 않은 요청 출처입니다.' });
  }

  if (req.method === 'PATCH') {
    const user = await requireUser(req, res, 'member');
    if (!user) return;

    await query(
      `INSERT INTO check_draft (id, data, updated_by, updated_at)
            VALUES (1, $1, $2, now())
       ON CONFLICT (id) DO UPDATE
              SET data = EXCLUDED.data,
                  updated_by = EXCLUDED.updated_by,
                  updated_at = now()`,
      [req.body?.draft ?? {}, user.name]
    );
    return res.status(200).json({ ok: true });
  }

  if (req.method === 'POST') {
    const user = await requireUser(req, res, 'member');
    if (!user) return;

    const s = req.body?.snapshot ?? {};
    if (!s.from || !s.to) {
      return res.status(400).json({ error: '점검 대상 기간을 입력하십시오.' });
    }
    if (!s.date || !String(s.by ?? '').trim()) {
      return res.status(400).json({ error: '점검 수행일과 점검자를 입력하십시오.' });
    }

    const id = `h${Date.now()}`;
    const { rows } = await query(
      `INSERT INTO checks (id, period_from, period_to, performed_on, performed_by,
                           approved_by, pop_count, ledger_count, pop_note, sample,
                           opinion, flagged, defects, items, created_by)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
         RETURNING *`,
      [
        id,
        date(s.from),
        date(s.to),
        date(s.date),
        String(s.by ?? '').trim(),
        String(s.app ?? '').trim(),
        num(s.popCount),
        num(s.ledCount) ?? 0,
        s.popNote ?? '',
        s.sample ?? '',
        s.opinion ?? '',
        num(s.flagged) ?? 0,
        num(s.defects) ?? 0,
        JSON.stringify(s.items ?? []),
        user.name,
      ]
    );

    await audit(user, 'check.save', id, null, `${s.from} ~ ${s.to} · 지적 ${s.defects ?? 0}건`);
    return res.status(200).json({ check: toClient(rows[0]) });
  }

  if (req.method === 'DELETE') {
    /* 점검 이력의 연속성 자체가 통제 운영의 증거이므로 삭제는 admin 으로 제한합니다. */
    const user = await requireUser(req, res, 'admin');
    if (!user) return;

    const id = String(req.query?.id ?? '').trim();
    if (!id) return res.status(400).json({ error: '점검 이력 식별자가 없습니다.' });

    const row = await one(
      `DELETE FROM checks WHERE id = $1 RETURNING period_from, period_to`,
      [id]
    );
    if (!row) return res.status(404).json({ error: '해당 점검 이력을 찾을 수 없습니다.' });

    await audit(user, 'check.delete', id, null, `${row.period_from} ~ ${row.period_to}`);
    return res.status(200).json({ ok: true });
  }

  res.setHeader('Allow', 'GET, POST, PATCH, DELETE');
  return res.status(405).json({ error: '지원하지 않는 메서드입니다.' });
}
