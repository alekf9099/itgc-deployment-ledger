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
  last_login_at TIMESTAMPTZ
);

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
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 점검 화면의 조치 내용 임시 저장 (확정 전 초안)
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
