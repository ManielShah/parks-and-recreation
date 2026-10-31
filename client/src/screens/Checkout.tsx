import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { HOLD_MS } from '@parks/shared';
import { Button } from '../components/Button';
import { Card, CardTitle } from '../components/Card';
import { CardIcon } from '../components/icons';
import { countdown, money } from '../domain/format';
import { kidName, myHolds, type Model } from '../domain/model';
import { useActions } from '../state/useActions';
import styles from './Checkout.module.css';

export function Checkout({ model }: { model: Model }) {
  const navigate = useNavigate();
  const actions = useActions();
  const [paying, setPaying] = useState(false);
  const holds = myHolds(model, 'cart');
  const items = holds.map((h) => ({ hold: h, ...model.section(h.sectionId) }));
  const total = items.reduce((sum, i) => sum + i.program.priceCents, 0);

  const pay = async () => {
    setPaying(true);
    try {
      await actions.checkout();
    } finally {
      setPaying(false);
    }
  };

  return (
    <div className="page">
      <h1 className={styles.title}>Checkout</h1>

      {items.length === 0 ? (
        <Card className={styles.empty}>
          <span className={styles.emptyTitle}>Your cart is empty</span>
          <span className="muted">Spots you add are held for 5 minutes.</span>
          <Button variant="dark" onClick={() => navigate('/')}>Browse programs</Button>
        </Card>
      ) : (
        <div className="split">
          <div className={`main ${styles.items}`}>
            {items.map(({ hold, program, section }) => {
              const left = hold.expiresAt - model.now;
              const pct = Math.max(0, Math.min(100, (left / HOLD_MS) * 100));
              const hot = left < 60_000;
              return (
                <Card key={hold.id} className={hot ? styles.itemHot : undefined}>
                  <div className={styles.itemTop}>
                    <div className={styles.itemInfo}>
                      <span className={styles.badge}>Held for you</span>
                      <span className={styles.program}>{program.name}</span>
                      <span className={styles.when}>{section.day}, {section.time}</span>
                      <span className={styles.place}>{program.location}</span>
                      <span className={styles.kid}>For {kidName(model, hold.childId)}</span>
                    </div>
                    <div className={styles.timerBox}>
                      <span className={`${styles.countdown} ${hot ? styles.countdownHot : ''}`}>{countdown(left)}</span>
                      <span className={styles.timerLabel}>held for you</span>
                    </div>
                  </div>
                  <div role="progressbar" aria-label="Time left on hold" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(pct)} className={styles.track}>
                    <div className={`${styles.bar} ${hot ? styles.barHot : ''}`} style={{ width: `${pct.toFixed(2)}%` }} />
                  </div>
                  <div className={styles.itemFoot}>
                    <span className={styles.price}>{money(program.priceCents)}</span>
                    <Button variant="secondary" size="compact" onClick={() => actions.removeFromCart(hold.id, hold.sectionId)}>
                      Remove and release spot
                    </Button>
                  </div>
                </Card>
              );
            })}
          </div>

          <Card className="side">
            <CardTitle>Order summary</CardTitle>
            {items.map(({ hold, program }) => (
              <div className={styles.line} key={hold.id}>
                <span>{program.name} · {kidName(model, hold.childId)}</span>
                <span>{money(program.priceCents)}</span>
              </div>
            ))}
            <div className={styles.total}><span>Total</span><span>{money(total)}</span></div>
            <div className={styles.payField}>
              <span className={styles.payLabel}>Payment method</span>
              <div className={styles.payMethod}>
                <CardIcon />
                <span>Saved card ending 4242 (demo)</span>
              </div>
            </div>
            <Button size="large" onClick={pay} disabled={paying}>
              {paying ? 'Processing…' : `Pay ${money(total)} and register`}
            </Button>
            <span className={styles.fine}>Spots are confirmed when payment goes through. Cancellation and refund policy: [TO BE CONFIRMED]. Payment is simulated for now.</span>
          </Card>
        </div>
      )}
    </div>
  );
}
