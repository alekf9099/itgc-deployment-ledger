/**
 * 월간 점검 결과 반출본 (CSV → Excel)
 *
 * 확정된 점검 기록 한 건을 사람이 읽는 표로 만듭니다. 값은 **확정 당시 저장된
 * 기록**에서만 가져옵니다. 반출 시점의 대장으로 다시 계산하면 확정 이후의
 * 변경이 섞여, 점검 기록이 그 시점의 사실이 아니게 됩니다.
 *
 * DB 에 의존하지 않도록 따로 두었습니다. 반출 형식은 감사 대응 산출물이라
 * 검사(scripts/test-check-export.mjs)로 고정합니다.
 */

/** 확정 기록에 남아 있는 화면 구분선. v2.18.1 이전 기록에는 들어 있습니다. */
const isSplit = (it) => it?.key === '__split__';

/** 해당 건 표시. refs 가 없는 기록은 이 기능이 생기기 전에 확정된 것입니다. */
function refsCell(it) {
  if (!it.n) return '';
  if (!Array.isArray(it.refs)) return '(확정 당시 미기록)';
  return it.refs.join('\n');
}

const stamp = (v) => {
  if (!v) return '';
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return String(v);
  /* 감사 기록은 한국 시간으로 읽으므로 KST 로 표기합니다. */
  const k = new Date(d.getTime() + 9 * 3600 * 1000);
  const p = (n) => String(n).padStart(2, '0');
  return `${k.getUTCFullYear()}-${p(k.getUTCMonth() + 1)}-${p(k.getUTCDate())} ${p(k.getUTCHours())}:${p(k.getUTCMinutes())} (KST)`;
};

/**
 * @param c         checks 테이블의 한 행
 * @param replaced  같은 회차에서 제외 표시된 이전 확정 기록 수 (재작성 또는 삭제)
 */
export function checkRows(c, replaced = 0) {
  const items = (c.items ?? []).filter((it) => !isSplit(it));
  const pop = c.pop_count;
  const match =
    pop === null || pop === undefined
      ? '미입력'
      : Number(pop) === Number(c.ledger_count)
        ? '일치'
        : `불일치 (차이 ${Math.abs(Number(pop) - Number(c.ledger_count))}건)`;

  const R = [];
  R.push(['월간 점검 기록']);
  R.push(['점검 대상 통제', 'PC-01 애플리케이션 변경 승인 및 개발자/사용자 테스트 · PD-02 데이터 정합성 테스트']);
  R.push(['점검 근거', '릴리즈 유형별 QA/QC 증적 수립 표준 가이드라인 5항']);
  R.push(['점검 주체', 'QA유닛 (통제부서)']);
  R.push(['점검 방법', '대장 전수 검토 및 배포 이력(GitHub RELEASE 머지 PR 목록) 대조']);
  R.push(['점검 대상 기간 (배포일 기준)', `${c.period_from} ~ ${c.period_to}`]);
  R.push(['점검 수행일', c.performed_on]);
  R.push(['점검자', c.performed_by]);
  R.push(['확인자', c.approved_by]);
  /* 점검자·확인자는 입력한 성명입니다. 실제로 확정 버튼을 누른 계정과 시각은
     서버가 기록한 값이며, 누가 확정했는지는 이 값으로 확인합니다. */
  R.push(['확정 계정 (시스템 기록)', c.created_by ?? '']);
  R.push(['확정 일시 (시스템 기록)', stamp(c.created_at)]);
  R.push(['기록 구분', replaced ? `재확정본 — 같은 회차의 이전 확정 기록 ${replaced}건은 제외 표시되고 내용은 보존됨 (사유는 변경 이력 참조)` : '최초 확정본']);
  R.push(['점검 기록 식별자', c.id]);
  R.push([]);

  R.push(['1. 모집단 완전성 확인']);
  R.push(['구분', '건수']);
  R.push(['배포 이력 건수 (GitHub RELEASE 머지 PR)', pop ?? '']);
  R.push(['대장 기재 건수 (배포 건 기준)', c.ledger_count]);
  R.push(['일치 여부', match]);
  R.push(['차이 원인 및 조치', c.pop_note ?? '']);
  R.push([]);

  R.push(['2. 점검 항목별 결과']);
  R.push(['구분', '점검 항목', '관련 통제', '건수', '해당 건 (증적 문서 ID)', '판단 기준', '조치 내용']);
  items.forEach((it) =>
    R.push([
      it.isDef ? '지적 항목' : '확인 항목',
      it.name, it.ctrl, it.n, refsCell(it), it.crit, it.fix ?? '',
    ])
  );
  R.push(['※ 지적 항목은 1건 이상이면 조치 내용 기재가 필수입니다. 확인 항목은 지적사항이 아니며 후속 조치 이행 여부를 확인합니다.']);
  R.push(['※ 한 배포 건에 보고서가 여러 개면 증적 문서 ID 를 「/」로 구분해 한 칸에 표시합니다.']);
  R.push([]);

  R.push(['3. 표본 재검토', c.sample ?? '']);
  R.push([]);

  R.push(['4. 점검 결과']);
  R.push(['모집단 건수', c.ledger_count]);
  R.push(['확인필요 건수', c.flagged]);
  R.push(['지적 항목 수', c.defects]);
  R.push(['점검 결과', c.defects ? '보완 필요' : '적정 (지적사항 없음)']);
  R.push(['점검자 의견', c.opinion ?? '']);
  R.push([]);

  R.push(['구분', '성명', '일자']);
  R.push(['점검자 (QA유닛)', c.performed_by, c.performed_on]);
  /* 확인자의 확인 일자는 시스템에 기록되는 절차가 아직 없습니다. 임의로 채우지
     않고 서명란으로 남겨, 출력본에 확인자가 직접 서명·기재하게 합니다. */
  R.push(['확인자 (QA유닛 책임자)', c.approved_by, '(서명 · 일자 직접 기재)']);
  R.push([]);
  R.push(['※ 본 점검은 통제부서(QA유닛)의 자체 점검이며, 통제검토부서(TA유닛)의 검토와는 별개의 절차이다.']);
  return R;
}
