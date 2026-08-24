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
import { COLS, toRow, toClient, diff } from '../lib/entry.js';

/* 증적 문서 ID 유니크 인덱스 위반 */
const UNIQUE_VIOLATION = '23505';

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
      `SELECT ${COLS.join(', ')}, deleted_at, updated_at FROM entries WHERE k = $1`,
      [k]
    );
    if (before?.deleted_at) {
      return res.status(409).json({ error: '삭제 표시된 건입니다. 관리자에게 문의하십시오.' });
    }

    /**
     * 동시 수정 방지
     *
     * 화면이 불러온 시점의 최종 수정 시각을 함께 보내고, 그 사이에 다른
     * 담당자가 저장했으면 거부합니다. 그러지 않으면 나중에 누른 쪽이 앞선
     * 변경을 조용히 덮어써, 이력에는 남지만 값은 사라집니다.
     *
     * 신규 등록(before 없음)에는 적용하지 않습니다.
     */
    if (before) {
      const seen = body.expectedUpdatedAt ?? null;
      const actual = before.updated_at ? new Date(before.updated_at).toISOString() : null;
      const sent = seen ? new Date(seen).toISOString() : null;
      if (sent !== actual) {
        return res.status(409).json({
          error: '다른 담당자가 먼저 이 건을 수정했습니다. 화면을 새로고침해 최신 내용을 확인한 뒤 다시 저장하십시오.',
          conflict: true,
        });
      }
    }

    const setList = COLS.map((c, i) => `${c} = $${i + 2}`).join(', ');
    const insertCols = COLS.map((_, i) => `$${i + 2}`).join(', ');

    let rows;
    try {
      ({ rows } = await query(
        `INSERT INTO entries (k, ${COLS.join(', ')}, created_by, created_at)
              VALUES ($1, ${insertCols}, $${COLS.length + 2}, now())
         ON CONFLICT (k) DO UPDATE
                SET ${setList},
                    updated_by = $${COLS.length + 2},
                    updated_at = now()
           RETURNING k, ${COLS.join(', ')}, created_by, created_at, updated_by, updated_at`,
        [k, ...values, user.name]
      ));
    } catch (e) {
      /* 증적 문서 ID 중복. 화면이 일련번호를 자기 목록에서 계산하므로,
         두 담당자가 동시에 등록하면 같은 값이 만들어질 수 있습니다. */
      if (e.code === UNIQUE_VIOLATION) {
        return res.status(409).json({
          error: `증적 문서 ID ${body.id} 는 이미 사용 중입니다. 화면을 새로고침한 뒤 다시 부여하십시오.`,
        });
      }
      throw e;
    }

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
