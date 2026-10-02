/**
 * 판정 및 월간 점검 집계 (서버 기준)
 *
 * 월간 점검 결과는 통제 운영의 증거이므로, 집계를 브라우저가 계산해 보내면
 * 요청을 직접 만들어 「지적 0건」으로 저장할 수 있습니다. 저장되는 수치는
 * 서버가 대장 데이터에서 다시 계산합니다.
 *
 * 점검 항목의 이름·판단 기준도 여기에 둡니다. 화면은 서버가 준 항목을
 * 그대로 그립니다. 정의가 양쪽에 있으면 한쪽만 바뀌어 어긋납니다.
 *
 * 날짜는 모두 'YYYY-MM-DD' 문자열로 다룹니다. 사전순 비교가 날짜순 비교와
 * 같아 시간대 변환에서 하루가 밀리는 문제를 피할 수 있습니다.
 */

export const CODE = { 정규: 'R', 수시: 'A', 핫픽스: 'E' };

/** 등록 기한 = 배포일 + N영업일 */
const OFFSET = { 정규: 0, 수시: 3, 핫픽스: 2 };

const pad = (n) => String(n).padStart(2, '0');

/**
 * 증적 문서 ID 형식
 *
 * 현재 체계는 `QA-{검증 완료일 YYYYMMDD}-{일련 2자리}` 입니다. 유형은 ID 가
 * 아니라 「릴리즈 구분」 열로만 관리합니다.
 *
 * 기준일은 배포일이 아니라 **검증 완료일**입니다. QA 완료 보고서 V2 가
 * "증적 문서 ID 는 최종 회차 검증 완료일 기준으로 부여하며 대장 기재값과
 * 동일해야 한다"로 정하고 있어, 대장이 배포일을 기준으로 잡으면 사후 검증
 * 건에서 보고서와 대장의 ID 가 서로 다른 값이 됩니다.
 *
 * 검증 완료일이 비어 있는 건은 배포일로 대조합니다. 새 항목이 생기기 전에
 * 등록된 건을 한꺼번에 불일치로 만들지 않기 위한 것이며, 검증 완료일 자체의
 * 누락은 「검증 완료일」 판정이 따로 잡습니다.
 *
 * 유형코드가 들어간 구 형식(`QA-A-20260814-01`)도 인정합니다. 이미 부여된
 * ID 는 바꾸지 않는 것이 원칙이라, 새 규칙을 적용하면서 기존 건을 형식 위반으로
 * 만들면 안 됩니다. 구 형식은 유형코드도 함께 검사합니다.
 */
const ID_CURRENT = /^QA-(\d{8})-(\d{2,})$/;
const ID_LEGACY = /^QA-([RAE])-(\d{8})-(\d{2,})$/;

/**
 * 워크플로우 코드 (v2.22.0 부터 기본)
 *
 * 회사 워크플로우가 릴리즈(R)·프로젝트(P)·일감(T)을 코드로 관리하므로, 보고서의
 * 증적 문서 ID 도 그 코드를 씁니다. 대장 ↔ 보고서 ↔ 워크플로우가 같은 값으로
 * 이어져, 감사인이 어느 쪽에서 출발해도 바로 찾아갈 수 있습니다.
 *
 *   R1052      릴리즈 단위 보고서
 *   P953       프로젝트 보고서
 *   T2886      일감 단위 보고서 (프로젝트가 없는 수시 · 핫픽스)
 *   P1166-02   같은 대상을 다시 검증한 보고서 (2회차)
 *
 * 코드에는 날짜가 없으므로 검증 완료일과의 날짜 대조는 QA 번호에만 적용합니다.
 * 워크플로우 코드가 없는 배포는 지금처럼 QA 번호를 붙입니다.
 */
const ID_WORKFLOW = /^([RPT])(\d{3,})(?:-(\d{2}))?$/;

