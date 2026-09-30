/**
 * 배포 건 필드 정의
 *
 * 화면 필드 ↔ 컬럼 대응을 한 곳에 둡니다. api/entries.js 와 api/checks.js 가
 * 같은 정의를 써야 하는데, 각자 들고 있으면 항목을 추가할 때 한쪽이 빠집니다.
 *
 * 라벨은 변경 이력을 사람이 읽을 수 있게 하기 위한 것입니다.
 */
import { normalizeDocIds, splitDocIds } from './judge.js';

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

  /* ── QA 완료 보고서 V2 대응 항목 ──
     보고서 「문서 정보」·「1. 요약」에 있는 값을 대장에도 두어, 두 문서를
     항목 단위로 대조할 수 있게 합니다. 대장에 없는 값은 보고서를 열어보지
     않으면 확인할 수 없어, 점검이 표본 추출에 의존하게 됩니다.

     새 항목은 뒤에 붙입니다. 앞에 끼워 넣으면 Google Sheet 의 열 위치가
     밀려 양식의 수식과 서식이 어긋납니다. */
  ['rel', 'release_name', '릴리즈명'],
  ['plan', 'planned_on', '릴리즈 계획일'],
  ['vdate', 'verified_on', '검증 완료일'],
  ['qajudge', 'qa_judged_by', 'QA 판정자'],
  ['qajd', 'qa_judged_on', 'QA 판정일'],
  ['req', 'req_match', '요구사항 일치'],
  ['reqby', 'req_checked_by', '요구사항 확인자'],
  ['holdc', 'hold_critical', '보류 이슈(즉시·긴급)'],
  ['holdh', 'hold_high', '보류 이슈(높음)'],

  /* ── 배포 수행 · 승인 근거 ──
     운영 배포를 인프라와 개발이 함께 담당하므로, 누가 반영했는지와 승인의
     원본(릴리즈 결재 · PR)을 대장에서 바로 찾아갈 수 있어야 합니다. */
  ['deployer', 'deployed_by', '배포 수행자'],
  ['apprref', 'approval_ref', '배포 승인 근거'],
];

export const COLS = FIELDS.map(([, col]) => col);
export const FIELD_LABEL = Object.fromEntries(FIELDS.map(([key, , label]) => [key, label]));

/** 화면 → DB. 빈 문자열은 NULL 로 저장해 "미입력"을 한 가지 값으로 통일합니다. */
export function toRow(body) {
  return FIELDS.map(([key]) => {
    const v = body[key];
    if (v === undefined || v === null || String(v).trim() === '') return null;
    /* 여러 ID 는 구분자를 하나로 맞춰 저장합니다. 같은 목록이 다른 문자열로
       저장되면 중복 검사와 변경 이력 비교가 어긋납니다. */
    if (key === 'id') return normalizeDocIds(v) || null;
    return String(v).trim();
  });
}

/** DB → 화면. 화면 로직이 문자열을 전제하므로 NULL 은 빈 문자열로 돌려줍니다. */
export function toClient(row) {
  const out = { k: row.k };
  FIELDS.forEach(([key, col]) => {
    /* 보류 건수(INTEGER)는 숫자로 오므로 문자열로 맞춥니다. 숫자 0 은 화면의
       `값||''` 처리에서 공란이 되어, 다시 저장하면 0 이 공란으로 바뀝니다. */
    out[key] = row[col] === null || row[col] === undefined ? '' : String(row[col]);
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
  /* 보고서 V2 의 표기는 「실패」입니다. 「실패(반려)」는 이전 표기로,
     이미 저장된 값이 형식 위반이 되지 않도록 받아만 둡니다. */
  qav: ['통과', '조건부 통과', '실패', '실패(반려)'],
  req: ['일치', '일치(범위 조정)', '불일치'],
  schema: ['해당', '없음'],
  int: ['완료', '부적합', '미실시'],
  state: ['작성중', '등록완료', '보완필요', '예외승인', '해당없음'],
};

/** 화면 드롭다운에 내보내는 값. 이전 표기는 고르지 못하게 합니다. */
export const QA_VERDICT = ['통과', '조건부 통과', '실패'];

/** 이전 표기를 현재 표기로 맞춥니다. 집계·비교는 항상 이 값으로 합니다. */
export function normVerdict(v) {
  return String(v ?? '').trim() === '실패(반려)' ? '실패' : String(v ?? '').trim();
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const COUNT_RE = /^\d{1,4}$/;

/** 날짜로 다루는 항목 */
export const DATE_FIELDS = ['date', 'apprd', 'reg', 'plan', 'vdate', 'qajd'];

/** 건수로 다루는 항목 */
export const COUNT_FIELDS = ['holdc', 'holdh'];

/**
 * 반입 대상 검증
 *
 * 저장 규칙과 같은 기준입니다. 문제가 있으면 사유를 돌려주어, 적용 전에
 * 어떤 행이 왜 제외되는지 사람이 볼 수 있게 합니다.
 */
export function validateEntry(e) {
  const bad = [];

  if (!e.id) bad.push('증적 문서 ID 없음');
  else {
    const ids = splitDocIds(e.id);
    if (new Set(ids).size !== ids.length) bad.push('같은 증적 문서 ID 가 두 번 적혀 있음');
  }
  [['date', '배포일'], ['type', '릴리즈 구분'], ['sys', '대상 시스템'], ['judge', '유형 판정자']]
    .forEach(([k, label]) => { if (!e[k]) bad.push(`${label} 없음`); });

  DATE_FIELDS.forEach((k) => {
    if (e[k] && !DATE_RE.test(e[k])) bad.push(`${FIELD_LABEL[k]} 형식 오류 (${e[k]})`);
  });

  COUNT_FIELDS.forEach((k) => {
    if (e[k] && !COUNT_RE.test(String(e[k]).trim())) {
      bad.push(`${FIELD_LABEL[k]} 는 0 이상의 정수여야 합니다 (${e[k]})`);
    }
  });

  Object.entries(ENUMS).forEach(([k, allowed]) => {
    if (e[k] && !allowed.includes(e[k])) bad.push(`${FIELD_LABEL[k]} 값 오류 (${e[k]})`);
  });

  return bad;
}

/**
 * 증적 문서 ID 겹침 검사
 *
 * 한 건에 ID 를 여러 개 적을 수 있으므로, DB 의 유일 제약(문자열 전체 기준)만으로는
 * 「A, B」와 「B, C」가 둘 다 저장됩니다. 보고서 하나가 두 배포 건에 걸리면
 * 모집단과 증적의 1:1 대응이 깨지므로 ID 단위로 막습니다.
 *
 * others: [{ k, doc_id }] — 비교 대상 건 (자기 자신은 빼고 넘깁니다)
 * 돌려주는 값: 겹치는 첫 건 { id, k, docId } 또는 null
 */
export function findIdOverlap(others, ids) {
  const want = new Set(ids);
  for (const o of others) {
    const hit = splitDocIds(o.doc_id ?? o.id).find((x) => want.has(x));
    if (hit) return { id: hit, k: o.k, docId: o.doc_id ?? o.id };
  }
  return null;
}
