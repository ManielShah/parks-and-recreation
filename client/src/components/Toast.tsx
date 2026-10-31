import { useLocation, useNavigate } from 'react-router-dom';
import { useRegistration } from '../state/RegistrationProvider';
import { BellIcon, CloseIcon } from './icons';
import styles from './Toast.module.css';

export function Toast() {
  const { toast, showToast } = useRegistration();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  if (!toast) return null;
  return (
    <div role="status" aria-live="polite" className={`${styles.toast} ${styles[toast.tone]}`}>
      <span className={styles.icon}><BellIcon /></span>
      <div className={styles.body}>
        <span>{toast.text}</span>
        {toast.toCheckout && pathname !== '/checkout' && (
          <button type="button" className={styles.action} onClick={() => navigate('/checkout')}>Go to checkout</button>
        )}
      </div>
      <button type="button" className={styles.dismiss} onClick={() => showToast(null)} aria-label="Dismiss notification">
        <CloseIcon />
      </button>
    </div>
  );
}
