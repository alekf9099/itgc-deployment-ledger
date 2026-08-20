/**
 * 월간 점검
 *
 *   GET    /api/checks                     점검 이력 + 조치 내용 초안
 *   GET    /api/checks?from=&to=           위 + 해당 기간 집계 (summary)
 *   POST   /api/checks  { ...입력값 }        점검 결과 확정 저장
 *   PATCH  /api/checks  { draft }          조치 내용 초안 저장
 *   DELETE /api/checks?id=...              점검 이력 제외 표시 (admin)
 *
 * 집계는 화면이 보낸 값을 쓰지 않고 서버가 대장에서 다시 계산합니다.
 * 화면 계산값을 그대로 저장하면 요청을 직접 만들어 「지적 0건」으로
 * 기록할 수 있어, 점검 결과가 증거로서 성립하지 않습니다.
 */
import { query, one } from '../lib/db.js';
import { requireUser, audit, sameOrigin } from '../lib/auth.js';
import { COLS, toClient } from '../lib/entry.js';
import { CHECK_DEFS, computeSummary, missingFixes } from '../lib/judge.js';

function histToClient(row) {
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

/** 대장 전수를 판정 가능한 형태로 읽어옵니다. */
async function loadLedger() {
  const { rows } = await query(
    `SELECT k, ${COLS.join(', ')} FROM entries WHERE deleted_at IS NULL`
  );
  return rows.map(toClient);
}

export default async function handler(req, res) {
  if (req.method === 'GET') {
    const user = await requireUser(req, res, 'viewer');
    if (!user) return;

    const from = String(req.query?.from ?? '').trim();
    const to = String(req.query?.to ?? '').trim();

    const [{ rows }, draft] = await Promise.all([
      query(
        `SELECT * FROM checks WHERE deleted_at IS NULL
          ORDER BY period_from ASC, created_at ASC`
      ),
      one(`SELECT data FROM check_draft WHERE id = 1`),
    ]);

    const out = { hist: rows.map(histToClient), draft: draft?.data ?? {} };

    /* 화면에 표시되는 수치도 서버가 계산한 값이어야 저장값과 어긋나지 않습니다. */
    if (from && to) {
      out.summary = computeSummary(await loadLedger(), from, to, out.draft ? fixesOf(out.draft) : {});
    }
    return res.status(200).json(out);
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

    const b = req.body ?? {};
    if (!b.from || !b.to) {
      return res.status(400).json({ error: '점검 대상 기간을 입력하십시오.' });
    }
    if (!b.date || !String(b.by ?? '').trim()) {
      return res.status(400).json({ error: '점검 수행일과 점검자를 입력하십시오.' });
    }

    /* 집계는 화면 값을 믿지 않고 여기서 다시 계산합니다. */
    const summary = computeSummary(await loadLedger(), b.from, b.to, fixesOf(b.fixes));

    const missing = missingFixes(summary);
    if (missing.length) {
      return res.status(400).json({
        error: `지적 항목의 조치 내용을 기재하십시오 — ${missing.join(', ')}`,
      });
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
        date(b.from),
        date(b.to),
        date(b.date),
        String(b.by ?? '').trim(),
        String(b.app ?? '').trim(),
        num(b.popCount),
        summary.ledgerCount,
        b.popNote ?? '',
        b.sample ?? '',
        b.opinion ?? '',
        summary.flagged,
        summary.defects,
        JSON.stringify(summary.items),
        user.name,
      ]
    );

    await audit(
      user, 'check.save', id, null,
      `${b.from} ~ ${b.to} · 모집단 ${summary.ledgerCount}건 · 지적 ${summary.defects}건`
    );
    return res.status(200).json({ check: histToClient(rows[0]) });
  }

  if (req.method === 'DELETE') {
    /* 점검 이력의 연속성 자체가 통제 운영의 증거이므로 admin 으로 제한하고,
       실제로 지우지 않고 제외 표시만 합니다. */
    const user = await requireUser(req, res, 'admin');
    if (!user) return;

    const id = String(req.query?.id ?? '').trim();
    if (!id) return res.status(400).json({ error: '점검 이력 식별자가 없습니다.' });

    const row = await one(
      `UPDATE checks SET deleted_by = $2, deleted_at = now()
        WHERE id = $1 AND deleted_at IS NULL
    RETURNING period_from, period_to, defects`,
      [id, user.name]
    );
    if (!row) return res.status(404).json({ error: '해당 점검 이력을 찾을 수 없습니다.' });

    await audit(
      user, 'check.delete', id, null,
      `${row.period_from} ~ ${row.period_to} · 지적 ${row.defects}건`
    );
    return res.status(200).json({ ok: true });
  }

  res.setHeader('Allow', 'GET, POST, PATCH, DELETE');
  return res.status(405).json({ error: '지원하지 않는 메서드입니다.' });
}

/**
 * 조치 내용 정리
 *
 * 초안은 화면에서 'fix_<key>' 형태로 저장해 왔습니다. 저장 요청은 key 만
 * 보내므로 두 형태를 모두 받아 { key: 내용 } 으로 맞춥니다.
 */
function fixesOf(src) {
  const out = {};
  if (!src || typeof src !== 'object') return out;
  const keys = new Set(CHECK_DEFS.map((d) => d.key));
  for (const [k, v] of Object.entries(src)) {
    const key = k.startsWith('fix_') ? k.slice(4) : k;
    if (keys.has(key) && typeof v === 'string') out[key] = v;
  }
  return out;
}
