import styles from './Footer.module.css';

export function Footer() {
  return (
    <footer className={styles.footer}>
      <div className={styles.inner}>
        <span>Cedar Valley Parks &amp; Recreation · Questions? Call (555) 010-4400</span>
        <span>Cancellation and refund policy: [TO BE CONFIRMED]</span>
      </div>
    </footer>
  );
}
