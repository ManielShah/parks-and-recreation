import type { DotKind } from '../domain/model';
import styles from './CapacityDots.module.css';

export function CapacityDots({ dots, label }: { dots: DotKind[]; label: string }) {
  return (
    <div role="img" aria-label={label} className={styles.dots}>
      {dots.map((d, i) => <span key={i} className={`${styles.dot} ${styles[d]}`} />)}
    </div>
  );
}

const LEGEND: [DotKind, string][] = [
  ['taken', 'Taken'],
  ['mine', 'Yours'],
  ['held', 'Held for another family'],
  ['open', 'Open'],
];

export function CapacityLegend() {
  return (
    <div role="list" aria-label="Spot legend" className={styles.legend}>
      {LEGEND.map(([kind, label]) => (
        <span role="listitem" key={kind}>
          <span className={`${styles.swatch} ${styles[kind]}`} />
          {label}
        </span>
      ))}
    </div>
  );
}
