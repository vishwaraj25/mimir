import type {
  AggregateSpec,
  EventRecord,
  EventSchema,
  EventSource,
  QueryResult,
  TimeRange,
} from "./types";

/**
 * A synthetic telemetry source, generated in memory.
 *
 * Exists so the app is fully explorable with no database, no API key and no
 * credentials of any kind -- which matters twice over: you can see what you
 * are building before wiring anything up, and anyone opening the repo can
 * run it and watch the agent work rather than reading a README about it.
 *
 * The data is deliberately shaped like a real product with a real problem:
 * a boss-completion rate that genuinely falls in the last week, driven by
 * one specific cause (a difficulty spike at one position) that the agent
 * has to actually find by segmenting rather than be told about.
 */

const ITEMS = ["medkit", "double_mg", "laser", "flamethrower", "jetpack", "machine_gun"];
const ENEMIES = ["sentry_bot", "flyer_squadron", "trap_shooter", "mech_boss"];

/** Deterministic PRNG, so the demo looks identical on every load. */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

interface DemoEvent {
  userId: string;
  sessionId: string;
  eventName: string;
  properties: Record<string, unknown>;
  occurredAt: Date;
}

let CACHE: DemoEvent[] | null = null;

function generate(): DemoEvent[] {
  if (CACHE) return CACHE;
  const rand = rng(42);
  const events: DemoEvent[] = [];
  const now = new Date();

  // 28 days of history, ~9 players a day.
  for (let dayOffset = 27; dayOffset >= 0; dayOffset--) {
    const isRecentWeek = dayOffset < 7;
    const playersToday = 16 + Math.floor(rand() * 9);

    for (let p = 0; p < playersToday; p++) {
      const userId = `u${Math.floor(rand() * 260)
        .toString()
        .padStart(3, "0")}`;
      const sessionId = `s${dayOffset}-${p}`;
      const base = new Date(now);
      base.setUTCDate(base.getUTCDate() - dayOffset);
      base.setUTCHours(10 + Math.floor(rand() * 10), Math.floor(rand() * 60), 0, 0);

      let t = base.getTime();
      const step = (ms: number) => new Date((t += ms));

      const push = (name: string, props: Record<string, unknown> = {}, gap = 4000) =>
        events.push({
          userId,
          sessionId,
          eventName: name,
          properties: props,
          occurredAt: step(gap),
        });

      push("menu_click", { button: "play" }, 1000);
      push("run_start");

      // How far they get. The buried cause: in the last week, a difficulty
      // spike around x=22000 kills far more runs than it used to.
      const spikeZone = 22000;
      const skill = rand();
      let reached = 0;
      // Must be a multiple of the 2000 step, or the final iteration never
      // lands on it and the boss is unreachable -- which is exactly the bug
      // this comment exists to stop someone reintroducing.
      const maxX = 26000;

      for (let x = 2000; x <= maxX; x += 2000) {
        // Base survival odds, degrading with distance.
        let survive = 0.98 - x / 500000;
        // The regression: the tower section got harder, recently only.
        if (isRecentWeek && x >= spikeZone && x <= spikeZone + 2000) {
          survive -= 0.42;
        }
        if (skill > 0.8) survive += 0.03; // strong players

        push("progress", { x });
        reached = x;

        if (x % 8000 === 0) push("checkpoint_reached", { x });

        if (rand() > 0.45) {
          push("enemy_defeated", {
            enemy: ENEMIES[Math.floor(rand() * 3)],
            x,
          });
        }
        if (rand() > 0.72) {
          push("item_collected", { item: ITEMS[Math.floor(rand() * ITEMS.length)] });
        }
        if (rand() > 0.85) push("double_jump");
        if (rand() > 0.8) {
          push("shield_deflect", { perfect: rand() > 0.75 });
        }

        if (rand() > survive) {
          push("player_died", { reason: rand() > 0.25 ? "defeated" : "fell", x });
          push("run_end", {
            reason: "defeated",
            score: Math.floor(x / 12),
            duration_sec: Math.floor((t - base.getTime()) / 1000),
            x,
          });
          break;
        }

        if (x >= maxX) {
          push("enemy_defeated", { enemy: "mech_boss", x });
          push("boss_defeated", { score: Math.floor(x / 8) });
          push("run_end", {
            reason: "boss_defeated",
            score: Math.floor(x / 8),
            duration_sec: Math.floor((t - base.getTime()) / 1000),
            x,
          });
        }
      }
      void reached;
    }
  }

  CACHE = events;
  return events;
}

