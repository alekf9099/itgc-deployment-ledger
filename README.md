# 배포 관리 대장 (ITGC PC-01 / PD-02)

QA유닛이 운영하는 배포 관리 대장입니다. 배포 이력 전수를 모집단으로 기재하고,
각 건을 증적 문서와 1:1로 매핑하며, 월간 점검 결과를 누적합니다.

- **통제부서** QA유닛 · **검토부서** TA유닛
- **대상 통제** PC-01 애플리케이션 변경 승인 및 개발자/사용자 테스트, PD-02 데이터 정합성 테스트
- **근거** 「릴리즈 유형별 QA/QC 증적 수립 표준 가이드라인」

원본 엑셀 대장은 [`docs/QA-LG-001_Release_Deployment_Ledger.xlsx`](docs/QA-LG-001_Release_Deployment_Ledger.xlsx)
에 보관합니다. 웹 버전이 이 양식을 대체하며, 양식이 개정되면 원본과 화면을 함께 갱신합니다.

---

## 화면 구성

| 화면 | 내용 |
|---|---|
| 대장 | 배포 건 등록·편집, 자동 판정(판정 스트립), 필터, CSV 내보내기 |
| 월간 점검 | 모집단 완전성 대조, 점검 항목별 자동 집계, 표본 재검토, 점검 이력 누적 |
| 작성 기준 | 입력 항목 정의, 자동 판정 규칙, 유형별 보고서 작성 범위, 운영 규칙 |
| 변경 이력 | 모든 등록·수정·삭제·접속 기록 조회 |

판정 스트립은 여섯 항목(기한 준수 · 직무 분리 · 승인 기록 · 증적 매핑 · 정합성 확인 · ID 정합성)을
입력값에서 계산합니다. **판정 결과는 DB에 저장하지 않고 매번 계산합니다.** 저장된 판정값은
임의 수정이 가능해 통제의 신뢰성을 떨어뜨리기 때문입니다.

---

## ITGC 대응 사항

| 감사 관점 | 구현 |
|---|---|
| 사용자 인증 | 담당자별 계정 로그인. 비밀번호는 scrypt 해시로 저장하며 평문을 보관하지 않습니다. |
| 권한 분리 | `admin`(계정·삭제) / `member`(작성·점검) / `viewer`(열람 전용). 서버에서 강제합니다. |
| 책임 추적성 | 모든 등록·수정·삭제·접속을 수행자·일시·변경 전후 값과 함께 `audit_log`에 기록합니다. |
| 기록 보존 | 배포 건 삭제는 실제 삭제가 아닌 제외 표시입니다. 흔적 없는 삭제가 불가능합니다. |
| 변경 통제 | 화면·판정 로직 변경은 PR과 리뷰를 거쳐야 배포됩니다. GitHub에 이력이 남습니다. |
| 입력 검증 | 필수 항목을 화면과 서버 양쪽에서 확인합니다. API 직접 호출로 우회할 수 없습니다. |
| 세션 관리 | HttpOnly·Secure·SameSite 쿠키, 12시간 만료. |

> **주의** 대장 화면과 별개로, 증적 문서(QA 완료 보고서) 자체는 기존 아카이빙 채널에
> 등록합니다. 이 대장은 증적의 색인이자 모니터링 도구이며 보고서 보관소가 아닙니다.

---

## 구성

```
브라우저 ──▶ Vercel (정적 index.html + /api 서버리스 함수) ──▶ Postgres
```

| 경로 | 설명 |
|---|---|
| `index.html` | 대장 앱 전체 (마크업 · 스타일 · 판정 로직) |
| `api/auth.js` | 로그인 · 로그아웃 · 비밀번호 변경 |
| `api/entries.js` | 배포 건 조회 · 등록/수정 · 제외 표시 |
| `api/checks.js` | 월간 점검 이력 · 조치 내용 초안 |
| `api/audit.js` | 변경 이력 조회 (조회 전용) |
| `lib/db.js` | Postgres 연결 풀 |
| `lib/auth.js` | 비밀번호 해시, 세션 쿠키, 권한 가드, 이력 기록 |
| `db/schema.sql` | 테이블 정의 |
| `scripts/migrate.mjs` | 스키마 적용 |
| `scripts/create-user.mjs` | 계정 생성 · 비밀번호 재설정 |
| `scripts/check.mjs` | `index.html` 정합성 검사 (CI에서 실행) |

