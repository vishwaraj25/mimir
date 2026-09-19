-- Mimir's own store. Deliberately separate from any connected telemetry
-- source: sources are read-only inputs, this is where Mimir's own work
-- lives. Point MIMIR_DATABASE_URL at this database.

-- An investigation is one question and the full trail of how it was
-- answered. The trail is the product, not a debug log: "the agent said
-- completion dropped" is worth nothing without the steps that show it
-- checked sample size and ruled out the alternatives.
CREATE TABLE IF NOT EXISTS investigations (
    id            BIGSERIAL PRIMARY KEY,
    source_id     TEXT NOT NULL,
    question      TEXT NOT NULL,
    -- 'running' | 'complete' | 'failed'
    status        TEXT NOT NULL DEFAULT 'running',
    -- How it was started: 'ask' (you typed it) or 'monitor' (anomaly watch).
    trigger       TEXT NOT NULL DEFAULT 'ask',
    headline      TEXT,
    summary       TEXT,
    hypothesis    TEXT,
    confidence    TEXT,          -- 'high' | 'medium' | 'low' | 'insufficient_data'
    -- Which model actually ran it, so a verdict can be read in the light of
    -- what produced it -- a free 8B model and a frontier model are not the
    -- same witness.
    model_label   TEXT,
    started_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    finished_at   TIMESTAMPTZ,
    error         TEXT
);

-- One row per reasoning step: the tool the agent chose, why, and what came
-- back. Ordered by step_index, this is the readable trail in the UI.
CREATE TABLE IF NOT EXISTS investigation_steps (
    id               BIGSERIAL PRIMARY KEY,
    investigation_id BIGINT NOT NULL REFERENCES investigations(id) ON DELETE CASCADE,
    step_index       INT NOT NULL,
    -- 'thought' | 'tool_call' | 'tool_result' | 'conclusion'
    kind             TEXT NOT NULL,
    tool_name        TEXT,
    tool_input       JSONB,
    content          TEXT,
    result           JSONB,
    duration_ms      INT,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_steps_investigation
    ON investigation_steps(investigation_id, step_index);

-- A finding worth keeping. Insights are what the agent believes about the
-- product; investigations are how it got there.
CREATE TABLE IF NOT EXISTS insights (
    id               BIGSERIAL PRIMARY KEY,
    source_id        TEXT NOT NULL,
    investigation_id BIGINT REFERENCES investigations(id) ON DELETE SET NULL,
    headline         TEXT NOT NULL,
    detail           TEXT NOT NULL,
    -- 'drop_off' | 'anomaly' | 'segment_gap' | 'correlation' | 'data_quality'
    kind             TEXT NOT NULL,
    severity         TEXT NOT NULL DEFAULT 'info',  -- 'critical' | 'warning' | 'info'
    metric_before    NUMERIC,
    metric_after     NUMERIC,
    sample_size      INT,
    -- False once the underlying metric recovers or the finding is dismissed.
    active           BOOLEAN NOT NULL DEFAULT TRUE,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_insights_source ON insights(source_id, created_at DESC);

-- A proposed change, its success metric, and the guardrails that say when
-- to stop. Written by the agent at the end of an investigation; the status
-- is moved by a human.
CREATE TABLE IF NOT EXISTS experiments (
    id               BIGSERIAL PRIMARY KEY,
    source_id        TEXT NOT NULL,
    insight_id       BIGINT REFERENCES insights(id) ON DELETE SET NULL,
    title            TEXT NOT NULL,
    hypothesis       TEXT NOT NULL,
    change_described TEXT NOT NULL,
    primary_metric   TEXT NOT NULL,
    -- Metrics that must NOT get worse for the result to count as a win.
    guardrail_metrics JSONB NOT NULL DEFAULT '[]',
    -- 'proposed' | 'running' | 'shipped' | 'rejected'
    status           TEXT NOT NULL DEFAULT 'proposed',
    baseline_value   NUMERIC,
    current_value    NUMERIC,
    started_at       TIMESTAMPTZ,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Each morning brief, kept so the dashboard can show "what changed since
-- yesterday" without recomputing, and so briefs are diffable over time.
CREATE TABLE IF NOT EXISTS briefs (
    id          BIGSERIAL PRIMARY KEY,
    source_id   TEXT NOT NULL,
    brief_date  DATE NOT NULL,
    headline    TEXT NOT NULL,
    body        TEXT NOT NULL,
    metrics     JSONB NOT NULL DEFAULT '{}',
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (source_id, brief_date)
);