export class DemoEventSource implements EventSource {
  readonly id = "demo";
  readonly displayName = "Demo product (synthetic)";

  private all(): DemoEvent[] {
    return generate();
  }

  private inRange(range: TimeRange): DemoEvent[] {
    return this.all().filter(
      (e) => e.occurredAt >= range.from && e.occurredAt < range.to,
    );
  }

  async healthCheck() {
    return {
      ok: true,
      detail: `synthetic source, ${this.all().length} events generated in memory`,
    };
  }

  async describeSchema(): Promise<EventSchema> {
    const all = this.all();
    const byName = new Map<string, DemoEvent[]>();
    for (const e of all) {
      const list = byName.get(e.eventName) ?? [];
      list.push(e);
      byName.set(e.eventName, list);
    }

    const events = [...byName.entries()]
      .sort((a, b) => b[1].length - a[1].length)
      .map(([name, rows]) => {
        const props = new Map<string, Set<string>>();
        const types = new Map<string, Set<string>>();
        for (const r of rows) {
          for (const [k, v] of Object.entries(r.properties)) {
            if (!props.has(k)) props.set(k, new Set());
            if (!types.has(k)) types.set(k, new Set());
            props.get(k)!.add(String(v));
            types.get(k)!.add(typeof v);
          }
        }
        return {
          name,
          count: rows.length,
          properties: [...props.entries()].map(([key, values]) => {
            const t = types.get(key)!;
            return {
              key,
              type: (t.size > 1
                ? "mixed"
                : t.has("number")
                  ? "number"
                  : t.has("boolean")
                    ? "boolean"
                    : "string") as "string" | "number" | "boolean" | "mixed",
              sampleValues: [...values].slice(0, 8),
              distinctCount: values.size,
            };
          }),
        };
      });

    const sorted = [...all].sort(
      (a, b) => a.occurredAt.getTime() - b.occurredAt.getTime(),
    );
    return {
      events,
      totalEvents: all.length,
      totalUsers: new Set(all.map((e) => e.userId)).size,
      firstEventAt: sorted[0]?.occurredAt ?? null,
      lastEventAt: sorted.at(-1)?.occurredAt ?? null,
    };
  }

  async activeUsersByDay(range: TimeRange) {
    const byDay = new Map<string, Set<string>>();
    for (const e of this.inRange(range)) {
      const day = e.occurredAt.toISOString().slice(0, 10);
      if (!byDay.has(day)) byDay.set(day, new Set());
      byDay.get(day)!.add(e.userId);
    }
    return [...byDay.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([day, users]) => ({ day: new Date(day), users: users.size }));
  }

  async distinctUsers(range: TimeRange) {
    return new Set(this.inRange(range).map((e) => e.userId)).size;
  }

  async newUsers(range: TimeRange) {
    const firstSeen = new Map<string, Date>();
    for (const e of this.all()) {
      const prev = firstSeen.get(e.userId);
      if (!prev || e.occurredAt < prev) firstSeen.set(e.userId, e.occurredAt);
    }
    return [...firstSeen.values()].filter((d) => d >= range.from && d < range.to)
      .length;
  }

