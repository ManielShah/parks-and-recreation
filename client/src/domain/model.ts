import { CART_MAX, isAgeEligible, isRegistrationOpen, type Hold, type Kid, type Program, type Section, type SectionLive, type StateResponse, type Tone } from '@parks/shared';
import { countdown, money, plural, when } from './format';

const DAY_MS = 24 * 60 * 60 * 1000;

/** Catalog and live state joined up, with `now` on the server's clock. */
export interface Model {
  programs: Program[];
  state: StateResponse;
  now: number;
  program: (id: string) => Program | undefined;
  section: (id: string) => { program: Program; section: Section };
  live: (sectionId: string) => SectionLive;
}

export function buildModel(programs: Program[], state: StateResponse, now: number): Model {
  const byProgram = new Map(programs.map((p) => [p.id, p]));
  const bySection = new Map(programs.flatMap((p) => p.sections.map((s) => [s.id, { program: p, section: s }] as const)));
  // Polling lags; drop holds that ran out since the last fetch so timers never show 0:00 for long.
  const live = new Map(
    state.sections.map((s) => [s.sectionId, { ...s, holds: s.holds.filter((h) => h.expiresAt > now) }]),
  );
  return {
    programs,
    state,
    now,
    program: (id) => byProgram.get(id),
    section: (id) => bySection.get(id)!,
    live: (id) => live.get(id) ?? { sectionId: id, capacity: 0, taken: 0, holds: [], waitlistLength: 0 },
  };
}

export const kidName = (m: Model, id: string | null) => m.state.kids.find((k) => k.id === id)?.name ?? 'Your child';

export function sectionName(m: Model, sectionId: string): string {
  const { program, section } = m.section(sectionId);
  return `${program.name} · ${section.day}`;
}

export const openSpots = (l: SectionLive) => l.capacity - l.taken - l.holds.length;

export interface MyHold extends Hold {
  sectionId: string;
}

export function myHolds(m: Model, kind: Hold['kind']): MyHold[] {
  return m.programs.flatMap((p) => p.sections.flatMap((s) => m.live(s.id).holds.filter((h) => h.kind === kind)));
}

type Involvement = 'reg' | 'offer' | 'cart' | 'wait' | null;

function involvement(m: Model, kidId: string, program: Program): Involvement {
  for (const s of program.sections) {
    if (m.state.registrations.some((r) => r.sectionId === s.id && r.childId === kidId)) return 'reg';
    const holds = m.live(s.id).holds.filter((h) => h.childId === kidId);
    if (holds.some((h) => h.kind === 'offer')) return 'offer';
    if (holds.length) return 'cart';
    if (m.state.waitlist.some((w) => w.sectionId === s.id && w.childId === kidId)) return 'wait';
  }
  return null;
}

export function kidStatus(m: Model, kid: Kid, program: Program): { ok: boolean; reason: string } {
  if (!isAgeEligible(kid.age, program)) return { ok: false, reason: `Ages ${program.minAge}–${program.maxAge} only` };
  switch (involvement(m, kid.id, program)) {
    case 'reg': return { ok: false, reason: 'Already registered' };
    case 'offer': return { ok: false, reason: 'Waitlist spot offered' };
    case 'cart': return { ok: false, reason: 'In your cart' };
    case 'wait': return { ok: false, reason: 'On the waitlist' };
    default: return { ok: true, reason: `Age ${kid.age} · eligible` };
  }
}

export function firstEligible(m: Model, program: Program): string | null {
  return m.state.kids.find((k) => kidStatus(m, k, program).ok)?.id ?? null;
}

export type Opening =
  | { open: true }
  | { open: false; at: string; left: number; buttonLabel: string; cardLabel: string };

/** Whether registration has opened yet, with the wording the design uses while it hasn't. */
export function opening(m: Model, program: Program): Opening {
  if (isRegistrationOpen(program, m.now)) return { open: true };
  const left = program.registrationOpensAt! - m.now;
  const soon = left < DAY_MS;
  return {
    open: false,
    at: when(program.registrationOpensAt!),
    left,
    buttonLabel: soon ? `Opens in ${countdown(left)}` : 'Not open yet',
    cardLabel: soon ? `Registration opens in ${countdown(left)}` : `Opens ${when(program.registrationOpensAt!)}`,
  };
}

export function programAvailability(m: Model, program: Program): { label: string; tone: 'good' | 'warn' | 'info' | 'muted' } {
  const o = opening(m, program);
  if (!o.open) return { label: o.cardLabel, tone: 'info' };
  const open = program.sections.reduce((n, s) => n + Math.max(0, openSpots(m.live(s.id))), 0);
  if (open === 0) return { label: 'Waitlist only', tone: 'muted' };
  if (open === 1) return { label: 'Only 1 spot left', tone: 'warn' };
  return { label: `${open} spots open`, tone: 'good' };
}

