/**
 * lib/judge.js 검증
 *
 *   node scripts/test-judge.mjs
 *
 * 판정 규칙과 점검 집계는 통제 결과를 결정하는 부분입니다. DB 나 로그인이
 * 없어도 확인할 수 있어야 하므로 순수 함수만 검사합니다.
 */
import { deadline, judge, computeSummary, missingFixes, CHECK_DEFS, splitDocIds, normalizeDocIds, splitNames } from '../lib/judge.js';

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
/* 현재 체계: QA-{배포일 YYYYMMDD}-{일련}. 유형은 ID 에 넣지 않습니다. */
eq(judge({ date: '2026-08-24', type: '정규', id: 'QA-20260824-01' }).idc, 'ok', '현행 형식 일치');
eq(judge({ date: '2026-08-24', type: '수시', id: 'QA-20260824-07' }).idc, 'ok', '유형이 달라도 무관');
eq(judge({ date: '2026-08-27', type: '정규', id: 'QA-20260824-03' }).idc, 'bad', '날짜부 불일치');
eq(judge({ date: '2026-08-24', type: '정규', id: 'QA-2026824-01' }).idc, 'bad', '날짜 자릿수 부족은 형식 위반');
eq(judge({ date: '2026-08-24', type: '정규', id: 'QA-20260824-1' }).idc, 'bad', '일련번호 한 자리는 형식 위반');
eq(judge({ date: '2026-08-24', type: '정규', id: '20260824-01' }).idc, 'bad', '접두어 없으면 형식 위반');
eq(judge({ date: '2026-08-24', type: '정규', id: 'QA-20260824-01 ' }).idc, 'ok', '앞뒤 공백은 무시');

/* 구 형식도 유효한 값으로 인정하며, 남아 있는 유형코드는 함께 검사합니다. */
eq(judge({ date: '2026-08-14', type: '수시', id: 'QA-A-20260814-01' }).idc, 'ok', '구 형식 일치');
eq(judge({ date: '2026-08-14', type: '정규', id: 'QA-A-20260814-01' }).idc, 'bad', '구 형식 유형코드 불일치');
eq(judge({ date: '2026-08-13', type: '수시', id: 'QA-A-20260814-01' }).idc, 'bad', '구 형식 날짜부 불일치');
eq(judge({ date: '2026-08-14', type: '', id: 'QA-A-20260814-01' }).idc, 'bad', '구 형식인데 유형이 비면 확인 필요');
eq(judge({ date: '2026-08-14', type: '', id: 'QA-20260814-01' }).idc, 'ok', '현행 형식은 유형이 없어도 판정 가능');

eq(judge({ date: '2026-08-14', type: '수시', id: '' }).idc, null, 'ID 없으면 미판정');
eq(judge({ date: '', type: '수시', id: 'QA-20260814-01' }).idc, null, '배포일 없으면 미판정');

/* ── 종합 판정 ── */
const clean = {
  date: '2026-08-14', type: '수시', id: 'QA-A-20260814-01', judge: '김판정',
  dev: '이개발', qa: '박검증', appr: '최승인', apprd: '2026-08-14',
  schema: '없음', int: '', intby: '', reg: '2026-08-19', state: '등록완료',
  /* 보고서 V2 대응 항목 */
  vdate: '2026-08-14', qav: '통과', qajudge: '박검증', qajd: '2026-08-14',
  req: '일치', reqby: '김동완', holdc: '', holdh: '', rel: '', plan: '', memo: '',
  deployer: '김인프라',
};
eq(judge(clean).flag, false, '이상 없는 건은 확인필요 아님');
eq(judge(clean).overall, '정상', '이상 없는 건의 종합 판정은 정상');
eq(judge({ ...clean, apprd: '' }).overall, '확인필요', '한 항목만 이상이어도 확인필요');
eq(judge({ ...clean, date: '' }).overall, null, '배포일 없으면 종합 판정 없음');

/* ── 증적 문서 ID 의 기준일은 검증 완료일 ── */
/* 보고서 V2 — ID 는 최종 회차 검증 완료일 기준으로 부여합니다.
   사후 검증 건에서 배포일로 대조하면 보고서와 대장의 ID 가 갈립니다. */
eq(judge({ ...clean, date: '2026-08-14', vdate: '2026-08-20', id: 'QA-20260820-01' }).idc, 'ok',
  '날짜부는 검증 완료일과 맞으면 정상 (배포일과 달라도 됨)');
