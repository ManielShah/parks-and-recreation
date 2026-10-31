import type { DotKind } from '../domain/model';
import styles from './CapacityDots.module.css';

/** Dots shrink as classes grow, so a 16-kid camp still fits on one or two rows. */
function dotSize(capacity: number): number {
  return capacity <= 8 ? 20 : capacity <= 10 ? 18 : 14;
}

export function CapacityDots({ dots, label }: { dots: DotKind[]; label: string }) {
  return (
    <div role="img" aria-label={label} className={styles.dots} style={{ '--dot-size': `${dotSize(dots.length)}px` } as React.CSSProperties}>
      {dots.map((d, i) => <span key={i} className={`${styles.dot} ${styles[d]}`} />)}
    </div>
  );
}

const LEGEND: [DotKind, string][] = [
  ['taken', 'Taken'],
  ['mine', 'Yours'],
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
