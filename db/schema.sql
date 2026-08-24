-- 배포 관리 대장 스키마
--
-- 설계 원칙
--   1. 기록은 지우지 않습니다. 배포 건 삭제는 실제 DELETE 대신 deleted_at 표시로 처리합니다.
--      감사 대상 대장에서 흔적 없는 삭제가 가능하면 모집단 완전성을 담보할 수 없습니다.
--   2. 모든 변경은 audit_log 에 남깁니다. 누가·언제·무엇을 어떤 값에서 어떤 값으로
--      바꿨는지가 PC-01 의 변경 통제 증거입니다.
--   3. 판정 결과는 저장하지 않습니다. 화면에서 입력값으로부터 계산합니다.
--      저장된 판정값은 임의 수정이 가능해 통제의 신뢰성을 떨어뜨립니다.

CREATE TABLE IF NOT EXISTS users (
  id            SERIAL PRIMARY KEY,
  username      TEXT        NOT NULL UNIQUE,
  name          TEXT        NOT NULL,           -- 대장에 기록되는 성명
  unit          TEXT,                           -- 소속 유닛
  role          TEXT        NOT NULL DEFAULT 'member'
                            CHECK (role IN ('admin', 'member', 'viewer')),
  password_hash TEXT        NOT NULL,
  active        BOOLEAN     NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_login_at TIMESTAMPTZ,
  -- 세션 세대. 비밀번호가 바뀌면 올려서 이전 세션을 모두 무효로 만듭니다.
  session_epoch INTEGER     NOT NULL DEFAULT 0
);

ALTER TABLE users ADD COLUMN IF NOT EXISTS session_epoch INTEGER NOT NULL DEFAULT 0;

COMMENT ON COLUMN users.role IS
  'admin: 계정 관리 및 삭제 가능 / member: 대장 작성·점검 수행 / viewer: 열람만';

-- 배포 건 (PC-01 모집단)
CREATE TABLE IF NOT EXISTS entries (
  k               TEXT PRIMARY KEY,             -- 화면에서 생성하는 행 식별자
  doc_id          TEXT,                         -- 증적 문서 ID
  deploy_date     DATE,                         -- 배포일
  release_type    TEXT,                         -- 정규 / 수시 / 핫픽스
  type_judge      TEXT,                         -- 유형 판정자
  target_system   TEXT,                         -- 대상 시스템
  task            TEXT,                         -- 일감 / 릴리즈 식별자
  dev             TEXT,                         -- 변경 작성자
  qa              TEXT,                         -- 검증 수행자
  qa_verdict      TEXT,                         -- 통과 / 조건부 통과 / 실패(반려)
  approver        TEXT,                         -- 배포 승인자
  approved_on     DATE,                         -- 배포 승인일
  schema_change   TEXT,                         -- 해당 / 없음
  integrity       TEXT,                         -- 완료 / 부적합 / 미실시
  integrity_by    TEXT,                         -- 정합성 검증자
  registered_on   DATE,                         -- 증적 등록일
  registered_path TEXT,                         -- 증적 등록 경로
  state           TEXT,                         -- 증적 상태
  exception_by    TEXT,                         -- 예외 승인자
  memo            TEXT,
  created_by      TEXT        NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by      TEXT,
  updated_at      TIMESTAMPTZ,
  deleted_by      TEXT,
  deleted_at      TIMESTAMPTZ                   -- NULL 이 아니면 대장에서 제외된 건
);

CREATE INDEX IF NOT EXISTS entries_deploy_date_idx ON entries (deploy_date DESC);
CREATE INDEX IF NOT EXISTS entries_active_idx      ON entries (deleted_at) WHERE deleted_at IS NULL;

-- 증적 문서 ID 는 증적과 배포 건을 1:1 로 잇는 값이므로 중복될 수 없습니다.
-- 일련번호를 화면에서 계산하기 때문에, 두 담당자가 같은 배포일·같은 유형을
-- 동시에 등록하면 같은 ID 가 만들어질 수 있어 DB 에서 막습니다.
-- 대장에서 제외된 건은 대상에서 빼, 같은 ID 로 다시 등록할 수 있게 둡니다.
CREATE UNIQUE INDEX IF NOT EXISTS entries_doc_id_uniq
  ON entries (doc_id) WHERE deleted_at IS NULL AND doc_id IS NOT NULL;

