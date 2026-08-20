/**
 * lib/judge.js 검증
 *
 *   node scripts/test-judge.mjs
 *
 * 판정 규칙과 점검 집계는 통제 결과를 결정하는 부분입니다. DB 나 로그인이
 * 없어도 확인할 수 있어야 하므로 순수 함수만 검사합니다.
 */
import { deadline, judge, computeSummary, missingFixes, CHECK_DEFS } from '../lib/judge.js';

let pass = 0;
const fails = [];

function eq(actual, expected, label) {
  const a = JSON.stringify(actual);
  const b = JSON.stringify(expected);
  if (a === b) pass++;
  else fails.push(`${label}\n      기대 ${b}\n      실제 ${a}`);
}

/* ── 등록 기한 ── */
// 2026-08-14 는 금요일. 수시 +3영업일 → 화요일 08-19, 핫픽스 +2영업일 → 월요일 08-18
eq(deadline({ date: '2026-08-14', type: '정규' }), '2026-08-14', '정규는 배포일이 기한');
eq(deadline({ date: '2026-08-14', type: '수시' }), '2026-08-19', '수시 +3영업일 (주말 제외)');
eq(deadline({ date: '2026-08-14', type: '핫픽스' }), '2026-08-18', '핫픽스 +2영업일 (주말 제외)');
eq(deadline({ date: '', type: '수시' }), null, '배포일 없으면 기한 없음');
eq(deadline({ date: '2026-08-14', type: '' }), null, '유형 없으면 기한 없음');
// 월요일 기준: 2026-08-17(월) 수시 → 08-20(목)
eq(deadline({ date: '2026-08-17', type: '수시' }), '2026-08-20', '주중 시작은 주말 건너뛰지 않음');

/* ── 기한 준수 ── */
const base = { date: '2026-08-14', type: '수시', id: 'QA-A-20260814-01' };
eq(judge({ ...base, reg: '2026-08-19' }).term, 'ok', '기한일 등록은 준수');
eq(judge({ ...base, reg: '2026-08-20' }).term, 'bad', '기한 다음날 등록은 미준수');
eq(judge({ ...base, reg: '' }).term, null, '등록일 없으면 미판정');

/* ── 직무 분리 ── */
eq(judge({ ...base, dev: '이개발', qa: '박검증' }).sod, 'ok', '작성자와 검증자가 다르면 정상');
eq(judge({ ...base, dev: '이개발', qa: '이개발' }).sod, 'bad', '동일인이면 비정상');
eq(judge({ ...base, dev: ' 이개발 ', qa: '이개발' }).sod, 'bad', '공백 차이는 같은 사람으로 봄');
eq(judge({ ...base, dev: '이개발', qa: '' }).sod, null, '한쪽이 비면 미판정');

/* ── 승인 기록 ── */
eq(judge({ ...base, appr: '최승인', apprd: '2026-08-14' }).appr, 'ok', '승인자+승인일 완비');
eq(judge({ ...base, appr: '최승인', apprd: '' }).appr, 'bad', '승인일 누락은 미완비');
eq(judge({ ...base, appr: '', apprd: '2026-08-14' }).appr, 'bad', '승인자 누락은 미완비');

/* ── 증적 매핑 ── */
eq(judge({ ...base }).map, 'ok', 'ID 있으면 매핑완료');
eq(judge({ ...base, id: '' }).map, 'bad', 'ID 없으면 매핑미완료');
eq(judge({ ...base, id: '', state: '해당없음' }).map, 'na', '해당없음은 매핑 대상 아님');

/* ── 정합성 확인 (PD-02) ── */
eq(judge({ ...base, schema: '해당', int: '완료', intby: '정합담당' }).integ, 'ok', '해당+완료+검증자');
eq(judge({ ...base, schema: '해당', int: '완료', intby: '' }).integ, 'bad', '검증자 공란은 비정상');
eq(judge({ ...base, schema: '해당', int: '부적합', intby: '정합담당' }).integ, 'bad', '부적합은 비정상');
eq(judge({ ...base, schema: '없음', int: '' }).integ, 'na', '없음+공란은 미해당');
eq(judge({ ...base, schema: '없음', int: '완료' }).integ, 'bad', '없음인데 값이 있으면 기재 오류');
eq(judge({ ...base, schema: '' }).integ, null, '스키마 항목 미입력은 미판정');

/* ── ID 정합성 ── */
eq(judge({ date: '2026-08-14', type: '수시', id: 'QA-A-20260814-01' }).idc, 'ok', 'ID 일치');
eq(judge({ date: '2026-08-14', type: '정규', id: 'QA-A-20260814-01' }).idc, 'bad', '유형코드 불일치');
eq(judge({ date: '2026-08-13', type: '수시', id: 'QA-A-20260814-01' }).idc, 'bad', '날짜부 불일치');
eq(judge({ date: '2026-08-14', type: '수시', id: '' }).idc, null, 'ID 없으면 미판정');

