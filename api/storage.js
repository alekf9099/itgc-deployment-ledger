/**
 * 저장소 사용량 및 증적 반출 이력
 *
 *   GET  /api/storage                                     용량 통계 · 알림
 *   POST /api/storage  { action:'log-export', kind, scope, count }
 *
 * Free 플랜은 용량 한도가 있고 시점 복구 기간이 짧습니다. 대장을 화면에만
 * 두면 한도에 닿거나 보관 기간이 지난 뒤에는 증적을 복구할 수 없으므로,
 * 사용량을 보여주고 반출 시점을 알립니다.
 *
 * 반출 자체도 기록합니다. "증적을 언제 누가 어떤 범위로 내보내 보관했는지"가
 * 기록 보존 절차의 증거입니다.
 */
import { query, one } from '../lib/db.js';
import { requireUser, audit, sameOrigin } from '../lib/auth.js';

const TABLES = ['entries', 'checks', 'check_draft', 'users', 'audit_log'];

/* Neon Free 플랜 기준 0.5GB. 플랜을 올리면 STORAGE_LIMIT_BYTES 로 덮어씁니다. */
const LIMIT = Number(process.env.STORAGE_LIMIT_BYTES) || 512 * 1024 * 1024;

/* 반출 주기. 월간 점검이 월 1회이므로 한 달을 조금 넘긴 값으로 둡니다. */
const EXPORT_CYCLE_DAYS = 35;

const LABEL = {
  entries: '배포 건 (모집단)',
  checks: '월간 점검 이력',
  check_draft: '점검 조치 초안',
  users: '담당자 계정',
  audit_log: '변경 이력',
};

export default async function handler(req, res) {
  if (req.method === 'GET') {
    const user = await requireUser(req, res, 'viewer');
    if (!user) return;

    const [dbRow, sizeRes, countRes, lastExport] = await Promise.all([
      one(`SELECT pg_database_size(current_database())::bigint AS bytes`),
      query(
        `SELECT c.relname AS name, pg_total_relation_size(c.oid)::bigint AS bytes
           FROM pg_class c
           JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname = 'public' AND c.relkind = 'r'`
      ),
      query(TABLES.map((t) => `SELECT '${t}' AS name, count(*)::int AS rows FROM ${t}`).join(' UNION ALL ')),
      one(
        `SELECT at, actor_name, note FROM audit_log
          WHERE action LIKE 'export.%' ORDER BY at DESC LIMIT 1`
      ),
    ]);

    const bytesOf = Object.fromEntries(sizeRes.rows.map((r) => [r.name, Number(r.bytes)]));
    const rowsOf = Object.fromEntries(countRes.rows.map((r) => [r.name, r.rows]));

    const tables = TABLES.map((name) => ({
      name,
      label: LABEL[name] ?? name,
      rows: rowsOf[name] ?? 0,
      bytes: bytesOf[name] ?? 0,
    })).sort((a, b) => b.bytes - a.bytes);

    const used = Number(dbRow.bytes);
    const pct = Math.min(100, Math.round((used / LIMIT) * 1000) / 10);

    /* 배포 건 한 건이 차지하는 평균 크기로 남은 여유를 건수로 환산합니다.
       한도가 임박했을 때 "몇 건 더 넣을 수 있는지"가 실무에서 필요한 값입니다. */
    const entryRows = rowsOf.entries ?? 0;
    const perEntry = entryRows > 0 ? (bytesOf.entries ?? 0) / entryRows : 0;
    const headroom = perEntry > 0 ? Math.max(0, Math.floor((LIMIT - used) / perEntry)) : null;

    /* 월별 등록 추이. 증가 속도를 보고 반출·플랜 상향 시점을 판단합니다. */
    const { rows: trend } = await query(
      `SELECT to_char(date_trunc('month', deploy_date), 'YYYY-MM') AS month,
              count(*)::int AS rows
         FROM entries
        WHERE deleted_at IS NULL AND deploy_date IS NOT NULL
     GROUP BY 1 ORDER BY 1 DESC LIMIT 12`
    );

    const daysSince = lastExport
      ? Math.floor((Date.now() - new Date(lastExport.at).getTime()) / 86_400_000)
      : null;

    const notices = [];
    if (pct >= 85) {
      notices.push({
        level: 'critical',
        text: `저장 용량을 ${pct}% 사용했습니다. 증적을 내보내 보관하고 플랜 상향 또는 이력 정리를 검토하십시오.`,
      });
    } else if (pct >= 70) {
      notices.push({
        level: 'warn',
        text: `저장 용량을 ${pct}% 사용했습니다. 증적을 내보내 별도 보관하십시오.`,
      });
    }
    if (entryRows > 0 && daysSince === null) {
      notices.push({
        level: 'warn',
        text: '증적을 내보낸 기록이 없습니다. 대장을 CSV로 내보내 아카이빙 채널에 보관하십시오.',
      });
    } else if (daysSince !== null && daysSince > EXPORT_CYCLE_DAYS) {
      notices.push({
        level: 'warn',
        text: `최근 증적 반출 이후 ${daysSince}일이 지났습니다. 월 1회 이상 내보내 보관하십시오.`,
      });
    }

    return res.status(200).json({
      used,
      limit: LIMIT,
      pct,
      headroom,
      perEntry: Math.round(perEntry),
      tables,
      trend,
      lastExport: lastExport
        ? { at: lastExport.at, by: lastExport.actor_name, note: lastExport.note, daysSince }
        : null,
      cycleDays: EXPORT_CYCLE_DAYS,
      notices,
    });
  }

  if (req.method === 'POST') {
    if (!sameOrigin(req)) {
      return res.status(403).json({ error: '허용되지 않은 요청 출처입니다.' });
    }
    const user = await requireUser(req, res, 'viewer');
    if (!user) return;

    const { action, kind, scope, count } = req.body ?? {};
    if (action !== 'log-export') {
      return res.status(400).json({ error: '알 수 없는 요청입니다.' });
    }

    const KINDS = { ledger: '대장', check: '월간 점검', backup: '전체 백업' };
    const label = KINDS[kind];
    if (!label) return res.status(400).json({ error: '반출 구분이 올바르지 않습니다.' });

    const note = `${label} · ${Number(count) || 0}건${scope ? ` · ${String(scope).slice(0, 80)}` : ''}`;
    await audit(user, `export.${kind}`, null, null, note);
    return res.status(200).json({ ok: true });
  }

  res.setHeader('Allow', 'GET, POST');
  return res.status(405).json({ error: '지원하지 않는 메서드입니다.' });
}
