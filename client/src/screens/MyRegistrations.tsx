import { Button } from '../components/Button';
import { Card, CardTitle } from '../components/Card';
import { countdown, money } from '../domain/format';
import { kidName, myHolds, type Model } from '../domain/model';
import { useActions } from '../state/useActions';
import styles from './MyRegistrations.module.css';

export function MyRegistrations({ model }: { model: Model }) {
  const actions = useActions();
  const offers = myHolds(model, 'offer');
  const { registrations, waitlist } = model.state;
  const when = (sectionId: string) => {
    const { section } = model.section(sectionId);
    return `${section.day}, ${section.time}`;
  };

  return (
    <div className={`page ${styles.page}`}>
      <h1 className={styles.title}>My registrations</h1>

      <Card padding="padWide" className={styles.card}>
        <div className={styles.heading}><CardTitle>Registered</CardTitle></div>
        {registrations.length === 0 && <span className={styles.empty}>Nothing yet this season.</span>}
        {registrations.map((r) => (
          <div className={styles.row} key={r.id}>
            <div className={styles.info}>
              <span className={styles.name}>{model.section(r.sectionId).program.name}</span>
              <span className={styles.sub}>{when(r.sectionId)} · {kidName(model, r.childId)} · {r.confirmation}</span>
              <span className={styles.detail}>
                {r.fromWaitlist ? `Accepted from the waitlist · ${money(r.priceCents)} charged` : `Paid ${money(r.priceCents)}`}
              </span>
            </div>
            <Button variant="secondary" size="compact" onClick={() => actions.withdraw(r.id, r.sectionId, r.childId)}>Withdraw</Button>
          </div>
        ))}
      </Card>

      <Card padding="padWide" className={styles.card}>
        <div className={styles.heading}><CardTitle>Waitlists</CardTitle></div>
        {offers.map((o) => (
          <div className={styles.offer} key={o.id}>
            <div className={styles.info}>
              <span className={styles.name}>{model.section(o.sectionId).program.name}</span>
              <span className={styles.sub}>{when(o.sectionId)} · {kidName(model, o.childId)}</span>
              <span className={styles.offerTimer}>Spot offered · {countdown(o.expiresAt - model.now)} left to accept</span>
            </div>
            <div className={styles.buttons}>
              <Button variant="success" size="compact" onClick={() => actions.acceptOffer(o.id, o.childId)}>
                Accept and pay {money(model.section(o.sectionId).program.priceCents)}
              </Button>
              <Button variant="successOutline" size="compact" onClick={() => actions.declineOffer(o.id, o.sectionId)}>Decline</Button>
            </div>
          </div>
        ))}
        {waitlist.length === 0 && offers.length === 0 && <span className={styles.empty}>You're not on any waitlists.</span>}
        {waitlist.map((w) => (
          <div className={styles.row} key={w.id}>
            <div className={styles.info}>
              <span className={styles.name}>{model.section(w.sectionId).program.name}</span>
              <span className={styles.sub}>{when(w.sectionId)} · {kidName(model, w.childId)}</span>
              <span className={styles.pos}>#{w.position} of {model.live(w.sectionId).waitlistLength} in line</span>
            </div>
            <Button variant="secondary" size="compact" onClick={() => actions.leaveWaitlist(w.id, w.sectionId, w.childId)}>Leave waitlist</Button>
          </div>
        ))}
        <span className={styles.fine}>When a spot opens, we'll text and email you. You'll have 2 hours to accept it. Your saved card is charged when you accept, and never if you don't.</span>
      </Card>
    </div>
  );
}