---

## 최초 구축

### 1. Vercel 프로젝트 연결

Vercel 대시보드 → **Add New → Project** → 이 GitHub 리포지토리를 Import 합니다.
프레임워크는 **Other**, 빌드 명령은 비워 둡니다.

### 2. Postgres 생성

프로젝트 → **Storage** → **Create Database** → Postgres 를 선택해 생성하고,
이 프로젝트에 **Connect** 합니다. 연결하면 `POSTGRES_URL` 등의 환경변수가
자동으로 주입됩니다.

### 3. 세션 키 설정

프로젝트 → **Settings → Environment Variables** 에 아래를 추가합니다.
Production·Preview·Development 모두에 적용합니다.

| 이름 | 값 |
|---|---|
| `SESSION_SECRET` | 32자 이상의 임의 문자열 |

생성 예:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
```

> 이 값이 바뀌면 로그인 세션이 전부 무효화됩니다. 유출 시에는 교체하십시오.

### 4. 스키마 적용

Vercel의 Postgres 연결 문자열(`POSTGRES_URL`)을 대시보드에서 복사해 로컬에서 실행합니다.

```bash
npm install
POSTGRES_URL="복사한_연결문자열" npm run migrate
```

### 5. 계정 생성

```bash
POSTGRES_URL="복사한_연결문자열" node scripts/create-user.mjs hhkim 김홍현 admin QA유닛
```

비밀번호가 화면에 한 번만 출력됩니다. 본인에게 전달하고, 최초 로그인 후
비밀번호를 변경하도록 안내하십시오.

권한은 `admin` / `member` / `viewer` 중 하나입니다.
통제검토부서(TA유닛)와 감사인에게는 `viewer` 를 발급합니다.

---

## 계정 운영

| 상황 | 조치 |
|---|---|
| 신규 담당자 | `create-user.mjs` 로 계정 생성 |
| 비밀번호 분실 | 같은 명령을 다시 실행하면 재설정됩니다 (기록은 유지) |
| 인사 이동·퇴사 | 아래 SQL로 즉시 비활성화하고 그 사실을 월간 점검 기록에 남깁니다 |

```sql
UPDATE users SET active = FALSE WHERE username = '아이디';
```

계정을 삭제하지 않고 비활성화하는 이유는, 그 계정이 남긴 변경 이력의
수행자 정보를 보존해야 하기 때문입니다.

---

## 배포 구조

```
feature 브랜치 ──PR──▶ main ──자동──▶ Vercel Production
      │
      └─ PR 생성 시 Vercel Preview 배포 + CI 검사
```

- **main** = 운영 반영 브랜치. main에 머지되는 순간 Production에 배포됩니다.
- **직접 커밋 금지.** 모든 변경은 브랜치 → PR → 리뷰 → 머지 순서로 진행합니다.
- PR을 열면 Vercel이 **Preview URL**을 자동으로 붙입니다. 머지 전 그 URL에서 확인합니다.
- CI(`.github/workflows/ci.yml`)가 `index.html` 정합성을 검사합니다. 실패하면 머지하지 않습니다.

> **Preview 배포 주의** Preview 환경도 같은 Postgres를 바라봅니다. 검증 목적으로
> 실제 대장에 시험 데이터를 넣지 마십시오. 스키마를 바꾸는 변경은 별도 DB를 만들어
> Preview 환경변수로 분리한 뒤 진행합니다.

자세한 절차는 [CONTRIBUTING.md](CONTRIBUTING.md)를 보십시오.

---

## 로컬에서 실행

API가 있으므로 `index.html`을 파일로 여는 것만으로는 동작하지 않습니다.
Vercel CLI로 띄웁니다.

```bash
npm install
npx vercel dev
```

로컬에서도 `POSTGRES_URL`과 `SESSION_SECRET`이 필요합니다.
`npx vercel env pull .env.local` 로 내려받으면 자동으로 인식합니다.
(`.env*`는 `.gitignore`에 있어 커밋되지 않습니다.)

변경 후에는 커밋 전에 검사를 돌립니다.

```bash
node scripts/check.mjs
```

## 버전

`index.html`의 `APP_VERSION` 상수로 관리하며 화면 좌하단에 표시됩니다.
판정 로직이나 입력 항목을 바꾼 PR에서는 이 값을 함께 올립니다.
어느 버전의 대장에서 작성·판정된 기록인지 추적하기 위한 값입니다.
