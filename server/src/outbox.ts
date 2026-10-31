import { pool } from './db.js';

/**
 * Deliver queued text and email notifications. No SMS or email provider is connected yet,
 * so this logs each message and marks it delivered; swap in a provider here.
 */
export async function deliverOutbox(): Promise<number> {
  const { rows } = await pool.query<{ id: string; family_id: string; message: string; send_sms: boolean; send_email: boolean }>(
    `UPDATE notifications SET delivered_at = now()
      WHERE id IN (SELECT id FROM notifications
                    WHERE delivered_at IS NULL AND (send_sms OR send_email)
                    ORDER BY id LIMIT 50 FOR UPDATE SKIP LOCKED)
      RETURNING id, family_id, message, send_sms, send_email`,
  );
  for (const n of rows) {
    const channels = [n.send_sms && 'sms', n.send_email && 'email'].filter(Boolean).join('+');
    console.log(`[outbox] ${channels} -> family ${n.family_id}: ${n.message}`);
  }
  return rows.length;
}
