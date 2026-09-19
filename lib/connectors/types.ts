// The contract every telemetry source must satisfy.
//
// This is the seam that keeps Mimir from being "the Night Run dashboard".
// Night Run is connector #1, not the thing the analyst is built around: the
// agent, the metrics layer and the UI all speak this interface and never
// touch a source's real table names.
//
// Adding a new source (Mixpanel, Amplitude, a different Postgres schema, a
// CSV drop) means writing one class that satisfies EventSource. Nothing in
// lib/agent or lib/analysis changes.

/** A source's own idea of "an event happened". */
export interface EventRecord {
  userId: string;
  sessionId: string | null;
  eventName: string;
  properties: Record<string, unknown>;
  occurredAt: Date;
}

/** What the agent is told exists before it starts reasoning. */
export interface EventSchema {
  events: EventDefinition[];
  /** Total rows, for sample-size guards. */
  totalEvents: number;
  totalUsers: number;
  firstEventAt: Date | null;
  lastEventAt: Date | null;
}

export interface EventDefinition {
  name: string;
  count: number;
  /** Property keys seen on this event, with their observed types. */
  properties: PropertyDefinition[];
}

export interface PropertyDefinition {
  key: string;
  type: "string" | "number" | "boolean" | "mixed";
  /** Up to N distinct values, when the property is low-cardinality. */
  sampleValues: string[];
  distinctCount: number;
}

/** Result of any aggregate the agent asks for. Deliberately shapeless rows. */
export type QueryResult = Record<string, unknown>[];

export interface TimeRange {
  from: Date;
  to: Date;
}

/**
 * A connected telemetry source.
 *
 * Every method is READ-ONLY by contract. Mimir never writes to a source --
 * its own findings live in Mimir's own database instead. A connector that
 * needs write access to do its job is a connector doing the wrong job.
 */
export interface EventSource {
  /** Stable id, e.g. "night-run". Used as the FK in Mimir's own tables. */
  readonly id: string;
  readonly displayName: string;

  /** Is the source reachable and configured? Surfaced in the UI. */
  healthCheck(): Promise<{ ok: boolean; detail: string }>;

  /**
   * What events exist, how often, and what properties they carry.
   * The agent gets this before it plans anything, so it reasons about real
   * event names rather than guessing at them.
   */
  describeSchema(): Promise<EventSchema>;

  /** Distinct active users per day, for trend lines. */
  activeUsersByDay(range: TimeRange): Promise<{ day: Date; users: number }[]>;

  /**
   * Distinct users active anywhere in the range. Separate from
   * activeUsersByDay because WAU is not the sum (or the peak) of daily
   * numbers -- anyone active on two days would be counted twice.
   */
  distinctUsers(range: TimeRange): Promise<number>;

  /** Users whose very first event falls inside the range. */
  newUsers(range: TimeRange): Promise<number>;

  /** Raw counts of one event over time, optionally split by a property. */
  eventCountsByDay(
    eventName: string,
    range: TimeRange,
    splitByProperty?: string,
  ): Promise<{ day: Date; segment: string | null; count: number }[]>;

  /**
   * Ordered funnel: for each step, how many distinct users fired that event
   * at least once within the range, having also fired every prior step.
   */
  funnel(
    steps: string[],
    range: TimeRange,
  ): Promise<{ step: string; users: number }[]>;

  /**
   * The workhorse for investigations: counts of `eventName` grouped by one
   * property, so the agent can segment a metric by device, level, reason,
   * or anything else the source happens to carry.
   */
  segment(
    eventName: string,
    property: string,
    range: TimeRange,
  ): Promise<{ value: string; users: number; events: number }[]>;

  /**
   * Users who fired `eventName` in the range, for cohort comparison.
   * Returned as ids only -- Mimir compares behaviour between cohorts, it
   * does not need to know anything else about a person.
   */
  usersWhoDid(eventName: string, range: TimeRange): Promise<string[]>;

  /** Every event for one user, in order. The per-user reasoning trail. */
  userTimeline(userId: string, limit?: number): Promise<EventRecord[]>;

  /**
   * Escape hatch for aggregates the interface above can't express.
   * Implementations MUST reject anything that isn't a read, and MUST scope
   * it to that source's own data. See postgres-event-source.ts.
   */
  runAggregate(spec: AggregateSpec): Promise<QueryResult>;
}

/**
 * A structured aggregate request. Deliberately not raw SQL: the agent
 * composes these, and a malformed or hostile one can only ever produce a
 * bad aggregate, never an arbitrary statement against the source.
 */
export interface AggregateSpec {
  eventName?: string;
  /** Property to group by, e.g. "reason" or "x". */
  groupBy?: string;
  /** Bucket a numeric property, e.g. round x to the nearest 1000. */
  bucketSize?: number;
  metric: "event_count" | "user_count" | "avg" | "sum";
  /** Property to average/sum when metric is avg or sum. */
  metricProperty?: string;
  range: TimeRange;
  limit?: number;
}
