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
import { releaseCodes, splitDocIds, normalizeDocIds, C_LEVEL, bareName } from './judge.js';

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

/* ── 증적 수집 (추출 북마크 v4 부터) ──
   릴리즈 상세가 불러오는 일감 목록에는 프로젝트 WBS 단계 일감(승인 · 개발 ·
   검토 · 완료)과 프로젝트가 아닌 일감이 함께 들어 있습니다. RCM 이 요구하는
   증적을 여기서 읽어, 사람이 옮겨 적지 않게 합니다.
     PD-01  프로젝트(P): 프로젝트 승인 · 테스트 · 이관 전 승인(릴리즈 결재) · 완료 평가
     PC-01  프로젝트가 아닌 일감(T): 요청 · 승인(릴리즈 결재) · 개발자/사용자 테스트
     PD-03  QA 테스트 아래 결함 일감 */
/* 한글 뒤에서는 \b 가 동작하지 않아, 뒤따르는 문자로 단어 경계를 봅니다. */
const PHASE = /^\(?\s*(기획|승인|개발|검토|완료)(?=[\s)\]]|$)/;
const phaseOf = (it) => (PHASE.exec(it.parent ? it.phase : it.title) || [])[1] || '';
const uniq = (a) => [...new Set(a.filter(Boolean))];
const day = (s) => String(s ?? '').slice(0, 10);

function normalizeItem(x) {
  const s = (v) => String(v ?? '').trim();
  return {
    id: s(x?.id), title: s(x?.title), project: s(x?.project), parent: s(x?.parent), phase: s(x?.phase),
    type: s(x?.type), menu: s(x?.menu), status: s(x?.status), done: x?.done === true,
    assignee: s(x?.assignee), requester: s(x?.requester), completer: s(x?.completer), completedAt: s(x?.completedAt),
  };
}

function normalizeApproval(a) {
  if (!a || typeof a !== 'object') return null;
  return {
    status: String(a.status ?? '').trim(),
    completedAt: String(a.completedAt ?? '').trim(),
    approvers: (Array.isArray(a.approvers) ? a.approvers : []).map((p) => ({
      name: String(p?.name ?? '').trim(), decision: String(p?.decision ?? '').trim(), at: String(p?.at ?? '').trim(),
    })).filter((p) => p.name),
  };
}

/**
 * 릴리즈 한 건의 증적 요약
 * @returns { devs, approvers, apprd, approved, taskIds, lines, warnings }
 */
