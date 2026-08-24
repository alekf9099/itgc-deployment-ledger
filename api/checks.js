/**
 * 월간 점검
 *
 *   GET    /api/checks                 점검 이력 목록
 *   GET    /api/checks?from=&to=       위 + 그 회차의 집계·작성중·확정 내용
 *   PATCH  /api/checks  { from, to, draft }   작성 중 내용 저장 (회차별)
 *   POST   /api/checks  { from, to, ... }     회차 확정
 *   DELETE /api/checks?id=...          이력에서 제외 표시 (admin)
 *
 * 점검은 「회차」 단위이며 회차는 대상 기간으로 식별합니다. 회차당 한 건만
 * 두어 정본이 하나로 확정되게 합니다. 같은 기간이 두 건 있으면 어느 것이
 * 점검 결과인지 답할 수 없습니다.
 *
 * 집계는 화면이 보낸 값을 쓰지 않고 서버가 대장에서 다시 계산합니다.
 * 화면 계산값을 그대로 저장하면 요청을 직접 만들어 「지적 0건」으로
 * 기록할 수 있어, 점검 결과가 증거로서 성립하지 않습니다.
 */
import { query, one } from '../lib/db.js';
import { requireUser, audit, sameOrigin } from '../lib/auth.js';
import { COLS, toClient } from '../lib/entry.js';
import { CHECK_DEFS, computeSummary, missingFixes } from '../lib/judge.js';

const PERIOD_CONFLICT = '23505';

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

/**
 * 작성 중 내용 정리
 *
 * 조치 내용은 정의된 항목만 받습니다. 예전 초안이 'fix_<key>' 형태였으므로
 * 두 형태를 모두 받아 { key: 내용 } 으로 맞춥니다.
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

const TEXTS = ['date', 'by', 'app', 'popCount', 'popNote', 'sample', 'opinion'];

/** 작성 중 내용에서 받을 항목만 골라냅니다. */
function draftOf(src) {
  const out = { fixes: fixesOf(src?.fixes) };
  TEXTS.forEach((k) => {
    const v = src?.[k];
    out[k] = v === undefined || v === null ? '' : String(v).slice(0, 4000);
  });
  return out;
}

export default async function handler(req, res) {
  if (req.method === 'GET') {
    const user = await requireUser(req, res, 'viewer');
    if (!user) return;

    const from = String(req.query?.from ?? '').trim();
    const to = String(req.query?.to ?? '').trim();

    const { rows } = await query(
      `SELECT * FROM checks WHERE deleted_at IS NULL
        ORDER BY period_from ASC, created_at ASC`
    );
    const out = { hist: rows.map(histToClient) };

    if (from && to) {
      const [draftRow, confirmedRow] = await Promise.all([
        one(`SELECT data FROM check_drafts WHERE period_from = $1 AND period_to = $2`, [from, to]),
        one(
          `SELECT * FROM checks
            WHERE period_from = $1 AND period_to = $2 AND deleted_at IS NULL`,
          [from, to]
        ),
      ]);

      const draft = draftRow?.data ?? null;
      out.draft = draft;
      out.confirmed = confirmedRow ? histToClient(confirmedRow) : null;

      /* 확정된 회차에도 현재 집계를 함께 돌려줍니다. 확정 이후 대장이 바뀌면
         화면이 그 사실을 알릴 수 있어야 합니다. 확정 기록 자체는 그대로 둡니다. */
      out.summary = computeSummary(await loadLedger(), from, to, fixesOf(draft?.fixes));
    }
    return res.status(200).json(out);
  }

  if (!sameOrigin(req)) {
    return res.status(403).json({ error: '허용되지 않은 요청 출처입니다.' });
  }

  if (req.method === 'PATCH') {
    const user = await requireUser(req, res, 'member');
    if (!user) return;

    const from = date(req.body?.from);
    const to = date(req.body?.to);
    if (!from || !to) {
      return res.status(400).json({ error: '점검 대상 기간이 필요합니다.' });
    }

    await query(
      `INSERT INTO check_drafts (period_from, period_to, data, updated_by, updated_at)
            VALUES ($1, $2, $3, $4, now())
       ON CONFLICT (period_from, period_to) DO UPDATE
              SET data = EXCLUDED.data,
                  updated_by = EXCLUDED.updated_by,
                  updated_at = now()`,
      [from, to, JSON.stringify(draftOf(req.body?.draft))]
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

    const existing = await one(
      `SELECT id, performed_by, performed_on FROM checks
        WHERE period_from = $1 AND period_to = $2 AND deleted_at IS NULL`,
      [date(b.from), date(b.to)]
    );

    if (existing && !b.replace) {
      return res.status(409).json({
        error: `${b.from} ~ ${b.to} 회차는 이미 확정되었습니다 (${existing.performed_by}, ${existing.performed_on}). 다시 작성하려면 관리자가 「재작성」으로 기존 기록을 제외해야 합니다.`,
        confirmed: true,
      });
    }

    /* 재작성은 확정된 결과를 바꾸는 행위이므로 admin 으로 제한하고, 기존
       기록은 지우지 않고 제외 표시만 남깁니다. */
    if (existing && b.replace) {
      if (user.role !== 'admin') {
        return res.status(403).json({ error: '확정된 회차의 재작성은 관리자만 할 수 있습니다.' });
      }
      await query(
        `UPDATE checks SET deleted_by = $2, deleted_at = now() WHERE id = $1`,
        [existing.id, user.name]
      );
      await audit(
        user, 'check.replace', existing.id, null,
        `${b.from} ~ ${b.to} 재작성으로 기존 기록 제외`
      );
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
    let rows;
    try {
      ({ rows } = await query(
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
      ));
    } catch (e) {
      /* 같은 회차를 두 사람이 동시에 확정하려 한 경우 */
      if (e.code === PERIOD_CONFLICT) {
        return res.status(409).json({
          error: `${b.from} ~ ${b.to} 회차가 방금 다른 담당자에 의해 확정되었습니다. 화면을 새로고침해 확인하십시오.`,
          confirmed: true,
        });
      }
      throw e;
    }

    /* 확정했으므로 그 회차의 작성 중 내용은 더 필요하지 않습니다. */
    await query(`DELETE FROM check_drafts WHERE period_from = $1 AND period_to = $2`, [
      date(b.from),
      date(b.to),
    ]);

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
