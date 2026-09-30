/**
 * 월간 점검 반출본 검증
 *
 * 반출본은 감사인에게 넘기는 산출물이라 행 구성이 바뀌면 안 됩니다.
 *   node scripts/test-check-export.mjs
 */
import { checkRows } from '../lib/check-export.js';
import { computeSummary, storedItems } from '../lib/judge.js';
import { toCsv } from '../lib/csv.js';

let pass = 0;
const fails = [];
const eq = (a, b, label) => {
  const x = JSON.stringify(a), y = JSON.stringify(b);
  if (x === y) pass++;
  else fails.push(`${label}\n      기대 ${y}\n      실제 ${x}`);
};

const clean = {
  type: '수시', judge: '김판정', dev: '이개발', qa: '박검증', appr: '최승인',
  schema: '없음', int: '', intby: '', state: '등록완료', qav: '통과', qajudge: '박검증',
  req: '일치', reqby: '김동완', holdc: '', holdh: '', memo: '',
};
const mk = (date, id, over = {}) => ({ ...clean, date, vdate: date, qajd: date, apprd: date, reg: date, id, ...over });
const ledger = [
  mk('2026-08-14', 'QA-20260814-01'),
  mk('2026-08-20', 'QA-20260820-01', { qa: '이개발' }),                          // 직무 분리 위반
  mk('2026-08-21', 'QA-20260820-02, QA-20260821-01', { qa: '이개발, 최우석' }),  // 여러 ID · 직무 분리 위반
  mk('2026-08-22', '', { appr: '' }),                                            // 매핑 누락 · 승인 누락
];
const s = computeSummary(ledger, '2026-08-01', '2026-08-31', {
  sod: '검증자 재지정', map: 'ID 부여', appr: '승인 기록 보완',
});

/* 확정 기록 형태 (DB 행) */
const rec = {
  id: 'h1', period_from: '2026-08-01', period_to: '2026-08-31', performed_on: '2026-09-02',
  performed_by: '김홍현', approved_by: '최우석', pop_count: 4, ledger_count: s.ledgerCount,
  pop_note: '', sample: '표본 1건', opinion: '조치 요청', flagged: s.flagged, defects: s.defects,
  items: storedItems(s.items), created_by: '김홍현', created_at: '2026-09-02T01:05:00Z',
};
const rows = checkRows(rec);
const find = (label) => rows.find((r) => r[0] === label || r[1] === label);

/* 구분선이 점검 항목으로 나오지 않음 */
eq(storedItems(s.items).some((it) => it.key === '__split__'), false, '저장 항목에 화면 구분선 없음');
eq(rows.filter((r) => (r[0] === '지적 항목' || r[0] === '확인 항목') && !r[1]).length, 0, '이름 없는 점검 항목 행 없음');

/* 이전 기록(구분선 포함, refs 없음)도 같은 형태로 */
const legacy = checkRows({ ...rec, items: s.items.map(({ refs, ...it }) => it) });
eq(legacy.filter((r) => (r[0] === '지적 항목' || r[0] === '확인 항목') && !r[1]).length, 0, '구분선이 저장된 이전 기록도 걸러냄');
eq(legacy.find((r) => r[1] === '직무 분리 위반')[4], '(확정 당시 미기록)', '해당 건 기록이 없는 이전 기록은 그 사실을 표시');

/* 머리글과 해당 건 */
eq(find('구분')?.length && rows.find((r) => r[4] === '해당 건 (증적 문서 ID)') ? true : false, true, '항목 표에 「해당 건」 열');
const sod = find('직무 분리 위반');
eq(sod[3], 2, '직무 분리 위반 2건 (여러 명 중 한 명 겹침 포함)');
eq(sod[4], 'QA-20260820-01\nQA-20260820-02 / QA-20260821-01', '해당 건: 건마다 한 줄, 한 건의 여러 ID 는 「/」');
eq(sod[6], '검증자 재지정', '조치 내용');
eq(find('증적 매핑 누락')[4], 'ID 없음 (배포일 2026-08-22)', 'ID 가 없는 건은 배포일로 표시');
eq(find('기한 준수')?.[4] ?? find('증적 등록 기한 초과')[4], '', '0건 항목의 해당 건은 공란');

/* 확정 계정 · 일시 · 기록 구분 */
eq(find('확정 계정 (시스템 기록)')[1], '김홍현', '확정 계정');
eq(find('확정 일시 (시스템 기록)')[1], '2026-09-02 10:05 (KST)', '확정 일시는 KST');
eq(find('기록 구분')[1], '최초 확정본', '최초 확정본 표시');
eq(checkRows(rec, 1).find((r) => r[0] === '기록 구분')[1].startsWith('재확정본'), true, '재확정본 표시');
eq(find('점검 기록 식별자')[1], 'h1', '점검 기록 식별자');

/* 확인자 일자는 임의로 채우지 않음 */
eq(rows.find((r) => r[0] === '확인자 (QA유닛 책임자)')[2], '(서명 · 일자 직접 기재)', '확인자 일자는 서명란');

/* 모집단 */
eq(find('일치 여부')[1], '일치', '배포 이력 4건 = 대장 4건');
eq(find('대장 기재 건수 (배포 건 기준)')[1], 4, '대장 건수는 배포 건 기준');

/* CSV 로 바꿔도 줄바꿈 셀이 한 셀로 유지 */
const csv = toCsv(rows);
eq(csv.startsWith('﻿'), true, 'BOM (Excel 한글)');
eq(csv.includes('"QA-20260820-01\nQA-20260820-02 / QA-20260821-01"'), true, '여러 줄 셀은 따옴표로 감싸 한 셀로');

if (fails.length) {
  console.error(`점검 반출본 검증 실패 — ${pass}건 통과, ${fails.length}건 실패\n`);
  fails.forEach((f) => console.error(`  - ${f}`));
  process.exit(1);
}
console.log(`점검 반출본 검증 통과 · ${pass}건`);
