-- Stage 2 exact-key index and diagnostics table. Apply after verifying V2 is
-- empty or contains no duplicate (org_id, agent_id, exact_key) rows.
CREATE UNIQUE INDEX IF NOT EXISTS response_cache_v2_unique_exact
  ON response_cache_v2(org_id, agent_id, exact_key);

CREATE TABLE IF NOT EXISTS cache_request_diagnostics (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  agent_id uuid NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  task_id uuid,
  provider text NOT NULL,
  model text,
  outcome text NOT NULL,
  reason text NOT NULL,
  lookup_latency_ms integer NOT NULL,
  embedding_latency_ms integer,
  embedding_input_tokens integer,
  embedding_cost_usd numeric(12,6),
  embedding_cost_status text NOT NULL DEFAULT 'none',
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT cache_diagnostics_latency_nonnegative CHECK (lookup_latency_ms >= 0)
);
CREATE INDEX IF NOT EXISTS cache_request_diagnostics_scope
  ON cache_request_diagnostics(org_id, agent_id, created_at);
