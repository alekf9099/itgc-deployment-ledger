/**
 * 엑셀 양식 레이아웃
 *
 * 대상 Google Sheet 는 「QA-LG-001 QA 검증 이력 대장」 양식을 Google Sheets 로
 * 변환한 사본입니다. 시트를 새로 만들지 않고 **데이터 범위만 덮어씁니다.**
 * 그래야 양식의 색상·테두리·열 너비·수식이 보존됩니다.
 *
 * 「작성기준」 시트는 고정 문구이므로 건드리지 않습니다.
 *
 * 이 파일은 값만 만듭니다. 전송은 api/sheet.js 가 담당합니다.
 */
import { judge, deadline, VERDICT_LABEL, CHECK_DEFS } from './judge.js';

export const LEDGER_SHEET = '배포관리대장';
export const CHECK_SHEET = '월간점검';

/** 양식의 헤더는 5행, 데이터는 6행부터입니다. */
export const LEDGER_HEADER_ROW = 5;
export const LEDGER_FIRST_ROW = 6;

/** 양식 A5:AB5 와 정확히 같아야 합니다. 다르면 대상 시트가 잘못된 것입니다. */
export const LEDGER_HEADER = [
  'No', '증적 문서 ID', '배포일', '릴리즈 구분', '유형 판정자', '대상 시스템',
  '일감 / 릴리즈 식별자', '변경 작성자', '검증 수행자', 'QA 판정', '배포 승인자',
  '배포 승인일', '스키마 · 데이터 변경', '정합성 검증', '정합성 검증자',
  '증적 등록일', '증적 등록 경로', '증적 상태', '등록 기한', '기한 준수',
  '직무 분리', '승인 기록', '증적 매핑', '정합성 확인', 'ID 정합성', '종합 판정',
  '예외 승인자', '비고',
];

/** 양식에서 값을 채울 위치. 행 번호는 양식 구조에 묶여 있습니다. */
const CHECK_CELLS = {
  performedOn: 'B10',
  performedBy: 'B11',
  periodFrom: 'B12',
  periodTo: 'C12',
  popCount: 'B18',
  popMatch: 'C18',
  popNote: 'D18',
  ledgerCount: 'B19',
  defectFirstRow: 25,   // 지적 항목 9종: 25~33행 (건수 C, 조치 내용 E)
  observeFirstRow: 35,  // 확인 항목 3종: 35~37행 (건수 C)
  sample: 'A42',
  summaryLedger: 'B49',
  summaryFlagged: 'B50',
  summaryDefects: 'B51',
  summaryResult: 'B52',
  opinion: 'A55',
  signBy: 'B59',
  signDate: 'C59',
  signApprover: 'B60',
  histFirstRow: 66,
};

/* 판정값을 문구로 바꿉니다. 미판정은 공란입니다. */
const label = (v, key) => (v[key] ? VERDICT_LABEL[key][v[key]] ?? '' : '');

/**
 * 대장 시트 데이터.
 *
 * No 는 배포일 오름차순으로 부여합니다. 양식이 "배포일 순으로 부여한다"로
 * 정하고 있어, 화면의 최신순 정렬과는 순서가 반대입니다.
 */
export function buildLedgerRows(entries) {
  const sorted = [...entries].sort(
    (a, b) => String(a.date).localeCompare(String(b.date)) ||
              String(a.id).localeCompare(String(b.id))
  );

  return sorted.map((r, i) => {
    const v = judge(r);
    return [
      i + 1,
      r.id, r.date, r.type, r.judge, r.sys, r.task, r.dev, r.qa, r.qav,
      r.appr, r.apprd, r.schema, r.int, r.intby, r.reg, r.path, r.state,
      deadline(r) ?? '',
      label(v, 'term'), label(v, 'sod'), label(v, 'appr'),
      label(v, 'map'), label(v, 'integ'), label(v, 'idc'),
      v.overall ?? '',
      r.exc, r.memo,
    ].map((c) => (c === null || c === undefined ? '' : c));
  });
}