export type DotKind = 'taken' | 'mine' | 'open';
export type NoteTone = Tone | 'muted';

export type SectionAction =
  | { type: 'add'; label: string }
  | { type: 'waitlist'; label: string }
  | { type: 'accept'; label: string; holdId: string }
  | { type: 'checkout'; label: string }
  | { type: 'leave'; label: string; entryId: string }
  | { type: 'account'; label: string }
  | { type: 'disabled'; label: string };

export interface SectionView {
  id: string;
  day: string;
  time: string;
  dots: DotKind[];
  capacityLabel: string;
  note: string;
  tone: NoteTone;
  action: SectionAction;
  secondary: boolean;
}

/**
 * What one section row says and offers, for the child currently picked. Other families' holds and
 * offers count as taken; nothing here hints that another family is about to claim or release a spot.
 */
export function sectionView(m: Model, program: Program, section: Section, kid: Kid | null, kidOk: boolean): SectionView {
  const l = m.live(section.id);
  const opens = opening(m, program);
  const now = m.now;
  const mine = l.holds.filter((h) => h.kind === 'cart');
  const myOffer = l.holds.find((h) => h.kind === 'offer') ?? null;
  const open = openSpots(l);
  const myRegs = m.state.registrations.filter((r) => r.sectionId === section.id);
  const myWait = m.state.waitlist.find((w) => w.sectionId === section.id) ?? null;
  const cartFull = myHolds(m, 'cart').length >= CART_MAX;

  const mineReg = Math.min(myRegs.length, l.taken);
  const dots: DotKind[] = [
    ...Array<DotKind>(Math.max(0, l.taken - mineReg)).fill('taken'),
    ...Array<DotKind>(mineReg + mine.length + (myOffer ? 1 : 0)).fill('mine'),
  ];
  while (dots.length < l.capacity) dots.push('open');

  // What the rest of the household already has here, shown alongside and never blocking a sibling.
  const household: string[] = [];
  if (myRegs.length) household.push(`${myRegs.map((r) => kidName(m, r.childId)).join(' & ')} registered`);
  if (myOffer) household.push(`Spot offered to ${kidName(m, myOffer.childId)} · accept within ${countdown(myOffer.expiresAt - now)}`);
  if (mine.length) household.push(`${mine.map((h) => kidName(m, h.childId)).join(' & ')} in your cart · ${countdown(mine[0]!.expiresAt - now)} left`);
  if (myWait) household.push(`${kidName(m, myWait.childId)} is #${myWait.position} on the waitlist`);
  const hh = household.join(' · ');
  const pre = hh ? `${hh} · ` : '';
  const needKid = !kid || !kidOk;

  let note: string;
  let tone: NoteTone;
  let action: SectionAction;
  let secondary = false;

  if (!opens.open) {
    note = `Up to ${l.capacity} kids · registration opens ${opens.at}`;
    tone = 'muted';
    action = { type: 'disabled', label: opens.buttonLabel };
  } else if (needKid && household.length) {
    note = hh;
    if (myOffer) { tone = 'good'; action = { type: 'accept', label: `Accept and pay ${money(program.priceCents)}`, holdId: myOffer.id }; }
    else if (mine.length) { tone = 'info'; action = { type: 'checkout', label: 'Go to checkout' }; }
    else if (myWait && !myRegs.length) { tone = 'info'; secondary = true; action = { type: 'leave', label: 'Leave waitlist', entryId: myWait.id }; }
    else { tone = 'good'; secondary = true; action = { type: 'account', label: 'View registrations' }; }
  } else if (open > 0) {
    note = pre + (open === 1 ? 'Only 1 spot left' : `${open} of ${l.capacity} spots open`);
    tone = open === 1 ? 'warn' : hh ? 'info' : 'muted';
    if (needKid) action = { type: 'disabled', label: 'Add to cart' };
    else if (cartFull) action = { type: 'disabled', label: 'Cart is full' };
    else action = { type: 'add', label: `Add ${kid!.name} to cart` };
  } else {
    note = `${pre}Full · ${l.waitlistLength} ${plural(l.waitlistLength, 'family', 'families')} on the waitlist`;
    tone = hh ? 'info' : 'muted';
    action = needKid ? { type: 'disabled', label: 'Join waitlist' } : { type: 'waitlist', label: `Waitlist ${kid!.name}` };
  }

  return {
    id: section.id,
    day: section.day,
    time: section.time,
    dots,
    capacityLabel: `${l.taken - mineReg} taken, ${dots.filter((d) => d === 'mine').length} yours, ${Math.max(open, 0)} open, out of ${l.capacity} spots`,
    note,
    tone,
    action,
    secondary,
  };
}
