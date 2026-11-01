import { useCallback, useEffect, useRef, useState } from 'react';
import { autoOfferExpiry, formatDuration, type StaffOverviewResponse, type StaffSection, type WaitlistEvent } from '@parks/shared';
import { api, ApiRequestError, staffToken } from '../api/client';
import { Button } from '../components/Button';
import { Card, CardTitle } from '../components/Card';
import { countdown, plural, when } from '../domain/format';
import styles from './Staff.module.css';

const POLL_MS = 2000;
const WINDOWS = [5, 10, 15, 30];

const EVENT_LABEL: Record<WaitlistEvent['event'], string> = {
  joined: 'Joined waitlist',
  left: 'Left waitlist',
  offered: 'Offered spot',
  accepted: 'Accepted and paid',
  declined: 'Declined',
  expired: 'Offer expired',
  last_call: 'Last call sent',
  claimed: 'Claimed and paid',
};

/**
 * Staff view: every section's seats and waitlist, with manual overrides for the last 20 minutes
 * before class, when automatic offers stop. Not part of the family-facing design.
 */
export function Staff() {
  const [data, setData] = useState<StaffOverviewResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [needsToken, setNeedsToken] = useState(false);
  const [token, setToken] = useState(staffToken.get());
  const [message, setMessage] = useState<string | null>(null);
  const skew = useRef(0);
  const [tick, setTick] = useState(() => Date.now());

  const load = useCallback(async () => {
    try {
      const d = await api.staff.overview();
      skew.current = d.serverNow - Date.now();
      setData(d);
      setError(null);
      setNeedsToken(false);
    } catch (err) {
      if (err instanceof ApiRequestError && err.status === 403) setNeedsToken(true);
      else setError(err instanceof Error ? err.message : 'Could not load the staff view.');
    }
  }, []);

  useEffect(() => {
    void load();
    const poll = setInterval(load, POLL_MS);
    const clock = setInterval(() => setTick(Date.now()), 1000);
    return () => {
      clearInterval(poll);
      clearInterval(clock);
    };
  }, [load]);

  const now = tick + skew.current;
  const act = async (fn: () => Promise<string>) => {
    try {
      setMessage(await fn());
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'That didn’t work. Try again.');
    }
    await load();
  };

  return (
    <div className="page">
      <h1 className={styles.title}>Waitlists · staff</h1>
      <p className={styles.lead}>
        Spots that open are offered to the first family in line automatically, with less time to accept as class gets
        closer. In the last 20 minutes before a class, automatic offers stop: assign open seats here, either to the next
        family in line or as a last call to everyone waiting. Payments and texts are simulated in this build.
      </p>

      {needsToken && (
        <Card>
          <form
            className={styles.tokenForm}
            onSubmit={(e) => {
              e.preventDefault();
              staffToken.set(token);
              void load();
            }}
          >
            <div className={styles.field}>
              <label htmlFor="staff-token" className={styles.label}>Staff token</label>
              <input id="staff-token" className={styles.input} type="password" value={token} onChange={(e) => setToken(e.target.value)} />
            </div>
            <Button type="submit" variant="dark">Continue</Button>
          </form>
        </Card>
      )}
      {error && <p role="alert" className="muted">{error}</p>}
      {message && <p role="status" className={styles.lead}>{message}</p>}

      {data && (
        <>
          <div className={styles.grid}>
            {data.sections.map((s) => <SectionCard key={s.sectionId} s={s} now={now} act={act} />)}
          </div>

          <Card padding="padWide">
            <CardTitle>Recent waitlist activity</CardTitle>
            <div className={styles.tableWrap}>
              <table className={styles.events}>
                <thead>
                  <tr><th>When</th><th>Section</th><th>What</th><th>Who</th><th>By</th><th>Details</th></tr>
                </thead>
                <tbody>
                  {data.events.map((e) => (
                    <tr key={e.id}>
                      <td>{when(e.at)}</td>
                      <td>{e.sectionLabel}</td>
                      <td>{EVENT_LABEL[e.event]}</td>
                      <td>{[e.familyName, e.childName].filter(Boolean).join(' · ') || '—'}</td>
                      <td>{e.actor}</td>
                      <td>{e.offerExpiresAt ? `Until ${when(e.offerExpiresAt)}` : ''}{e.detail ? ` ${e.detail}` : ''}</td>
                    </tr>
                  ))}
                  {data.events.length === 0 && <tr><td colSpan={6} className="muted">Nothing yet.</td></tr>}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      )}
    </div>
  );
}

