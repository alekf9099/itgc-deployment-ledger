/**
 * 소프트팩토리 가져오기 계획 검증
 *   node scripts/test-workflow.mjs
 */
import { planImport, normalizeRelease, targetSystem } from '../lib/workflow.js';

let pass = 0;
const fails = [];
const eq = (a, b, label) => {
  const x = JSON.stringify(a), y = JSON.stringify(b);
  if (x === y) pass++;
  else fails.push(`${label}\n      기대 ${y}\n      실제 ${x}`);
};

const rel = (over = {}) => ({
  code: 'R2001', ws: 'HR몬스터', title: '[몬스터] 11월 정기 릴리즈', status: '완료', approval: '승인',
  type: '정규', owner: '이득룡', target: '2026-11-25', completed: '2026-11-25', tasks: 10, tasksDone: 10,
  projects: [], notes: [], ...over,
});

/* 기본 */
let p = planImport([rel({ projects: [{ code: 'P10', name: 'A', tasks: 5, tasksDone: 5 }, { code: 'P11', name: 'B', tasks: 0, tasksDone: 0 }] })], [], { from: '2026-09-01', extractedAt: '2026-11-30' });
eq(p.add.length, 1, '완료 릴리즈는 추가');
const e = p.add[0].entry;
eq(e.k, 'wf-R2001', '행 식별자는 릴리즈 코드로 고정 (다시 가져와도 같은 값)');
eq(e.task, 'R2001 [몬스터] 11월 정기 릴리즈', '식별자 = 코드 + 제목');
eq(e.id, 'P10', '증적 ID 는 일감이 있는 프로젝트만');
eq(e.state, '작성중', '새 건은 작성중');
eq(e.date, '2026-11-25', '배포일 후보 = 완료일');
eq(e.memo.includes('실제 배포일 확인 필요'), true, '비고에 배포일 확인 필요');
eq(p.add[0].warnings.some((w) => w.includes('P11')), true, '일감 없이 연결된 프로젝트 경고');
eq(e.type, '정규', '유형 그대로');

/* 대장 항목 매핑 */
eq(e.rel, '[몬스터] 11월 정기 릴리즈', '릴리즈명 = 소프트팩토리 제목');
eq(e.plan, '2026-11-25', '릴리즈 계획일 = 목표일');
eq(e.apprref, '소프트팩토리 R2001 릴리즈 결재 https://sofac.muhayu.com/releases/R2001', '결재 승인 건은 배포 승인 근거에 결재 링크');
eq(e.memo.includes('릴리즈 담당자 이득룡'), true, '비고에 릴리즈 담당자');
eq(e.sys, 'HR몬스터', '태그가 워크스페이스에 들어 있으면 워크스페이스 표기');
eq(targetSystem('CK캠퍼스', '[카피킬러] 2026/10/06 12시 핫픽스'), '카피킬러', '여러 서비스 워크스페이스는 제목 태그의 서비스');
eq(targetSystem('CK캠퍼스', '[수시 릴리즈] OCR Controller'), 'CK캠퍼스', '유형을 적은 태그는 서비스로 보지 않음');
eq(targetSystem('무하유', '2026년 10월 8일 공방 업데이트'), '무하유', '태그가 없으면 워크스페이스');
p = planImport([rel({ approval: '없음' })], [], {});
eq(p.add[0].entry.apprref, '', '결재가 없으면 배포 승인 근거를 비워 둠');
p = planImport([rel({ title: '[CK신디] 수시 릴리즈 요청서', type: '정규' })], [], {});
eq(p.add[0].warnings.includes('제목은 수시, 소프트팩토리 유형은 정규 — 유형 확인'), true, '제목과 유형이 다르면 경고');
p = planImport([rel({ title: '2026/10 [신디] 릴리즈', type: '정규' })], [], {});
eq(p.add[0].warnings.some((w) => w.includes('유형 확인')), false, '제목에 유형이 없으면 경고 없음');

/* ── v4 추출 파일: 결재 · 일감으로 증적 채우기 ── */
const T = (id, o = {}) => ({ id, title: '', project: '', parent: '', phase: '', type: '일감', menu: '', status: '완료', done: true,
  assignee: '', requester: '', completer: '', completedAt: '2026-11-20 10:00', ...o });