/* ── 종합 판정 ── */
const clean = {
  date: '2026-08-14', type: '수시', id: 'QA-A-20260814-01', judge: '김판정',
  dev: '이개발', qa: '박검증', appr: '최승인', apprd: '2026-08-14',
  schema: '없음', int: '', intby: '', reg: '2026-08-19', state: '등록완료',
};
eq(judge(clean).flag, false, '이상 없는 건은 확인필요 아님');
eq(judge(clean).overall, '정상', '이상 없는 건의 종합 판정은 정상');
eq(judge({ ...clean, apprd: '' }).overall, '확인필요', '한 항목만 이상이어도 확인필요');
eq(judge({ ...clean, date: '' }).overall, null, '배포일 없으면 종합 판정 없음');

/* ── 월간 점검 집계 ── */
/* 날짜를 바꿀 때 ID 와 등록일도 함께 맞춥니다. 그러지 않으면 검사하려는
   항목 외에 ID 정합성·기한 준수까지 같이 어긋나 집계가 섞입니다. */
function mk(date, over = {}) {
  return {
    ...clean,
    date,
    id: `QA-A-${date.replaceAll('-', '')}-01`,
    reg: date, // 배포일 등록이면 어떤 유형이든 기한 이내
    ...over,
  };
}

const all = [
  mk('2026-08-14'),                             // 이상 없음
  mk('2026-08-20', { id: '' }),                 // 매핑 누락
  mk('2026-08-21', { appr: '' }),               // 승인 누락
  mk('2026-08-22', { qa: '이개발' }),            // 직무 분리 위반
  mk('2026-08-24', { schema: '해당', int: '미실시' }), // 정합성 미이행
  mk('2026-08-25', { reg: '2026-09-30' }),      // 기한 초과
  mk('2026-08-26', { judge: '' }),              // 판정자 미기재
  mk('2026-08-27', { int: '완료' }),             // 입력 오류 (없음 + 값)
  mk('2026-07-01', { state: '보완필요' }),       // 기간 밖 · 보완필요
  mk('2026-08-28', { state: '예외승인' }),       // 확인 항목
  mk('2026-08-31', { qav: '실패(반려)' }),       // 확인 항목
];

const s = computeSummary(all, '2026-08-01', '2026-08-31');
const n = (key) => s.items.find((i) => i.key === key).n;

eq(s.ledgerCount, 10, '기간 내 건수는 10건 (7월 건 제외)');
eq(n('map'), 1, '매핑 누락 1건');
eq(n('appr'), 1, '승인 기록 누락 1건');
eq(n('sod'), 1, '직무 분리 위반 1건');
eq(n('integ'), 1, '정합성 미이행 1건');
eq(n('term'), 1, '기한 초과 1건');
eq(n('judge'), 1, '판정자 미기재 1건');
eq(n('inputerr'), 1, '입력 오류 1건');
eq(n('idc'), 0, 'ID 정합성 불일치 0건');
eq(n('hold'), 1, '보완필요는 기간 밖도 집계 (전체 누적)');
eq(n('exc'), 1, '예외 승인 1건');
eq(n('fail'), 1, '실패(반려) 1건');
eq(n('cond'), 0, '조건부 통과 0건');
eq(s.defects, 8, '지적 항목 8종');

/* 정합성 미이행 건은 입력 오류로 중복 집계되지 않아야 합니다. */
const onlyInputErr = computeSummary(
  [{ ...clean, int: '완료', date: '2026-08-27' }], '2026-08-01', '2026-08-31');
eq(onlyInputErr.items.find((i) => i.key === 'integ').n, 0,
  '스키마 없음 + 값 있음은 정합성 지적이 아니라 입력 오류로만 집계');
eq(onlyInputErr.items.find((i) => i.key === 'inputerr').n, 1, '입력 오류로 집계');

/* 지적 없는 기간 */
const cleanPeriod = computeSummary([clean], '2026-08-01', '2026-08-31');
eq(cleanPeriod.defects, 0, '이상 없는 기간은 지적 0건');
eq(cleanPeriod.flagged, 0, '확인필요 0건');
eq(missingFixes(cleanPeriod), [], '지적이 없으면 조치 내용도 필요 없음');

/* 조치 내용 누락 검사 */
const withFix = computeSummary(all, '2026-08-01', '2026-08-31', { map: '누락 건 ID 부여 완료' });
eq(missingFixes(withFix).includes('증적 매핑 누락'), false, '조치 내용을 넣은 항목은 제외');
eq(missingFixes(withFix).length, 7, '나머지 지적 항목 7종은 조치 내용 필요');

/* 빈 대장 */
const empty = computeSummary([], '2026-08-01', '2026-08-31');
eq(empty.ledgerCount, 0, '빈 대장은 0건');
eq(empty.defects, 0, '빈 대장은 지적 없음');
eq(empty.items.length, CHECK_DEFS.length, '항목 수는 정의와 동일');

/* ── 결과 ── */
if (fails.length) {
  console.error(`판정 검증 실패 — ${pass}건 통과, ${fails.length}건 실패\n`);
  fails.forEach((f) => console.error(`  - ${f}`));
  process.exit(1);
}
console.log(`판정 검증 통과 · ${pass}건`);
