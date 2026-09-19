-- Up Migration

-- One row per CSV import started through POST /imports. The row is the trusted
-- link between an uploaded object and the identity that may create todos from
-- it: the ingest Lambda looks the object key up here and takes tenant_id /
-- user_sub from this row, never from the file or the key.
CREATE TABLE todo_imports (
  import_id     uuid PRIMARY KEY,
  tenant_id     text        NOT NULL,
  user_sub      text        NOT NULL,
  file_name     text        NOT NULL CHECK (char_length(file_name) BETWEEN 1 AND 255),
  object_key    text        NOT NULL UNIQUE,
  status        text        NOT NULL DEFAULT 'awaiting_upload'
                CHECK (status IN ('awaiting_upload', 'processing', 'completed', 'rejected')),
  row_count     integer,
  created_count integer,
  -- First contract violations (todo_import_error[]) when rejected; the full
  -- report is quarantined next to the file.
  errors        jsonb,
  created_at    timestamptz(3) NOT NULL DEFAULT now(),
  updated_at    timestamptz(3) NOT NULL DEFAULT now(),
  completed_at  timestamptz(3)
);

CREATE INDEX todo_imports_owner_idx ON todo_imports (tenant_id, user_sub, created_at DESC);

-- Down Migration

DROP TABLE IF EXISTS todo_imports;
