/**
 * 화면 판정 ↔ 서버 판정 일치 검증
 *
 * 판정 규칙이 화면(index.html)과 서버(lib/judge.js)에 한 벌씩 있습니다.
 * 한쪽만 고치면 화면에서 「정상」으로 보인 건이 월간 점검에서 지적으로
 * 집계되는 식으로 어긋나, 감사에서 설명할 수 없게 됩니다.
 *
 * 화면의 판정 코드를 index.html 에서 그대로 꺼내 실행하고, 같은 입력에
 * 서버 판정과 결과가 같은지, 이상 판정에는 사유 문구가 있는지 봅니다.
 *
 *   node scripts/test-parity.mjs
 */
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { judge as serverJudge } from '../lib/judge.js';

const html = readFileSync('index.html', 'utf8');
const start = html.indexOf("const CODE={'정규':'R','수시':'A','핫픽스':'E'};");
const end = html.indexOf('const SEG=[');
if (start < 0 || end < 0) {
  console.error('index.html 에서 화면 판정 코드를 찾지 못했습니다. 표식이 바뀌었으면 이 검사를 갱신하십시오.');
  process.exit(1);
}
const ctx = {};
vm.createContext(ctx);
vm.runInContext(
  html.slice(start, end) +
    "\nconst fmt=d=>d?`${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`:'';" +
    '\nglobalThis.clientJudge = judge;',
  ctx
);
const clientJudge = ctx.clientJudge;

const KEYS = ['term', 'sod', 'appr', 'dep', 'map', 'integ', 'idc', 'vfy', 'verd', 'reqm'];

/* 기준 건과, 한 항목씩 어긋나게 만든 변형들 */
const base = {
  date: '2026-09-30', vdate: '2026-09-29', type: '정규', judge: '이득룡', sys: 'HR 몬스터',
  task: 'R1003', id: 'QA-20260928-01, QA-20260929-01', dev: '박정규, 김민정',
  qa: '최우석, 김홍현', qav: '조건부 통과', req: '일치', holdc: '2', holdh: '',
  appr: '이득룡', apprd: '2026-09-30', deployer: '이종범', reg: '2026-09-30',
  schema: '해당', int: '완료', intby: '이종범', state: '등록완료', memo: '', exc: '',
};
const cases = [
  ['기준 건', {}],
  ['등록 기한 초과', { reg: '2026-10-05' }],
  ['수시 기한 +3영업일 이내', { type: '수시', id: 'QA-20260929-01', reg: '2026-10-05' }],
  ['직무 분리 위반', { qa: '김민정, 김홍현' }],
  ['승인자 누락', { appr: '' }],
  ['승인일 누락', { apprd: '' }],
  ['사후 승인 (정규)', { apprd: '2026-10-01' }],
  ['핫픽스 사후 승인 + 사유', { type: '핫픽스', apprd: '2026-10-01', memo: '장애 조치' }],
  ['핫픽스 사후 승인 사유 없음', { type: '핫픽스', apprd: '2026-10-01', memo: '' }],
  ['자기 승인', { appr: '박정규' }],
  ['배포 수행자 누락', { deployer: '' }],
  ['증적 ID 없음', { id: '' }],
  ['해당없음 상태', { id: '', state: '해당없음' }],
  ['스키마 없음 + 검증값', { schema: '없음', int: '완료' }],
  ['스키마 없음 + 공란', { schema: '없음', int: '', intby: '' }],
  ['스키마 해당 + 결과 없음', { int: '', intby: '' }],
  ['스키마 해당 + 부적합', { int: '부적합' }],
  ['스키마 해당 + 검증자 없음', { intby: '' }],
  ['ID 형식 위반', { id: 'QA-2026929-01' }],
  ['ID 반복', { id: 'QA-20260929-01, QA-20260929-01' }],
  ['ID 날짜가 검증 완료일 이후', { id: 'QA-20260929-01, QA-20260930-01' }],
  ['검증 완료일과 같은 날 ID 없음', { id: 'QA-20260928-01' }],
  ['구 형식 유형코드 불일치', { id: 'QA-A-20260929-01' }],
  ['구 형식 유형코드 일치', { id: 'QA-R-20260929-01' }],
  ['검증 완료일 누락', { vdate: '' }],
  ['사후 검증 사유 없음', { vdate: '2026-10-02', id: 'QA-20261002-01' }],
  ['사후 검증 사유 있음', { vdate: '2026-10-02', id: 'QA-20261002-01', memo: '배포 후 검증' }],
  ['보류 있는데 통과', { qav: '통과' }],
  ['보류 없고 통과', { qav: '통과', holdc: '0' }],
  ['보류 공란 + 통과', { qav: '통과', holdc: '' }],
  ['이전 기록 보류 두 칸', { qav: '통과', holdc: '0', holdh: '1' }],
  ['요구사항 미기재', { req: '' }],
  ['불일치 + 통과', { req: '불일치', qav: '통과', holdc: '0' }],
  ['불일치 + 조건부', { req: '불일치' }],
  ['배포일 없음', { date: '' }],
  /* 워크플로우 코드 (v2.22.0) */
  ['릴리즈 코드', { task: 'R1003', id: 'R1003' }],
  ['프로젝트 코드 여러 개', { task: 'R1003', id: 'P953, P1102, P1166-02' }],
  ['식별자와 다른 릴리즈 코드', { task: 'R1003', id: 'R1052' }],
  ['식별자 문장 속 코드', { task: '워크플로우 #R1003', id: 'R1003' }],
  ['식별자에 코드 없음', { task: 'COW #1', id: 'R1052' }],
  ['코드 + QA 번호 혼용', { id: 'P953, QA-20260928-01' }],
  ['혼용 + QA 번호가 늦음', { id: 'P953, QA-20260930-01' }],
  ['회차 한 자리', { id: 'P953-2' }],
  ['알 수 없는 접두어', { id: 'X953' }],
];

let pass = 0;
const fails = [];
for (const [label, over] of cases) {
  const r = { ...base, ...over };
  const s = serverJudge(r);
  const c = clientJudge(r);
  for (const k of KEYS) {
    if ((s[k] ?? null) !== (c[k] ?? null)) {
      fails.push(`${label} · ${k}: 서버 ${s[k]} / 화면 ${c[k]}`);
    } else pass++;
    if (c[k] === 'bad' && !(c.why && c.why[k])) fails.push(`${label} · ${k}: 이상 판정인데 사유 문구가 없음`);
    else if (c[k] === 'bad') pass++;
  }
  if ((s.overall ?? null) !== (c.overall ?? null)) fails.push(`${label} · 종합: 서버 ${s.overall} / 화면 ${c.overall}`);
  else pass++;
}

if (fails.length) {
  console.error(`화면·서버 판정 일치 검증 실패 — ${pass}건 통과, ${fails.length}건 실패\n`);
  fails.forEach((f) => console.error(`  - ${f}`));
  process.exit(1);
}
console.log(`화면·서버 판정 일치 검증 통과 · ${pass}건 (사례 ${cases.length}개)`);