/** 문자열에 들어 있는 릴리즈 코드(R1003 등). 일감/릴리즈 식별자와 ID 를 대조할 때 씁니다. */
export function releaseCodes(s) {
  return [...String(s ?? '').matchAll(/(?<![A-Za-z0-9])R(\d{3,})(?![0-9])/g)].map((m) => `R${m[1]}`);
}

/**
 * 한 배포 건에 걸린 증적 문서 ID 목록
 *
 * 정규 릴리즈 하나에 프로젝트가 여러 개 들어가면 보고서도 여러 개입니다.
 * 대장의 한 줄은 배포 1건(모집단 단위)이고, 그 배포의 보고서 ID 를 모두
 * 적습니다. 쉼표·공백·줄바꿈 어느 것으로 구분해도 같은 목록으로 봅니다.
 */
export function splitDocIds(s) {
  return String(s ?? '').split(/[\s,，、]+/).map((x) => x.trim()).filter(Boolean);
}

/** 저장 형식. 구분자를 하나로 맞춰 같은 목록이 다른 문자열로 저장되지 않게 합니다. */
export function normalizeDocIds(s) {
  return splitDocIds(s).join(', ');
}

/**
 * 담당자 목록
 *
 * 변경 작성자·검증 수행자에 여러 명을 쉼표로 적을 수 있습니다. 직무 분리는
 * 두 목록에 **한 사람이라도 겹치면** 위반입니다. 이름 전체를 통째로 비교하면
 * 「이개발, 박개발」과 「박개발」이 다른 값이 되어 위반을 놓칩니다.
 */
export function splitNames(s) {
  return String(s ?? '').split(/[,，、/·]+/).map((x) => x.trim()).filter(Boolean);
}

export function parseDocId(id) {
  const s = String(id ?? '').trim();
  let m = ID_WORKFLOW.exec(s);
  if (m) return { kind: 'wf', prefix: m[1], ref: `${m[1]}${m[2]}`, round: m[3] ? Number(m[3]) : 1, date: null, code: null };
  m = ID_CURRENT.exec(s);
  if (m) return { kind: 'qa', date: m[1], seq: Number(m[2]), code: null };
  m = ID_LEGACY.exec(s);
  if (m) return { kind: 'qa', date: m[2], seq: Number(m[3]), code: m[1] };
  return null;
}
const fmt = (d) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
const ymd = (s) => (s ? s.replaceAll('-', '') : '');