export function deriveEvidence(r, projectCodes) {
  const items = r.items;
  const lines = [];
  const warnings = [];
  const devs = [];
  const notC = (n) => !C_LEVEL.includes(bareName(n));

  /* 릴리즈 결재 = 운영 이관 전 승인 */
  const ra = r.releaseApproval;
  const yes = (ra?.approvers || []).filter((p) => p.decision === 'APPROVED');
  const approved = ra ? ra.status === 'APPROVED' && yes.length > 0 : r.approval === '승인';
  const approvers = uniq(yes.map((p) => p.name));
  const apprd = yes.map((p) => day(p.at)).filter(Boolean).sort()[0] || '';

  for (const code of projectCodes) {
    const its = items.filter((i) => i.project === code);
    if (!its.length) continue;
    /* 릴리즈의 일감 목록에는 그 릴리즈에 연결된 일감만 옵니다. 프로젝트의 WBS 단계 일감
       (최상위)이 다른 릴리즈에 연결돼 있으면 여기서 판단하지 않고 그쪽에서 봅니다. */
    if (!its.some((i) => !i.parent)) {
      lines.push(`${code} [PD-01] · WBS 단계 일감이 다른 릴리즈에 연결됨 — 그 릴리즈에서 확인 (이 릴리즈 일감 ${its.length}건)`);
      continue;
    }
    const ok = (i) => (i.done ? '완료' : i.status || '미완료');
    const appr = its.find((i) => i.type === '프로젝트 승인');
    /* WBS 기본 이름은 「기능 테스트」, 팀에 따라 「개발자 테스트_…」 로 씁니다. */
    const devTests = its.filter((i) => /개발자\s*테스트|기능\s*테스트/.test(i.title));
    /* QA 테스트는 이름(「QA테스트」 · 「QA 검토」 · 「QC」)도 유형(QA테스트 · 일감)도 제각각이라
       둘 중 하나로 찾습니다. */
    const qaTests = its.filter((i) => i.menu === 'QA_REVIEW' || i.type === 'QA테스트'
      || (phaseOf(i) === '검토' && /QA\s*(테스트|검토)|^QC$/.test(i.title)));
    const defects = its.filter((i) => qaTests.some((q) => q.id === i.parent));
    const evals = its.filter((i) => i.type === '평가');
    /* 개발자: 개발 단계의 개발 일감 담당자 + 개발자 테스트 담당자. 기능 · 기획자 테스트는
       기획자가 맡는 경우가 많아 뺍니다. */
    its.filter((i) => i.parent && ((phaseOf(i) === '개발' && !/테스트/.test(i.title)) || /개발자\s*테스트/.test(i.title)))
      .forEach((i) => devs.push(i.assignee));

    const who = appr ? (appr.completer || appr.assignee) : '';
    const open = defects.filter((d) => !d.done).length;
    lines.push([
      `${code} [PD-01]`,
      appr ? `프로젝트 승인 ${who} ${appr.done ? day(appr.completedAt) : `(${ok(appr)})`}` : '프로젝트 승인 일감 없음',
      `개발자 테스트 ${devTests.length ? devTests.map(ok).join('/') : '없음'}`,
      `QA 테스트 ${qaTests.length ? qaTests.map(ok).join('/') : '없음'}`,
      defects.length ? `결함 ${defects.length}건${open ? `(미해결 ${open})` : ''}` : null,
      ...evals.map((e) => `${e.title.replace(/\s+/g, '')} ${ok(e)}`),
    ].filter(Boolean).join(' · '));

    if (!appr) warnings.push(`${code} 프로젝트 승인 일감 없음`);
    else if (!appr.done) warnings.push(`${code} 프로젝트 승인 미완료`);
    else {
      if (notC(who)) warnings.push(`${code} 프로젝트 승인자 ${who} 은(는) 전결권자(C레벨) 아님`);
      if (r.completed && day(appr.completedAt) > r.completed) warnings.push(`${code} 프로젝트 승인(${day(appr.completedAt)})이 배포 후`);
      /* 23:59 는 날짜만 정해 완료 처리한 값입니다. 실제로 누른 시각은 변경 이력에 남습니다. */
      if (/23:59$/.test(appr.completedAt)) warnings.push(`${code} 프로젝트 승인 시각이 날짜 지정값(23:59) — 실제 승인 일시는 변경 이력 확인`);
    }
    if (!devTests.some((i) => i.done)) warnings.push(`${code} 개발자 테스트 ${devTests.length ? '미완료' : '일감 없음'}`);
    if (!qaTests.some((i) => i.done)) warnings.push(`${code} QA 테스트 ${qaTests.length ? '미완료' : '일감 없음'}`);
    if (open) warnings.push(`${code} 미해결 결함 ${open}건`);
  }

  /* 프로젝트가 아닌 일감 — 이 릴리즈 안에서 최상위인 일감을 증적 단위로 봅니다(하위는 그
     일감의 테스트 등). 상위 일감이 다른 릴리즈에 있으면 하위 일감이 단위가 됩니다. */
  const inRelease = new Set(items.map((i) => i.id));
  const loose = items.filter((i) => !i.project && (!i.parent || !inRelease.has(i.parent)));
  for (const t of loose) {
    const subs = items.filter((i) => i.parent === t.id);
    const tests = subs.filter((i) => /테스트|검증|QA|QC/i.test(i.title));
    const role = (/^\s*\[(기획|개발|QC|QA)\]/i.exec(t.title) || [])[1] || '';
    /* 장애 일감은 운영 오류 조치(CO-01) 모집단입니다. */
    const incident = t.menu === 'INCIDENT' || t.type === '장애';
    if (!/^(기획|QC|QA)$/i.test(role)) devs.push(t.assignee);
    /* 요청자가 직접 완료 처리했다면 요청자가 결과를 확인한 것(사용자 확인)으로 볼 수 있습니다. */
    const userOk = t.done && t.completer && t.completer === t.requester && t.requester !== t.assignee;
    const solo = t.requester && t.requester === t.assignee && (!t.completer || t.completer === t.assignee);
    lines.push([
      `${t.id} [${incident ? 'CO-01' : 'PC-01'}]`,
      t.requester && `요청 ${t.requester}`,
      t.assignee && `담당 ${t.assignee}`,
      t.done ? `완료 ${day(t.completedAt)}${t.completer && t.completer !== t.assignee ? ` (${t.completer} 확인)` : ''}` : t.status || '미완료',
      `테스트 ${tests.length ? tests.map((i) => `${i.title}(${i.done ? '완료' : i.status})`).join(', ') : '일감 없음'}`,
    ].filter(Boolean).join(' · '));
    if (!t.done) warnings.push(`${t.id} 미완료 일감 포함 (${t.status || '상태 없음'})`);
    if (!incident && !tests.some((i) => i.done)) {
      warnings.push(userOk
        ? `${t.id} 테스트 결과 문서 없음 — 요청자 완료 확인만 있음 (PC-01 은 개발자 · 사용자 테스트 결과 필요)`
        : `${t.id} 테스트 증적 없음 — PC-01 은 개발자 · 사용자 테스트 결과가 필요`);
    }
    if (solo) warnings.push(`${t.id} 요청 · 개발 · 완료를 같은 사람(${t.assignee})이 처리 — 독립 확인 없음`);
  }
  /* 같은 사람이 기획과 QC 를 함께 맡은 경우 — 위반은 아니지만 자기 기획을 자기가 점검한 것 */
  const byRole = (re) => loose.filter((t) => re.test(t.title)).map((t) => t.assignee);
  const selfCheck = byRole(/^\s*\[기획\]/).filter((n) => byRole(/^\s*\[(QC|QA)\]/i).includes(n));
  uniq(selfCheck).forEach((n) => warnings.push(`${n} 님이 기획과 QC 를 함께 담당 — 관찰 사항`));

  const devList = uniq(devs);
  if (approved) {
    /* 결재선에 여러 명이 있어도 전결권자 한 명이 승인했으면 권한 요건은 충족합니다. */
    if (approvers.every(notC)) warnings.push(`릴리즈 결재자 ${approvers.join(', ')} 중 전결권자(C레벨) 없음`);
    if (r.owner && approvers.includes(r.owner)) warnings.push(`릴리즈 결재자가 릴리즈 담당자 본인(${r.owner})`);
    approvers.filter((n) => devList.includes(n)).forEach((n) => warnings.push(`릴리즈 결재자 ${n} 이(가) 개발에도 참여`));
    if (apprd && r.completed && apprd > r.completed) warnings.push(`릴리즈 결재(${apprd})가 완료일 이후`);
  }

  return { devs: devList, approvers, apprd, approved, taskIds: loose.map((t) => t.id), lines, warnings };
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
    /* v4 추출 파일부터 있는 값. 이전 파일이면 비어 있고, 증적 요약 없이 가져옵니다. */
    releaseApproval: normalizeApproval(r?.releaseApproval),
    items: (Array.isArray(r?.items) ? r.items : []).map(normalizeItem).filter((i) => /^T\d+$/.test(i.id)),
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

    const ev = r.items.length ? deriveEvidence(r, live.map((p) => p.code)) : null;
    const hit = byCode.get(r.code);
    if (hit) {
      const want = [...live.map((p) => p.code), ...(ev?.taskIds || [])];
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
    [...live.map((p) => p.code), ...(ev?.taskIds || [])].forEach((c) => {
      if (used.has(c)) overlap.push(`${c} 는 다른 배포 건(${used.get(c)})에도 포함`);
      else ids.push(c);
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
    ev?.warnings.forEach((w) => warnings.push(w));
    r.notes.forEach((n) => warnings.push(n));
    const approved = ev ? ev.approved : r.approval === '승인';

    const memo = [
      `소프트팩토리 ${r.code} 가져옴${stamp ? ` (${stamp})` : ''} — 완료일 ${r.completed} 기준, 실제 배포일 확인 필요`,
      [r.ws && `워크스페이스 ${r.ws}`, r.owner && `릴리즈 담당자 ${r.owner}`].filter(Boolean).join(' · ') || null,
      live.length
        ? `릴리즈 구성: ${live.map((p) => `${p.code}(${p.tasksDone}/${p.tasks})`).join(', ')}`
        : (r.tasks ? `릴리즈 구성: 일감 ${r.tasks}건 (프로젝트 없음)` : null),
      ev?.lines.length ? `[증적 요약]\n${ev.lines.join('\n')}` : null,
      warnings.length ? `[확인할 것]\n${warnings.join('\n')}` : null,
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
        apprref: approved ? `소프트팩토리 ${r.code} 릴리즈 결재 ${FLOW}${r.code}` : '',
        /* v4 추출 파일: 결재자 · 결재일 · 개발자 · 배포 담당자를 소프트팩토리 기록에서 채웁니다.
           판정(전결권자 · 자기 승인 · 사후 승인)은 대장이 이 값으로 다시 계산합니다. */
        ...(ev ? {
          appr: approved ? ev.approvers.join(', ') : '',
          apprd: approved ? ev.apprd : '',
          dev: ev.devs.join(', '),
          deployer: r.owner,
        } : {}),
        id: normalizeDocIds(ids.join(', ')),
        state: empty ? '보완필요' : '작성중',
        memo,
      },
    });
  }

  return { add, exists, pending, outOfRange, invalid };
}
