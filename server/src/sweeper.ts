import { pool } from './db.js';
import { clock } from './clock.js';
import { sendOpeningReminders, sweepSection } from './booking.js';
import { deliverOutbox } from './outbox.js';

/** Release every expired hold and offer its spot to the waitlist. Safe to run on many servers at once. */
export async function sweepOnce(): Promise<number> {
  const now = clock.now();
  const { rows } = await pool.query<{ section_id: string }>(
    'SELECT DISTINCT section_id FROM holds WHERE expires_at <= $1',
    [now],
  );
  for (const r of rows) await sweepSection(r.section_id, now);
  await sendOpeningReminders(now);
  return rows.length;
}

export function startSweeper(intervalMs: number): () => void {
  let running = false;
  const timer = setInterval(async () => {
    if (running) return;
    running = true;
    try {
      await sweepOnce();
      await deliverOutbox();
    } catch (err) {
      console.error('sweeper failed', err);
    } finally {
      running = false;
    }
  }, intervalMs);
  return () => clearInterval(timer);
}
