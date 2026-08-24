/**
 * lib/csv.js 검증
 *
 *   node scripts/test-csv.mjs
 *
 * 반출본의 형식과 해시는 증적의 무결성을 증명하는 값입니다. 같은 입력에서
 * 항상 같은 결과가 나와야 하고, 수식으로 실행될 수 있는 값이 그대로
 * 나가지 않아야 합니다.
 */
import { toCsv, sha256 } from '../lib/csv.js';

let pass = 0;
const fails = [];
const eq = (a, b, label) => {
  const x = JSON.stringify(a), y = JSON.stringify(b);
  if (x === y) pass++;
  else fails.push(`${label}\n      기대 ${y}\n      실제 ${x}`);
};

/* ── 형식 ── */
const BOM = '﻿';
eq(toCsv([['a', 'b']]), `${BOM}"a","b"`, '기본 인용');
eq(toCsv([['a'], ['b']]), `${BOM}"a"\r\n"b"`, '행 구분은 CRLF');
eq(toCsv([[]]), `${BOM}`, '빈 행');
eq(toCsv([['따옴표 "안" 값']]), `${BOM}"따옴표 ""안"" 값"`, '따옴표는 두 번으로 escape');
eq(toCsv([['쉼표,포함']]), `${BOM}"쉼표,포함"`, '쉼표는 인용으로 처리');
eq(toCsv([['줄\n바꿈']]), `${BOM}"줄\n바꿈"`, '값 안의 줄바꿈은 인용 안에 유지');
eq(toCsv([[null, undefined, 0]]), `${BOM}"","","0"`, 'null·undefined 는 빈 값, 0 은 유지');
eq(toCsv([[1, 2]]), `${BOM}"1","2"`, '숫자도 문자열로 인용');

/* ── 수식 주입 방어 ── */
/* Excel·Sheets 가 수식으로 실행하는 시작 문자는 문자열로 고정합니다. */
eq(toCsv([['=1+1']]), `${BOM}"'=1+1"`, '= 로 시작하면 작은따옴표를 붙임');
eq(toCsv([['+1']]), `${BOM}"'+1"`, '+ 로 시작');
eq(toCsv([['-1']]), `${BOM}"'-1"`, '- 로 시작');
eq(toCsv([['@SUM(A1)']]), `${BOM}"'@SUM(A1)"`, '@ 로 시작');
eq(toCsv([['\tTAB']]), `${BOM}"'\tTAB"`, '탭으로 시작');
eq(toCsv([['=HYPERLINK("http://x","클릭")']]),
  `${BOM}"'=HYPERLINK(""http://x"",""클릭"")"`, '수식 + 따옴표가 함께 있는 경우');

/* 정상 값은 건드리지 않습니다. */
eq(toCsv([['QA-A-20260814-01']]), `${BOM}"QA-A-20260814-01"`, '증적 문서 ID 는 그대로');
eq(toCsv([['2026-08-14']]), `${BOM}"2026-08-14"`, '날짜는 그대로');
eq(toCsv([['카피킬러 / muhayu-repo']]), `${BOM}"카피킬러 / muhayu-repo"`, '시스템명은 그대로');
eq(toCsv([['게시판 > 릴리즈노트']]), `${BOM}"게시판 > 릴리즈노트"`, '경로는 그대로');
eq(toCsv([['통과']]), `${BOM}"통과"`, '판정값은 그대로');

/* ── 해시 ── */
const a = toCsv([['x']]);
eq(sha256(a) === sha256(toCsv([['x']])), true, '같은 입력은 같은 해시');
eq(sha256(a) === sha256(toCsv([['y']])), false, '다른 입력은 다른 해시');
eq(sha256(a).length, 64, 'SHA-256 은 64자 16진수');
eq(/^[0-9a-f]{64}$/.test(sha256(a)), true, '16진 소문자');
/* 알려진 값으로 계산이 맞는지 확인 */
eq(sha256(''), 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
  '빈 문자열 해시가 표준값과 일치');

if (fails.length) {
  console.error(`반출본 검증 실패 — ${pass}건 통과, ${fails.length}건 실패\n`);
  fails.forEach((f) => console.error(`  - ${f}`));
  process.exit(1);
}
console.log(`반출본 검증 통과 · ${pass}건`);