eq(judge({ ...clean, date: '2026-08-14', vdate: '2026-08-20', id: 'QA-20260814-01' }).idc, 'bad',
  '배포일로 부여한 ID 는 불일치');
eq(judge({ ...clean, date: '2026-08-14', vdate: '', id: 'QA-20260814-01' }).idc, 'ok',
  '검증 완료일이 비면 배포일로 대조 (기존 기록 보호)');

/* ── 검증 완료일 ── */
eq(judge({ ...clean, vdate: '2026-08-14' }).vfy, 'ok', '배포일과 같으면 정상');
eq(judge({ ...clean, vdate: '2026-08-13' }).vfy, 'ok', '배포 전 검증은 정상');
eq(judge({ ...clean, vdate: '' }).vfy, 'bad', '미기재는 미비');
eq(judge({ ...clean, vdate: '2026-08-20', id: 'QA-20260820-01', memo: '' }).vfy, 'bad',
  '사후 검증인데 사유가 없으면 미비');
eq(judge({ ...clean, vdate: '2026-08-20', id: 'QA-20260820-01', memo: '배포 후 검증 · 사유 기재' }).vfy,
  'ok', '사후 검증이어도 사유가 있으면 정상');
eq(judge({ ...clean, date: '' }).vfy, null, '배포일 없으면 미판정');

/* ── QA 판정 적정성 ── */
eq(judge({ ...clean, qav: '통과', holdc: '0', holdh: '0' }).verd, 'ok', '보류 0건 + 통과');
eq(judge({ ...clean, qav: '통과', holdc: '1' }).verd, 'bad', '즉시·긴급 보류가 남으면 통과 불가');
eq(judge({ ...clean, qav: '통과', holdh: '2' }).verd, 'bad', '높음 보류가 남으면 통과 불가');
eq(judge({ ...clean, qav: '조건부 통과', holdh: '2' }).verd, 'ok', '조건부 통과는 허용');
eq(judge({ ...clean, qav: '실패', holdc: '3' }).verd, 'ok', '실패는 허용');
/* v2.19.1 — 판정자·판정일·확인자는 보고서에서 관리하고 대장에서 받지 않습니다. */
eq(judge({ ...clean, qav: '통과', qajudge: '' }).verd, 'ok', '판정자는 대장 판정 대상 아님');
eq(judge({ ...clean, qav: '통과', qajd: '' }).verd, 'ok', '판정일은 대장 판정 대상 아님');
eq(judge({ ...clean, qav: '' }).verd, null, '판정이 없으면 미판정');
eq(judge({ ...clean, qav: '통과', holdc: '', holdh: '' }).verd, 'ok',
  '보류 건수를 비워두면 건수 대조는 하지 않음');

/* ── 요구사항 일치 ── */
eq(judge({ ...clean, req: '일치', reqby: '김동완' }).reqm, 'ok', '일치 + 확인자');
eq(judge({ ...clean, req: '일치(범위 조정)', reqby: '김동완' }).reqm, 'ok', '범위 조정도 정상');
eq(judge({ ...clean, req: '', reqby: '김동완' }).reqm, 'bad', '일치 여부 미기재는 미확인');
eq(judge({ ...clean, req: '일치', reqby: '' }).reqm, 'ok', '확인자는 대장 판정 대상 아님');
eq(judge({ ...clean, req: '불일치', qav: '통과' }).reqm, 'bad', '불일치인데 통과 판정은 미확인');
eq(judge({ ...clean, req: '불일치', qav: '조건부 통과' }).reqm, 'ok', '불일치 + 조건부 통과는 정상');
eq(judge({ ...clean, date: '' }).reqm, null, '배포일 없으면 미판정');

/* ── 여러 증적 문서 ID (릴리즈 1건 = 보고서 여러 개) ── */
eq(splitDocIds('QA-20260928-01, QA-20260929-01,QA-20260929-02\nQA-20260929-03'),
  ['QA-20260928-01', 'QA-20260929-01', 'QA-20260929-02', 'QA-20260929-03'], '쉼표·공백·줄바꿈 구분 모두 인식');
eq(normalizeDocIds(' QA-20260929-01 ,QA-20260929-02 '), 'QA-20260929-01, QA-20260929-02', '저장 형식으로 정규화');
eq(splitDocIds(''), [], '빈 값은 빈 목록');

