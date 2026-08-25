/**
 * 서비스 계정 비공개 키 정리
 *
 * 환경변수에 키를 붙여넣는 과정에서 값이 여러 형태로 들어옵니다.
 *
 *   - 줄바꿈이 \n 으로 escape 된 형태 (JSON 에서 복사한 그대로)
 *   - 실제 줄바꿈이 들어간 형태
 *   - 값 전체가 따옴표로 감싸인 형태
 *   - 키 JSON 파일을 통째로 붙여넣은 형태
 *   - base64 로 감싼 형태
 *
 * 어느 쪽이든 받아들이되, 끝내 PEM 이 아니면 무엇이 잘못됐는지 알립니다.
 * OpenSSL 이 내는 `error:1E08010C:DECODER routines::unsupported` 만으로는
 * 무엇을 고쳐야 할지 알 수 없습니다.
 */

const NL = '\n';
const ESCAPED_CRLF = '\\r\\n';
const ESCAPED_LF = '\\n';

const BEGIN = /-----BEGIN [A-Z ]*PRIVATE KEY-----/;
const END = /-----END [A-Z ]*PRIVATE KEY-----/;
const BASE64_ONLY = /^[A-Za-z0-9+/=\s]+$/;

export function normalizePem(raw) {
  let k = String(raw ?? '').trim();

  /* 값 전체를 따옴표로 감싼 경우 */
  const quoted =
    (k.startsWith('"') && k.endsWith('"')) || (k.startsWith("'") && k.endsWith("'"));
  if (quoted) k = k.slice(1, -1).trim();

  /* 키 JSON 을 통째로 붙여넣은 경우 */
  if (k.startsWith('{')) {
    try {
      const j = JSON.parse(k);
      if (j.private_key) k = String(j.private_key);
    } catch {
      /* JSON 이 아니면 그대로 둡니다 */
    }
  }

  /* base64 로 감싸 넣은 경우 */
  if (!k.includes('BEGIN') && k.length > 100 && BASE64_ONLY.test(k)) {
    try {
      const decoded = Buffer.from(k, 'base64').toString('utf8');
      if (decoded.includes('BEGIN')) k = decoded;
    } catch {
      /* base64 가 아니면 그대로 둡니다 */
    }
  }

  /* escape 된 줄바꿈을 실제 줄바꿈으로 되돌립니다. */
  k = k.split(ESCAPED_CRLF).join(NL).split(ESCAPED_LF).join(NL);
  k = k.split('\r\n').join(NL).trim();

  if (!BEGIN.test(k) || !END.test(k)) {
    throw new Error(
      'GOOGLE_SA_PRIVATE_KEY 가 PEM 형식이 아닙니다. 키 JSON 파일의 private_key 값을 ' +
        '-----BEGIN PRIVATE KEY----- 부터 -----END PRIVATE KEY----- 까지 통째로 넣으십시오. ' +
        `(현재 길이 ${k.length}자, BEGIN ${k.includes('BEGIN') ? '있음' : '없음'}, ` +
        `END ${k.includes('END') ? '있음' : '없음'})`
    );
  }

  /* PEM 은 마지막 줄바꿈이 있어야 합니다. */
  return k + NL;
}
