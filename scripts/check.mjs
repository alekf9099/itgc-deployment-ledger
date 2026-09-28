/**
 * index.html 정합성 검사
 *
 * 단일 HTML 파일로 관리되는 앱이므로, 손으로 편집하다 생긴 문법 오류가
 * 그대로 배포되면 화면이 통째로 비어 대장을 열 수 없게 됩니다.
 * PR 단계에서 다음을 확인합니다.
 *
 *   1. 문서 골격 (doctype / html / head / body)
 *   2. <script> 블록의 JavaScript 문법
 *   3. 코드가 참조하는 element id가 마크업에 실제로 존재하는지
 *   4. APP_VERSION 표기
 */
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const FILE = 'index.html';
const html = readFileSync(FILE, 'utf8');
const fail = [];

/* 1. 문서 골격 */
for (const [name, re] of [
  ['<!doctype html>', /^<!doctype html>/i],
  ['<html lang="ko">', /<html\s+lang="ko">/i],
  ['<head>', /<head>/i],
  ['</head>', /<\/head>/i],
  ['<body>', /<body>/i],
  ['</body>', /<\/body>/i],
  ['</html>', /<\/html>/i],
]) {
  if (!re.test(html)) fail.push(`문서 골격 누락: ${name}`);
}

/* 2. script 문법 */
const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
if (!scripts.length) fail.push('<script> 블록을 찾지 못했습니다');

const dir = mkdtempSync(join(tmpdir(), 'ledger-check-'));
scripts.forEach((src, i) => {
  const f = join(dir, `block-${i}.js`);
  writeFileSync(f, src);
  try {
    execFileSync(process.execPath, ['--check', f], { stdio: 'pipe' });
  } catch (e) {
    fail.push(`script #${i + 1} 문법 오류\n${e.stderr?.toString() ?? e.message}`);
  }
});

/* 3. 참조 id 존재 여부 */
const declared = new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]));
const referenced = new Set(
  scripts.flatMap((s) => [...s.matchAll(/\$\('([A-Za-z0-9_-]+)'\)/g)].map((m) => m[1]))
);
// F 맵과 CHECKS 등에서 문자열 상수로만 쓰이는 id도 대상에 넣습니다.
for (const m of scripts.join('\n').matchAll(/'(f_[a-z]+)'/g)) referenced.add(m[1]);

const missing = [...referenced].filter((id) => !declared.has(id)).sort();
if (missing.length) fail.push(`코드가 참조하는 id가 마크업에 없습니다: ${missing.join(', ')}`);

/* 3-2. 호출하는 함수가 정의되어 있는지
   문법 검사는 정의되지 않은 함수 호출을 잡지 못합니다. v2.10.0 에서
   saveCheck·queueDraft 가 지워진 채 배포되어, 월간 점검 확정 버튼이
   누를 때 오류로 멈추는 상태가 다섯 버전 동안 남아 있었습니다. */
const code = scripts.join('\n')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/\/\/[^\n]*/g, '')
  .replace(/`(?:\\.|[^`\\])*`|'(?:\\.|[^'\\\n])*'|"(?:\\.|[^"\\\n])*"/g, '""');
const defined = new Set([
  ...[...code.matchAll(/\b(?:function|class)\s+([A-Za-z_$][\w$]*)/g)].map((m) => m[1]),
  ...[...code.matchAll(/\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=/g)].map((m) => m[1]),
  ...[...code.matchAll(/\b(?:const|let|var)\s+([A-Za-z_$][\w$]*(?:\s*=[^,;]*)?(?:\s*,\s*[A-Za-z_$][\w$]*(?:\s*=[^,;]*)?)+)/g)]
    .flatMap((m) => m[1].split(',').map((p) => p.trim().split(/\s|=/)[0])),
]);
const GLOBAL = new Set(['if', 'for', 'while', 'switch', 'catch', 'return', 'typeof', 'function',
  'fetch', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'confirm', 'alert', 'prompt',
  'encodeURIComponent', 'decodeURIComponent', 'parseInt', 'parseFloat', 'isNaN', 'String', 'Number',
  'Boolean', 'Array', 'Object', 'Date', 'Math', 'JSON', 'Promise', 'Error', 'Set', 'Map', 'RegExp',
  'URL', 'URLSearchParams', 'Blob', 'requestAnimationFrame', 'structuredClone', 'await', 'super',
  'async', 'constructor']);
/* 선언 없이 쓰는 매개변수·지역 화살표 함수는 소문자 한 단어가 많아, 정의
   집합에 없는 이름만 추려 사람이 읽을 수 있을 만큼 좁힙니다. */
const called = new Set([...code.matchAll(/(?<![\w$.])([A-Za-z_$][\w$]*)\s*\(/g)].map((m) => m[1]));
const undef = [...called].filter((n) => !defined.has(n) && !GLOBAL.has(n) && n.length > 2).sort();
if (undef.length) fail.push(`정의되지 않은 함수를 호출합니다: ${undef.join(', ')}`);

/* 4. 버전 표기 */
const v = html.match(/const APP_VERSION\s*=\s*'([^']+)'/);
if (!v) fail.push("APP_VERSION 상수를 찾지 못했습니다");
else if (!/^\d+\.\d+\.\d+$/.test(v[1])) fail.push(`APP_VERSION 형식 오류: ${v[1]} (x.y.z)`);

if (fail.length) {
  console.error('검사 실패\n');
  fail.forEach((f) => console.error(`  - ${f}`));
  process.exit(1);
}

console.log(`검사 통과 · ${FILE} · v${v[1]} · id ${declared.size}개 / 참조 ${referenced.size}개`);