const v4 = (over = {}) => rel({
  owner: '이득룡', completed: '2026-11-25', target: '2026-11-25',
  projects: [{ code: 'P10', name: 'A', tasks: 9, tasksDone: 9 }],
  releaseApproval: { status: 'APPROVED', completedAt: '2026-11-24 12:00', approvers: [{ name: '김경수', decision: 'APPROVED', at: '2026-11-24 12:00' }] },
  items: [
    T('T1', { project: 'P10', title: '승인', type: '프로젝트 승인', assignee: '김경수', completer: '김경수', completedAt: '2026-11-01 10:00' }),
    T('T2', { project: 'P10', parent: 'T1', phase: '승인', title: 'QA 승인', type: '1차 승인', menu: 'APPROVAL', assignee: '이광주' }),
    T('T3', { project: 'P10', title: '개발', type: '일감' }),
    T('T4', { project: 'P10', parent: 'T3', phase: '개발', title: '번역 API 개발', assignee: '박개발' }),
    T('T5', { project: 'P10', parent: 'T3', phase: '개발', title: '개발자 테스트', assignee: '최개발' }),
    T('T6', { project: 'P10', parent: 'T3', phase: '개발', title: '기획자 테스트', assignee: '김기획' }),
    T('T7', { project: 'P10', title: '검토' }),
    T('T8', { project: 'P10', parent: 'T7', phase: '검토', title: 'QA 테스트', assignee: '김홍현' }),
    T('T9', { project: 'P10', parent: 'T8', phase: '검토', title: '[결함] 문구 오류', assignee: '박개발', done: false, status: '요청' }),
    T('T10', { project: 'P10', parent: 'T7', phase: '완료', title: 'QA평가', type: '평가', assignee: '이광주', done: false, status: '예정' }),
    T('T20', { title: '[개발] PDF 구현', assignee: '장개발', requester: '김기획' }),
    T('T21', { title: '[기획] PDF 기획', assignee: '김재현' }),
    T('T22', { title: '[QC] 기획 관점 점검', assignee: '김재현' }),
    T('T23', { title: '[개발] PDF 테스트 대상', assignee: '장개발' }),
    T('T24', { parent: 'T23', title: '개발자 테스트', assignee: '장개발' }),
    T('T25', { title: '팝업 버튼 추가', assignee: '송개발', done: false, status: '진행' }),
  ],
  ...over,
});
p = planImport([v4()], [], { from: '2026-09-01' });
let w = p.add[0].warnings, en = p.add[0].entry;
eq(en.id, 'P10, T20, T21, T22, T23, T25', '증적 ID = 프로젝트 + 프로젝트가 아닌 최상위 일감');
eq(en.appr, '김경수', '릴리즈 결재자 = 배포 승인자');
eq(en.apprd, '2026-11-24', '결재 일시 = 배포 승인일');
eq(en.deployer, '이득룡', '릴리즈 담당자 = 배포 수행자');
eq(en.dev, '박개발, 최개발, 장개발, 송개발', '개발 단계 담당자 + 개발 일감 담당자 (기획 · QC · 기획자 테스트 제외)');
eq(en.memo.includes('P10 [PD-01] · 프로젝트 승인 김경수 2026-11-01'), true, '프로젝트 증적 요약');
eq(en.memo.includes('결함 1건(미해결 1)'), true, 'PD-03 결함 요약');
eq(w.includes('P10 미해결 결함 1건'), true, '미해결 결함 경고');
eq(w.includes('T25 미완료 일감 포함 (진행)'), true, '미완료 일감 경고');
eq(w.some((x) => x.startsWith('T20 테스트 증적 없음')), true, '테스트 하위 일감이 없으면 PC-01 경고');
eq(w.some((x) => x.startsWith('T23 테스트 증적 없음')), false, '개발자 테스트 하위 일감이 있으면 경고 없음');
eq(w.includes('김재현 님이 기획과 QC 를 함께 담당 — 관찰 사항'), true, '기획 · QC 겸임 관찰');
eq(w.some((x) => x.includes('전결권자')), false, '결재자 · 프로젝트 승인자가 C레벨이면 경고 없음');

p = planImport([v4({ releaseApproval: { status: 'APPROVED', approvers: [{ name: '이득룡', decision: 'APPROVED', at: '2026-11-26 09:00' }] } })], [], {});
w = p.add[0].warnings;
eq(w.includes('릴리즈 결재자 이득룡 중 전결권자(C레벨) 없음'), true, '결재자가 C레벨이 아니면 경고');
eq(w.includes('릴리즈 결재자가 릴리즈 담당자 본인(이득룡)'), true, '자기 릴리즈 결재 경고');
eq(w.includes('릴리즈 결재(2026-11-26)가 완료일 이후'), true, '사후 결재 경고');

p = planImport([v4({ releaseApproval: { status: 'APPROVED', approvers: [{ name: '추연우', decision: 'APPROVED', at: '2026-11-24 12:23' }, { name: '이광주', decision: 'APPROVED', at: '2026-11-24 12:26' }] } })], [], {});
eq(p.add[0].warnings.some((x) => x.includes('전결권자')), false, '결재선에 C레벨이 한 명이라도 있으면 경고 없음');
eq(p.add[0].entry.appr, '추연우, 이광주', '결재자 모두 기록');

