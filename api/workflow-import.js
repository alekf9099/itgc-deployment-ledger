/**
 * 워크플로우 릴리즈 가져오기
 *
 *   POST /api/workflow-import { mode: 'preview', data, from }   계획만 계산
 *   POST /api/workflow-import { mode: 'apply',   data, from }   새 건 생성
 *
 * data 는 워크플로우에서 추출한 릴리즈 목록 파일입니다
 * ({ source, extractedAt, extractedBy, criteria, releases: [...] }).
 *
 * 워크플로우 API 토큰이 발급되면 같은 계획 · 적용 단계를 그대로 쓰고, 파일 대신
 * 서버가 워크플로우에서 직접 받아오도록 바꿉니다(WORKFLOW_API_TOKEN).
 *
 * 적용 시 계획을 서버에서 다시 계산합니다. 화면이 보낸 계획을 그대로 저장하면
 * 화면에서 값을 바꿔 보낼 수 있습니다.
 */
import { query, tx } from '../lib/db.js';
import { requireUser, audit, sameOrigin } from '../lib/auth.js';
import { COLS, toRow, toClient, findIdOverlap } from '../lib/entry.js';
import { splitDocIds } from '../lib/judge.js';
import { planImport } from '../lib/workflow.js';

const DATE = /^\d{4}-\d{2}-\d{2}$/;

async function loadLedger(c) {
  const run = c ? (t, p) => c.query(t, p) : query;
  const { rows } = await run(
    `SELECT k, ${COLS.join(', ')}, updated_at FROM entries WHERE deleted_at IS NULL`
  );
  return rows.map(toClient);
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: '지원하지 않는 메서드입니다.' });
  }
  if (!sameOrigin(req)) return res.status(403).json({ error: '허용되지 않은 요청 출처입니다.' });

  /* 모집단을 만드는 작업이라 대장 작성 권한(member) 이상만 허용합니다. */
  const user = await requireUser(req, res, 'member');
  if (!user) return;

  const b = req.body ?? {};
  const data = b.data ?? {};
  const releases = Array.isArray(data.releases) ? data.releases : null;
  if (!releases) return res.status(400).json({ error: '릴리즈 목록(releases)이 없는 파일입니다.' });
  if (releases.length > 2000) return res.status(400).json({ error: '한 번에 2,000건까지 가져올 수 있습니다.' });
  const from = String(b.from ?? '').trim();
  if (from && !DATE.test(from)) return res.status(400).json({ error: '시작일 형식이 올바르지 않습니다.' });
  const extractedAt = DATE.test(String(data.extractedAt ?? '')) ? data.extractedAt : '';
  const source = {
    source: String(data.source ?? '').slice(0, 100),
    extractedAt,
    extractedBy: String(data.extractedBy ?? '').slice(0, 100),
    criteria: String(data.criteria ?? '').slice(0, 300),
  };

  if (b.mode === 'preview') {
    const plan = planImport(releases, await loadLedger(), { from, extractedAt });
    return res.status(200).json({ plan, source });
  }

  if (b.mode !== 'apply') return res.status(400).json({ error: '알 수 없는 요청입니다.' });

  const created = [];
  const skipped = [];
  await tx(async (c) => {
    /* 일반 저장과 같은 잠금으로 줄을 세워, 동시에 저장되는 건과 증적 ID 가
       겹치지 않게 합니다. */
    await c.query('SELECT pg_advisory_xact_lock(4217001)');
    const ledger = await loadLedger(c);
    const plan = planImport(releases, ledger, { from, extractedAt });

    for (const item of plan.add) {
      const e = item.entry;
      const hit = findIdOverlap(ledger.map((x) => ({ k: x.k, doc_id: x.id })), splitDocIds(e.id));
      if (hit) { skipped.push({ code: item.code, reason: `증적 ID ${hit.id} 가 다른 건에 있음` }); continue; }
      /* 대장에서 제외한 릴리즈를 다시 가져오면, 제외된 행은 기록으로 남기고
         새 행을 만듭니다 (wf-R1052 → wf-R1052-2). */
      const taken = new Set((await c.query(
        `SELECT k FROM entries WHERE k = $1 OR k LIKE $2`, [e.k, `${e.k}-%`]
      )).rows.map((x) => x.k));
      if (taken.has(e.k)) {
        let n = 2;
        while (taken.has(`${e.k}-${n}`)) n++;
        e.k = `${e.k}-${n}`;
      }
      const values = toRow(e);
      const r = await c.query(
        `INSERT INTO entries (k, ${COLS.join(', ')}, created_by, created_at)
              VALUES ($1, ${COLS.map((_, i) => `$${i + 2}`).join(', ')}, $${COLS.length + 2}, now())
         ON CONFLICT (k) DO NOTHING
         RETURNING k`,
        [e.k, ...values, user.name]
      );
      if (!r.rows.length) { skipped.push({ code: item.code, reason: '이미 가져온 릴리즈' }); continue; }
      ledger.push({ ...e });
      created.push(item.code);
      await c.query(
        `INSERT INTO audit_log (actor, actor_name, action, target, changed, note)
         VALUES ($1, $2, 'entry.create', $3, $4, $5)`,
        [user.username, user.name, e.k, JSON.stringify({ 등록: ['', e.id] }),
         `워크플로우 ${item.code} 가져옴`]
      );
    }
  });

  /* 가져오기 자체를 한 줄로 남깁니다. 감사에서 "모집단을 언제, 누가, 어디서,
     어떤 기준으로 뽑았나"에 답하는 기록입니다. */
  await audit(user, 'workflow.import', null, null,
    `${source.source || '워크플로우'} · 추출 ${source.extractedAt || '미상'} (${source.extractedBy || '미상'}) · ` +
    `기준 ${source.criteria || from || '미상'} · 생성 ${created.length}건 · 제외 ${skipped.length}건`);

  return res.status(200).json({ created, skipped });
}
