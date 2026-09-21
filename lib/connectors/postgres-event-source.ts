import { Pool } from "pg";
import type {
  AggregateSpec,
  EventRecord,
  EventSchema,
  EventSource,
  PropertyDefinition,
  QueryResult,
  TimeRange,
} from "./types";

/**
 * A connector for any Postgres database that stores events in a single wide
 * table with a JSON properties column -- which is the common shape, and the
 * shape Night Run happens to use.
 *
 * Nothing here knows the words "player" or "night run": the caller supplies
 * a TableMapping saying which columns mean what. Pointing this at a second,
 * differently-named database is a config change, not a code change.
 *
 * SAFETY: every column name that reaches SQL comes from the mapping, which
 * is code Mimir itself controls, and is additionally identifier-quoted.
 * Every VALUE (event names, property keys, dates the agent chose) is passed
 * as a bound parameter. The agent can therefore steer WHAT is aggregated
 * without ever being able to inject SQL, and holds a read-only role besides.
 */
export interface TableMapping {
  eventsTable: string;
  usersTable: string;
  columns: {
    userId: string;
    sessionId: string;
    eventName: string;
    properties: string;
    occurredAt: string;
    /** On the users table: when each user was first seen. */
    userFirstSeen: string;
  };
}

/** Night Run's telemetry schema, expressed as a mapping. */
export const NIGHT_RUN_MAPPING: TableMapping = {
  eventsTable: "events",
  usersTable: "players",
  columns: {
    userId: "player_id",
    sessionId: "session_id",
    eventName: "event_name",
    properties: "payload",
    occurredAt: "server_ts",
    userFirstSeen: "first_seen_at",
  },
};

/** Postgres identifier quoting. Mapping values are trusted, but not blindly. */
function ident(name: string): string {
  if (!/^[a-z_][a-z0-9_]*$/i.test(name)) {
    throw new Error(`unsafe identifier in table mapping: ${name}`);
  }
  return `"${name}"`;
}

export class PostgresEventSource implements EventSource {
  readonly id: string;
  readonly displayName: string;
  private pool: Pool;
  private map: TableMapping;

  constructor(opts: {
    id: string;
    displayName: string;
    connectionString: string;
    mapping: TableMapping;
  }) {
    this.id = opts.id;
    this.displayName = opts.displayName;
    this.map = opts.mapping;
    this.pool = new Pool({
      connectionString: opts.connectionString,
      max: 3,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 5_000,
      ssl: { rejectUnauthorized: true },
      // The agent chooses what to aggregate. Two limits that hold even if the
      // role it connects with was granted more than it should have been:
      // a query can't run longer than 10s, and the session can't write.
      statement_timeout: 10_000,
      options: "-c default_transaction_read_only=on",
    });
  }

  private get e() {
    return ident(this.map.eventsTable);
  }
  private get c() {
    const c = this.map.columns;
    return {
      userId: ident(c.userId),
      sessionId: ident(c.sessionId),
      eventName: ident(c.eventName),
      props: ident(c.properties),
      at: ident(c.occurredAt),
    };
  }

  async healthCheck() {
    try {
      const r = await this.pool.query(`SELECT 1 AS ok FROM ${this.e} LIMIT 1`);
      return { ok: true, detail: `reachable, ${r.rowCount ?? 0} row sampled` };
    } catch (err) {
      // Driver errors can name the host, database and user. Log the detail on
      // the server; the page only needs to know it failed.
      console.error(`source ${this.id} health check failed:`, (err as Error).message);
      return { ok: false, detail: "unreachable (see server logs)" };
    }
  }

