import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Button } from '../components/Button';
import { Card, CardTitle } from '../components/Card';
import { CapacityDots, CapacityLegend } from '../components/CapacityDots';
import { CATEGORY_THEME } from '../components/categoryTheme';
import { CategoryIcon, ChevronLeftIcon } from '../components/icons';
import { money } from '../domain/format';
import { firstEligible, kidStatus, sectionView, type Model, type SectionView } from '../domain/model';
import { useActions } from '../state/useActions';
import buttonStyles from '../components/Button.module.css';
import styles from './ProgramDetail.module.css';

export function ProgramDetail({ model }: { model: Model }) {
  const { programId = '' } = useParams();
  const navigate = useNavigate();
  const actions = useActions();
  const [picked, setPicked] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const program = model.program(programId);
  if (!program) {
    return (
      <div className="page">
        <h1>Program not found</h1>
        <Link to="/">Back to all programs</Link>
      </div>
    );
  }

  const theme = CATEGORY_THEME[program.category];
  const statuses = model.state.kids.map((k) => ({ kid: k, ...kidStatus(model, k, program) }));
  // Keep the family's pick while it's still valid; otherwise move to the next child who can be added.
  const selectedId = statuses.find((s) => s.kid.id === picked && s.ok) ? picked : firstEligible(model, program);
  const selected = statuses.find((s) => s.kid.id === selectedId) ?? null;
  const anyEligible = statuses.some((s) => s.ok);

  const act = async (v: SectionView) => {
    const a = v.action;
    setBusy(true);
    try {
      if (a.type === 'add' && selected) await actions.addToCart(v.id, selected.kid.id);
      else if (a.type === 'waitlist' && selected) await actions.joinWaitlist(v.id, selected.kid.id);
      else if (a.type === 'accept') await actions.acceptOffer(a.holdId, model.live(v.id).holds.find((h) => h.id === a.holdId)?.childId ?? null);
      else if (a.type === 'leave') {
        const entry = model.state.waitlist.find((w) => w.id === a.entryId);
        if (entry) await actions.leaveWaitlist(entry.id, entry.sectionId, entry.childId);
      } else if (a.type === 'checkout') navigate('/checkout');
      else if (a.type === 'account') navigate('/account');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="page">
      <Link to="/" className={`${buttonStyles.button} ${buttonStyles.link} ${styles.back}`}>
        <ChevronLeftIcon />
        All programs
      </Link>

      <div className="split">
        <div className="main">
          <Card padding="flush">
            <div className={styles.band} style={{ background: theme.bg, color: theme.ink }}>
              <CategoryIcon category={program.category} size={72} />
            </div>
            <div className={styles.intro}>
              <span className={`eyebrow ${styles.eyebrow}`}>{program.category}</span>
              <h1 className={styles.title}>{program.name}</h1>
              <p className={styles.desc}>{program.description}</p>
              <dl className={styles.facts}>
                <div className={styles.fact}><dt>Ages</dt><dd>{program.minAge}–{program.maxAge} years</dd></div>
                <div className={styles.fact}><dt>Dates</dt><dd>{program.dates}</dd></div>
                <div className={styles.fact}><dt>Location</dt><dd>{program.location}</dd></div>
                <div className={styles.fact}><dt>Fee</dt><dd>{money(program.priceCents)}</dd></div>
              </dl>
            </div>
          </Card>

          <Card padding="padWide">
            <CardTitle large>Who is this for?</CardTitle>
            <div className={styles.kids}>
              {statuses.map(({ kid, ok, reason }) => (
                <button
                  key={kid.id}
                  type="button"
                  className={styles.kid}
                  disabled={!ok}
                  aria-pressed={selectedId === kid.id && ok}
                  onClick={() => setPicked(kid.id)}
                >
                  <span className={styles.kidName}>{kid.name}</span>
                  <span className={styles.kidSub}>{reason}</span>
                </button>
              ))}
            </div>
            <span className={styles.hint}>
              {!anyEligible
                ? 'None of your kids can be added to this program right now.'
                : selected
                  ? `Choosing a section for ${selected.kid.name}.`
                  : 'Choose a child to see what you can add.'}
            </span>
          </Card>

          <Card padding="padWide" className={styles.sectionsCard}>
            <div className={styles.sectionsHead}>
              <CardTitle large>Choose a section</CardTitle>
              <CapacityLegend />
            </div>
            {program.sections.map((s) => {
              const v = sectionView(model, s, selected?.kid ?? null, Boolean(selected?.ok));
              return (
                <div className={styles.row} key={s.id}>
                  <div className={styles.when}>
                    <span className={styles.day}>{v.day}</span>
                    <span className={styles.time}>{v.time}</span>
                  </div>
                  <div className={styles.status}>
                    <CapacityDots dots={v.dots} label={v.capacityLabel} />
                    <span className={`${styles.note} ${styles[v.tone]}`}>{v.note}</span>
                  </div>
                  <Button
                    className={styles.rowAction}
                    variant={v.secondary ? 'secondary' : 'primary'}
                    disabled={v.action.type === 'disabled' || busy}
                    onClick={() => act(v)}
                  >
                    {v.action.label}
                  </Button>
                </div>
              );
            })}
          </Card>
        </div>

        <Card as="aside" className="side">
          <CardTitle>How registration works</CardTitle>
          <div className={styles.steps}>
            <div className={styles.step}><span className={styles.stepNum}>1</span><span>Add a spot to your cart. It's held for you for 5 minutes, and other families see it as taken.</span></div>
            <div className={styles.step}><span className={styles.stepNum}>2</span><span>Check out before the timer runs out, or the spot goes back to the next family.</span></div>
            <div className={styles.step}><span className={styles.stepNum}>3</span><span>Section full? Join the waitlist. When a spot opens, we text and email the first family in line. They have 2 hours to accept, then pay to confirm. Nobody is charged automatically.</span></div>
          </div>
        </Card>
      </div>
    </div>
  );
}
