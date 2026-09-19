import type Anthropic from "@anthropic-ai/sdk";
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

export const TOOL_DEFINITIONS: Anthropic.Tool[] = [
  {
    name: "describe_schema",
    description:
      "List every event that exists in this telemetry source, how often each fires, and what properties each carries (with sample values). Call this FIRST in almost every investigation -- it is how you learn what is actually tracked instead of guessing event names.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "metric_over_time",
    description:
      "Daily counts of one event, optionally split by a property. Use this to confirm a change is real and to find WHEN it started before asking why.",
    input_schema: {
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
    input_schema: {
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
    input_schema: {
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
    input_schema: {
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
    input_schema: {
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
    input_schema: {
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
      },
      required: ["metric"],
    },
  },
  {
    name: "user_timeline",
    description:
      "Every event for one user in order. Use sparingly, to sanity-check a hypothesis against what one real session actually looked like.",
    input_schema: {
      type: "object",
      properties: { user_id: { type: "string" } },
      required: ["user_id"],
    },
  },
  {
    name: "check_significance",
    description:
      "Two-proportion check: given successes and totals for two periods, returns the absolute change, relative change, and whether the sample is large enough to conclude anything. ALWAYS call this before claiming a metric moved -- with small n, an apparent swing is usually noise, and saying so is a valid and important finding.",
    input_schema: {
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
  const days = (input.days_back as number) ?? 28;
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
      const w = (input.window_days as number) ?? 7;
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

    case "aggregate":
      return await source.runAggregate({
        eventName: input.event_name,
        groupBy: input.group_by,
        bucketSize: input.bucket_size,
        metric: input.metric,
        metricProperty: input.metric_property,
        range,
        limit: 60,
      });

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
