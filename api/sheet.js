/**
 * Google Sheets 반사 (웹 → 시트, 한 방향)
 *
 *   GET   /api/sheet                  설정·연결 상태 확인
 *   POST  /api/sheet                  대장과 최근 점검 결과를 대상 시트에 덮어쓰기
 *   PATCH /api/sheet  { auto: bool }  저장 시 자동 반사 켜기·끄기 (admin)
 *
 * 시트는 **읽기 전용 사본**입니다. 정본은 이 대장입니다. 시트에서 값을 고쳐도
 * 다음 반사에서 덮어써집니다. 시트 편집 권한을 담당자에게 주지 마십시오 —
 * 인증과 변경 이력 밖에서 대장이 바뀌면 통제가 성립하지 않습니다.
 *
 * 양식을 보존하기 위해 시트를 새로 만들지 않고 데이터 범위만 갱신합니다.
 */
import { query } from '../lib/db.js';
import { requireUser, audit, sameOrigin } from '../lib/auth.js';
import { COLS, toClient } from '../lib/entry.js';
import {
  LEDGER_SHEET, LEDGER_HEADER, LEDGER_HEADER_ROW, colName,
  buildLedgerRows, ledgerUpdate, ledgerClearRange, checkUpdates,
} from '../lib/sheet.js';
import {
  sheetConfig, readRange, writeRanges, clearRanges, spreadsheetInfo,
} from '../lib/google.js';
import { getSettings, setSettings } from '../lib/settings.js';

const LAST_COL = colName(LEDGER_HEADER.length);

/** 대상 시트가 이 양식인지 확인합니다. 엉뚱한 시트를 덮어쓰지 않기 위한 검사입니다. */
async function assertTemplate() {
  const range = `'${LEDGER_SHEET}'!A${LEDGER_HEADER_ROW}:${LAST_COL}${LEDGER_HEADER_ROW}`;
  const got = await readRange(range);
  const row = (got.values ?? [[]])[0].map((v) => String(v ?? '').trim());

  const mismatch = LEDGER_HEADER.filter((h, i) => (row[i] ?? '') !== h);
  if (mismatch.length) {
    throw new Error(
      `대상 시트의 머리글이 양식과 다릅니다. 「${LEDGER_SHEET}」 시트 ${LEDGER_HEADER_ROW}행이 ` +
      `양식과 같은지 확인하십시오. (불일치 항목: ${mismatch.slice(0, 3).join(', ')}${mismatch.length > 3 ? ' 외' : ''})`
    );
  }
}

export default async function handler(req, res) {
  if (req.method === 'GET') {
    const user = await requireUser(req, res, 'viewer');
    if (!user) return;

    const { missing, email, sheetId } = sheetConfig();
    const { sheetAuto } = await getSettings();

    if (missing.length) {
      return res.status(200).json({
        configured: false, missing, auto: sheetAuto,
        hint: '서비스 계정을 발급하고 환경변수를 등록한 뒤 대상 시트를 그 계정에 편집자로 공유하십시오.',
      });
    }

    try {
      const info = await spreadsheetInfo();
      const tabs = (info.sheets ?? []).map((s) => s.properties.title);
      await assertTemplate();
      return res.status(200).json({
        configured: true, ok: true, auto: sheetAuto,
        title: info.properties?.title, tabs,
        account: email, sheetId,
      });
    } catch (e) {
      return res.status(200).json({
        configured: true, ok: false, auto: sheetAuto,
        error: e.message, account: email, sheetId,
      });
    }
  }

  if (req.method === 'PATCH') {
    if (!sameOrigin(req)) {
      return res.status(403).json({ error: '허용되지 않은 요청 출처입니다.' });
    }
    /* 자동 반사는 자료가 외부로 나가는 동작을 상시화하므로 admin 만 바꿉니다. */
    const user = await requireUser(req, res, 'admin');
    if (!user) return;

    const auto = Boolean(req.body?.auto);
    await setSettings({ sheetAuto: auto }, user.name);
    await audit(user, 'sheet.auto', null, { '자동 반사': [!auto ? '켬' : '끔', auto ? '켬' : '끔'] }, null);
    return res.status(200).json({ auto });
  }

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST, PATCH');
    return res.status(405).json({ error: '지원하지 않는 메서드입니다.' });
  }
  if (!sameOrigin(req)) {
    return res.status(403).json({ error: '허용되지 않은 요청 출처입니다.' });
  }

  /* 외부로 자료를 내보내는 동작이므로 작성 권한 이상으로 제한합니다. */
  const user = await requireUser(req, res, 'member');
  if (!user) return;

  const { missing } = sheetConfig();
  if (missing.length) {
    return res.status(400).json({ error: `Google 연동 환경변수가 없습니다: ${missing.join(', ')}` });
  }

  try {
    await assertTemplate();

    const [entriesRes, checksRes] = await Promise.all([
      query(`SELECT k, ${COLS.join(', ')} FROM entries WHERE deleted_at IS NULL`),
      query(
        `SELECT * FROM checks WHERE deleted_at IS NULL
          ORDER BY period_from ASC, created_at ASC`
      ),
    ]);

    const entries = entriesRes.rows.map(toClient);
    const rows = buildLedgerRows(entries);

    const history = checksRes.rows.map((r) => ({
      from: r.period_from, to: r.period_to, date: r.performed_on,
      by: r.performed_by, app: r.approved_by, defects: r.defects,
      flagged: r.flagged, ledCount: r.ledger_count, popCount: r.pop_count,
      popNote: r.pop_note, sample: r.sample, opinion: r.opinion,
      items: r.items ?? [],
    }));
    const latest = history.length ? history[history.length - 1] : null;

    const data = [ledgerUpdate(rows), ...checkUpdates(latest, history)];
    await writeRanges(data);

    const stale = ledgerClearRange(rows.length);
    if (stale) await clearRanges([stale]);

    await audit(
      user, 'export.sheet', null, null,
      `Google Sheets 반사 · 대장 ${rows.length}건${latest ? ` · 점검 ${latest.from}~${latest.to}` : ''}`
    );

    return res.status(200).json({
      ok: true, rows: rows.length,
      check: latest ? `${latest.from} ~ ${latest.to}` : null,
    });
  } catch (e) {
    console.error('[sheet] 반사 실패', e);
    return res.status(502).json({ error: e.message });
  }
}
