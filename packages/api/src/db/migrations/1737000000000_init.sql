-- Up Migration

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE todos (
  todo_id     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   text        NOT NULL,
  user_sub    text        NOT NULL,
  title       text        NOT NULL CHECK (char_length(title) BETWEEN 1 AND 200),
  description text,
  status      text        NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'in_progress', 'done')),
  due_date    date,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- Supports the keyset pagination query: filter by tenant+user, order by
-- (created_at, todo_id) descending.
CREATE INDEX todos_owner_created_idx
  ON todos (tenant_id, user_sub, created_at DESC, todo_id DESC);

-- Down Migration

DROP TABLE IF EXISTS todos;
