/**
 * 시트에서 가져오기 (시트 → 웹)
 *
 *   GET  /api/sheet-import          미리보기 — 추가·변경·제외 목록
 *   POST /api/sheet-import { rows } 적용
 *
 * 자동 동기화가 아닙니다. 사람이 눌러 미리보기를 확인하고 적용하는 절차입니다.
 * 시트 편집은 누가 했는지 알 수 없으므로, **적용을 누른 사람**이 수행자로
 * 기록됩니다. 자동으로 밀어 넣으면 변경 이력에 사람이 남지 않습니다.
 *
 * 정하고 만든 규칙
 *   - 증적 문서 ID 로 대장 건을 찾습니다. ID 가 없는 행은 식별할 수 없어 제외합니다.
 *   - 웹에서 먼저 수정된 건은 충돌로 보고 건너뜁니다. 조용히 덮어쓰지 않습니다.
 *   - 시트에서 사라진 행은 아무것도 하지 않습니다. 대장에서 건을 빼는 것은
 *     모집단을 바꾸는 행위이므로 웹에서 관리자만 할 수 있어야 합니다.
 *   - 판정 열은 가져오지 않습니다. 시트에서 판정을 고칠 수 있으면 통제가
 *     무의미해집니다.
 */
import { query, one } from '../lib/db.js';
import { requireUser, audit, sameOrigin } from '../lib/auth.js';
import { COLS, FIELDS, FIELD_LABEL, toRow, toClient, diff, validateEntry } from '../lib/entry.js';
import { LEDGER_SHEET, LEDGER_HEADER, LEDGER_HEADER_ROW, colName, rowToEntry, importRange } from '../lib/sheet.js';
import { sheetConfig, readRange } from '../lib/google.js';

const LAST_COL = colName(LEDGER_HEADER.length);
const UNIQUE_VIOLATION = '23505';

/** 대상 시트가 이 양식인지 확인합니다. */
async function assertTemplate() {
  const range = `'${LEDGER_SHEET}'!A${LEDGER_HEADER_ROW}:${LAST_COL}${LEDGER_HEADER_ROW}`;
  const got = await readRange(range);
  const row = (got.values ?? [[]])[0].map((v) => String(v ?? '').trim());
  const mismatch = LEDGER_HEADER.filter((h, i) => (row[i] ?? '') !== h);
  if (mismatch.length) {
    throw new Error(
      `대상 시트의 머리글이 양식과 다릅니다. 「${LEDGER_SHEET}」 시트 ${LEDGER_HEADER_ROW}행을 확인하십시오.`
    );
  }
}

/** 대장 현재 상태를 증적 문서 ID 로 찾을 수 있게 담아둡니다. */
async function loadByDocId() {
  const { rows } = await query(
    `SELECT k, ${COLS.join(', ')}, updated_at FROM entries WHERE deleted_at IS NULL`
  );
  const map = new Map();
  rows.forEach((r) => {
    const e = toClient(r);
    e._updatedAt = r.updated_at ? new Date(r.updated_at).toISOString() : null;
    if (e.id) map.set(e.id, e);
  });
  return map;
}

/** 시트를 읽어 추가·변경·제외로 나눕니다. */
async function buildPlan() {
  await assertTemplate();

  const got = await readRange(importRange(), true);
  const raw = got.values ?? [];
  const existing = await loadByDocId();

  const add = [];
  const update = [];
  const skip = [];
  const seen = new Map();

  raw.forEach((row, i) => {
    const line = i + 6; // 데이터는 6행부터
    const e = rowToEntry(row);
    if (!e) return; // 빈 행

    const bad = validateEntry(e);

    /* 시트 안에서 ID 가 중복되면 어느 쪽이 맞는지 알 수 없습니다. */
    if (e.id && seen.has(e.id)) {
      bad.push(`시트 ${seen.get(e.id)}행과 증적 문서 ID 중복`);
    } else if (e.id) {
      seen.set(e.id, line);
    }

    if (bad.length) {
      skip.push({ line, id: e.id, reason: bad.join(' · ') });
      return;
    }

    const cur = existing.get(e.id);
    if (!cur) {
      add.push({ line, entry: e });
      return;
    }

    /* 값 비교. 판정 열은 애초에 가져오지 않으므로 입력 항목만 봅니다. */
    const changed = {};
    FIELDS.forEach(([key]) => {
      if (e[key] === undefined) return;
      const before = cur[key] ?? '';
      if (String(before) !== String(e[key])) changed[FIELD_LABEL[key]] = [before, e[key]];
    });

    if (!Object.keys(changed).length) return; // 같으면 건드리지 않음

    update.push({
      line, k: cur.k, id: e.id, entry: e, changed,
      expectedUpdatedAt: cur._updatedAt,
    });
  });

  return { add, update, skip, read: raw.length };
}