  async describeSchema(): Promise<EventSchema> {
    const c = this.c;

    const [totals, events] = await Promise.all([
      this.pool.query(`
        SELECT COUNT(*)::int AS total_events,
               COUNT(DISTINCT ${c.userId})::int AS total_users,
               MIN(${c.at}) AS first_at,
               MAX(${c.at}) AS last_at
        FROM ${this.e}
      `),
      this.pool.query(`
        SELECT ${c.eventName} AS name, COUNT(*)::int AS count
        FROM ${this.e}
        GROUP BY 1 ORDER BY 2 DESC
      `),
    ]);

    // Property discovery: for each event, unroll its JSON keys and profile
    // them. This is what lets the agent segment by a property it was never
    // told about -- it discovers "reason" and "x" the same way a human would.
    const eventDefs = await Promise.all(
      events.rows.map(async (row: { name: string; count: number }) => {
        const props = await this.pool.query(
          `
          SELECT kv.key AS key,
                 COUNT(DISTINCT kv.value::text)::int AS distinct_count,
                 (ARRAY_AGG(DISTINCT kv.value::text))[1:8] AS samples,
                 BOOL_AND(jsonb_typeof(kv.value) = 'number') AS all_num,
                 BOOL_AND(jsonb_typeof(kv.value) = 'boolean') AS all_bool
          FROM ${this.e} ev,
               LATERAL jsonb_each(ev.${c.props}) AS kv(key, value)
          WHERE ev.${c.eventName} = $1
          GROUP BY 1 ORDER BY 1
        `,
          [row.name],
        );

        const properties: PropertyDefinition[] = props.rows.map((p: any) => ({
          key: p.key,
          type: p.all_num ? "number" : p.all_bool ? "boolean" : "string",
          sampleValues: (p.samples ?? []).map((s: string) =>
            String(s).replace(/^"|"$/g, ""),
          ),
          distinctCount: p.distinct_count,
        }));

        return { name: row.name, count: row.count, properties };
      }),
    );

    const t = totals.rows[0];
    return {
      events: eventDefs,
      totalEvents: t.total_events,
      totalUsers: t.total_users,
      firstEventAt: t.first_at,
      lastEventAt: t.last_at,
    };
  }

  async activeUsersByDay(range: TimeRange) {
    const c = this.c;
    const r = await this.pool.query(
      `
      SELECT date_trunc('day', ${c.at}) AS day,
             COUNT(DISTINCT ${c.userId})::int AS users
      FROM ${this.e}
      WHERE ${c.at} >= $1 AND ${c.at} < $2
      GROUP BY 1 ORDER BY 1
    `,
      [range.from, range.to],
    );
    return r.rows.map((x: any) => ({ day: x.day, users: x.users }));
  }

  async distinctUsers(range: TimeRange): Promise<number> {
    const c = this.c;
    const r = await this.pool.query(
      `SELECT COUNT(DISTINCT ${c.userId})::int AS n
       FROM ${this.e} WHERE ${c.at} >= $1 AND ${c.at} < $2`,
      [range.from, range.to],
    );
    return r.rows[0]?.n ?? 0;
  }

  async newUsers(range: TimeRange): Promise<number> {
    const u = ident(this.map.usersTable);
    const firstSeen = ident(this.map.columns.userFirstSeen);
    const r = await this.pool.query(
      `SELECT COUNT(*)::int AS n FROM ${u}
       WHERE ${firstSeen} >= $1 AND ${firstSeen} < $2`,
      [range.from, range.to],
    );
    return r.rows[0]?.n ?? 0;
  }

  async eventCountsByDay(
    eventName: string,
    range: TimeRange,
    splitByProperty?: string,
  ) {
    const c = this.c;
    const segmentExpr = splitByProperty ? `ev.${c.props}->>$4` : `NULL::text`;
    const params: unknown[] = [eventName, range.from, range.to];
    if (splitByProperty) params.push(splitByProperty);

    const r = await this.pool.query(
      `
      SELECT date_trunc('day', ev.${c.at}) AS day,
             ${segmentExpr} AS segment,
             COUNT(*)::int AS count
      FROM ${this.e} ev
      WHERE ev.${c.eventName} = $1 AND ev.${c.at} >= $2 AND ev.${c.at} < $3
      GROUP BY 1, 2 ORDER BY 1, 2
    `,
      params,
    );
    return r.rows.map((x: any) => ({
      day: x.day,
      segment: x.segment,
      count: x.count,
    }));
  }

  /**
   * Strict funnel: a user counts at step N only if they also did steps 1..N-1.
   * Order is by first occurrence, so "did the later step earlier" doesn't
   * silently inflate a stage.
   */
  async funnel(steps: string[], range: TimeRange) {
    const c = this.c;
    const out: { step: string; users: number }[] = [];
    let eligible: string[] | null = null;

    for (const step of steps) {
      const params: unknown[] = [step, range.from, range.to];
      let userFilter = "";
      if (eligible) {
        if (eligible.length === 0) {
          out.push({ step, users: 0 });
          continue;
        }
        params.push(eligible);
        userFilter = `AND ev.${c.userId}::text = ANY($4)`;
      }
      const r = await this.pool.query(
        `
        SELECT DISTINCT ev.${c.userId}::text AS uid
        FROM ${this.e} ev
        WHERE ev.${c.eventName} = $1
          AND ev.${c.at} >= $2 AND ev.${c.at} < $3
          ${userFilter}
      `,
        params,
      );
      eligible = r.rows.map((x: any) => x.uid);
      out.push({ step, users: eligible.length });
    }
    return out;
  }

