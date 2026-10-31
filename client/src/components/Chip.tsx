import styles from './Chip.module.css';

export function Chip({ pressed, onClick, children }: { pressed: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" className={styles.chip} aria-pressed={pressed} onClick={onClick}>
      {children}
    </button>
  );
}