/** 주말을 제외하고 n영업일 뒤 날짜를 돌려줍니다. */
function workday(dateStr, n) {
  const d = new Date(`${dateStr}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return null;
  let left = n;
  while (left > 0) {
    d.setUTCDate(d.getUTCDate() + 1);
    const w = d.getUTCDay();
    if (w !== 0 && w !== 6) left--;
  }
  return fmt(d);
}

/** 증적 등록 기한. 값이 없으면 null */
export function deadline(r) {
  if (!r.date || !r.type || OFFSET[r.type] === undefined) return null;
  return OFFSET[r.type] === 0 ? r.date : workday(r.date, OFFSET[r.type]);
}

/** 증적 문서 ID 의 기준일. 검증 완료일이 원칙이고, 없으면 배포일로 봅니다. */
export function idBaseDate(r) {
  return r.vdate || r.date || '';
}

/** 「실패(반려)」는 이전 표기입니다. 비교는 항상 현재 표기로 합니다. */
const isFail = (v) => v === '실패' || v === '실패(반려)';

/** 보류 이슈(즉시·긴급 / 높음) 합계. 둘 다 미입력이면 null */
function holdCount(r) {
  const n = (v) => (String(v ?? '').trim() === '' ? null : Number(v));
  const c = n(r.holdc);
  const h = n(r.holdh);
  if (c === null && h === null) return null;
  return (c ?? 0) + (h ?? 0);
}

/**
 * 아홉 판정 항목. 'ok' | 'bad' | 'na' | null(미판정)
 * 화면의 judge() 와 같은 규칙입니다.
 */
export function judge(r) {
  const dl = deadline(r);
  const v = { deadline: dl };

  v.term = !dl || !r.reg ? null : r.reg <= dl ? 'ok' : 'bad';
  if (!r.dev || !r.qa) v.sod = null;
  else {
    const devs = splitNames(r.dev);
    v.sod = splitNames(r.qa).some((n) => devs.includes(n)) ? 'bad' : 'ok';
  }
  /* 승인 기록
     이름과 날짜가 있는지만 보면 「배포한 뒤에 받은 승인」과 「개발자가 자기
     배포를 승인한 것」을 잡지 못합니다. 운영 배포를 인프라와 개발이 함께
     하므로, 개발자가 배포하더라도 배포 전에 개발자가 아닌 사람이 승인했다는
     것이 통제의 근거입니다. 핫픽스는 사후 승인이 허용되며 사유를 남깁니다. */
  if (!r.date) v.appr = null;
  else if (!r.appr || !r.apprd) v.appr = 'bad';
  else if (r.apprd > r.date && !(r.type === '핫픽스' && String(r.memo ?? '').trim())) v.appr = 'bad';
  else if (splitNames(r.appr).some((n) => splitNames(r.dev).includes(n))) v.appr = 'bad';
  else v.appr = 'ok';

  /* 배포 수행 — 누가 운영에 반영했는지. 개발자가 직접 배포했는지 확인하는 근거입니다. */
  v.dep = !r.date ? null : String(r.deployer ?? '').trim() ? 'ok' : 'bad';
  v.map = !r.date ? null : r.state === '해당없음' ? 'na' : r.id ? 'ok' : 'bad';

  if (!r.schema) v.integ = null;
  else if (r.schema === '없음') v.integ = r.int ? 'bad' : 'na';
  else if (r.int === '완료' && r.intby) v.integ = 'ok';
  else v.integ = 'bad';

  /* ID 정합성 — 여러 ID 인 경우
     각 보고서의 ID 는 그 보고서의 검증 완료일로 부여되고, 대장의 검증 완료일은
     그중 **가장 늦은 날**(릴리즈 전체의 최종 검증일)입니다. 그래서
       · 모든 ID 의 날짜 ≤ 검증 완료일      (검증 완료 뒤에 부여된 ID 는 없음)
       · 검증 완료일과 같은 날짜의 ID 가 있음 (최종일이 실제 보고서와 맞음)
     을 봅니다. ID 가 하나면 "날짜 = 검증 완료일" 과 같은 규칙입니다. */
  /* 워크플로우 코드는 날짜가 없어 형식 · 중복 · 릴리즈 코드 대조만 봅니다.
     날짜 대조는 QA 번호에만 적용하고, 모든 ID 가 QA 번호일 때만 「검증 완료일과
     같은 날짜의 ID」를 요구합니다(섞여 있으면 최종 검증일의 보고서가 코드일 수 있음). */
  const base = idBaseDate(r);
  const ids = splitDocIds(r.id);
  if (!ids.length || !base) v.idc = null;
  else {
    const parsed = ids.map(parseDocId);
    const b = ymd(base);
    const qa = parsed.filter((p) => p && p.kind === 'qa');
    const taskR = releaseCodes(r.task);
    const idR = parsed.filter((p) => p && p.kind === 'wf' && p.prefix === 'R').map((p) => p.ref);
    if (parsed.some((p) => !p)) v.idc = 'bad';                            // 형식 위반
    else if (new Set(ids).size !== ids.length) v.idc = 'bad';             // 같은 ID 반복
    else if (taskR.length && idR.some((x) => !taskR.includes(x))) v.idc = 'bad';   // 다른 릴리즈 코드
    else if (qa.some((p) => p.date > b)) v.idc = 'bad';                   // 검증 완료일 이후 날짜
    else if (qa.length === parsed.length && !qa.some((p) => p.date === b)) v.idc = 'bad'; // 최종일 ID 없음
    /* 구 형식의 유형코드는 남아 있는 값이므로 그대로 검사합니다. */
    else if (qa.some((p) => p.code && (!r.type || p.code !== CODE[r.type]))) v.idc = 'bad';
    else v.idc = 'ok';
  }

  /* 검증 완료일
     보고서의 「검증 완료 일시」에 해당합니다. ID 의 기준일이므로 비워둘 수
     없습니다. 배포보다 늦게 검증한 건(사후 검증)은 보고서 규칙상 사유를
     남겨야 하므로, 비고가 비어 있으면 미비로 봅니다. */
  if (!r.date) v.vfy = null;
  else if (!r.vdate) v.vfy = 'bad';
  else if (r.vdate > r.date && !String(r.memo ?? '').trim()) v.vfy = 'bad';
  else v.vfy = 'ok';

  /* QA 판정 적정성
     보고서 V2 판정 기준 — 즉시·긴급 또는 높음 등급의 미해결 보류가 남아
     있으면 「통과」로 판정할 수 없습니다.
     판정자·판정일은 보고서 「1. 요약」에서 관리하고 대장에서는 받지 않습니다
     (v2.19.1). 판정 권한 확인은 보고서로 합니다. */
  const held = holdCount(r);
  if (!r.qav) v.verd = null;
  else if (held !== null && held > 0 && r.qav === '통과') v.verd = 'bad';
  else v.verd = 'ok';

  /* 요구사항 일치
     보고서 V2 — 근거 없이 요청과 다르면 「불일치」로 하고, 이 경우 판정은
     「조건부 통과」 이상으로 한다. 즉 불일치 + 통과 조합은 성립하지 않습니다. */
  if (!r.date) v.reqm = null;
  else if (!r.req) v.reqm = 'bad';
  else if (r.req === '불일치' && r.qav === '통과') v.reqm = 'bad';
  else v.reqm = 'ok';

  v.flag = ['term', 'sod', 'appr', 'dep', 'map', 'integ', 'idc', 'vfy', 'verd', 'reqm']
    .some((k) => v[k] === 'bad');
  v.overall = !r.date ? null : v.flag ? '확인필요' : '정상';
  v.fail = isFail(r.qav);
  return v;
}

/** 판정값을 대장에 기재하는 문구. 엑셀 양식의 표기와 같습니다. */
export const VERDICT_LABEL = {
  term: { ok: '준수', bad: '미준수' },
  sod: { ok: '정상', bad: '비정상' },
  appr: { ok: '완비', bad: '미완비' },
  map: { ok: '매핑완료', bad: '매핑미완료', na: '해당없음' },
  integ: { ok: '정상', bad: '비정상', na: '미해당' },
  idc: { ok: '정상', bad: '불일치' },
  vfy: { ok: '정상', bad: '미비' },
  verd: { ok: '적정', bad: '부적정' },
  reqm: { ok: '확인', bad: '미확인' },
  dep: { ok: '기재', bad: '미기재' },
};

/**
 * 점검 항목 정의
 *
 * isDef=true 는 지적 항목이며 1건 이상이면 조치 내용 기재가 필수입니다.
 * isDef=false 는 확인 항목으로, 발생 건의 후속 조치 이행 여부만 확인합니다.
 */
export const CHECK_DEFS = [
  { key: 'map', name: '증적 매핑 누락', ctrl: 'PC-01', isDef: true,
    crit: '증적 문서 ID 미기재. 모집단 1:1 매핑 위반이므로 0건이어야 합니다.' },
  { key: 'appr', name: '배포 승인 기록 누락 · 사후 승인 · 자기 승인', ctrl: 'PC-01', isDef: true,
    crit: '배포 승인자 또는 승인일 미기재, 승인일이 배포일보다 늦음(핫픽스는 사유 기재 시 허용), 또는 승인자가 변경 작성자. PC-01 승인 요건이므로 0건이어야 합니다.' },
  { key: 'dep', name: '배포 수행자 미기재', ctrl: 'PC-01', isDef: true,
    crit: '운영에 반영한 사람이 없음. 개발자 직접 배포 여부를 확인할 수 없으므로 0건이어야 합니다.' },
  { key: 'sod', name: '직무 분리 위반', ctrl: 'PC-01', isDef: true,
    crit: '변경 작성자와 검증 수행자 목록에 같은 사람이 있음. 0건이어야 합니다.' },
  { key: 'integ', name: '정합성 검증 미이행 · 부적합', ctrl: 'PD-02', isDef: true,
    crit: '스키마·데이터 변경 건 중 검증 미실시 또는 부적합. 0건이어야 합니다.' },
  { key: 'term', name: '증적 등록 기한 초과', ctrl: 'PC-01', isDef: true,
    crit: '예외 승인이 없는 초과 건은 미비 건으로 관리합니다.' },
  { key: 'judge', name: '유형 판정자 미기재', ctrl: 'PC-01', isDef: true,
    crit: '차등 증적 적용의 근거 부재. 0건이어야 합니다.' },
  { key: 'idc', name: '증적 문서 ID 정합성 불일치', ctrl: 'PC-01', isDef: true,
    crit: 'ID 가 워크플로우 코드(R · P · T) 또는 QA 번호 형식이 아니거나, 같은 ID 반복, 일감/릴리즈 식별자와 다른 릴리즈 코드, QA 번호의 날짜가 검증 완료일과 맞지 않음. 보고서 기재값과 어긋나므로 사유를 확인합니다.' },
  { key: 'vfy', name: '검증 완료일 미기재 · 사후 검증 사유 누락', ctrl: 'PC-01', isDef: true,
    crit: '검증 완료일은 증적 문서 ID 의 기준일이므로 공란일 수 없습니다. 배포일보다 늦은 사후 검증 건은 사유를 비고에 남겨야 합니다.' },
  { key: 'verd', name: 'QA 판정 부적정', ctrl: 'PC-01', isDef: true,
    crit: '즉시·긴급·높음 보류가 남은 건을 「통과」로 판정. 보고서 판정 기준 위반이므로 0건이어야 합니다.' },
  { key: 'reqm', name: '요구사항 일치 미확인 · 불일치', ctrl: 'PC-01', isDef: true,
    crit: '요구사항 일치 여부가 없는 건, 또는 「불일치」인데 「통과」로 판정한 건. 범위 통제의 근거이므로 0건이어야 합니다.' },
  { key: 'inputerr', name: '입력 오류 (항목 간 모순)', ctrl: 'PD-02', isDef: true,
    crit: '스키마·데이터 변경과 정합성 검증 값이 모순. 통제 위반이 아닌 기재 오류이므로 즉시 정정합니다.' },
  { key: 'hold', name: '보완필요 미해소 (전체 누적)', ctrl: 'PC-01', isDef: true,
    crit: '반송 후 미해소 건. 과거 기간을 포함한 전체 범위로 집계합니다.' },
  { key: '__split__', name: '', ctrl: '', isDef: false,
    crit: '다음 항목은 지적사항이 아니며, 발생 건의 후속 조치 이행 여부를 확인합니다.' },
  { key: 'exc', name: '예외 승인 건', ctrl: 'PC-01', isDef: false,
    crit: '예외 승인자 기재 여부와 승인 사유의 타당성을 확인합니다.' },
  { key: 'fail', name: '실패 건', ctrl: 'PC-01', isDef: false,
    crit: '재검증 및 보고서 재작성 완료 여부를 확인합니다.' },
  { key: 'hold_issue', name: '보류 이슈 잔존 건 (즉시·긴급·높음)', ctrl: 'PC-01', isDef: false,
    crit: '보고서 「보류 이슈 조치 계획」의 처리 기한 경과 여부와 조치 이행을 확인합니다.' },
  { key: 'devdeploy', name: '개발자 직접 배포 건', ctrl: 'PC-01', isDef: false,
    crit: '배포 수행자가 변경 작성자인 건. 위반은 아니나 배포 전 승인과 운영 점검이 있었는지 확인합니다.' },
  { key: 'cond', name: '조건부 통과 건', ctrl: 'PC-01', isDef: false,
    crit: '잔여 이슈에 대한 후속 조치 완료 여부를 확인합니다.' },
];

/** 기간 내 배포 건. 배포일이 없는 건은 집계 대상이 아닙니다. */
export function inPeriod(all, from, to) {
  return all.filter((r) => r.date && (!from || r.date >= from) && (!to || r.date <= to));
}

/** 항목에 해당하는 배포 건 목록. 건수는 이 목록의 길이입니다. */
function matchFor(key, period, all) {
  switch (key) {
    /* 보완필요는 이월 관리 대상이므로 기간과 무관하게 전체 범위로 집계합니다. */
    case 'hold':
      return all.filter((r) => r.state === '보완필요');
    case 'judge':
      return period.filter((r) => !r.judge);
    case 'inputerr':
      return period.filter((r) => r.schema === '없음' && r.int);
    case 'exc':
      return period.filter((r) => r.state === '예외승인');
    case 'fail':
      return period.filter((r) => isFail(r.qav));
    case 'cond':
      return period.filter((r) => r.qav === '조건부 통과');
    case 'devdeploy':
      return period.filter((r) => splitNames(r.deployer).some((n) => splitNames(r.dev).includes(n)));
    case 'hold_issue':
      return period.filter((r) => (holdCount(r) ?? 0) > 0);
    /* 스키마 변경이 「없음」인데 값이 있는 건은 입력 오류로 따로 세므로 제외합니다. */
    case 'integ':
      return period.filter((r) => judge(r).integ === 'bad' && r.schema === '해당');
    default:
      return period.filter((r) => judge(r)[key] === 'bad');
  }
}

/** 점검 기록에 남기는 배포 건 식별값. ID 가 없는 건(매핑 누락)은 배포일로 표시합니다. */
function refOf(r) {
  const ids = splitDocIds(r.id);
  return ids.length ? ids.join(' / ') : `ID 없음 (배포일 ${r.date || '미기재'})`;
}

/** 확정 기록에 저장할 항목. 화면 구분선(__split__)은 점검 항목이 아니므로 뺍니다. */
export function storedItems(items) {
  return (items ?? []).filter((it) => it.key !== '__split__');
}

/**
 * 기간에 대한 점검 집계. 저장되는 값은 항상 이 함수의 결과입니다.
 * fixes 는 { key: 조치 내용 } 형태로, 항목에 그대로 붙여 돌려줍니다.
 */
export function computeSummary(all, from, to, fixes = {}) {
  const period = inPeriod(all, from, to);
  let defects = 0;

  const items = CHECK_DEFS.map((d) => {
    if (d.key === '__split__') return { ...d, n: 0, fix: '', refs: [] };
    const hit = matchFor(d.key, period, all);
    const n = hit.length;
    if (d.isDef && n > 0) defects++;
    /* 해당 건을 증적 문서 ID 로 남깁니다. 건수만 있으면 점검 기록만 보고는
       어느 배포 건의 지적인지 알 수 없어 증적과 대조할 수 없습니다. */
    return { ...d, n, fix: String(fixes[d.key] ?? '').trim(), refs: hit.map(refOf) };
  });

  return {
    from: from ?? '',
    to: to ?? '',
    ledgerCount: period.length,
    flagged: period.filter((r) => judge(r).flag).length,
    defects,
    items,
  };
}

/** 지적 항목 중 조치 내용이 비어 있는 항목 이름 목록 */
export function missingFixes(summary) {
  return summary.items.filter((it) => it.isDef && it.n > 0 && !it.fix).map((it) => it.name);
}
