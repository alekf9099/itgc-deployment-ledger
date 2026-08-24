/**
 * 시트 반입 매핑·검증 검증
 *
 *   node scripts/test-import.mjs
 *
 * 시트에서 들어오는 값은 자유 입력이므로, 어떤 열을 가져오고 무엇을 걸러내는지가
 * 대장의 신뢰성을 좌우합니다. 판정 열을 실수로 가져오게 되면 시트에서 판정을
 * 고칠 수 있게 되므로, 매핑을 검사로 고정합니다.
 */
import { IMPORT_MAP, rowToEntry, serialToDate, importRange } from '../lib/sheet.js';
import { validateEntry, FIELD_LABEL, ENUMS } from '../lib/entry.js';

let pass = 0;
const fails = [];
const eq = (a, b, label) => {
  const x = JSON.stringify(a), y = JSON.stringify(b);
  if (x === y) pass++;
  else fails.push(`${label}\n      기대 ${y}\n      실제 ${x}`);
};

/* ── 매핑 ── */
const keys = IMPORT_MAP.map(([, k]) => k);
eq(keys.includes('id'), true, '증적 문서 ID 를 가져옴');
eq(keys.includes('memo'), true, '비고를 가져옴');
eq(IMPORT_MAP.length, 19, '가져오는 항목은 19개');

/* 판정 열과 No 열은 계산 결과이므로 가져오지 않아야 합니다. */
const idx = IMPORT_MAP.map(([i]) => i);
eq(idx.includes(0), false, 'No 열(A)은 가져오지 않음');
[18, 19, 20, 21, 22, 23, 24, 25].forEach((i) => {
  eq(idx.includes(i), false, `판정 열(${String.fromCharCode(65 + i)})은 가져오지 않음`);
});

/* ── 날짜 변환 ── */
eq(serialToDate(46247), '2026-08-13', '일련값 46247 은 2026-08-13');
eq(serialToDate(1), '1899-12-31', '일련값 1');
eq(serialToDate(45292), '2024-01-01', '일련값 45292 는 2024-01-01');

/* ── 행 → 건 ── */
const row = [];
row[1] = 'QA-20260827-01'; row[2] = 46261; row[3] = '정규'; row[4] = '김판정';
row[5] = '카피킬러'; row[6] = 'COW #1'; row[7] = '이개발'; row[8] = '박검증';
row[9] = '통과'; row[10] = '최승인'; row[11] = 46261; row[12] = '없음';
row[15] = 46261; row[17] = '등록완료'; row[26] = ''; row[27] = '비고';
row[24] = '불일치'; row[25] = '확인필요';   // 판정 열 — 무시되어야 함

const e = rowToEntry(row);
eq(e.id, 'QA-20260827-01', 'ID 매핑');
eq(e.date, '2026-08-27', '배포일은 일련값에서 변환');
eq(e.apprd, '2026-08-27', '승인일도 변환');
eq(e.reg, '2026-08-27', '등록일도 변환');
eq(e.type, '정규', '릴리즈 구분');
eq(e.memo, '비고', '비고');
eq(e.int, '', '빈 칸은 빈 문자열');
eq('idc' in e, false, '판정 값은 결과에 들어오지 않음');
eq(Object.keys(e).length, 19, '결과 항목 수는 매핑과 동일');

eq(rowToEntry([]), null, '빈 행은 null');
eq(rowToEntry(['', '', '']), null, '값이 전부 비면 null');
eq(rowToEntry(undefined), null, '행이 없으면 null');

/* 문자열 날짜는 그대로 둡니다. 형식 검사는 validateEntry 가 합니다. */
const r2 = []; r2[1] = 'QA-20260827-01'; r2[2] = '2026-08-27';
eq(rowToEntry(r2).date, '2026-08-27', '문자열 날짜는 그대로');
const r3 = []; r3[1] = 'QA-20260827-01'; r3[2] = ' 2026-08-27 ';
eq(rowToEntry(r3).date, '2026-08-27', '앞뒤 공백 제거');

/* ── 검증 ── */
const ok = {
  id: 'QA-20260827-01', date: '2026-08-27', type: '정규', judge: '김판정',
  sys: '카피킬러', qav: '통과', schema: '없음', int: '', state: '등록완료',
  apprd: '2026-08-27', reg: '2026-08-27',
};
eq(validateEntry(ok), [], '정상 건은 통과');

eq(validateEntry({ ...ok, id: '' }), ['증적 문서 ID 없음'], 'ID 없으면 제외');
eq(validateEntry({ ...ok, date: '' }).includes('배포일 없음'), true, '배포일 필수');
eq(validateEntry({ ...ok, type: '' }).includes('릴리즈 구분 없음'), true, '릴리즈 구분 필수');
eq(validateEntry({ ...ok, sys: '' }).includes('대상 시스템 없음'), true, '대상 시스템 필수');
eq(validateEntry({ ...ok, judge: '' }).includes('유형 판정자 없음'), true, '유형 판정자 필수');

eq(validateEntry({ ...ok, date: '2026/08/27' }).some((m) => m.includes('형식 오류')), true,
  '날짜 형식이 다르면 제외');
eq(validateEntry({ ...ok, reg: '8/27' }).some((m) => m.includes('형식 오류')), true,
  '등록일 형식 오류');

eq(validateEntry({ ...ok, type: '긴급' }).some((m) => m.includes('값 오류')), true,
  '정의되지 않은 릴리즈 구분은 제외');
eq(validateEntry({ ...ok, qav: '보류' }).some((m) => m.includes('값 오류')), true,
  '정의되지 않은 QA 판정은 제외');
eq(validateEntry({ ...ok, state: '진행중' }).some((m) => m.includes('값 오류')), true,
  '정의되지 않은 증적 상태는 제외');
eq(validateEntry({ ...ok, schema: 'Y' }).some((m) => m.includes('값 오류')), true,
  '정의되지 않은 스키마 값은 제외');

/* 선택 항목이 비어 있는 것은 오류가 아닙니다. */
eq(validateEntry({ ...ok, qav: '', state: '', schema: '', apprd: '', reg: '' }), [],
  '선택 항목 공란은 허용');

/* 허용값 정의가 화면 선택지와 같아야 합니다. */
eq(ENUMS.type, ['정규', '수시', '핫픽스'], '릴리즈 구분 허용값');
eq(ENUMS.state.length, 5, '증적 상태 허용값 5종');
eq(FIELD_LABEL.date, '배포일', '라벨 확인');

/* ── 범위 ── */
eq(importRange(), `'배포관리대장'!A6:AB1000`, '반입 범위는 데이터 영역');
eq(importRange(20), `'배포관리대장'!A6:AB20`, '범위 상한 지정');

if (fails.length) {
  console.error(`시트 반입 검증 실패 — ${pass}건 통과, ${fails.length}건 실패\n`);
  fails.forEach((f) => console.error(`  - ${f}`));
  process.exit(1);
}
console.log(`시트 반입 검증 통과 · ${pass}건`);
