import { Navigate, useNavigate } from 'react-router-dom';
import { Button } from '../components/Button';
import { Card } from '../components/Card';
import { CheckIcon } from '../components/icons';
import { money } from '../domain/format';
import { kidName, type Model } from '../domain/model';
import { useRegistration } from '../state/RegistrationProvider';
import styles from './Confirmation.module.css';

export function Confirmation({ model }: { model: Model }) {
  const { lastOrder } = useRegistration();
  const navigate = useNavigate();
  if (!lastOrder) return <Navigate to="/account" replace />;

  return (
    <div className={styles.page}>
      <Card className={styles.card}>
        <span className={styles.check}><CheckIcon /></span>
        <h1 className={styles.title}>You're registered</h1>
        <p className={styles.lead}>A receipt is on its way to your email. You'll find everything under My registrations.</p>
        <div className={styles.list}>
          {lastOrder.registrations.map((r) => {
            const { program, section } = model.section(r.sectionId);
            return (
              <div className={styles.row} key={r.id}>
                <div className={styles.left}>
                  <span className={styles.name}>{program.name}</span>
                  <span className={styles.sub}>{section.day}, {section.time} · {kidName(model, r.childId)}</span>
                </div>
                <div className={styles.right}>
                  <span className={styles.price}>{money(r.priceCents)}</span>
                  <span className={styles.small}>Confirmation {r.confirmation}</span>
                </div>
              </div>
            );
          })}
          <div className={styles.total}><span>Paid</span><span>{money(lastOrder.totalCents)}</span></div>
        </div>
        <div className={styles.actions}>
          <Button variant="dark" onClick={() => navigate('/account')}>View my registrations</Button>
          <Button variant="secondary" onClick={() => navigate('/')}>Register another child</Button>
        </div>
      </Card>
    </div>
  );
}