const rel = { ...clean, date: '2026-09-30', vdate: '2026-09-29', type: '정규' };
eq(judge({ ...rel, id: 'QA-20260928-01, QA-20260929-01, QA-20260929-02, QA-20260929-03' }).idc, 'ok',
  '실제 사례: 09-28 1건 + 09-29 3건, 검증 완료일 09-29 → 정상');
eq(judge({ ...rel, id: 'QA-20260928-01, QA-20260928-02' }).idc, 'bad',
  '검증 완료일(09-29)과 같은 날짜의 ID 가 없으면 불일치');
eq(judge({ ...rel, id: 'QA-20260929-01, QA-20260930-01' }).idc, 'bad',
  '검증 완료일 이후 날짜의 ID 가 있으면 불일치');
eq(judge({ ...rel, id: 'QA-20260929-01, QA-20260929-01' }).idc, 'bad', '같은 ID 반복은 불일치');
eq(judge({ ...rel, id: 'QA-20260929-01, QA-2026929-02' }).idc, 'bad', '하나라도 형식 위반이면 불일치');
eq(judge({ ...rel, id: 'QA-20260929-01' }).idc, 'ok', 'ID 하나는 기존 규칙과 같음');
eq(judge({ ...rel, id: 'QA-20260928-01' }).idc, 'bad', 'ID 하나인데 날짜가 다르면 불일치 (기존과 같음)');
eq(judge({ ...rel, type: '정규', id: 'QA-A-20260929-01, QA-20260929-02' }).idc, 'bad',
  '구 형식이 섞이면 유형코드도 검사');

/* ── 직무 분리: 여러 명 ── */
eq(splitNames('이개발, 박개발 ,김개발'), ['이개발', '박개발', '김개발'], '성명 목록 분리');
eq(judge({ ...clean, dev: '이개발, 박개발', qa: '박개발' }).sod, 'bad', '한 사람이라도 겹치면 위반');
eq(judge({ ...clean, dev: '이개발, 박개발', qa: '최우석, 김홍현' }).sod, 'ok', '겹치는 사람이 없으면 정상');
eq(judge({ ...clean, dev: '이개발', qa: '최우석, 이개발' }).sod, 'bad', '검증 수행자 쪽이 여러 명이어도 겹침 확인');
eq(judge({ ...clean, dev: '개발 22명 · 배포 PR #123', qa: '최우석, 김홍현' }).sod, 'ok',
  '정규 표기(개발 N명 · 배포 PR) 는 겹침 없음 — 확인 결과는 비고에 남김');

/* ── 배포 승인: 사후 승인 · 자기 승인 ── */
const dep = { ...clean, date: '2026-09-30', type: '정규', appr: '김결재', apprd: '2026-09-30', dev: '이개발', deployer: '김인프라' };
eq(judge(dep).appr, 'ok', '배포일 당일 승인은 완비');
eq(judge({ ...dep, apprd: '2026-09-29' }).appr, 'ok', '배포 전 승인은 완비');
eq(judge({ ...dep, apprd: '2026-10-01' }).appr, 'bad', '배포 후 승인은 미완비 (정규)');
eq(judge({ ...dep, type: '수시', apprd: '2026-10-01' }).appr, 'bad', '배포 후 승인은 미완비 (수시)');
eq(judge({ ...dep, type: '핫픽스', apprd: '2026-10-01', memo: '' }).appr, 'bad', '핫픽스 사후 승인도 사유가 없으면 미완비');
eq(judge({ ...dep, type: '핫픽스', apprd: '2026-10-01', memo: '장애 긴급 조치 후 승인' }).appr, 'ok', '핫픽스 사후 승인 + 사유는 완비');
eq(judge({ ...dep, appr: '이개발' }).appr, 'bad', '변경 작성자가 자기 배포를 승인하면 미완비');
eq(judge({ ...dep, dev: '이개발, 박개발', appr: '박개발' }).appr, 'bad', '여러 개발자 중 한 명이 승인해도 미완비');

/* ── 배포 수행자 ── */
eq(judge(dep).dep, 'ok', '배포 수행자 기재');
eq(judge({ ...dep, deployer: '' }).dep, 'bad', '배포 수행자 미기재');
eq(judge({ ...dep, deployer: '이개발' }).dep, 'ok', '개발자 직접 배포 자체는 위반 아님');
eq(judge({ ...dep, deployer: '이개발' }).appr, 'ok', '개발자가 배포해도 사전 승인이 있으면 승인 기록 완비');
eq(judge({ ...dep, date: '' }).dep, null, '배포일 없으면 미판정');