/** A1 표기의 열 문자 (1 → A, 28 → AB) */
export function colName(n) {
  let s = '';
  while (n > 0) {
    const rem = (n - 1) % 26;
    s = String.fromCharCode(65 + rem) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

const LAST_COL = colName(LEDGER_HEADER.length);

/** 대장 데이터를 쓸 범위와 값 */
export function ledgerUpdate(rows) {
  const end = LEDGER_FIRST_ROW + Math.max(rows.length, 1) - 1;
  return {
    range: `'${LEDGER_SHEET}'!A${LEDGER_FIRST_ROW}:${LAST_COL}${end}`,
    values: rows.length ? rows : [Array(LEDGER_HEADER.length).fill('')],
  };
}

/**
 * 이전에 쓴 데이터가 남지 않도록 아래쪽을 비웁니다.
 * 값만 지우며 서식은 그대로 둡니다.
 */
export function ledgerClearRange(rowCount, until = 1000) {
  const from = LEDGER_FIRST_ROW + rowCount;
  if (from > until) return null;
  return `'${LEDGER_SHEET}'!A${from}:${LAST_COL}${until}`;
}

/**
 * 월간 점검 시트 갱신값.
 *
 * check 는 저장된 점검 이력 한 건입니다(가장 최근 건). 이력이 없으면
 * 빈 배열을 돌려주어 시트를 건드리지 않습니다.
 */
export function checkUpdates(check, history = []) {
  if (!check) return [];

  const cell = (ref, value) => ({
    range: `'${CHECK_SHEET}'!${ref}`,
    values: [[value === null || value === undefined ? '' : value]],
  });

  const out = [
    cell(CHECK_CELLS.performedOn, check.date),
    cell(CHECK_CELLS.performedBy, check.by),
    cell(CHECK_CELLS.periodFrom, check.from),
    cell(CHECK_CELLS.periodTo, check.to),
    cell(CHECK_CELLS.popCount, check.popCount),
    cell(CHECK_CELLS.ledgerCount, check.ledCount),
    cell(CHECK_CELLS.popNote, check.popNote),
    cell(CHECK_CELLS.sample, check.sample),
    cell(CHECK_CELLS.summaryLedger, check.ledCount),
    cell(CHECK_CELLS.summaryFlagged, check.flagged),
    cell(CHECK_CELLS.summaryDefects, check.defects),
    cell(CHECK_CELLS.summaryResult, check.defects ? '보완 필요' : '적정 (지적사항 없음)'),
    cell(CHECK_CELLS.opinion, check.opinion),
    cell(CHECK_CELLS.signBy, check.by),
    cell(CHECK_CELLS.signDate, check.date),
    cell(CHECK_CELLS.signApprover, check.app),
  ];

  /* 모집단 대조 결과 */
  const pop = check.popCount === '' || check.popCount === null ? null : Number(check.popCount);
  out.push(cell(
    CHECK_CELLS.popMatch,
    pop === null ? '미입력'
      : pop === Number(check.ledCount) ? '일치'
      : `불일치 (차이 ${Math.abs(pop - Number(check.ledCount))}건)`
  ));

  /* 점검 항목별 건수와 조치 내용. 저장된 items 순서는 CHECK_DEFS 와 같습니다. */
  const byKey = Object.fromEntries((check.items ?? []).map((it) => [it.key, it]));
  const defects = CHECK_DEFS.filter((d) => d.isDef);
  const observes = CHECK_DEFS.filter((d) => !d.isDef && d.key !== '__split__');

  defects.forEach((d, i) => {
    const row = CHECK_CELLS.defectFirstRow + i;
    const it = byKey[d.key];
    out.push(cell(`C${row}`, it ? it.n : 0));
    out.push(cell(`E${row}`, it ? it.fix ?? '' : ''));
  });
  observes.forEach((d, i) => {
    const row = CHECK_CELLS.observeFirstRow + i;
    out.push(cell(`C${row}`, byKey[d.key] ? byKey[d.key].n : 0));
  });

  /* 점검 이력 누적 (오래된 순) */
  const hist = [...history]
    .filter((h) => h.from && h.to)
    .sort((a, b) => String(a.from).localeCompare(String(b.from)));
  if (hist.length) {
    out.push({
      range: `'${CHECK_SHEET}'!A${CHECK_CELLS.histFirstRow}:D${CHECK_CELLS.histFirstRow + hist.length - 1}`,
      values: hist.map((h) => [`${h.from} ~ ${h.to}`, h.date, h.by, h.defects]),
    });
  }

  return out;
}

/* ══════════════ 반입 (시트 → 웹) ══════════════ */

/**
 * 시트 열 → 화면 필드
 *
 * 판정 열(S~Z)과 No 열(A)은 계산 결과이므로 가져오지 않습니다. 가져오면
 * 시트에서 판정을 고칠 수 있게 되어 통제가 무의미해집니다.
 */
export const IMPORT_MAP = [
  [1, 'id'], [2, 'date'], [3, 'type'], [4, 'judge'], [5, 'sys'], [6, 'task'],
  [7, 'dev'], [8, 'qa'], [9, 'qav'], [10, 'appr'], [11, 'apprd'],
  [12, 'schema'], [13, 'int'], [14, 'intby'], [15, 'reg'], [16, 'path'],
  [17, 'state'], [26, 'exc'], [27, 'memo'],
];

const DATE_FIELDS = new Set(['date', 'apprd', 'reg']);

/**
 * 시트의 날짜 일련값을 'YYYY-MM-DD' 로 바꿉니다.
 * Sheets 의 기준일은 1899-12-30 입니다.
 */
export function serialToDate(n) {
  const ms = Date.UTC(1899, 11, 30) + Math.round(Number(n)) * 86400000;
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return '';
  const p = (x) => String(x).padStart(2, '0');
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}`;
}

function cell(v, isDate) {
  if (v === null || v === undefined) return '';
  if (isDate) {
    if (typeof v === 'number') return serialToDate(v);
    const t = String(v).trim();
    /* 이미 문자열 날짜면 그대로 두고, 형식 검증은 validateEntry 가 합니다. */
    return t;
  }
  return String(v).trim();
}

/** 시트 한 행을 화면 필드 형태로 바꿉니다. 값이 하나도 없으면 null */
export function rowToEntry(row) {
  const out = {};
  let any = false;
  IMPORT_MAP.forEach(([i, key]) => {
    const v = cell(row?.[i], DATE_FIELDS.has(key));
    out[key] = v;
    if (v) any = true;
  });
  return any ? out : null;
}

/** 반입 대상 범위. 양식의 데이터 영역입니다. */
export function importRange(until = 1000) {
  return `'${LEDGER_SHEET}'!A${LEDGER_FIRST_ROW}:${LAST_COL}${until}`;
}
