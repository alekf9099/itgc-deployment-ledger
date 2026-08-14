# 변경 절차

이 리포지토리의 변경 절차 자체가 통제의 일부입니다. 대장 화면이나 판정 로직이
검토 없이 바뀌면 대장으로 산출한 판정의 신뢰성이 무너집니다. 아래 순서를 지킵니다.

## 1. 브랜치

`main`에 직접 커밋하지 않습니다. 용도에 맞는 접두어로 브랜치를 만듭니다.

| 접두어 | 용도 | 예 |
|---|---|---|
| `feat/` | 화면·항목 추가 | `feat/monthly-check-export` |
| `fix/` | 오류 수정 | `fix/deadline-workday-calc` |
| `docs/` | 문서·기준 문구 | `docs/update-scope-table` |
| `chore/` | 설정·CI | `chore/vercel-headers` |

```bash
git switch -c feat/브랜치명
```

## 2. 변경 및 확인

1. `index.html`을 수정합니다.
2. 브라우저로 열어 대장 · 월간 점검 · 작성 기준 세 화면을 모두 확인합니다.
3. 판정 로직(`judge`, `deadline`, `CHECKS`)이나 입력 항목(`F`, `DEF_IN`)을 바꿨다면
   `APP_VERSION`을 올립니다.
4. 검사를 돌립니다.

```bash
node scripts/check.mjs
```

## 3. PR

```bash
git push -u origin feat/브랜치명
gh pr create --fill
```

PR을 열면 두 가지가 자동으로 붙습니다.

- **Vercel Preview 배포** — PR에 코멘트로 URL이 달립니다. 머지 전 이 URL에서 실제 화면을 확인합니다.
- **CI 검사** — 문서 골격, JS 문법, 참조 id, 버전 표기를 확인합니다.

둘 다 통과하고 리뷰 승인을 받은 뒤 머지합니다.

## 4. 머지 = 배포

`main`에 머지되는 즉시 Vercel Production에 반영됩니다. 머지 후 운영 URL에서
반영 결과와 좌하단 버전 표기를 확인합니다.

문제가 발견되면 Vercel 대시보드에서 이전 배포를 **Promote to Production**으로
되돌린 뒤, 원인을 수정한 PR을 새로 올립니다.

---

## 판정 로직을 바꿀 때

`judge()`, `deadline()`, `CHECKS`, `SCOPE`는 「릴리즈 유형별 QA/QC 증적 수립 표준
가이드라인」을 코드로 옮긴 부분입니다. 이 값을 바꾸는 것은 **통제 기준을 바꾸는 것**과
같습니다.

- 가이드라인 개정 없이 판정 기준만 먼저 바꾸지 않습니다.
- PR 본문에 **근거가 되는 가이드라인 항목 번호**를 적습니다.
- 「작성 기준」 화면(`DEF_FX`, `DEF_IN`)의 설명 문구도 함께 고쳐 화면과 코드가
  어긋나지 않게 합니다.
- 이미 저장된 기록의 판정 결과가 바뀔 수 있으므로, 변경 전 CSV를 내보내 보관합니다.

## 리뷰 관점

- 판정 규칙 변경에 가이드라인 근거가 제시되었는가
- 화면 설명 문구와 코드 동작이 일치하는가
- 기존 저장 데이터가 깨지지 않는가 (`localStorage` 키 `qa-ledger-v1`, `qa-check-v1`)
- 증적 실데이터나 개인정보가 커밋에 포함되지 않았는가
