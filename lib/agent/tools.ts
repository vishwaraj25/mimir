import type { LLMTool } from "../llm";
import type { EventSource, TimeRange } from "../connectors/types";

/**
 * The agent's hands.
 *
 * Every tool is a read against the connected source, expressed in the
 * EventSource vocabulary -- so the same tool definitions work against any
 * connector, and the agent never writes SQL. That is the safety property
 * AND the portability property: the agent that investigates Night Run is
 * byte-identical to the one that would investigate a SaaS funnel.
 *
 * Tools are deliberately small and composable. The interesting behaviour
 * (drop detected -> segment it -> compare cohorts -> check significance)
 * is the agent CHOOSING this sequence, not a hardcoded pipeline.
 */

function daysAgo(n: number): Date {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - n);
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

function rangeFromDays(fromDaysAgo: number, toDaysAgo = 0): TimeRange {
  return { from: daysAgo(fromDaysAgo), to: daysAgo(toDaysAgo - 1 + 1) };
}

export const TOOL_DEFINITIONS: LLMTool[] = [
  {
    name: "describe_schema",
    description:
      "List every event that exists in this telemetry source, how often each fires, and what properties each carries (with sample values). Call this FIRST in almost every investigation -- it is how you learn what is actually tracked instead of guessing event names.",
    parameters: { type: "object", properties: {} },
  },
  {
    name: "metric_over_time",
    description:
      "Daily counts of one event, optionally split by a property. Use this to confirm a change is real and to find WHEN it started before asking why.",
    parameters: {
      type: "object",
      properties: {
        event_name: { type: "string" },
        days_back: {
          type: "number",
          description: "How many days of history. Default 28.",
        },
        split_by_property: {
          type: "string",
          description:
            "Optional property key to break the series out by, e.g. 'reason'.",
        },
      },
      required: ["event_name"],
    },
  },
  {
    name: "funnel",
    description:
      "Strict ordered funnel across event names: how many distinct users reached each step having completed all prior steps. Use this to locate WHICH stage changed rather than reasoning about a single aggregate number.",
    parameters: {
      type: "object",
      properties: {
        steps: {
          type: "array",
          items: { type: "string" },
          description: "Event names in order, e.g. ['run_start','boss_defeated']",
        },
        days_back: { type: "number", description: "Default 28." },
      },
      required: ["steps"],
    },
  },
  {
    name: "compare_periods",
    description:
      "Run the same funnel over two adjacent windows (recent vs prior) and return both, so you can quantify a shift rather than assert one. Returns conversion rates and absolute user counts for each step in both periods.",
    parameters: {
      type: "object",
      properties: {
        steps: { type: "array", items: { type: "string" } },
        window_days: {
          type: "number",
          description: "Length of each window in days. Default 7.",
        },
      },
      required: ["steps"],
    },
  },
  {
    name: "segment_event",
    description:
      "Break one event down by one property: users and event counts per value. This is the main tool for 'why' -- segment the changed metric by every plausible property and look for the value carrying the change.",
    parameters: {
      type: "object",
      properties: {
        event_name: { type: "string" },
        property: { type: "string" },
        days_back: { type: "number", description: "Default 28." },
      },
      required: ["event_name", "property"],
    },
  },
  {
    name: "compare_cohorts",
    description:
      "Compare two groups of users defined by an event each did (e.g. users who reached the boss vs users who did not) and return how differently each group fires every other event, as per-user averages. This is how you find behavioural differences between successful and unsuccessful users.",
    parameters: {
      type: "object",
      properties: {
        cohort_a_event: {
          type: "string",
          description: "Event defining cohort A, e.g. 'boss_defeated'",
        },
        cohort_b_event: {
          type: "string",
          description:
            "Event defining cohort B. Users in A are excluded from B, so the groups never overlap.",
        },
        days_back: { type: "number", description: "Default 28." },
      },
      required: ["cohort_a_event", "cohort_b_event"],
    },
  },
  {
    name: "aggregate",
    description:
      "Flexible grouped aggregate over one event: count events/users, or average/sum a numeric property, grouped by a property with optional numeric bucketing. Use bucket_size to turn a continuous property (like a position) into a histogram.",
    parameters: {
      type: "object",
      properties: {
        event_name: { type: "string" },
        group_by: { type: "string" },
        bucket_size: {
          type: "number",
          description:
            "Round the grouped numeric property into buckets of this size.",
        },
        metric: {
          type: "string",
          enum: ["event_count", "user_count", "avg", "sum"],
        },
        metric_property: {
          type: "string",
          description: "Required when metric is avg or sum.",
        },
        days_back: { type: "number", description: "Default 28." },
        compare_to_prior: {
          type: "boolean",
          description:
            "Also run the identical query over the equally long window before this one and return both side by side, sorted by biggest change. Use this to find WHERE a change came from (e.g. group_by a position, bucket_size it).",
        },
      },
      required: ["metric"],
    },
  },
  {
    name: "locate_change",
    description:
      "THE tool for 'where did people get lost / where did it change'. Give it the event that marks a loss or a change (a death, an exit, an error). It finds every property of that event that says where or how it happened, compares the last window to the one before it, and reports which value of which property changed most, and how concentrated the change is. Call this as soon as a metric has moved.",
    parameters: {
      type: "object",
      properties: {
        event_name: {
          type: "string",
          description: "The event that marks the loss, e.g. player_died.",
        },
        days_back: {
          type: "number",
          description: "Length of each window. Default 7.",
        },
      },
      required: ["event_name"],
    },
  },
  {
    name: "user_timeline",
    description:
      "Every event for one user in order. Use sparingly, to sanity-check a hypothesis against what one real session actually looked like.",
    parameters: {
      type: "object",
      properties: { user_id: { type: "string" } },
      required: ["user_id"],
    },
  },
  {
    name: "check_significance",
    description:
      "Two-proportion check: given successes and totals for two periods, returns the absolute change, relative change, and whether the sample is large enough to conclude anything. ALWAYS call this before claiming a metric moved -- with small n, an apparent swing is usually noise, and saying so is a valid and important finding.",
    parameters: {
      type: "object",
      properties: {
        before_successes: { type: "number" },
        before_total: { type: "number" },
        after_successes: { type: "number" },
        after_total: { type: "number" },
      },
      required: [
        "before_successes",
        "before_total",
        "after_successes",
        "after_total",
      ],
    },
  },
];

