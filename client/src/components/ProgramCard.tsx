import { useNavigate } from 'react-router-dom';
import { classSize, type Program } from '@parks/shared';
import { money } from '../domain/format';
import { programAvailability, type Model } from '../domain/model';
import { Button } from './Button';
import { CATEGORY_THEME } from './categoryTheme';
import { CategoryIcon } from './icons';
import styles from './ProgramCard.module.css';

export function ProgramCard({ model, program }: { model: Model; program: Program }) {
  const navigate = useNavigate();
  const theme = CATEGORY_THEME[program.category];
  const avail = programAvailability(model, program);
  return (
    <article className={styles.card}>
      <div className={styles.band} style={{ background: theme.bg, color: theme.ink }}>
        <CategoryIcon category={program.category} />
      </div>
      <div className={styles.body}>
        <span className="eyebrow">{program.category}</span>
        <h3 className={styles.name}>{program.name}</h3>
        <span className={styles.meta}>{program.sections.map((s) => s.day).join(' · ')}</span>
        <span className={styles.meta}>{program.location}</span>
        <span className={styles.meta}>
          Up to {classSize(program)} kids per class
        </span>
        <div className={styles.foot}>
          <span className={`${styles.avail} ${styles[avail.tone]}`}>{avail.label}</span>
          <span className={styles.price}>{money(program.priceCents)}</span>
        </div>
        <Button variant="dark" onClick={() => navigate(`/programs/${program.id}`)}>See sections</Button>
      </div>
    </article>
  );
}
