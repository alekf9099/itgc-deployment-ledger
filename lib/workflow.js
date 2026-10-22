/**
 * 소프트팩토리 릴리즈 → 배포 관리 대장 가져오기 (계획)
 *
 * 소프트팩토리(sofac.muhayu.com)의 「완료」 릴리즈를 대장의 모집단으로 가져옵니다.
 * 손으로 옮기면 빠지는 배포가 생기고, 감사에서 "모집단을 어디서 뽑았나"에
 * 답할 근거가 없습니다. 이 파일은 무엇을 새로 만들지 계산만 하고, 저장은
 * api/workflow-import.js 가 합니다. DB 에 의존하지 않아 검사로 고정합니다.
 *
 * 원칙
 *   · 새 건만 만듭니다. 이미 대장에 있는 릴리즈(R코드)는 건드리지 않고
 *     구성 차이만 보여 줍니다. 사람이 적은 값을 덮어쓰지 않기 위해서입니다.
 *   · 완료일은 배포일 「후보」입니다. 완료 처리한 날이 실제 반영일과 다를 수
 *     있어(예: 9/30 배포를 10/2 에 완료 처리) 비고에 확인 필요를 남깁니다.
 *   · 만든 건은 「작성중」입니다. 증적 · 검증 · 승인은 담당자가 채웁니다.
 *     판정이 「확인필요」로 표시되는 것이 맞는 상태입니다.
 */
import { releaseCodes, splitDocIds, normalizeDocIds } from './judge.js';

const TYPES = ['정규', '수시', '핫픽스'];
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const CODE = /^R\d{1,}$/;
const FLOW = 'https://sofac.muhayu.com/releases/';

/** 제목의 [태그] 중 서비스명. [수시 릴리즈] 처럼 유형을 적은 태그는 건너뜁니다. */
function serviceTag(title) {
  for (const m of title.matchAll(/\[([^\]]+)\]/g)) {
    const t = m[1].trim();
    if (t && !/릴리즈|정기|정규|수시|핫픽스/.test(t)) return t;
  }
  return '';
}

/**
 * 대상 시스템. 워크스페이스(무하유 · CK캠퍼스)는 여러 서비스를 묶은 단위라
 * 제목 태그의 서비스명을 씁니다. 태그가 워크스페이스 이름에 들어 있으면
 * (몬스터 → HR몬스터) 워크스페이스 표기로 통일합니다.
 */
export function targetSystem(ws, title) {
  const tag = serviceTag(title);
  if (!tag || !ws) return ws || tag;
  const flat = (x) => x.replace(/\s+/g, '').toLowerCase();
  return flat(ws).includes(flat(tag)) ? ws : tag;
}

/** 제목에 적힌 유형. 소프트팩토리 유형 값과 다르면 어느 쪽이 맞는지 사람이 확인해야 합니다. */
function titleType(title) {
  if (/핫픽스/.test(title)) return '핫픽스';
  if (/수시/.test(title)) return '수시';
  if (/정기|정규/.test(title)) return '정규';
  return '';
}

/** 파일 한 건을 검사해 정돈합니다. 문제가 있으면 사유 목록을 돌려줍니다. */
export function normalizeRelease(r) {
  const bad = [];
  const x = {
    code: String(r?.code ?? '').trim(),
    ws: String(r?.ws ?? '').trim(),
    title: String(r?.title ?? '').trim(),
    status: String(r?.status ?? '').trim(),
    approval: String(r?.approval ?? '').trim(),
    type: String(r?.type ?? '').trim(),
    owner: String(r?.owner ?? '').trim(),
    target: String(r?.target ?? '').trim(),
    completed: String(r?.completed ?? '').trim(),
    tasks: Number(r?.tasks) || 0,
    tasksDone: Number(r?.tasksDone) || 0,
    projects: (Array.isArray(r?.projects) ? r.projects : []).map((p) => ({
      code: String(p?.code ?? '').trim(),
      name: String(p?.name ?? '').trim(),
      tasks: Number(p?.tasks) || 0,
      tasksDone: Number(p?.tasksDone) || 0,
    })).filter((p) => /^P\d+$/.test(p.code)),
    notes: (Array.isArray(r?.notes) ? r.notes : []).map(String).filter(Boolean),
  };
  if (!CODE.test(x.code)) bad.push('릴리즈 코드 형식 오류');
  if (!x.title) bad.push('제목 없음');
  if (x.completed && !DATE.test(x.completed)) bad.push('완료일 형식 오류');
  if (x.target && !DATE.test(x.target)) bad.push('목표일 형식 오류');
  return { release: x, bad };
}

/** 대장 건이 어떤 릴리즈 코드를 가리키는지 (식별자와 증적 ID 양쪽에서 찾음) */
function codesOf(entry) {
  return new Set([...releaseCodes(entry.task), ...splitDocIds(entry.id).filter((x) => /^R\d+$/.test(x))]);
}

/**
 * 가져오기 계획
 *
 * @param releases  파일의 releases 배열
 * @param entries   현재 대장 (삭제 표시되지 않은 건, 화면 필드 형태)
 * @param opt       { from: 'YYYY-MM-DD', extractedAt: 'YYYY-MM-DD' }
 * @returns { add, exists, pending, outOfRange, invalid }
 */