type ToolInput = Record<string, any>;

export async function executeTool(
  source: EventSource,
  name: string,
  input: ToolInput,
): Promise<unknown> {
  // Bounded: the agent chooses these, and an unbounded window or funnel is
  // just a way to ask for an expensive full-table scan.
  const days = Math.max(1, Math.min(Math.trunc(Number(input.days_back)) || 28, 365));
  if (Array.isArray(input.steps)) input.steps = input.steps.slice(0, 10);
  const range = rangeFromDays(days);

  switch (name) {
    case "describe_schema":
      return await source.describeSchema();

    case "metric_over_time":
      return await source.eventCountsByDay(
        input.event_name,
        range,
        input.split_by_property,
      );

    case "funnel": {
      const rows = await source.funnel(input.steps, range);
      const top = rows[0]?.users ?? 0;
      return rows.map((r) => ({
        ...r,
        conversion_from_first:
          top > 0 ? Number(((r.users / top) * 100).toFixed(1)) : null,
      }));
    }

    case "compare_periods": {
      const w = Math.max(1, Math.min(Math.trunc(Number(input.window_days)) || 7, 180));
      const recent: TimeRange = { from: daysAgo(w), to: daysAgo(0) };
      const prior: TimeRange = { from: daysAgo(w * 2), to: daysAgo(w) };
      const [a, b] = await Promise.all([
        source.funnel(input.steps, prior),
        source.funnel(input.steps, recent),
      ]);
      const rate = (rows: { users: number }[]) => {
        const top = rows[0]?.users ?? 0;
        return rows.map((r) =>
          top > 0 ? Number(((r.users / top) * 100).toFixed(1)) : null,
        );
      };
      return {
        window_days: w,
        prior_period: { steps: a, conversion_pct: rate(a) },
        recent_period: { steps: b, conversion_pct: rate(b) },
      };
    }

    case "segment_event":
      return await source.segment(input.event_name, input.property, range);

    case "compare_cohorts": {
      const [aUsers, bUsersRaw] = await Promise.all([
        source.usersWhoDid(input.cohort_a_event, range),
        source.usersWhoDid(input.cohort_b_event, range),
      ]);
      const aSet = new Set(aUsers);
      const bUsers = bUsersRaw.filter((u) => !aSet.has(u));

      const schema = await source.describeSchema();
      const perUser = async (users: string[]) => {
        if (users.length === 0) return {};
        const counts: Record<string, number> = {};
        // Sample cap: a cohort comparison is a shape question, and pulling
        // every timeline for a large cohort is both slow and unnecessary.
        for (const u of users.slice(0, 40)) {
          const tl = await source.userTimeline(u, 400);
          for (const ev of tl) {
            counts[ev.eventName] = (counts[ev.eventName] ?? 0) + 1;
          }
        }
        const n = Math.min(users.length, 40);
        const out: Record<string, number> = {};
        for (const ev of schema.events) {
          out[ev.name] = Number(((counts[ev.name] ?? 0) / n).toFixed(2));
        }
        return out;
      };

      const [aAvg, bAvg] = await Promise.all([perUser(aUsers), perUser(bUsers)]);
      const deltas = Object.keys(aAvg).map((k) => ({
        event: k,
        cohort_a_per_user: aAvg[k],
        cohort_b_per_user: (bAvg as any)[k] ?? 0,
        difference: Number((aAvg[k] - ((bAvg as any)[k] ?? 0)).toFixed(2)),
      }));
      deltas.sort((x, y) => Math.abs(y.difference) - Math.abs(x.difference));

      return {
        cohort_a: { event: input.cohort_a_event, users: aUsers.length },
        cohort_b: {
          event: input.cohort_b_event,
          users: bUsers.length,
          note: "users in cohort A excluded",
        },
        sampled_per_cohort: Math.min(40, Math.max(aUsers.length, bUsers.length)),
        behaviour_differences: deltas.slice(0, 15),
      };
    }

    case "aggregate": {
      const spec = {
        eventName: input.event_name,
        groupBy: input.group_by,
        bucketSize: input.bucket_size,
        metric: input.metric,
        metricProperty: input.metric_property,
        limit: 200,
      };
      if (!input.compare_to_prior) {
        return await source.runAggregate({ ...spec, range });
      }

      // Same query over two adjacent equal windows, merged per group. A
      // shift that lives in one place -- say a burst of deaths at a single
      // position -- is invisible in either window's own histogram but
      // obvious as a per-group change, so that is what gets sorted on.
      const prior: TimeRange = { from: daysAgo(days * 2), to: daysAgo(days) };
      const recent: TimeRange = { from: daysAgo(days), to: daysAgo(0) };
      const [before, after] = await Promise.all([
        source.runAggregate({ ...spec, range: prior }),
        source.runAggregate({ ...spec, range: recent }),
      ]);
      const key = (r: any) => String(r.group_value);
      const byGroup = new Map<string, { before: number; after: number }>();
      for (const r of before) byGroup.set(key(r), { before: Number(r.value), after: 0 });
      for (const r of after) {
        const g = byGroup.get(key(r)) ?? { before: 0, after: 0 };
        g.after = Number(r.value);
        byGroup.set(key(r), g);
      }
      const rows = [...byGroup.entries()]
        .map(([group_value, v]) => ({
          group_value,
          prior_window: v.before,
          recent_window: v.after,
          change: Number((v.after - v.before).toFixed(2)),
        }))
        .sort((a, b) => Math.abs(b.change) - Math.abs(a.change))
        .slice(0, 12);
      return {
        window_days: days,
        note: "Largest per-group changes first. Groups not listed changed less.",
        biggest_changes: rows,
        total_prior: before.reduce((n, r: any) => n + Number(r.value), 0),
        total_recent: after.reduce((n, r: any) => n + Number(r.value), 0),
      };
    }

    case "locate_change":
      return await locateChange(source, input.event_name, input.days_back === undefined ? 7 : days);

    case "user_timeline":
      return await source.userTimeline(input.user_id, 300);

    case "check_significance": {
      const { before_successes: bs, before_total: bt } = input;
      const { after_successes: as_, after_total: at } = input;
      const p1 = bt > 0 ? bs / bt : 0;
      const p2 = at > 0 ? as_ / at : 0;

      // Pooled two-proportion z-test.
      const pooled = bt + at > 0 ? (bs + as_) / (bt + at) : 0;
      const se = Math.sqrt(pooled * (1 - pooled) * (1 / (bt || 1) + 1 / (at || 1)));
      const z = se > 0 ? (p2 - p1) / se : 0;

      // The guard that matters more than the p-value at this data scale.
      const tooSmall = bt < 30 || at < 30;

      return {
        before_rate_pct: Number((p1 * 100).toFixed(1)),
        after_rate_pct: Number((p2 * 100).toFixed(1)),
        absolute_change_pct_points: Number(((p2 - p1) * 100).toFixed(1)),
        relative_change_pct:
          p1 > 0 ? Number((((p2 - p1) / p1) * 100).toFixed(1)) : null,
        z_score: Number(z.toFixed(2)),
        significant_at_95: Math.abs(z) >= 1.96 && !tooSmall,
        sample_too_small: tooSmall,
        verdict: tooSmall
          ? `Sample too small to conclude anything (n=${bt} vs n=${at}; want 30+ each). Report this as inconclusive rather than as a finding.`
          : Math.abs(z) >= 1.96
            ? "Change is statistically significant at 95%."
            : "Change is within normal variation; do not treat as a real shift.",
      };
    }

    default:
      throw new Error(`unknown tool: ${name}`);
  }
}


