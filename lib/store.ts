import { Pool } from "pg";

/**
 * Where Mimir keeps its own work: investigations, their step-by-step
 * reasoning trails, insights, experiments and briefs.
 *
 * Backed by Postgres when MIMIR_DATABASE_URL is set, and by an in-process
 * map when it is not. The fallback is what lets a fresh clone run the agent
 * and read a full reasoning trail with no database at all -- it is lost on
 * restart, and the UI says so rather than pretending otherwise.
 */

export interface Investigation {
  id: number;
  source_id: string;
  question: string;
  status: string;
  trigger: string;
  headline: string | null;
  summary: string | null;
  hypothesis: string | null;
  confidence: string | null;
  model_label: string | null;
  started_at: Date;
  finished_at: Date | null;
  error: string | null;
}

export interface Step {
  id: number;
  investigation_id: number;
  step_index: number;
  kind: string;
  tool_name: string | null;
  tool_input: unknown;
  content: string | null;
  result: unknown;
  duration_ms: number | null;
  created_at: Date;
}

export interface Insight {
  id: number;
  source_id: string;
  investigation_id: number | null;
  headline: string;
  detail: string;
  kind: string;
  severity: string;
  metric_before: number | null;
  metric_after: number | null;
  sample_size: number | null;
  created_at: Date;
}

export interface Experiment {
  id: number;
  source_id: string;
  title: string;
  hypothesis: string;
  change_described: string;
  primary_metric: string;
  guardrail_metrics: string[];
  status: string;
  created_at: Date;
}

export interface Brief {
  id: number;
  source_id: string;
  brief_date: string;
  headline: string;
  body: string;
  metrics: unknown;
  created_at: Date;
}

export interface Store {
  readonly persistent: boolean;
  createInvestigation(v: {
    sourceId: string;
    question: string;
    trigger: string;
    modelLabel: string;
  }): Promise<number>;
  addStep(v: Omit<Step, "id" | "created_at">): Promise<void>;
  finishInvestigation(
    id: number,
    v: Partial<Pick<Investigation, "status" | "headline" | "summary" | "hypothesis" | "confidence" | "error">>,
  ): Promise<void>;
  listInvestigations(limit?: number): Promise<Investigation[]>;
  getInvestigation(id: number): Promise<{ investigation: Investigation | null; steps: Step[] }>;
  addInsight(v: Omit<Insight, "id" | "created_at">): Promise<void>;
  listInsights(limit?: number): Promise<Insight[]>;
  addExperiment(v: Omit<Experiment, "id" | "created_at">): Promise<void>;
  listExperiments(limit?: number): Promise<Experiment[]>;
  saveBrief(v: Omit<Brief, "id" | "created_at">): Promise<void>;
  latestBrief(sourceId: string): Promise<Brief | null>;
}

// --- in-memory ------------------------------------------------------------

class MemoryStore implements Store {
  readonly persistent = false;
  private investigations: Investigation[] = [];
  private steps: Step[] = [];
  private insights: Insight[] = [];
  private experiments: Experiment[] = [];
  private briefs: Brief[] = [];
  private seq = 1;

  async createInvestigation(v: {
    sourceId: string;
    question: string;
    trigger: string;
    modelLabel: string;
  }) {
    const id = this.seq++;
    this.investigations.unshift({
      id,
      source_id: v.sourceId,
      question: v.question,
      status: "running",
      trigger: v.trigger,
      headline: null,
      summary: null,
      hypothesis: null,
      confidence: null,
      model_label: v.modelLabel,
      started_at: new Date(),
      finished_at: null,
      error: null,
    });
    return id;
  }

  async addStep(v: Omit<Step, "id" | "created_at">) {
    this.steps.push({ ...v, id: this.seq++, created_at: new Date() });
  }

  async finishInvestigation(id: number, v: Partial<Investigation>) {
    const inv = this.investigations.find((i) => i.id === id);
    if (inv) Object.assign(inv, v, { finished_at: new Date() });
  }

  async listInvestigations(limit = 50) {
    return this.investigations.slice(0, limit);
  }

  async getInvestigation(id: number) {
    return {
      investigation: this.investigations.find((i) => i.id === id) ?? null,
      steps: this.steps
        .filter((s) => s.investigation_id === id)
        .sort((a, b) => a.step_index - b.step_index),
    };
  }

  async addInsight(v: Omit<Insight, "id" | "created_at">) {
    this.insights.unshift({ ...v, id: this.seq++, created_at: new Date() });
  }
  async listInsights(limit = 60) {
    return this.insights.slice(0, limit);
  }
  async addExperiment(v: Omit<Experiment, "id" | "created_at">) {
    this.experiments.unshift({ ...v, id: this.seq++, created_at: new Date() });
  }
  async listExperiments(limit = 50) {
    return this.experiments.slice(0, limit);
  }
  async saveBrief(v: Omit<Brief, "id" | "created_at">) {
    this.briefs = this.briefs.filter(
      (b) => !(b.source_id === v.source_id && b.brief_date === v.brief_date),
    );
    this.briefs.unshift({ ...v, id: this.seq++, created_at: new Date() });
  }
  async latestBrief(sourceId: string) {
    return this.briefs.filter((b) => b.source_id === sourceId)[0] ?? null;
  }
}

