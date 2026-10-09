-- Additive migration. No legacy cache rows or optimization settings are copied,
-- modified, or deleted. Requires the project's existing pgvector extension.
CREATE TABLE IF NOT EXISTS agent_cache_policies (
  agent_id uuid PRIMARY KEY REFERENCES agents(id) ON DELETE CASCADE,
  org_id uuid NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  schema_version integer NOT NULL DEFAULT 2,
  revision integer NOT NULL DEFAULT 1,
  policy jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT cache_policy_revision_positive CHECK (revision > 0),
  CONSTRAINT cache_policy_schema_v2 CHECK (schema_version = 2)
);

CREATE TABLE IF NOT EXISTS response_cache_v2 (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  agent_id uuid NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  schema_version integer NOT NULL DEFAULT 2,
  policy_revision integer NOT NULL,
  exact_key text NOT NULL,
  partition_key text,
  provider text NOT NULL,
  model text NOT NULL,
  embedding_model_version text,
  embedding vector(768),
  response jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  CONSTRAINT response_cache_schema_v2 CHECK (schema_version = 2),
  CONSTRAINT response_cache_revision_positive CHECK (policy_revision > 0),
  CONSTRAINT response_cache_expiry_after_creation CHECK (expires_at > created_at),
  CONSTRAINT response_cache_embedding_scope CHECK (
    embedding IS NULL OR (partition_key IS NOT NULL AND embedding_model_version IS NOT NULL)
  )
);
CREATE INDEX IF NOT EXISTS response_cache_v2_exact ON response_cache_v2(org_id, agent_id, exact_key);
CREATE INDEX IF NOT EXISTS response_cache_v2_partition ON response_cache_v2(org_id, agent_id, partition_key, embedding_model_version);
CREATE INDEX IF NOT EXISTS response_cache_v2_expiry ON response_cache_v2(expires_at);
