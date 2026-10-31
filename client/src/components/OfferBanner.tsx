import { countdown, money } from '../domain/format';
import { kidName, myHolds, sectionName } from '../domain/model';
import { useActions } from '../state/useActions';
import { useRegistration } from '../state/RegistrationProvider';
import { Button } from './Button';
import { BellIcon } from './icons';
import styles from './OfferBanner.module.css';

/** One banner per waitlist spot offered to this family, on every page until they answer. */
export function OfferBanners() {
  const { model } = useRegistration();
  const actions = useActions();
  if (!model) return null;
  return (
    <>
      {myHolds(model, 'offer').map((o) => {
        const price = money(model.section(o.sectionId).program.priceCents);
        return (
          <div role="region" aria-label="Waitlist offer" className={styles.banner} key={o.id}>
            <div className={styles.inner}>
              <div className={styles.lead}>
                <span className={styles.badge}><BellIcon size={18} /></span>
                <div className={styles.text}>
                  <span className={styles.title}>A spot opened for {kidName(model, o.childId)} in {sectionName(model, o.sectionId)}</span>
                  <span className={styles.detail}>
                    We sent this to your phone and email. Accept within 2 hours to claim it. Accepting registers {kidName(model, o.childId)} and charges your saved card {price}. Nothing is charged if you don't accept.
                  </span>
                </div>
              </div>
              <div className={styles.actions}>
                <span className={styles.timer}>{countdown(o.expiresAt - model.now)} left</span>
                <Button variant="success" onClick={() => actions.acceptOffer(o.id, o.childId)}>Accept and pay {price}</Button>
                <Button variant="successOutline" onClick={() => actions.declineOffer(o.id, o.sectionId)}>Decline</Button>
              </div>
            </div>
          </div>
        );
      })}
    </>
  );
}
