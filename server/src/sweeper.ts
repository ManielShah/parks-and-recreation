import { pool } from './db.js';
import { clock } from './clock.js';
import { sendOpeningReminders, sweepSection } from './booking.js';
import { deliverOutbox } from './outbox.js';

/**
 * Release every expired hold and offer freed spots to the waitlist. Sections with anyone
 * waiting are revisited too, so a spot is offered as soon as the rules allow it (for
 * example after a staff last call ends early or a class is rescheduled).
 * Safe to run on many servers at once.
 */
export async function sweepOnce(): Promise<number> {
  const now = clock.now();
  const { rows } = await pool.query<{ section_id: string }>(
    `SELECT section_id FROM holds WHERE expires_at <= $1
     UNION
     SELECT section_id FROM waitlist_entries`,
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
