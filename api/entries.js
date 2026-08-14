/**
 * 배포 건 (PC-01 모집단)
 *
 *   GET    /api/entries            대장 전체 (삭제 표시된 건 제외)
 *   POST   /api/entries   { ...건 }  등록 또는 수정 (k 기준 upsert)
 *   DELETE /api/entries?k=...       삭제 표시 (실제 행은 남습니다)
 *
 * 판정 결과는 저장하지 않습니다. 화면이 입력값에서 계산합니다.
 */
import { query, one } from '../lib/db.js';
import { requireUser, audit, sameOrigin } from '../lib/auth.js';

/* 화면 필드 ↔ 컬럼 대응. 라벨은 변경 이력을 사람이 읽을 수 있게 하기 위한 것입니다. */
const FIELDS = [
  ['id', 'doc_id', '증적 문서 ID'],
  ['date', 'deploy_date', '배포일', 'date'],
  ['type', 'release_type', '릴리즈 구분'],
  ['judge', 'type_judge', '유형 판정자'],
  ['sys', 'target_system', '대상 시스템'],
  ['task', 'task', '일감/릴리즈 식별자'],
  ['dev', 'dev', '변경 작성자'],
  ['qa', 'qa', '검증 수행자'],
  ['qav', 'qa_verdict', 'QA 판정'],
  ['appr', 'approver', '배포 승인자'],
  ['apprd', 'approved_on', '배포 승인일', 'date'],
  ['schema', 'schema_change', '스키마·데이터 변경'],
  ['int', 'integrity', '정합성 검증'],
  ['intby', 'integrity_by', '정합성 검증자'],
  ['reg', 'registered_on', '증적 등록일', 'date'],
  ['path', 'registered_path', '증적 등록 경로'],
  ['state', 'state', '증적 상태'],
  ['exc', 'exception_by', '예외 승인자'],
  ['memo', 'memo', '비고'],
];

const COLS = FIELDS.map(([, col]) => col);
const LABEL = Object.fromEntries(FIELDS.map(([key, , label]) => [key, label]));

/** 화면 → DB. 빈 문자열은 NULL 로 저장해 "미입력"을 한 가지 값으로 통일합니다. */
function toRow(body) {
  return FIELDS.map(([key]) => {
    const v = body[key];
    return v === undefined || v === null || String(v).trim() === '' ? null : String(v).trim();
  });
}

/** DB → 화면. 화면 로직이 문자열을 전제하므로 NULL 은 빈 문자열로 돌려줍니다. */
function toClient(row) {
  const out = { k: row.k };
  FIELDS.forEach(([key, col]) => {
    out[key] = row[col] ?? '';
  });
  out._meta = {
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedBy: row.updated_by,
    updatedAt: row.updated_at,
  };
  return out;
}

/** 변경된 항목만 { 라벨: [이전, 이후] } 형태로 추립니다. */
function diff(before, values) {
  const changed = {};
  FIELDS.forEach(([key, col], i) => {
    const a = before[col] ?? '';
    const b = values[i] ?? '';
    if (String(a) !== String(b)) changed[LABEL[key]] = [a, b];
  });
  return changed;
}

export default async function handler(req, res) {
  if (req.method === 'GET') {
    const user = await requireUser(req, res, 'viewer');
    if (!user) return;

    const { rows } = await query(
      `SELECT k, ${COLS.join(', ')}, created_by, created_at, updated_by, updated_at
         FROM entries
        WHERE deleted_at IS NULL
        ORDER BY deploy_date DESC NULLS LAST, doc_id DESC`
    );
    return res.status(200).json({ entries: rows.map(toClient) });
  }

  if (!sameOrigin(req)) {
    return res.status(403).json({ error: '허용되지 않은 요청 출처입니다.' });
  }

  if (req.method === 'POST') {
    const user = await requireUser(req, res, 'member');
    if (!user) return;

    const body = req.body ?? {};
    const k = String(body.k ?? '').trim();
    if (!k) return res.status(400).json({ error: '행 식별자(k)가 없습니다.' });

    /* 화면과 동일한 필수 항목을 서버에서도 확인합니다.
       화면 검증만 두면 API 를 직접 호출해 우회할 수 있습니다. */
    const missing = [
      ['date', '배포일'],
      ['type', '릴리즈 구분'],
      ['sys', '대상 시스템'],
      ['judge', '유형 판정자'],
    ]
      .filter(([key]) => !String(body[key] ?? '').trim())
      .map(([, label]) => label);
    if (missing.length) {
      return res.status(400).json({ error: `${missing.join(', ')}을(를) 입력하십시오.` });
    }

    const values = toRow(body);
    const before = await one(
      `SELECT ${COLS.join(', ')}, deleted_at FROM entries WHERE k = $1`,
      [k]
    );
    if (before?.deleted_at) {
      return res.status(409).json({ error: '삭제 표시된 건입니다. 관리자에게 문의하십시오.' });
    }

    const setList = COLS.map((c, i) => `${c} = $${i + 2}`).join(', ');
    const insertCols = COLS.map((_, i) => `$${i + 2}`).join(', ');

    const { rows } = await query(
      `INSERT INTO entries (k, ${COLS.join(', ')}, created_by, created_at)
            VALUES ($1, ${insertCols}, $${COLS.length + 2}, now())
       ON CONFLICT (k) DO UPDATE
              SET ${setList},
                  updated_by = $${COLS.length + 2},
                  updated_at = now()
         RETURNING k, ${COLS.join(', ')}, created_by, created_at, updated_by, updated_at`,
      [k, ...values, user.name]
    );

    await audit(
      user,
      before ? 'entry.update' : 'entry.create',
      k,
      before ? diff(before, values) : { 등록: ['', body.id || k] },
      body.id || null
    );

    return res.status(200).json({ entry: toClient(rows[0]) });
  }

  if (req.method === 'DELETE') {
    /* 대장에서 건을 빼는 것은 모집단을 바꾸는 행위이므로 admin 만 할 수 있습니다.
       행 자체는 남기고 삭제 표시만 합니다. */
    const user = await requireUser(req, res, 'admin');
    if (!user) return;

    const k = String(req.query?.k ?? '').trim();
    if (!k) return res.status(400).json({ error: '행 식별자(k)가 없습니다.' });

    const row = await one(
      `UPDATE entries SET deleted_by = $2, deleted_at = now()
        WHERE k = $1 AND deleted_at IS NULL
    RETURNING k, doc_id`,
      [k, user.name]
    );
    if (!row) return res.status(404).json({ error: '해당 건을 찾을 수 없습니다.' });

    await audit(user, 'entry.delete', k, null, row.doc_id);
    return res.status(200).json({ ok: true });
  }

  res.setHeader('Allow', 'GET, POST, DELETE');
  return res.status(405).json({ error: '지원하지 않는 메서드입니다.' });
}
