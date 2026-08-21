/**
 * Google Sheets 접근 (서비스 계정)
 *
 * googleapis 패키지를 쓰지 않고 JWT 를 직접 만들어 토큰을 받습니다.
 * 필요한 기능이 값 읽기·쓰기·비우기 세 가지뿐이라, 의존성을 늘리는 것보다
 * 이쪽이 감사 관점에서 확인하기 쉽습니다.
 *
 * 필요한 환경변수
 *   GOOGLE_SA_EMAIL        서비스 계정 이메일
 *   GOOGLE_SA_PRIVATE_KEY  서비스 계정 비공개 키 (PEM. \n 이 escape 되어 있어도 됩니다)
 *   GOOGLE_SHEET_ID        대상 스프레드시트 ID
 */
import { createSign } from 'node:crypto';

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const SCOPE = 'https://www.googleapis.com/auth/spreadsheets';
const API = 'https://sheets.googleapis.com/v4/spreadsheets';

export function sheetConfig() {
  const email = process.env.GOOGLE_SA_EMAIL;
  const key = process.env.GOOGLE_SA_PRIVATE_KEY;
  const sheetId = process.env.GOOGLE_SHEET_ID;
  const missing = [
    !email && 'GOOGLE_SA_EMAIL',
    !key && 'GOOGLE_SA_PRIVATE_KEY',
    !sheetId && 'GOOGLE_SHEET_ID',
  ].filter(Boolean);
  return { email, key, sheetId, missing };
}

const b64url = (buf) =>
  Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

/* 서버리스 인스턴스가 재사용되는 동안 토큰을 다시 받지 않습니다. */
let cached = null;

async function accessToken() {
  const { email, key, missing } = sheetConfig();
  if (missing.length) {
    throw new Error(`Google 연동 환경변수가 없습니다: ${missing.join(', ')}`);
  }
  if (cached && cached.exp > Date.now() + 60_000) return cached.token;

  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claims = b64url(JSON.stringify({
    iss: email, scope: SCOPE, aud: TOKEN_URL, iat: now, exp: now + 3600,
  }));

  /* Vercel 환경변수에는 줄바꿈을 \n 으로 넣게 되므로 되돌립니다. */
  const pem = key.replace(/\\n/g, '\n');
  const signer = createSign('RSA-SHA256');
  signer.update(`${header}.${claims}`);
  const jwt = `${header}.${claims}.${b64url(signer.sign(pem))}`;

  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt,
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(
      `Google 토큰 발급 실패 (${res.status}): ${data.error_description ?? data.error ?? '원인 불명'}`
    );
  }
  cached = { token: data.access_token, exp: Date.now() + (data.expires_in ?? 3600) * 1000 };
  return cached.token;
}

async function call(path, init = {}) {
  const { sheetId } = sheetConfig();
  const token = await accessToken();
  const res = await fetch(`${API}/${sheetId}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(init.headers ?? {}),
    },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = data?.error?.message ?? '원인 불명';
    /* 권한 누락이 가장 흔한 실패이므로 조치를 함께 안내합니다. */
    if (res.status === 403) {
      throw new Error(`시트 접근 권한이 없습니다. 대상 시트를 서비스 계정 이메일에 편집자로 공유하십시오. (${msg})`);
    }
    if (res.status === 404) {
      throw new Error(`시트를 찾을 수 없습니다. GOOGLE_SHEET_ID 를 확인하십시오. (${msg})`);
    }
    throw new Error(`Google Sheets 오류 (${res.status}): ${msg}`);
  }
  return data;
}

/** 범위 하나를 읽습니다. */
export function readRange(range) {
  return call(`/values/${encodeURIComponent(range)}`);
}

/** 여러 범위를 한 번에 씁니다. 날짜·숫자는 시트 서식에 맞게 해석됩니다. */
export function writeRanges(data) {
  return call('/values:batchUpdate', {
    method: 'POST',
    body: JSON.stringify({ valueInputOption: 'USER_ENTERED', data }),
  });
}

/** 값만 비웁니다. 서식은 남습니다. */
export function clearRanges(ranges) {
  if (!ranges.length) return Promise.resolve({});
  return call('/values:batchClear', {
    method: 'POST',
    body: JSON.stringify({ ranges }),
  });
}

/** 시트 제목과 탭 목록. 설정 확인용입니다. */
export function spreadsheetInfo() {
  return call('?fields=properties.title,sheets.properties.title');
}