  async segment(eventName: string, property: string, range: TimeRange) {
    const c = this.c;
    const r = await this.pool.query(
      `
      SELECT COALESCE(ev.${c.props}->>$2, '(absent)') AS value,
             COUNT(DISTINCT ev.${c.userId})::int AS users,
             COUNT(*)::int AS events
      FROM ${this.e} ev
      WHERE ev.${c.eventName} = $1 AND ev.${c.at} >= $3 AND ev.${c.at} < $4
      GROUP BY 1 ORDER BY 3 DESC
      LIMIT 50
    `,
      [eventName, property, range.from, range.to],
    );
    return r.rows.map((x: any) => ({
      value: x.value,
      users: x.users,
      events: x.events,
    }));
  }

  async usersWhoDid(eventName: string, range: TimeRange) {
    const c = this.c;
    const r = await this.pool.query(
      `
      SELECT DISTINCT ${c.userId}::text AS uid
      FROM ${this.e}
      WHERE ${c.eventName} = $1 AND ${c.at} >= $2 AND ${c.at} < $3
    `,
      [eventName, range.from, range.to],
    );
    return r.rows.map((x: any) => x.uid);
  }

  async userTimeline(userId: string, limit = 500): Promise<EventRecord[]> {
    const c = this.c;
    const r = await this.pool.query(
      `
      SELECT ${c.userId}::text AS uid, ${c.sessionId}::text AS sid,
             ${c.eventName} AS name, ${c.props} AS props, ${c.at} AS at
      FROM ${this.e}
      WHERE ${c.userId}::text = $1
      ORDER BY ${c.at} ASC
      LIMIT $2
    `,
      [userId, limit],
    );
    return r.rows.map((x: any) => ({
      userId: x.uid,
      sessionId: x.sid,
      eventName: x.name,
      properties: x.props ?? {},
      occurredAt: x.at,
    }));
  }

  async runAggregate(spec: AggregateSpec): Promise<QueryResult> {
    const c = this.c;
    const params: unknown[] = [spec.range.from, spec.range.to];
    const where: string[] = [`ev.${c.at} >= $1`, `ev.${c.at} < $2`];

    if (spec.eventName) {
      params.push(spec.eventName);
      where.push(`ev.${c.eventName} = $${params.length}`);
    }

    let groupExpr = `'all'::text`;
    if (spec.groupBy) {
      params.push(spec.groupBy);
      const raw = `ev.${c.props}->>$${params.length}`;
      if (spec.bucketSize && spec.bucketSize > 0) {
        params.push(spec.bucketSize);
        groupExpr = `(FLOOR((${raw})::numeric / $${params.length}) * $${params.length})::text`;
      } else {
        groupExpr = raw;
      }
    }

    let metricExpr: string;
    switch (spec.metric) {
      case "user_count":
        metricExpr = `COUNT(DISTINCT ev.${c.userId})::int`;
        break;
      case "avg":
      case "sum": {
        if (!spec.metricProperty) {
          throw new Error(`metric ${spec.metric} needs metricProperty`);
        }
        params.push(spec.metricProperty);
        const fn = spec.metric === "avg" ? "AVG" : "SUM";
        metricExpr = `${fn}((ev.${c.props}->>$${params.length})::numeric)`;
        break;
      }
      default:
        metricExpr = `COUNT(*)::int`;
    }

    params.push(Math.max(1, Math.min(Math.trunc(Number(spec.limit) || 100), 500)));
    const r = await this.pool.query(
      `
      SELECT ${groupExpr} AS group_value, ${metricExpr} AS value
      FROM ${this.e} ev
      WHERE ${where.join(" AND ")}
      GROUP BY 1
      ORDER BY 2 DESC NULLS LAST
      LIMIT $${params.length}
    `,
      params,
    );
    return r.rows;
  }
}
