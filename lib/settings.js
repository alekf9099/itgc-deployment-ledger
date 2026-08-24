/**
 * 운영 설정
 *
 * 한 행(id=1)에 JSON 으로 담습니다. 설정 항목이 몇 개뿐이고, 항목을 늘릴 때
 * 스키마를 바꾸지 않아도 되기 때문입니다.
 *
 * 현재 항목
 *   sheetAuto  저장할 때 Google Sheets 에 자동 반사할지 (기본 false)
 */
import { one, query } from './db.js';

const DEFAULTS = { sheetAuto: false };

export async function getSettings() {
  const row = await one(`SELECT data FROM settings WHERE id = 1`);
  return { ...DEFAULTS, ...(row?.data ?? {}) };
}

/** 넘긴 항목만 덮어씁니다. */
export async function setSettings(patch, actorName) {
  const next = { ...(await getSettings()), ...patch };
  await query(
    `INSERT INTO settings (id, data, updated_by, updated_at)
          VALUES (1, $1, $2, now())
     ON CONFLICT (id) DO UPDATE
            SET data = EXCLUDED.data,
                updated_by = EXCLUDED.updated_by,
                updated_at = now()`,
    [JSON.stringify(next), actorName ?? null]
  );
  return next;
}