export default async function handler(req, res) {
  const { missing } = sheetConfig();

  if (req.method === 'GET') {
    /* 미리보기는 대장을 바꾸지 않지만 시트 전체를 읽으므로 작성 권한 이상으로 둡니다. */
    const user = await requireUser(req, res, 'member');
    if (!user) return;
    if (missing.length) {
      return res.status(400).json({ error: `Google 연동 환경변수가 없습니다: ${missing.join(', ')}` });
    }
    try {
      return res.status(200).json(await buildPlan());
    } catch (e) {
      console.error('[sheet-import] 미리보기 실패', e);
      return res.status(502).json({ error: e.message });
    }
  }

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: '지원하지 않는 메서드입니다.' });
  }
  if (!sameOrigin(req)) {
    return res.status(403).json({ error: '허용되지 않은 요청 출처입니다.' });
  }

  /* 시트 내용을 대장에 반영하는 것은 모집단을 바꾸는 행위이므로 관리자로 제한합니다. */
  const user = await requireUser(req, res, 'admin');
  if (!user) return;
  if (missing.length) {
    return res.status(400).json({ error: `Google 연동 환경변수가 없습니다: ${missing.join(', ')}` });
  }

  try {
    /* 미리보기 이후 시트나 대장이 바뀌었을 수 있으므로 적용 시점에 다시 계산합니다.
       화면이 보낸 목록을 그대로 저장하면 화면에서 값을 바꿔 보낼 수 있습니다. */
    const plan = await buildPlan();

    const added = [];
    const updated = [];
    const conflict = [];
    const failed = [];

    for (const item of plan.add) {
      const k = `s${Date.now()}${Math.random().toString(36).slice(2, 6)}`;
      const values = toRow(item.entry);
      try {
        await query(
          `INSERT INTO entries (k, ${COLS.join(', ')}, created_by, created_at)
                VALUES ($1, ${COLS.map((_, i) => `$${i + 2}`).join(', ')}, $${COLS.length + 2}, now())`,
          [k, ...values, user.name]
        );
        await audit(user, 'entry.create', k, { 등록: ['', item.entry.id] },
          `시트 ${item.line}행에서 반입`);
        added.push(item.entry.id);
      } catch (e) {
        failed.push({
          line: item.line, id: item.entry.id,
          reason: e.code === UNIQUE_VIOLATION ? '증적 문서 ID 중복' : '저장 실패',
        });
      }
    }

    for (const item of plan.update) {
      const values = toRow(item.entry);
      const setList = COLS.map((c, i) => `${c} = $${i + 2}`).join(', ');
      try {
        /* 웹에서 먼저 수정되었으면 건너뜁니다. */
        const row = await one(
          `UPDATE entries SET ${setList}, updated_by = $${COLS.length + 2}, updated_at = now()
            WHERE k = $1 AND deleted_at IS NULL
              AND (updated_at IS NOT DISTINCT FROM $${COLS.length + 3}::timestamptz)
        RETURNING k`,
          [item.k, ...values, user.name, item.expectedUpdatedAt]
        );
        if (!row) {
          conflict.push({ line: item.line, id: item.id });
          continue;
        }
        await audit(user, 'entry.update', item.k, item.changed, `시트 ${item.line}행에서 반입`);
        updated.push(item.id);
      } catch (e) {
        failed.push({
          line: item.line, id: item.id,
          reason: e.code === UNIQUE_VIOLATION ? '증적 문서 ID 중복' : '저장 실패',
        });
      }
    }

    await audit(
      user, 'sheet.import', null, null,
      `시트 반입 · 추가 ${added.length}건 · 변경 ${updated.length}건 · ` +
      `제외 ${plan.skip.length}건 · 충돌 ${conflict.length}건 · 실패 ${failed.length}건`
    );

    return res.status(200).json({
      added: added.length, updated: updated.length,
      skip: plan.skip, conflict, failed,
    });
  } catch (e) {
    console.error('[sheet-import] 반입 실패', e);
    return res.status(502).json({ error: e.message });
  }
}