// --- postgres -------------------------------------------------------------

class PostgresStore implements Store {
  readonly persistent = true;
  private pool: Pool;

  constructor(connectionString: string) {
    this.pool = new Pool({
      connectionString,
      max: 5,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 5_000,
      ssl: { rejectUnauthorized: true },
    });
  }

  async createInvestigation(v: {
    sourceId: string;
    question: string;
    trigger: string;
    modelLabel: string;
  }) {
    const r = await this.pool.query(
      `INSERT INTO investigations (source_id, question, trigger, model_label, status)
       VALUES ($1,$2,$3,$4,'running') RETURNING id`,
      [v.sourceId, v.question, v.trigger, v.modelLabel],
    );
    return r.rows[0].id as number;
  }

  async addStep(v: Omit<Step, "id" | "created_at">) {
    await this.pool.query(
      `INSERT INTO investigation_steps
         (investigation_id, step_index, kind, tool_name, tool_input, content, result, duration_ms)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [
        v.investigation_id,
        v.step_index,
        v.kind,
        v.tool_name,
        v.tool_input ? JSON.stringify(v.tool_input) : null,
        v.content,
        v.result ? JSON.stringify(v.result) : null,
        v.duration_ms,
      ],
    );
  }

  async finishInvestigation(id: number, v: Partial<Investigation>) {
    await this.pool.query(
      `UPDATE investigations SET status=COALESCE($2,status), headline=$3,
         summary=$4, hypothesis=$5, confidence=$6, error=$7, finished_at=now()
       WHERE id=$1`,
      [
        id,
        v.status ?? null,
        v.headline ?? null,
        v.summary ?? null,
        v.hypothesis ?? null,
        v.confidence ?? null,
        v.error ?? null,
      ],
    );
  }

  async listInvestigations(limit = 50) {
    const r = await this.pool.query(
      `SELECT * FROM investigations ORDER BY started_at DESC LIMIT $1`,
      [limit],
    );
    return r.rows;
  }

  async getInvestigation(id: number) {
    const [a, b] = await Promise.all([
      this.pool.query(`SELECT * FROM investigations WHERE id=$1`, [id]),
      this.pool.query(
        `SELECT * FROM investigation_steps WHERE investigation_id=$1 ORDER BY step_index`,
        [id],
      ),
    ]);
    return { investigation: a.rows[0] ?? null, steps: b.rows };
  }

  async addInsight(v: Omit<Insight, "id" | "created_at">) {
    await this.pool.query(
      `INSERT INTO insights (source_id, investigation_id, headline, detail, kind,
         severity, metric_before, metric_after, sample_size)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [
        v.source_id,
        v.investigation_id,
        v.headline,
        v.detail,
        v.kind,
        v.severity,
        v.metric_before,
        v.metric_after,
        v.sample_size,
      ],
    );
  }

  async listInsights(limit = 60) {
    const r = await this.pool.query(
      `SELECT * FROM insights WHERE active ORDER BY
         CASE severity WHEN 'critical' THEN 0 WHEN 'warning' THEN 1 ELSE 2 END,
         created_at DESC LIMIT $1`,
      [limit],
    );
    return r.rows;
  }

  async addExperiment(v: Omit<Experiment, "id" | "created_at">) {
    await this.pool.query(
      `INSERT INTO experiments (source_id, title, hypothesis, change_described,
         primary_metric, guardrail_metrics, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [
        v.source_id,
        v.title,
        v.hypothesis,
        v.change_described,
        v.primary_metric,
        JSON.stringify(v.guardrail_metrics),
        v.status,
      ],
    );
  }

  async listExperiments(limit = 50) {
    const r = await this.pool.query(
      `SELECT * FROM experiments ORDER BY created_at DESC LIMIT $1`,
      [limit],
    );
    return r.rows;
  }

  async saveBrief(v: Omit<Brief, "id" | "created_at">) {
    await this.pool.query(
      `INSERT INTO briefs (source_id, brief_date, headline, body, metrics)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (source_id, brief_date) DO UPDATE
         SET headline=EXCLUDED.headline, body=EXCLUDED.body,
             metrics=EXCLUDED.metrics, created_at=now()`,
      [v.source_id, v.brief_date, v.headline, v.body, JSON.stringify(v.metrics)],
    );
  }

  async latestBrief(sourceId: string) {
    const r = await this.pool.query(
      `SELECT * FROM briefs WHERE source_id=$1 ORDER BY brief_date DESC LIMIT 1`,
      [sourceId],
    );
    return r.rows[0] ?? null;
  }
}

let instance: Store | null = null;

export function store(): Store {
  if (!instance) {
    const url = process.env.MIMIR_DATABASE_URL;
    instance = url ? new PostgresStore(url) : new MemoryStore();
  }
  return instance;
}
