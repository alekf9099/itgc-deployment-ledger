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
