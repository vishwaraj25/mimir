import { NIGHT_RUN_MAPPING, PostgresEventSource } from "./postgres-event-source";
import type { EventSource } from "./types";

/**
 * Which telemetry sources this deployment can see.
 *
 * Today there is one. The registry exists so there can be more without any
 * caller learning about it: everything downstream asks for a source by id
 * and gets back an EventSource, never a Night-Run-shaped thing.
 *
 * A source is configured entirely by environment variables, so connecting a
 * second database is a Vercel settings change plus one entry here -- no
 * credentials in the repo, and no code that knows what the data is about.
 */

let cache: Map<string, EventSource> | null = null;

function build(): Map<string, EventSource> {
  const sources = new Map<string, EventSource>();

  const nightRunUrl = process.env.SOURCE_NIGHT_RUN_URL;
  if (nightRunUrl) {
    sources.set(
      "night-run",
      new PostgresEventSource({
        id: "night-run",
        displayName: "Night Run",
        connectionString: nightRunUrl,
        mapping: NIGHT_RUN_MAPPING,
      }),
    );
  }

  return sources;
}

export function listSources(): EventSource[] {
  if (!cache) cache = build();
  return [...cache.values()];
}

export function getSource(id: string): EventSource {
  if (!cache) cache = build();
  const source = cache.get(id);
  if (!source) {
    throw new Error(
      `no telemetry source "${id}" is configured on this deployment`,
    );
  }
  return source;
}

/** The source used when a request doesn't name one. */
export function defaultSource(): EventSource {
  const all = listSources();
  if (all.length === 0) {
    throw new Error(
      "no telemetry sources configured -- set SOURCE_NIGHT_RUN_URL",
    );
  }
  return all[0];
}
