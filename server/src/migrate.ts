import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import type pg from 'pg';

const here = path.dirname(fileURLToPath(import.meta.url));
// src/ in development, dist/ once bundled; migrations sit next to either.
const candidates = [path.join(here, '../migrations'), path.join(here, 'migrations')];

async function migrationsDir(): Promise<string> {
  for (const dir of candidates) {
    try {
      await readdir(dir);
      return dir;
    } catch {}
  }
  throw new Error('migrations directory not found');
}

/** Apply every .sql file in migrations/ that has not been applied yet, in name order. */
export async function migrate(pool: pg.Pool): Promise<string[]> {
  const dir = await migrationsDir();
  await pool.query('CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())');
  const done = new Set((await pool.query<{ name: string }>('SELECT name FROM schema_migrations')).rows.map((r) => r.name));
  const files = (await readdir(dir)).filter((f) => f.endsWith('.sql')).sort();
  const applied: string[] = [];
  for (const file of files) {
    if (done.has(file)) continue;
    const sql = await readFile(path.join(dir, file), 'utf8');
    const c = await pool.connect();
    try {
      await c.query('BEGIN');
      await c.query(sql);
      await c.query('INSERT INTO schema_migrations (name) VALUES ($1)', [file]);
      await c.query('COMMIT');
      applied.push(file);
    } catch (err) {
      await c.query('ROLLBACK');
      throw err;
    } finally {
      c.release();
    }
  }
  return applied;
}
