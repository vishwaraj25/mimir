import { Pool } from "pg";

/**
 * Mimir's OWN database -- investigations, insights, experiments, briefs.
 *
 * Deliberately a different connection from any telemetry source. Sources are
 * read-only inputs that Mimir must never write to; this is the only database
 * Mimir owns. Keeping them separate is what lets a source be revoked or
 * swapped without losing Mimir's accumulated findings.
 */

let pool: Pool | null = null;

export function mimirDb(): Pool {
  if (!pool) {
    const connectionString = process.env.MIMIR_DATABASE_URL;
    if (!connectionString) {
      throw new Error("MIMIR_DATABASE_URL is not set");
    }
    pool = new Pool({
      connectionString,
      max: 5,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 5_000,
      ssl: { rejectUnauthorized: true },
    });
  }
  return pool;
}