/* 실제 데이터에서 본 형태 */
const real = v4({ projects: [{ code: 'P20', tasks: 5, tasksDone: 5 }], items: [
  T('T30', { project: 'P20', title: '(개발) 기능', type: '프로젝트 개발' }),
  T('T31', { project: 'P20', parent: 'T30', phase: '(개발) 기능', title: '기능 테스트', assignee: '기효선' }),
  T('T32', { project: 'P20', parent: 'T30', phase: '(개발) 기능', title: '화면 개발', assignee: '김민정' }),
  T('T33', { project: 'P20', title: '(검토) 기능', type: '프로젝트 테스트' }),
  T('T34', { project: 'P20', parent: 'T33', phase: '(검토) 기능', title: 'QC', type: 'QA테스트', menu: 'QA_REVIEW', assignee: '김홍현' }),
  T('T40', { title: '[표절검사] 배치 지연 장애', type: '장애', menu: 'INCIDENT', assignee: '박명규', requester: '박명규', completer: '박명규' }),
  T('T41', { title: '보안서약 문구 추가', assignee: '김민정', requester: '김재현', completer: '김재현' }),
  T('T42', { parent: 'T9999', phase: '[몬스터] 상위 일감', title: '평가 플랜 조정', assignee: '송재한', requester: '송재한', completer: '송재한' }),
] });
p = planImport([real], [], {}); w = p.add[0].warnings; en = p.add[0].entry;
eq(en.dev, '김민정, 박명규, 송재한', '기능 테스트(기획자) 담당자는 개발자에서 뺌');
eq(w.some((x) => x.startsWith('P20 QA 테스트')), false, '「QC」 이름의 QA 테스트도 유형으로 찾음');
eq(w.some((x) => x.startsWith('P20 개발자 테스트')), false, '「기능 테스트」 를 개발자 테스트로 인정');
eq(en.memo.includes('T40 [CO-01]'), true, '장애 일감은 CO-01');
eq(w.some((x) => x.startsWith('T40 테스트')), false, '장애 일감에는 PC-01 테스트 경고를 걸지 않음');
eq(w.includes('T41 테스트 결과 문서 없음 — 요청자 완료 확인만 있음 (PC-01 은 개발자 · 사용자 테스트 결과 필요)'), true, '요청자 완료 확인은 따로 표시');
eq(en.id.includes('T42'), true, '상위 일감이 다른 릴리즈에 있으면 하위 일감이 증적 단위');
eq(w.includes('T42 요청 · 개발 · 완료를 같은 사람(송재한)이 처리 — 독립 확인 없음'), true, '혼자 요청 · 개발 · 완료한 일감');

const split = v4({ projects: [{ code: 'P30', tasks: 21, tasksDone: 21 }], items: [
  T('T50', { project: 'P30', parent: 'T49', phase: '검토', title: '[결함] 미리보기 미적용', assignee: '박정규' }),
] });
p = planImport([split], [], {});
eq(p.add[0].warnings.some((x) => x.startsWith('P30')), false, 'WBS 단계 일감이 다른 릴리즈에 있으면 경고하지 않음');
eq(p.add[0].entry.memo.includes('P30 [PD-01] · WBS 단계 일감이 다른 릴리즈에 연결됨'), true, '다른 릴리즈에서 확인하라고 표시');

p = planImport([v4({ releaseApproval: { status: 'NONE', approvers: [] } })], [], {});
eq([p.add[0].entry.appr, p.add[0].entry.apprref], ['', ''], '결재가 없으면 승인자 · 승인 근거를 비움');

const late = v4();
late.items[0] = T('T1', { project: 'P10', title: '승인', type: '프로젝트 승인', assignee: '임팀장', completer: '임팀장', completedAt: '2026-11-30 23:59' });
w = planImport([late], [], {}).add[0].warnings;
eq(w.includes('P10 프로젝트 승인자 임팀장 은(는) 전결권자(C레벨) 아님'), true, '프로젝트 승인자 C레벨 확인');
eq(w.includes('P10 프로젝트 승인(2026-11-30)이 배포 후'), true, '배포 후 프로젝트 승인 경고');
eq(w.some((x) => x.includes('날짜 지정값(23:59)')), true, '23:59 승인 시각 경고');