  async eventCountsByDay(
    eventName: string,
    range: TimeRange,
    splitByProperty?: string,
  ) {
    const rows = this.inRange(range).filter((e) => e.eventName === eventName);
    const key = (e: DemoEvent) =>
      `${e.occurredAt.toISOString().slice(0, 10)}|${
        splitByProperty ? String(e.properties[splitByProperty] ?? "(absent)") : ""
      }`;
    const counts = new Map<string, number>();
    for (const e of rows) counts.set(key(e), (counts.get(key(e)) ?? 0) + 1);
    return [...counts.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([k, count]) => {
        const [day, segment] = k.split("|");
        return { day: new Date(day), segment: segment || null, count };
      });
  }

  async funnel(steps: string[], range: TimeRange) {
    const rows = this.inRange(range);
    let eligible: Set<string> | null = null;
    const out: { step: string; users: number }[] = [];
    for (const step of steps) {
      const did = new Set<string>(
        rows.filter((e) => e.eventName === step).map((e) => e.userId),
      );
      const prior = eligible;
      const users: Set<string> = prior
        ? new Set<string>([...did].filter((u) => prior.has(u)))
        : did;
      eligible = users;
      out.push({ step, users: users.size });
    }
    return out;
  }

  async segment(eventName: string, property: string, range: TimeRange) {
    const rows = this.inRange(range).filter((e) => e.eventName === eventName);
    const agg = new Map<string, { users: Set<string>; events: number }>();
    for (const e of rows) {
      const v = String(e.properties[property] ?? "(absent)");
      if (!agg.has(v)) agg.set(v, { users: new Set(), events: 0 });
      agg.get(v)!.users.add(e.userId);
      agg.get(v)!.events++;
    }
    return [...agg.entries()]
      .map(([value, x]) => ({ value, users: x.users.size, events: x.events }))
      .sort((a, b) => b.events - a.events)
      .slice(0, 50);
  }

  async usersWhoDid(eventName: string, range: TimeRange) {
    return [
      ...new Set(
        this.inRange(range)
          .filter((e) => e.eventName === eventName)
          .map((e) => e.userId),
      ),
    ];
  }

  async userTimeline(userId: string, limit = 500): Promise<EventRecord[]> {
    return this.all()
      .filter((e) => e.userId === userId)
      .sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime())
      .slice(0, limit)
      .map((e) => ({
        userId: e.userId,
        sessionId: e.sessionId,
        eventName: e.eventName,
        properties: e.properties,
        occurredAt: e.occurredAt,
      }));
  }

  async runAggregate(spec: AggregateSpec): Promise<QueryResult> {
    let rows = this.inRange(spec.range);
    if (spec.eventName) rows = rows.filter((e) => e.eventName === spec.eventName);

    const groupOf = (e: DemoEvent) => {
      if (!spec.groupBy) return "all";
      const raw = e.properties[spec.groupBy];
      if (spec.bucketSize && typeof raw === "number") {
        return String(Math.floor(raw / spec.bucketSize) * spec.bucketSize);
      }
      return String(raw ?? "(absent)");
    };

    const agg = new Map<string, { users: Set<string>; n: number; sum: number }>();
    for (const e of rows) {
      const g = groupOf(e);
      if (!agg.has(g)) agg.set(g, { users: new Set(), n: 0, sum: 0 });
      const a = agg.get(g)!;
      a.users.add(e.userId);
      a.n++;
      if (spec.metricProperty) {
        const v = Number(e.properties[spec.metricProperty]);
        if (!Number.isNaN(v)) a.sum += v;
      }
    }

    return [...agg.entries()]
      .map(([group_value, a]) => ({
        group_value,
        value:
          spec.metric === "user_count"
            ? a.users.size
            : spec.metric === "avg"
              ? Number((a.sum / Math.max(1, a.n)).toFixed(2))
              : spec.metric === "sum"
                ? a.sum
                : a.n,
      }))
      .sort((x, y) => Number(y.value) - Number(x.value))
      .slice(0, spec.limit ?? 100);
  }
}
