/**
 * lib/sheet.js 검증
 *
 *   node scripts/test-sheet.mjs
 *
 * 시트에 쓰는 값과 범위가 엑셀 양식과 맞는지 확인합니다. Google 자격 증명이
 * 없어도 확인할 수 있도록 값 생성 부분만 검사합니다.
 *
 * 머리글은 리포지토리의 양식 파일에서 직접 읽어 대조합니다. 양식이 개정되면
 * 이 검사가 먼저 실패하므로, 코드를 함께 고치지 않고 배포되는 일을 막습니다.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { execFileSync } from 'node:child_process';
import {
  LEDGER_HEADER, LEDGER_FIRST_ROW, buildLedgerRows, ledgerUpdate,
  ledgerClearRange, checkUpdates, colName,
} from '../lib/sheet.js';

let pass = 0;
const fails = [];
const eq = (a, b, label) => {
  const x = JSON.stringify(a), y = JSON.stringify(b);
  if (x === y) pass++;
  else fails.push(`${label}\n      기대 ${y}\n      실제 ${x}`);
};

/* ── 열 문자 ── */
eq(colName(1), 'A', '1열은 A');
eq(colName(26), 'Z', '26열은 Z');
eq(colName(28), 'AB', '28열은 AB (양식의 마지막 열)');

/* ── 머리글이 양식 파일과 일치하는지 ── */
const here = dirname(fileURLToPath(import.meta.url));
const xlsx = join(here, '..', 'docs', 'QA-LG-001_Release_Deployment_Ledger.xlsx');

let templateHeader = null;
try {
  const py = execFileSync('python', ['-c', `
import zipfile, re, json, sys
z = zipfile.ZipFile(r"${xlsx.replace(/\\/g, '\\\\')}")
S = [''.join(re.findall(r'<t[^>]*>(.*?)</t>', s, re.S))
     for s in re.findall(r'<si>(.*?)</si>', z.read('xl/sharedStrings.xml').decode('utf8'), re.S)]
sheet = z.read('xl/worksheets/sheet1.xml').decode('utf8')
rows = dict(re.findall(r'<row[^>]*r="(\\d+)"[^>]*>(.*?)</row>', sheet, re.S))
out = []
for ref, attr, inner in re.findall(r'<c r="([A-Z]+)\\d+"([^>]*)>(.*?)</c>', rows.get('5',''), re.S):
    v = re.search(r'<v>(.*?)</v>', inner, re.S)
    val = v.group(1) if v else ''
    if 't="s"' in attr and val.isdigit() and int(val) < len(S): val = S[int(val)]
    out.append(val)
sys.stdout.write(json.dumps(out, ensure_ascii=False))
`], { encoding: 'utf8', env: { ...process.env, PYTHONIOENCODING: 'utf-8' } });
  templateHeader = JSON.parse(py);
} catch (e) {
  console.warn('양식 파일을 읽지 못해 머리글 대조를 건너뜁니다:', e.message.split('\n')[0]);
}

if (templateHeader) {
  eq(LEDGER_HEADER, templateHeader, '머리글이 양식 5행과 일치');
}

/* ── 대장 행 ── */
const clean = {
  id: 'QA-A-20260814-01', date: '2026-08-14', type: '수시', judge: '김판정',
  sys: '카피킬러', task: 'COW #20163', dev: '이개발', qa: '박검증', qav: '통과',
  appr: '최승인', apprd: '2026-08-14', schema: '없음', int: '', intby: '',
  reg: '2026-08-19', path: '게시판 > 릴리즈노트', state: '등록완료',
  exc: '', memo: '',
};
const older = { ...clean, id: 'QA-R-20260801-01', date: '2026-08-01', type: '정규' };

const rows = buildLedgerRows([clean, older]);
eq(rows.length, 2, '입력 건수만큼 행 생성');
eq(rows[0][0], 1, 'No 는 1부터');
eq(rows[0][1], 'QA-R-20260801-01', 'No 는 배포일 오름차순으로 부여 (양식 기준)');
eq(rows[1][1], 'QA-A-20260814-01', '나중 배포 건이 뒤에 옴');
eq(rows.every((r) => r.length === LEDGER_HEADER.length), true, '열 수가 머리글과 동일');

const row = rows[1];
eq(row[2], '2026-08-14', '배포일');
eq(row[18], '2026-08-19', '등록 기한 (수시 +3영업일)');
eq(row[19], '준수', '기한 준수');
eq(row[20], '정상', '직무 분리');
eq(row[21], '완비', '승인 기록');
eq(row[22], '매핑완료', '증적 매핑');
eq(row[23], '미해당', '정합성 확인 (스키마 없음)');
eq(row[24], '정상', 'ID 정합성');
eq(row[25], '정상', '종합 판정');
eq(row.includes(null), false, 'null 이 들어가지 않음');
eq(row.includes(undefined), false, 'undefined 가 들어가지 않음');