const dd = computeSummary([dep, { ...dep, id: 'QA-20260930-02', deployer: '이개발' }], '2026-09-01', '2026-09-30');
eq(dd.items.find((i) => i.key === 'devdeploy').n, 1, '확인 항목: 개발자 직접 배포 1건');
eq(dd.items.find((i) => i.key === 'devdeploy').isDef, false, '개발자 직접 배포는 지적이 아닌 확인 항목');

/* ── 워크플로우 코드 (v2.22.0) ── */
const wf = { ...clean, date: '2026-10-07', vdate: '2026-10-05', type: '정규', task: 'R1052' };
eq(judge({ ...wf, id: 'R1052' }).idc, 'ok', '릴리즈 코드');
eq(judge({ ...wf, id: 'P953' }).idc, 'ok', '프로젝트 코드');
eq(judge({ ...wf, id: 'T2886' }).idc, 'ok', '일감 코드');
eq(judge({ ...wf, id: 'P953, P1102, P1166-02' }).idc, 'ok', '여러 프로젝트 · 재검증 회차');
eq(judge({ ...wf, id: 'P953, QA-20261001-01' }).idc, 'ok', '코드와 QA 번호 혼용 (QA 번호 날짜 ≤ 검증 완료일)');
eq(judge({ ...wf, id: 'P953, QA-20261006-01' }).idc, 'bad', '혼용 시에도 QA 번호가 검증 완료일보다 늦으면 불일치');
eq(judge({ ...wf, id: 'R1003' }).idc, 'bad', '식별자(R1052)와 다른 릴리즈 코드는 불일치');
eq(judge({ ...wf, task: '워크플로우 #R1052', id: 'R1052' }).idc, 'ok', '식별자 문장 안의 릴리즈 코드도 인식');
eq(judge({ ...wf, task: 'COW #20163', id: 'R1003' }).idc, 'ok', '식별자에 릴리즈 코드가 없으면 대조하지 않음');
eq(judge({ ...wf, id: 'R1052, R1052' }).idc, 'bad', '같은 코드 반복');
eq(judge({ ...wf, id: 'P953-2' }).idc, 'bad', '회차는 두 자리');
eq(judge({ ...wf, id: 'X1052' }).idc, 'bad', '알 수 없는 접두어');
eq(judge({ ...wf, id: 'R12' }).idc, 'bad', '코드는 세 자리 이상');
eq(judge({ ...wf, id: 'QA-20261005-01' }).idc, 'ok', '기존 QA 번호 체계도 유효');

/* ── 월간 점검 집계 ── */
/* 날짜를 바꿀 때 ID 와 등록일도 함께 맞춥니다. 그러지 않으면 검사하려는
   항목 외에 ID 정합성·기한 준수까지 같이 어긋나 집계가 섞입니다. */
function mk(date, over = {}) {
  return {
    ...clean,
    date,
    id: `QA-A-${date.replaceAll('-', '')}-01`,
    vdate: date, // ID 의 기준일이므로 날짜를 바꾸면 함께 맞춥니다
    apprd: date, // 승인은 배포일 이전이어야 하므로 함께 맞춥니다
    qajd: date,
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
  mk('2026-08-31', { qav: '실패(반려)' }),       // 확인 항목 (이전 표기)
  mk('2026-08-18', { vdate: '' }),              // 검증 완료일 미기재
  mk('2026-08-19', { holdc: '2' }),             // 보류 잔존인데 통과 판정
  mk('2026-08-13', { req: '' }),                // 요구사항 일치 미기재
];

const s = computeSummary(all, '2026-08-01', '2026-08-31');
const n = (key) => s.items.find((i) => i.key === key).n;

eq(s.ledgerCount, 13, '기간 내 건수는 13건 (7월 건 제외)');
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
eq(n('fail'), 1, '이전 표기 「실패(반려)」도 실패로 집계');
eq(n('vfy'), 1, '검증 완료일 미비 1건');
eq(n('verd'), 1, 'QA 판정 부적정 1건');
eq(n('reqm'), 1, '요구사항 미확인 1건');
eq(n('hold_issue'), 1, '보류 잔존 1건');
eq(n('cond'), 0, '조건부 통과 0건');
eq(s.defects, 11, '지적 항목 11종');

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
eq(missingFixes(withFix).length, 10, '나머지 지적 항목 10종은 조치 내용 필요');

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