function SectionCard({ s, now, act }: { s: StaffSection; now: number; act: (fn: () => Promise<string>) => Promise<void> }) {
  const [minutes, setMinutes] = useState(10);
  const expiry = autoOfferExpiry(s.startsAt, now);
  const open = s.capacity - s.registered - s.inCarts - s.offers.length;
  const canAssign = open > 0 && s.waitlist.length > 0 && !s.lastCallUntil;
  const next = s.waitlist[0];
  const untilStart = s.startsAt - now;

  return (
    <Card>
      <div className={styles.head}>
        <span className={styles.name}>{s.programName} · {s.day}</span>
        <span className={styles.when}>
          First class {when(s.startsAt)}{untilStart > 0 && untilStart < 24 * 3600_000 ? ` · in ${countdown(untilStart)}` : ''}
        </span>
      </div>
      <span className={`${styles.mode} ${expiry === null ? styles.staff : styles.auto}`}>
        {expiry === null ? 'Staff-managed · automatic offers stopped' : `Automatic · ${formatDuration(expiry - now)} to accept`}
      </span>
      <span className={styles.seats}>
        {s.registered} of {s.capacity} registered · {s.inCarts} in carts · {s.offers.length} on offer ·{' '}
        <span className={open > 0 ? styles.open : undefined}>{Math.max(0, open)} open</span>
      </span>

      {s.offers.length > 0 && (
        <>
          <span className={styles.subhead}>On offer</span>
          <ul className={styles.list}>
            {s.offers.map((o, i) => (
              <li key={i}>
                {o.familyName}{o.childName ? ` · ${o.childName}` : ''} · <span className={styles.countdown}>{countdown(o.expiresAt - now)}</span> left
              </li>
            ))}
          </ul>
        </>
      )}
      {s.lastCallUntil && (
        <span className={styles.seats}>
          Last call open · <span className={styles.countdown}>{countdown(s.lastCallUntil - now)}</span> left
        </span>
      )}
      <span className={styles.subhead}>Waitlist ({s.waitlist.length})</span>
      {s.waitlist.length ? (
        <ol className={styles.list}>
          {s.waitlist.map((w) => <li key={w.position}>{w.familyName}{w.childName ? ` · ${w.childName}` : ''}</li>)}
        </ol>
      ) : (
        <span className="muted">Nobody waiting.</span>
      )}

      {canAssign && next && (
        <div className={styles.actions}>
          <label className="muted" htmlFor={`window-${s.sectionId}`}>Window</label>
          <select id={`window-${s.sectionId}`} className={styles.select} value={minutes} onChange={(e) => setMinutes(Number(e.target.value))}>
            {WINDOWS.map((m) => <option key={m} value={m}>{m} min</option>)}
          </select>
          <Button
            size="compact"
            onClick={() => act(async () => {
              await api.staff.offer(s.sectionId, minutes);
              return `Offered the spot in ${s.programName} · ${s.day} to ${next.familyName} for ${minutes} minutes.`;
            })}
          >
            Offer to #1 · {next.familyName}
          </Button>
          {expiry === null && (
            <Button
              size="compact"
              variant="secondary"
              onClick={() => act(async () => {
                const { notified } = await api.staff.lastCall(s.sectionId, minutes);
                return `Last call sent to ${notified} ${plural(notified, 'family', 'families')} for ${minutes} minutes. The first to claim gets the spot.`;
              })}
            >
              Last call to all {s.waitlist.length}
            </Button>
          )}
        </div>
      )}
    </Card>
  );
}