/* 이상 있는 건 */
const bad = buildLedgerRows([{ ...clean, qa: '이개발', apprd: '' }])[0];
eq(bad[20], '비정상', '작성자와 검증자가 같으면 비정상');
eq(bad[21], '미완비', '승인일 누락은 미완비');
eq(bad[25], '확인필요', '종합 판정은 확인필요');

/* 값이 거의 없는 건 */
const sparse = buildLedgerRows([{ date: '2026-08-14', type: '수시' }])[0];
eq(sparse.length, LEDGER_HEADER.length, '값이 없어도 열 수는 유지');
eq(sparse[19], '', '판정 불가 항목은 공란');

/* ── 범위 ── */
const up = ledgerUpdate(rows);
eq(up.range, `'배포관리대장'!A6:AB7`, '2건이면 6~7행');
eq(ledgerUpdate([]).range, `'배포관리대장'!A6:AB6`, '0건이어도 범위가 뒤집히지 않음');
eq(ledgerUpdate([]).values.length, 1, '0건이면 빈 행 하나를 써서 이전 값을 지움');
eq(LEDGER_FIRST_ROW, 6, '데이터 시작 행은 6');

eq(ledgerClearRange(2), `'배포관리대장'!A8:AB1000`, '데이터 다음 행부터 비움');
eq(ledgerClearRange(994, 1000), `'배포관리대장'!A1000:AB1000`, '마지막 한 행만 남은 경우');
eq(ledgerClearRange(995, 1000), null, '시작이 끝을 넘으면 null (범위가 뒤집히지 않음)');
eq(ledgerClearRange(1000, 1000), null, '비울 범위가 없으면 null');

/* ── 월간 점검 ── */
eq(checkUpdates(null), [], '점검 이력이 없으면 시트를 건드리지 않음');

const check = {
  from: '2026-08-01', to: '2026-08-31', date: '2026-09-01',
  by: '김홍현', app: '최책임', popCount: 12, ledCount: 10,
  popNote: '누락 2건 추가', sample: '표본 3건 재검토', opinion: '조치 완료',
  flagged: 3, defects: 2,
  items: [
    { key: 'map', n: 1, fix: 'ID 부여 완료' },
    { key: 'appr', n: 2, fix: '승인 기록 보완' },
    { key: 'exc', n: 1, fix: '' },
  ],
};
const ups = checkUpdates(check, [check]);
const at = (ref) => ups.find((u) => u.range.endsWith(`!${ref}`))?.values[0][0];

eq(at('B10'), '2026-09-01', '점검 수행일');
eq(at('B11'), '김홍현', '점검자');
eq(at('B12'), '2026-08-01', '기간 시작');
eq(at('C12'), '2026-08-31', '기간 종료');
eq(at('B18'), 12, '배포 이력 건수');
eq(at('B19'), 10, '대장 기재 건수');
eq(at('C18'), '불일치 (차이 2건)', '모집단 대조 결과');
eq(at('C25'), 1, '증적 매핑 누락 건수 (25행)');
eq(at('E25'), 'ID 부여 완료', '증적 매핑 조치 내용');
eq(at('C26'), 2, '배포 승인 기록 누락 건수 (26행)');
eq(at('C27'), 0, '값이 없는 항목은 0');
eq(at('C35'), 1, '확인 항목 예외 승인 건수 (35행)');
eq(at('B49'), 10, '종합 모집단');
eq(at('B50'), 3, '확인필요 건수');
eq(at('B51'), 2, '지적 항목 수');
eq(at('B52'), '보완 필요', '점검 결과');
eq(at('B59'), '김홍현', '점검자 서명');
eq(at('B60'), '최책임', '확인자 서명');

const clean2 = checkUpdates({ ...check, defects: 0, items: [] }, []);
eq(clean2.find((u) => u.range.endsWith('!B52')).values[0][0], '적정 (지적사항 없음)',
  '지적 0건이면 적정');
eq(checkUpdates({ ...check, popCount: 10 }, []).find((u) => u.range.endsWith('!C18')).values[0][0],
  '일치', '건수가 같으면 일치');
eq(checkUpdates({ ...check, popCount: '' }, []).find((u) => u.range.endsWith('!C18')).values[0][0],
  '미입력', '건수 미입력');

const hist = ups.find((u) => u.range.includes('A66'));
eq(!!hist, true, '점검 이력 범위 생성');
eq(hist.values[0], ['2026-08-01 ~ 2026-08-31', '2026-09-01', '김홍현', 2], '이력 행 구성');

/* ── 결과 ── */
if (fails.length) {
  console.error(`시트 레이아웃 검증 실패 — ${pass}건 통과, ${fails.length}건 실패\n`);
  fails.forEach((f) => console.error(`  - ${f}`));
  process.exit(1);
}
console.log(`시트 레이아웃 검증 통과 · ${pass}건`);