/** A round bucket width giving roughly `target` buckets across a range. */
export function niceStep(min: number, max: number, target = 14): number {
  const raw = Math.max((max - min) / target, 1e-9);
  const pow = 10 ** Math.floor(Math.log10(raw));
  const frac = raw / pow;
  const nice = frac <= 1 ? 1 : frac <= 2 ? 2 : frac <= 5 ? 5 : 10;
  return nice * pow;
}

/**
 * Finds where a change came from.
 *
 * Deliberately a tool rather than advice in the prompt: the useful move
 * (take the loss event, group it by each property that says where it
 * happened, compare two windows, look for one place that changed) takes
 * four separate decisions to assemble from the primitives, and a free
 * model reliably skipped it -- twice, ending on a confident and wrong
 * cause. Packaging it as one call named for the question makes the right
 * investigation the easy one. It is source-agnostic: it reads the schema
 * and works on whatever properties the event actually carries.
 */
async function locateChange(source: EventSource, eventName: string, days: number) {
  const schema = await source.describeSchema();
  const event = schema.events.find((e) => e.name === eventName);
  if (!event) {
    return { error: `no event named "${eventName}"`, known_events: schema.events.map((e) => e.name) };
  }

  const prior: TimeRange = { from: daysAgo(days * 2), to: daysAgo(days) };
  const recent: TimeRange = { from: daysAgo(days), to: daysAgo(0) };
  const findings: any[] = [];

  for (const prop of event.properties) {
    if (prop.distinctCount < 2) continue; // one value cannot say where

    let bucketSize: number | undefined;
    if (prop.type === "number") {
      const raw = await source.runAggregate({
        eventName, groupBy: prop.key, metric: "event_count",
        range: { from: prior.from, to: recent.to }, limit: 2000,
      });
      const values = raw.map((r: any) => Number(r.group_value)).filter(Number.isFinite);
      if (values.length < 2) continue;
      bucketSize = niceStep(Math.min(...values), Math.max(...values));
    } else if (prop.distinctCount > 30) {
      continue; // too many categories to compare meaningfully
    }

    const spec = { eventName, groupBy: prop.key, bucketSize, metric: "event_count" as const, limit: 200 };
    const [before, after] = await Promise.all([
      source.runAggregate({ ...spec, range: prior }),
      source.runAggregate({ ...spec, range: recent }),
    ]);

    const groups = new Map<string, { before: number; after: number }>();
    for (const r of before) groups.set(String(r.group_value), { before: Number(r.value), after: 0 });
    for (const r of after) {
      const g = groups.get(String(r.group_value)) ?? { before: 0, after: 0 };
      g.after = Number(r.value);
      groups.set(String(r.group_value), g);
    }

    // Judge each value against what plain growth would predict, not against
    // zero. When total volume rises 76%, every value rising ~76% has not
    // "changed" -- the mix is the same. Only the excess over that is a
    // shift. Without this a two-valued property (defeated/fell) looked like
    // the source of the change purely because one of two values is always
    // the bigger mover.
    const totalBefore = [...groups.values()].reduce((n, g) => n + g.before, 0);
    const totalAfter = [...groups.values()].reduce((n, g) => n + g.after, 0);
    if (totalAfter === 0 && totalBefore === 0) continue;
    const scale = totalBefore > 0 ? totalAfter / totalBefore : 1;

    const rows = [...groups.entries()]
      .map(([value, v]) => {
        const expected = v.before * scale;
        return {
          value,
          prior: v.before,
          recent: v.after,
          expected_recent: Number(expected.toFixed(1)),
          excess: Number((v.after - expected).toFixed(1)),
        };
      })
      .sort((a, b) => Math.abs(b.excess) - Math.abs(a.excess));

    // How big the biggest surprise is relative to all recent activity.
    const strength = Math.abs(rows[0].excess) / Math.max(totalAfter, 1);
    if (strength < 0.03) continue; // within noise of proportional growth

    findings.push({
      property: prop.key,
      bucket_size: bucketSize ?? null,
      strength: Number(strength.toFixed(2)),
      top_changes: rows.slice(0, 3),
    });
  }

  findings.sort((a, b) => b.strength - a.strength);
  return {
    event: eventName,
    window_days: days,
    strongest_first: findings.slice(0, 4),
    note: findings.length === 0
      ? "No value of any property moved beyond what overall growth predicts: the change, if any, is spread evenly and this event does not localise it."
      : "excess = recent minus what proportional growth would predict. A large excess in one value is where the change came from; strength is that excess as a share of all recent activity.",
  };
}
