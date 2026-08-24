/**
 * CSV 생성과 무결성
 *
 * 반출본은 서버가 만들고 해시도 서버가 계산합니다. 화면이 만든 파일의 해시를
 * 화면이 계산해 보내면, 값을 고친 파일에 맞는 해시를 함께 보낼 수 있어
 * 무결성 증명이 되지 않습니다.
 *
 * Excel 호환을 위해 BOM 과 CRLF 를 씁니다.
 */
import { createHash } from 'node:crypto';

/**
 * 수식으로 해석될 수 있는 값 앞에 작은따옴표를 붙입니다.
 *
 * `=`, `+`, `-`, `@`, 탭, 개행으로 시작하는 셀은 Excel·Sheets 가 수식으로
 * 실행합니다. 대장에 그런 값을 넣어 두면 반출본을 여는 사람의 PC 에서
 * 실행되므로, 반출 시점에 문자열로 고정합니다.
 *
 * 값을 바꾸는 처리이므로 해당하는 셀에만 적용하고, 안내서에 남겨 둡니다.
 */
const RISKY = /^[=+\-@\t\r]/;

function guard(v) {
  const s = v === null || v === undefined ? '' : String(v);
  return RISKY.test(s) ? `'${s}` : s;
}

/** 행 배열을 CSV 문자열로 만듭니다. */
export function toCsv(rows) {
  const body = rows
    .map((r) => r.map((c) => `"${guard(c).replace(/"/g, '""')}"`).join(','))
    .join('\r\n');
  return `﻿${body}`;
}

/** 반출본 무결성 확인용 해시 */
export function sha256(text) {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}
