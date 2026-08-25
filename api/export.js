/**
 * 증적 반출
 *
 *   GET /api/export?kind=ledger[&q=&type=&verdict=&from=&to=]
 *   GET /api/export?kind=check&id=<점검 이력 id>
 *
 * 반출본을 **서버가 만들고 해시도 서버가 계산**합니다. 파일과 함께 기록되는
 * SHA-256 이 있어야, 나중에 아카이빙 채널의 파일이 시스템에서 나온 그대로인지
 * 확인할 수 있습니다. 화면이 만든 파일의 해시를 화면이 보내면 값을 고친
 * 파일에 맞는 해시를 함께 보낼 수 있어 증명이 되지 않습니다.
 *
 * 해시는 응답 헤더(X-Export-Sha256)로도 돌려주어 화면이 바로 보여줍니다.
 */
import { query, one } from '../lib/db.js';
import { requireUser, audit } from '../lib/auth.js';
import { COLS, toClient } from '../lib/entry.js';
import { judge } from '../lib/judge.js';
import { LEDGER_HEADER, buildLedgerRows } from '../lib/sheet.js';
import { toCsv, sha256 } from '../lib/csv.js';

/** 화면 필터와 같은 조건. 어떤 범위를 반출했는지 기록에 남기기 위해 문구도 만듭니다. */
function applyFilters(entries, f) {
  const parts = [];
  let out = entries;

  if (f.type) {
    out = out.filter((r) => r.type === f.type);
    parts.push(`유형 ${f.type}`);
  }
  if (f.from || f.to) {
    out = out.filter((r) => r.date && (!f.from || r.date >= f.from) && (!f.to || r.date <= f.to));
    parts.push(`배포일 ${f.from || '전체'}~${f.to || '전체'}`);
  }
  if (f.verdict) {
    out = out.filter((r) => judge(r).overall === f.verdict);
    parts.push(`판정 ${f.verdict}`);
  }
  if (f.q) {
    const q = f.q.toLowerCase();
    out = out.filter((r) =>
      [r.id, r.sys, r.task, r.dev, r.qa, r.appr, r.judge]
        .join(' ')
        .toLowerCase()
        .includes(q)
    );
    parts.push(`검색 "${f.q}"`);
  }
  return { rows: out, scope: parts.length ? parts.join(' · ') : '전체 (필터 없음)' };
}

