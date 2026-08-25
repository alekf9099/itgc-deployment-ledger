/**
 * 배포 건 필드 정의
 *
 * 화면 필드 ↔ 컬럼 대응을 한 곳에 둡니다. api/entries.js 와 api/checks.js 가
 * 같은 정의를 써야 하는데, 각자 들고 있으면 항목을 추가할 때 한쪽이 빠집니다.
 *
 * 라벨은 변경 이력을 사람이 읽을 수 있게 하기 위한 것입니다.
 */
export const FIELDS = [
  ['id', 'doc_id', '증적 문서 ID'],
  ['date', 'deploy_date', '배포일'],
  ['type', 'release_type', '릴리즈 구분'],
  ['judge', 'type_judge', '유형 판정자'],
  ['sys', 'target_system', '대상 시스템'],
  ['task', 'task', '일감/릴리즈 식별자'],
  ['dev', 'dev', '변경 작성자'],
  ['qa', 'qa', '검증 수행자'],
  ['qav', 'qa_verdict', 'QA 판정'],
  ['appr', 'approver', '배포 승인자'],
  ['apprd', 'approved_on', '배포 승인일'],
  ['schema', 'schema_change', '스키마·데이터 변경'],
  ['int', 'integrity', '정합성 검증'],
  ['intby', 'integrity_by', '정합성 검증자'],
  ['reg', 'registered_on', '증적 등록일'],
  ['path', 'registered_path', '증적 등록 경로'],
  ['state', 'state', '증적 상태'],
  ['exc', 'exception_by', '예외 승인자'],
  ['memo', 'memo', '비고'],
];

export const COLS = FIELDS.map(([, col]) => col);
export const FIELD_LABEL = Object.fromEntries(FIELDS.map(([key, , label]) => [key, label]));

/** 화면 → DB. 빈 문자열은 NULL 로 저장해 "미입력"을 한 가지 값으로 통일합니다. */
export function toRow(body) {
  return FIELDS.map(([key]) => {
    const v = body[key];
    return v === undefined || v === null || String(v).trim() === '' ? null : String(v).trim();
  });
}

/** DB → 화면. 화면 로직이 문자열을 전제하므로 NULL 은 빈 문자열로 돌려줍니다. */
export function toClient(row) {
  const out = { k: row.k };
  FIELDS.forEach(([key, col]) => {
    out[key] = row[col] ?? '';
  });
  if ('created_by' in row) {
    out._meta = {
      createdBy: row.created_by,
      createdAt: row.created_at,
      updatedBy: row.updated_by,
      updatedAt: row.updated_at,
    };
  }
  return out;
}

/** 변경된 항목만 { 라벨: [이전, 이후] } 형태로 추립니다. */
export function diff(before, values) {
  const changed = {};
  FIELDS.forEach(([key, col], i) => {
    const a = before[col] ?? '';
    const b = values[i] ?? '';
    if (String(a) !== String(b)) changed[FIELD_LABEL[key]] = [a, b];
  });
  return changed;
}

/**
 * 선택 항목의 허용값
 *
 * 화면은 드롭다운이라 다른 값이 들어올 수 없지만, 시트에서 가져오는 값은
 * 자유 입력이므로 여기서 걸러야 합니다.
 */
export const ENUMS = {
  type: ['정규', '수시', '핫픽스'],
  qav: ['통과', '조건부 통과', '실패(반려)'],
  schema: ['해당', '없음'],
  int: ['완료', '부적합', '미실시'],
  state: ['작성중', '등록완료', '보완필요', '예외승인', '해당없음'],
};

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * 반입 대상 검증
 *
 * 저장 규칙과 같은 기준입니다. 문제가 있으면 사유를 돌려주어, 적용 전에
 * 어떤 행이 왜 제외되는지 사람이 볼 수 있게 합니다.
 */
export function validateEntry(e) {
  const bad = [];

  if (!e.id) bad.push('증적 문서 ID 없음');
  [['date', '배포일'], ['type', '릴리즈 구분'], ['sys', '대상 시스템'], ['judge', '유형 판정자']]
    .forEach(([k, label]) => { if (!e[k]) bad.push(`${label} 없음`); });

  ['date', 'apprd', 'reg'].forEach((k) => {
    if (e[k] && !DATE_RE.test(e[k])) bad.push(`${FIELD_LABEL[k]} 형식 오류 (${e[k]})`);
  });

  Object.entries(ENUMS).forEach(([k, allowed]) => {
    if (e[k] && !allowed.includes(e[k])) bad.push(`${FIELD_LABEL[k]} 값 오류 (${e[k]})`);
  });

  return bad;
}
