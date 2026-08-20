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

/**
 * 여섯 판정 항목. 'ok' | 'bad' | 'na' | null(미판정)
 * 화면의 judge() 와 같은 규칙입니다.
 */
export function judge(r) {
  const dl = deadline(r);
  const v = { deadline: dl };

  v.term = !dl || !r.reg ? null : r.reg <= dl ? 'ok' : 'bad';
  v.sod = !r.dev || !r.qa ? null : String(r.dev).trim() === String(r.qa).trim() ? 'bad' : 'ok';
  v.appr = !r.date ? null : !r.appr || !r.apprd ? 'bad' : 'ok';
  v.map = !r.date ? null : r.state === '해당없음' ? 'na' : r.id ? 'ok' : 'bad';

  if (!r.schema) v.integ = null;
  else if (r.schema === '없음') v.integ = r.int ? 'bad' : 'na';
  else if (r.int === '완료' && r.intby) v.integ = 'ok';
  else v.integ = 'bad';

  if (!r.id || !r.date || !r.type) v.idc = null;
  else
    v.idc =
      String(r.id).slice(3, 4) === CODE[r.type] && String(r.id).slice(5, 13) === ymd(r.date)
        ? 'ok'
        : 'bad';

  v.flag = ['term', 'sod', 'appr', 'map', 'integ', 'idc'].some((k) => v[k] === 'bad');
  v.overall = !r.date ? null : v.flag ? '확인필요' : '정상';
  return v;
}

/**
 * 점검 항목 정의
 *
 * isDef=true 는 지적 항목이며 1건 이상이면 조치 내용 기재가 필수입니다.
 * isDef=false 는 확인 항목으로, 발생 건의 후속 조치 이행 여부만 확인합니다.
 */
export const CHECK_DEFS = [
  { key: 'map', name: '증적 매핑 누락', ctrl: 'PC-01', isDef: true,
    crit: '증적 문서 ID 미기재. 모집단 1:1 매핑 위반이므로 0건이어야 합니다.' },
  { key: 'appr', name: '배포 승인 기록 누락', ctrl: 'PC-01', isDef: true,
    crit: '배포 승인자 또는 승인일 미기재. PC-01 승인 요건이므로 0건이어야 합니다.' },
  { key: 'sod', name: '직무 분리 위반', ctrl: 'PC-01', isDef: true,
    crit: '변경 작성자와 검증 수행자가 동일. 0건이어야 합니다.' },
  { key: 'integ', name: '정합성 검증 미이행 · 부적합', ctrl: 'PD-02', isDef: true,
    crit: '스키마·데이터 변경 건 중 검증 미실시 또는 부적합. 0건이어야 합니다.' },
  { key: 'term', name: '증적 등록 기한 초과', ctrl: 'PC-01', isDef: true,
    crit: '예외 승인이 없는 초과 건은 미비 건으로 관리합니다.' },
  { key: 'judge', name: '유형 판정자 미기재', ctrl: 'PC-01', isDef: true,
    crit: '차등 증적 적용의 근거 부재. 0건이어야 합니다.' },
  { key: 'idc', name: '증적 문서 ID 정합성 불일치', ctrl: 'PC-01', isDef: true,
    crit: 'ID의 유형코드 또는 날짜부가 실제 값과 불일치. 부여 오류 또는 유형 재판정 이력이므로 사유를 확인합니다.' },
  { key: 'inputerr', name: '입력 오류 (항목 간 모순)', ctrl: 'PD-02', isDef: true,
    crit: '스키마·데이터 변경과 정합성 검증 값이 모순. 통제 위반이 아닌 기재 오류이므로 즉시 정정합니다.' },
  { key: 'hold', name: '보완필요 미해소 (전체 누적)', ctrl: 'PC-01', isDef: true,
    crit: '반송 후 미해소 건. 과거 기간을 포함한 전체 범위로 집계합니다.' },
  { key: '__split__', name: '', ctrl: '', isDef: false,
    crit: '다음 항목은 지적사항이 아니며, 발생 건의 후속 조치 이행 여부를 확인합니다.' },
  { key: 'exc', name: '예외 승인 건', ctrl: 'PC-01', isDef: false,
    crit: '예외 승인자 기재 여부와 승인 사유의 타당성을 확인합니다.' },
  { key: 'fail', name: '실패(반려) 건', ctrl: 'PC-01', isDef: false,
    crit: '재검증 및 보고서 재작성 완료 여부를 확인합니다.' },
  { key: 'cond', name: '조건부 통과 건', ctrl: 'PC-01', isDef: false,
    crit: '잔여 이슈에 대한 후속 조치 완료 여부를 확인합니다.' },
];

/** 기간 내 배포 건. 배포일이 없는 건은 집계 대상이 아닙니다. */
export function inPeriod(all, from, to) {
  return all.filter((r) => r.date && (!from || r.date >= from) && (!to || r.date <= to));
}

function countFor(key, period, all) {
  switch (key) {
    /* 보완필요는 이월 관리 대상이므로 기간과 무관하게 전체 범위로 집계합니다. */
    case 'hold':
      return all.filter((r) => r.state === '보완필요').length;
    case 'judge':
      return period.filter((r) => !r.judge).length;
    case 'inputerr':
      return period.filter((r) => r.schema === '없음' && r.int).length;
    case 'exc':
      return period.filter((r) => r.state === '예외승인').length;
    case 'fail':
      return period.filter((r) => r.qav === '실패(반려)').length;
    case 'cond':
      return period.filter((r) => r.qav === '조건부 통과').length;
    /* 스키마 변경이 「없음」인데 값이 있는 건은 입력 오류로 따로 세므로 제외합니다. */
    case 'integ':
      return period.filter((r) => judge(r).integ === 'bad' && r.schema === '해당').length;
    default:
      return period.filter((r) => judge(r)[key] === 'bad').length;
  }
}

/**
 * 기간에 대한 점검 집계. 저장되는 값은 항상 이 함수의 결과입니다.
 * fixes 는 { key: 조치 내용 } 형태로, 항목에 그대로 붙여 돌려줍니다.
 */
export function computeSummary(all, from, to, fixes = {}) {
  const period = inPeriod(all, from, to);
  let defects = 0;

  const items = CHECK_DEFS.map((d) => {
    if (d.key === '__split__') return { ...d, n: 0, fix: '' };
    const n = countFor(d.key, period, all);
    if (d.isDef && n > 0) defects++;
    return { ...d, n, fix: String(fixes[d.key] ?? '').trim() };
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