function checkRows(c) {
  const items = c.items ?? [];
  const pop = c.pop_count;
  const match =
    pop === null || pop === undefined
      ? '미입력'
      : Number(pop) === Number(c.ledger_count)
        ? '일치'
        : `불일치 (차이 ${Math.abs(Number(pop) - Number(c.ledger_count))}건)`;

  const R = [];
  R.push(['월간 점검 기록']);
  R.push(['점검 대상 통제', 'PC-01 애플리케이션 변경 승인 및 개발자/사용자 테스트 · PD-02 데이터 정합성 테스트']);
  R.push(['점검 근거', '릴리즈 유형별 QA/QC 증적 수립 표준 가이드라인 5항']);
  R.push(['점검 주체', 'QA유닛 (통제부서)']);
  R.push(['점검 방법', '대장 전수 검토 및 배포 이력(GitHub RELEASE 머지 PR 목록) 대조']);
  R.push(['점검 대상 기간 (배포일 기준)', `${c.period_from} ~ ${c.period_to}`]);
  R.push(['점검 수행일', c.performed_on]);
  R.push(['점검자', c.performed_by]);
  R.push(['확인자', c.approved_by]);
  R.push([]);
  R.push(['1. 모집단 완전성 확인']);
  R.push(['구분', '건수']);
  R.push(['배포 이력 건수 (GitHub RELEASE 머지 PR)', pop ?? '']);
  R.push(['대장 기재 건수', c.ledger_count]);
  R.push(['일치 여부', match]);
  R.push(['차이 원인 및 조치', c.pop_note ?? '']);
  R.push([]);
  R.push(['2. 점검 항목별 결과']);
  R.push(['구분', '점검 항목', '관련 통제', '건수', '판단 기준', '조치 내용']);
  items.forEach((it) =>
    R.push([it.isDef ? '지적 항목' : '확인 항목', it.name, it.ctrl, it.n, it.crit, it.fix ?? ''])
  );
  R.push([]);
  R.push(['3. 표본 재검토', c.sample ?? '']);
  R.push([]);
  R.push(['4. 점검 결과']);
  R.push(['모집단 건수', c.ledger_count]);
  R.push(['확인필요 건수', c.flagged]);
  R.push(['지적 항목 수', c.defects]);
  R.push(['점검 결과', c.defects ? '보완 필요' : '적정 (지적사항 없음)']);
  R.push(['점검자 의견', c.opinion ?? '']);
  R.push([]);
  R.push(['구분', '성명', '일자']);
  R.push(['점검자 (QA유닛)', c.performed_by, c.performed_on]);
  R.push(['확인자 (QA유닛 책임자)', c.approved_by, '']);
  R.push([]);
  R.push(['※ 본 점검은 통제부서(QA유닛)의 자체 점검이며, 통제검토부서(TA유닛)의 검토와는 별개의 절차이다.']);
  return R;
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: '지원하지 않는 메서드입니다.' });
  }

  /* 감사인에게 자료를 넘기는 것을 막을 이유가 없으므로 열람 전용도 허용합니다.
     반출 사실은 기록되므로 누가 무엇을 가져갔는지 남습니다. */
  const user = await requireUser(req, res, 'viewer');
  if (!user) return;

  const kind = String(req.query?.kind ?? 'ledger');

  try {
    let rows;
    let note;
    let action;
    let filename;
    let count;

    if (kind === 'ledger' || kind === 'backup') {
      const { rows: raw } = await query(
        `SELECT k, ${COLS.join(', ')} FROM entries WHERE deleted_at IS NULL`
      );
      const entries = raw.map(toClient);

      /* 전체 백업은 필터를 적용하지 않습니다. */
      const filtered =
        kind === 'backup'
          ? { rows: entries, scope: '전체 (백업)' }
          : applyFilters(entries, {
              q: String(req.query?.q ?? '').trim(),
              type: String(req.query?.type ?? '').trim(),
              verdict: String(req.query?.verdict ?? '').trim(),
              from: String(req.query?.from ?? '').trim(),
              to: String(req.query?.to ?? '').trim(),
            });

      count = filtered.rows.length;
      if (!count) return res.status(400).json({ error: '반출할 배포 건이 없습니다.' });

      rows = [LEDGER_HEADER, ...buildLedgerRows(filtered.rows)];
      action = kind === 'backup' ? 'export.backup' : 'export.ledger';
      note = `${kind === 'backup' ? '전체 백업' : '대장'} · ${count}건 · ${filtered.scope}`;
      filename = `QA검증이력대장${kind === 'backup' ? '_전체' : ''}_${new Date().toISOString().slice(0, 10)}.csv`;
    } else if (kind === 'check') {
      const id = String(req.query?.id ?? '').trim();
      if (!id) return res.status(400).json({ error: '점검 이력 식별자가 없습니다.' });

      const c = await one(`SELECT * FROM checks WHERE id = $1 AND deleted_at IS NULL`, [id]);
      if (!c) return res.status(404).json({ error: '해당 점검 이력을 찾을 수 없습니다.' });

      rows = checkRows(c);
      count = c.ledger_count ?? 0;
      action = 'export.check';
      note = `월간 점검 · ${c.period_from}~${c.period_to} · 모집단 ${count}건 · 지적 ${c.defects}건`;
      filename = `QA-MC-${String(c.period_from).slice(0, 7)}_월간점검.csv`;
    } else {
      return res.status(400).json({ error: '반출 구분이 올바르지 않습니다.' });
    }

    const csv = toCsv(rows);
    const hash = sha256(csv);

    /* 해시를 함께 기록해야 나중에 파일이 그대로인지 확인할 수 있습니다. */
    await audit(user, action, null, null, `${note} · sha256:${hash}`);

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('X-Export-Sha256', hash);
    res.setHeader('X-Export-Count', String(count));
    res.setHeader(
      'Content-Disposition',
      `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`
    );
    res.setHeader('Access-Control-Expose-Headers', 'X-Export-Sha256, X-Export-Count');
    return res.status(200).send(csv);
  } catch (e) {
    console.error('[export] 반출 실패', e);
    return res.status(500).json({ error: '반출에 실패했습니다.' });
  }
}