p = planImport([v4()], [{ k: 'x', task: 'R2001', id: 'P10' }], {});
eq(p.exists[0].missing, ['T20', 'T21', 'T22', 'T23', 'T25'], '이미 있는 릴리즈는 대장에 없는 일감을 보여 줌');
eq(planImport([rel({ approval: '승인' })], [], {}).add[0].entry.appr, undefined, '이전 추출 파일은 승인자를 채우지 않음');

/* 프로젝트 없는 릴리즈 */
p = planImport([rel({ tasks: 3 })], [], {});
eq(p.add[0].entry.id, 'R2001', '프로젝트가 없으면 릴리즈 코드를 증적 ID 로');
eq(p.add[0].entry.state, '작성중', '일감이 있으면 작성중');
p = planImport([rel({ tasks: 0 })], [], {});
eq(p.add[0].entry.state, '보완필요', '구성이 전혀 없으면 보완필요');
eq(p.add[0].warnings.includes('릴리즈 구성 없음 (일감 등록 필요)'), true, '구성 없음 경고');

/* 경고 */
p = planImport([rel({ approval: '없음', target: '2026-11-20', completed: '2026-11-25' })], [], {});
eq(p.add[0].warnings.includes('릴리즈 결재 없음'), true, '결재 없음 경고');
eq(p.add[0].warnings.some((w) => w.startsWith('목표일 2026-11-20')), true, '목표일 ≠ 완료일 경고');

/* 이미 대장에 있는 릴리즈 */
const ledger = [{ k: 'x', task: '소프트팩토리 #R2001', id: 'QA-20261124-01' }];
p = planImport([rel({ projects: [{ code: 'P10', tasks: 5, tasksDone: 5 }] })], ledger, {});
eq(p.add.length, 0, '식별자에 같은 R코드가 있으면 새로 만들지 않음');
eq(p.exists[0].missing, ['P10'], '대장에 없는 소프트팩토리 프로젝트를 보여 줌');
p = planImport([rel()], [{ k: 'y', task: '', id: 'R2001' }], {});
eq(p.exists.length, 1, '증적 ID 에 R코드가 있어도 이미 있는 것으로 봄');

/* 완료 전 · 기간 밖 */
p = planImport([rel({ status: '예정', completed: '' })], [], { from: '2026-09-01' });
eq([p.add.length, p.pending.length], [0, 1], '예정은 추가하지 않고 확인 목록으로');
p = planImport([rel({ status: '예정', completed: '', target: '2026-08-01' })], [], { from: '2026-09-01' });
eq(p.pending.length, 0, '시작일 이전 목표의 예정 건은 확인 목록에서도 제외');
p = planImport([rel({ completed: '2026-08-31' })], [], { from: '2026-09-01' });
eq([p.add.length, p.outOfRange.length], [0, 1], '시작일 이전 완료는 기간 밖');

/* 증적 ID 겹침 */
p = planImport([
  rel({ code: 'R2001', projects: [{ code: 'P10', tasks: 5, tasksDone: 5 }] }),
  rel({ code: 'R2002', projects: [{ code: 'P10', tasks: 3, tasksDone: 3 }, { code: 'P12', tasks: 2, tasksDone: 2 }] }),
], [], {});
eq(p.add.map((a) => a.entry.id), ['P10', 'P12'], '한 프로젝트가 두 릴리즈에 있으면 먼저 나온 쪽에만 ID');
eq(p.add[1].warnings.some((w) => w.includes('P10 는 다른 배포 건')), true, '겹친 프로젝트 경고');
p = planImport([rel({ projects: [{ code: 'P10', tasks: 1, tasksDone: 1 }] })], [{ k: 'z', task: 'R1999', id: 'P10' }], {});
eq(p.add[0].entry.id, 'R2001', '대장에 이미 쓰인 프로젝트 코드는 넣지 않고 릴리즈 코드로');

/* 파일 오류 */
p = planImport([rel({ code: 'X1' }), rel(), rel()], [], {});
eq(p.invalid.length, 2, '형식 오류와 파일 안 중복을 모두 걸러냄');
eq(normalizeRelease({ code: 'R1', title: 't', completed: '2026/09/01' }).bad.includes('완료일 형식 오류'), true, '날짜 형식 검사');
eq(normalizeRelease({ code: 'R1', title: 't', projects: [{ code: 'Q1' }, { code: 'P5', tasks: '3' }] }).release.projects.map((x) => x.code), ['P5'], '프로젝트 코드가 아닌 값은 버림');

if (fails.length) {
  console.error(`소프트팩토리 가져오기 검증 실패 — ${pass}건 통과, ${fails.length}건 실패\n`);
  fails.forEach((f) => console.error(`  - ${f}`));
  process.exit(1);
}
console.log(`소프트팩토리 가져오기 검증 통과 · ${pass}건`);
