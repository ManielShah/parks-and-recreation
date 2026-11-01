import { useState } from 'react';
import { HOLD_MS, OFFER_MS } from '@parks/shared';
import { api } from '../api/client';
import { useRegistration } from '../state/RegistrationProvider';
import { ChevronDownIcon } from './icons';
import styles from './DevPanel.module.css';

/** Prototype controls: not part of the site. Only shown when the server runs with ENABLE_DEV_TOOLS. */
export function DevPanel() {
  const { model, run, showToast, reloadCatalog } = useRegistration();
  const [open, setOpen] = useState(true);
  if (!model?.state.dev.enabled) return null;

  const mins = Math.round(model.state.dev.clockOffsetMs / 60_000);
  const ahead = mins >= 60 ? `${Math.floor(mins / 60)} h ${mins % 60} min` : `${mins} min`;
  const simulate = async (fn: () => Promise<{ ok: boolean }>, ok: string, fail: string) => {
    const res = await run(fn);
    if (res) showToast({ text: res.ok ? ok : fail, tone: 'info' });
  };

  return (
    <div className={styles.dock}>
      {open ? (
        <div className={styles.panel}>
          <div className={styles.head}>
            <span>Prototype controls</span>
            <button type="button" className={styles.collapse} onClick={() => setOpen(false)} aria-label="Collapse prototype controls">
              <ChevronDownIcon />
            </button>
          </div>
          <span className={styles.note}>
            Not part of the site. Other families are simulated. {mins ? `Clock is ${ahead} ahead.` : ''}
          </span>
          <button type="button" className={styles.control} onClick={() => run(() => api.dev.advance(60_000))}>Skip ahead 1 minute</button>
          <button type="button" className={styles.control} onClick={() => run(() => api.dev.advance(HOLD_MS))}>Skip ahead 5 minutes</button>
          <button type="button" className={styles.control} onClick={() => run(() => api.dev.advance(OFFER_MS))}>Skip ahead 2 hours</button>
          <button
            type="button"
            className={styles.control}
            onClick={() => simulate(() => api.dev.dropout('swim2-sat'),
              'Simulated: a registered family dropped out of Swim Level 2 · Saturdays. The spot goes to the first family on the waitlist.',
              'Simulated: nobody else is registered in Swim Level 2 · Saturdays.')}
          >
            A family drops Swim 2 · Saturdays
          </button>
          <button
            type="button"
            className={styles.control}
            onClick={() => simulate(() => api.dev.rivalHold('art-sat'),
              'Simulated: another family just put a spot in Art Studio · Saturdays in their cart.',
              'Simulated: Art · Saturdays has no open spot to take.')}
          >
            Another family carts Art · Saturdays
          </button>
          <span className={styles.note}>Move Swim 2 · Saturdays' first class to see offer windows shrink:</span>
          <div className={styles.row}>
            {([['25 h', 25 * 60], ['3 h', 180], ['1 h', 60], ['15 min', 15]] as const).map(([label, minutes]) => (
              <button
                key={label}
                type="button"
                className={styles.control}
                onClick={() => run(async () => {
                  await api.dev.sectionStart('swim2-sat', minutes);
                  await reloadCatalog();
                })}
              >
                {label}
              </button>
            ))}
          </div>
          <button type="button" className={styles.reset} onClick={() => run(async () => { await api.dev.reset(); await reloadCatalog(); showToast(null); })}>
            Reset demo
          </button>
        </div>
      ) : (
        <button type="button" className={styles.open} onClick={() => setOpen(true)}>Prototype controls</button>
      )}
    </div>
  );
}
