import pg from 'pg';
import { config } from './config.js';

// Return bigint ids and counts as strings; we treat ids as opaque and parse counts explicitly.
export const pool = new pg.Pool({ connectionString: config.databaseUrl, max: 20 });

export type Db = pg.PoolClient;

/**
 * Run fn inside a transaction. Booking changes take row locks (SELECT ... FOR UPDATE),
 * so concurrent requests for the same section queue up instead of overselling.
 */
export async function tx<T>(fn: (c: Db) => Promise<T>): Promise<T> {
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    const out = await fn(c);
    await c.query('COMMIT');
    return out;
  } catch (err) {
    await c.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    c.release();
  }
}
