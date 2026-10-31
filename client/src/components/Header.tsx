import { Link, NavLink, useLocation } from 'react-router-dom';
import { countdown, plural } from '../domain/format';
import { myHolds } from '../domain/model';
import { useRegistration } from '../state/RegistrationProvider';
import { CartIcon, LogoMark } from './icons';
import styles from './Header.module.css';

export function Header() {
  const { model } = useRegistration();
  const { pathname } = useLocation();
  const holds = model ? myHolds(model, 'cart') : [];
  const soonest = holds.length ? Math.min(...holds.map((h) => h.expiresAt)) - model!.now : 0;
  const urgent = holds.length > 0 && soonest < 60_000;
  const onPrograms = pathname === '/' || pathname.startsWith('/programs');

  const cartCls = [styles.cart, holds.length && (urgent ? styles.cartUrgent : styles.cartActive)].filter(Boolean).join(' ');
  const cartLabel = `Cart, ${holds.length} ${plural(holds.length, 'item', 'items')}${holds.length ? `, held for ${countdown(soonest)}` : ''}`;

  return (
    <header className={styles.header}>
      <div className={styles.inner}>
        <Link to="/" className={styles.brand}>
          <LogoMark />
          <span className={styles.brandText}>
            <span className={styles.brandName}>Cedar Valley</span>
            <span className={styles.brandSub}>Parks &amp; Recreation</span>
          </span>
        </Link>
        <nav aria-label="Main" className={styles.nav}>
          <Link to="/" className={styles.navLink} aria-current={onPrograms ? 'page' : undefined}>Programs</Link>
          <NavLink to="/account" className={styles.navLink}>My registrations</NavLink>
          <Link to="/checkout" className={cartCls} aria-label={cartLabel}>
            <CartIcon />
            <span>Cart</span>
            <span className={styles.count}>{holds.length}</span>
            {holds.length > 0 && <span className={styles.timer}>{countdown(soonest)}</span>}
          </Link>
        </nav>
      </div>
    </header>
  );
}
