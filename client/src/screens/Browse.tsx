import { useSearchParams } from 'react-router-dom';
import { CATEGORIES, programSuits, programSuitsAll } from '@parks/shared';
import { Button } from '../components/Button';
import { Chip } from '../components/Chip';
import { ProgramCard } from '../components/ProgramCard';
import { plural } from '../domain/format';
import type { Model } from '../domain/model';
import styles from './Browse.module.css';

const AGES = Array.from({ length: 15 }, (_, i) => i + 3);

export function Browse({ model }: { model: Model }) {
  // Filters live in the URL so Back from a program keeps them.
  const [params, setParams] = useSearchParams();
  const age = params.get('age');
  const cat = params.get('activity');
  const ageNum = age ? Number(age) : null;
  // Pick one or more of your kids: with several, only programs with a section that takes them all.
  const kidIds = (params.get('kids') ?? '').split(',').filter(Boolean);
  const pickedKids = model.state.kids.filter((k) => kidIds.includes(k.id));
  const toggleKid = (id: string) => {
    const next = kidIds.includes(id) ? kidIds.filter((k) => k !== id) : [...kidIds, id];
    update({ kids: next.join(',') || null });
  };

  const update = (next: { age?: string | null; activity?: string | null; kids?: string | null }) => {
    const p = new URLSearchParams(params);
    for (const [k, v] of Object.entries(next)) v ? p.set(k, v) : p.delete(k);
    setParams(p, { replace: true });
  };

  const programs = model.programs.filter(
    (p) =>
      (ageNum === null || programSuits(ageNum, p)) &&
      (!pickedKids.length || programSuitsAll(pickedKids.map((k) => k.age), p)) &&
      (!cat || p.category === cat),
  );
  const forWhom = [
    pickedKids.length ? pickedKids.map((k) => k.name).join(' & ') + (pickedKids.length > 1 ? ' together' : '') : null,
    ageNum === null ? null : `age ${ageNum}`,
  ].filter(Boolean).join(', ');

  return (
    <>
      <section className={styles.hero}>
        <div className={styles.heroInner}>
          <span className={styles.season}>Winter session · Jan 5 – Feb 28</span>
          <h1 className={styles.heroTitle}>Winter registration is open</h1>
        </div>
      </section>

      <div className={styles.content}>
        <div className={styles.filters}>
          <div className={styles.field}>
            <label htmlFor="age-filter" className={styles.label}>Child's age</label>
            <select id="age-filter" className={styles.select} value={age ?? 'any'} onChange={(e) => update({ age: e.target.value === 'any' ? null : e.target.value })}>
              <option value="any">Any age</option>
              {AGES.map((a) => <option key={a} value={a}>{a} years</option>)}
            </select>
          </div>
          <div className={styles.field}>
            <span className={styles.label}>Your kids</span>
            <div className={styles.chips}>
              {model.state.kids.map((k) => (
                <Chip key={k.id} pressed={kidIds.includes(k.id)} onClick={() => toggleKid(k.id)}>
                  {k.name} · {k.age}
                </Chip>
              ))}
            </div>
          </div>
          <div className={styles.fieldWide}>
            <span className={styles.label}>Activity</span>
            <div className={styles.chips}>
              <Chip pressed={!cat} onClick={() => update({ activity: null })}>All</Chip>
              {CATEGORIES.map((c) => <Chip key={c} pressed={cat === c} onClick={() => update({ activity: c })}>{c}</Chip>)}
            </div>
          </div>
        </div>

        <div className={styles.resultsHead}>
          <h2 className={styles.resultsTitle}>
            {programs.length} {plural(programs.length, 'program', 'programs')}{forWhom ? ` for ${forWhom}` : ''}
          </h2>
          {(age || cat || kidIds.length > 0) && (
            <Button variant="link" underline onClick={() => update({ age: null, activity: null, kids: null })}>Clear filters</Button>
          )}
        </div>

        {programs.length === 0 && <div className={styles.empty}>No winter programs match. Try another age or activity.</div>}

        <div className={styles.grid}>
          {programs.map((p) => <ProgramCard key={p.id} model={model} program={p} />)}
        </div>
      </div>
    </>
  );
}