-- 월간 점검 이력
CREATE TABLE IF NOT EXISTS checks (
  id            TEXT PRIMARY KEY,
  period_from   DATE,
  period_to     DATE,
  performed_on  DATE,
  performed_by  TEXT,                           -- 점검자
  approved_by   TEXT,                           -- 확인자
  pop_count     INTEGER,                        -- 배포 이력 건수 (GitHub PR)
  ledger_count  INTEGER,                        -- 대장 기재 건수
  pop_note      TEXT,
  sample        TEXT,
  opinion       TEXT,
  flagged       INTEGER,
  defects       INTEGER,
  items         JSONB       NOT NULL DEFAULT '[]'::jsonb,
  created_by    TEXT        NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_by    TEXT,
  deleted_at    TIMESTAMPTZ                     -- NULL 이 아니면 이력에서 제외된 점검
);

-- 점검 이력도 배포 건과 같이 실제로 지우지 않습니다. 이력의 연속성이 통제
-- 운영의 증거이므로, 지워진 사실만 남고 내용이 사라지면 확인할 수 없습니다.
ALTER TABLE checks ADD COLUMN IF NOT EXISTS deleted_by TEXT;
ALTER TABLE checks ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

-- 점검은 「회차」 단위이며 회차는 대상 기간으로 식별합니다. 같은 기간이 두 건
-- 있으면 어느 것이 정본인지 알 수 없으므로 한 건만 허용합니다.
-- 제외 표시된 건은 대상에서 빼, 재작성할 수 있게 둡니다.
CREATE UNIQUE INDEX IF NOT EXISTS checks_period_uniq
  ON checks (period_from, period_to) WHERE deleted_at IS NULL;

-- 확정 전 작성 내용 (회차별)
--
-- 조치 내용만 담던 check_draft 를 회차별 표로 바꿉니다. 기간을 바꿨을 때
-- 이전 회차에 쓰던 값이 남아 섞이는 것을 막고, 새로고침해도 작성 중 내용이
-- 유지되게 하기 위한 것입니다.
CREATE TABLE IF NOT EXISTS check_drafts (
  period_from DATE        NOT NULL,
  period_to   DATE        NOT NULL,
  data        JSONB       NOT NULL DEFAULT '{}'::jsonb,
  updated_by  TEXT,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (period_from, period_to)
);

-- 이전 단일 행 초안 표. 회차별 표로 대체되어 더 쓰지 않습니다.
-- 남겨 두더라도 해가 없고, 표를 지우는 것보다 안전합니다.
CREATE TABLE IF NOT EXISTS check_draft (
  id         INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  data       JSONB       NOT NULL DEFAULT '{}'::jsonb,
  updated_by TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 변경 이력
CREATE TABLE IF NOT EXISTS audit_log (
  id       BIGSERIAL PRIMARY KEY,
  at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  actor    TEXT        NOT NULL,                -- username
  actor_name TEXT,                              -- 성명
  action   TEXT        NOT NULL,                -- login / entry.create / entry.update / entry.delete / check.save ...
  target   TEXT,                                -- 대상 식별자
  changed  JSONB,                               -- { 필드: [이전값, 이후값] }
  note     TEXT
);

CREATE INDEX IF NOT EXISTS audit_log_at_idx     ON audit_log (at DESC);
CREATE INDEX IF NOT EXISTS audit_log_target_idx ON audit_log (target);

-- 운영 설정 (자동 반사 여부 등). 한 행만 둡니다.
CREATE TABLE IF NOT EXISTS settings (
  id         INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  data       JSONB       NOT NULL DEFAULT '{}'::jsonb,
  updated_by TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 로그인 시도 제한은 최근 실패 건수를 세어 판단하므로 조회 경로를 만들어 둡니다.
CREATE INDEX IF NOT EXISTS audit_log_login_fail_idx
  ON audit_log (actor, at DESC) WHERE action = 'login.fail';