export function planImport(releases, entries, opt = {}) {
  const from = opt.from || '0000-00-00';
  const stamp = opt.extractedAt || '';
  const add = [];
  const exists = [];
  const pending = [];
  const outOfRange = [];
  const invalid = [];

  /* 이미 쓰인 증적 ID. 한 보고서 ID 는 한 배포 건에만 걸 수 있습니다. */
  const used = new Map();
  entries.forEach((e) => splitDocIds(e.id).forEach((id) => used.set(id, e.task || e.id)));

  const byCode = new Map();
  entries.forEach((e) => codesOf(e).forEach((c) => byCode.set(c, e)));

  const seen = new Set();
  for (const raw of releases ?? []) {
    const { release: r, bad } = normalizeRelease(raw);
    if (bad.length) { invalid.push({ code: r.code || '(코드 없음)', title: r.title, reason: bad.join(' · ') }); continue; }
    if (seen.has(r.code)) { invalid.push({ code: r.code, title: r.title, reason: '파일 안에 같은 릴리즈가 두 번 있음' }); continue; }
    seen.add(r.code);

    /* 완료 처리되지 않은 릴리즈. 목표일이 지났으면 실제로 배포됐는지 사람이 확인해야
       합니다. 자동으로 넣지 않는 것은, 배포되지 않은 건이 모집단에 섞이기 때문입니다. */
    if (r.status !== '완료' || !r.completed) {
      if (r.target && r.target >= from) pending.push({ ...r, reason: '완료 처리 전 — 실제 배포 여부 확인 후 소프트팩토리에서 완료 처리' });
      continue;
    }
    if (r.completed < from) { outOfRange.push({ code: r.code, title: r.title, completed: r.completed }); continue; }

    const live = r.projects.filter((p) => p.tasks > 0);
    const idle = r.projects.filter((p) => p.tasks === 0);

    const hit = byCode.get(r.code);
    if (hit) {
      const want = live.map((p) => p.code);
      const have = splitDocIds(hit.id);
      exists.push({
        code: r.code, title: r.title, k: hit.k, ledgerId: hit.id || '',
        workflowProjects: want,
        missing: want.filter((c) => !have.includes(c)),
      });
      continue;
    }

    const warnings = [];
    const ids = [];
    const overlap = [];
    live.forEach((p) => {
      if (used.has(p.code)) overlap.push(`${p.code} 는 다른 배포 건(${used.get(p.code)})에도 포함`);
      else ids.push(p.code);
    });
    /* 프로젝트가 없는 릴리즈는 릴리즈 단위 보고서(R코드)를 기본 증적으로 둡니다. */
    if (!ids.length && !used.has(r.code)) ids.push(r.code);
    ids.forEach((id) => used.set(id, `${r.code} ${r.title}`));

    const empty = !r.projects.length && r.tasks === 0;
    if (empty) warnings.push('릴리즈 구성 없음 (일감 등록 필요)');
    if (r.approval !== '승인') warnings.push('릴리즈 결재 없음');
    if (r.target && r.completed !== r.target) warnings.push(`목표일 ${r.target} · 완료일 ${r.completed}`);
    const tt = titleType(r.title);
    if (tt && r.type && tt !== r.type) warnings.push(`제목은 ${tt}, 소프트팩토리 유형은 ${r.type} — 유형 확인`);
    overlap.forEach((o) => warnings.push(o));
    if (idle.length) warnings.push(`일감 없이 연결된 프로젝트: ${idle.map((p) => p.code).join(', ')}`);
    r.notes.forEach((n) => warnings.push(n));

    const memo = [
      `소프트팩토리 ${r.code} 가져옴${stamp ? ` (${stamp})` : ''} — 완료일 ${r.completed} 기준, 실제 배포일 확인 필요`,
      [r.ws && `워크스페이스 ${r.ws}`, r.owner && `릴리즈 담당자 ${r.owner}`].filter(Boolean).join(' · ') || null,
      live.length
        ? `릴리즈 구성: ${live.map((p) => `${p.code}(${p.tasksDone}/${p.tasks})`).join(', ')}`
        : (r.tasks ? `릴리즈 구성: 일감 ${r.tasks}건 (프로젝트 없음)` : null),
      ...warnings,
    ].filter(Boolean).join('\n');

    add.push({
      code: r.code,
      warnings,
      entry: {
        k: `wf-${r.code}`,
        task: `${r.code} ${r.title}`,
        sys: targetSystem(r.ws, r.title),
        type: TYPES.includes(r.type) ? r.type : '',
        date: r.completed,
        rel: r.title,
        plan: r.target,
        /* 릴리즈 결재가 승인된 건만 근거로 겁니다. 결재가 없으면 비워 두어
           담당자가 PR 등 다른 근거를 찾아 적게 합니다. */
        apprref: r.approval === '승인' ? `소프트팩토리 ${r.code} 릴리즈 결재 ${FLOW}${r.code}` : '',
        id: normalizeDocIds(ids.join(', ')),
        state: empty ? '보완필요' : '작성중',
        memo,
      },
    });
  }

  return { add, exists, pending, outOfRange, invalid };
}
