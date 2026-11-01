// Contract shared by the API server and the web client.

/** How long a spot added to the cart is held before it is released. */
export const HOLD_MS = 5 * 60 * 1000;
const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;

/** Longest a family ever has to accept a waitlist offer (when the class is more than a day away). */
export const OFFER_MS = 2 * HOUR;
/** No automatic waitlist offer may be made, or still be open, after this long before class starts. */
export const AUTO_PROMOTION_CUTOFF_MS = 10 * MINUTE;
/** Most spots one family can hold in its cart at once. */
export const CART_MAX = 3;

/**
 * How long a family gets to accept a waitlist offer, given how long until the class starts.
 * Shorter windows close to class time keep seats from sitting empty. Returns null under
 * 20 minutes: spots are then assigned by staff instead of offered automatically.
 *
 * | Time until class starts | Window  |
 * | ----------------------- | ------- |
 * | more than 24 hours      | 2 hours |
 * | 2–24 hours              | 30 min  |
 * | 20 min–2 hours          | 10 min  |
 * | under 20 minutes        | staff   |
 */
export function offerWindowMs(msUntilStart: number): number | null {
  if (msUntilStart > 24 * HOUR) return 2 * HOUR;
  if (msUntilStart >= 2 * HOUR) return 30 * MINUTE;
  if (msUntilStart >= 20 * MINUTE) return 10 * MINUTE;
  return null;
}

/**
 * When an automatic offer made now would expire, or null if automatic offers have stopped.
 * The window never runs past the cutoff 10 minutes before class, whatever the table says.
 */
export function autoOfferExpiry(startsAt: number, now: number): number | null {
  const window = offerWindowMs(startsAt - now);
  const cutoff = startsAt - AUTO_PROMOTION_CUTOFF_MS;
  if (window === null || now >= cutoff) return null;
  return Math.min(now + window, cutoff);
}

/** "2 hours", "30 minutes", "1 minute". */
export function formatDuration(ms: number): string {
  const minutes = Math.max(1, Math.round(ms / MINUTE));
  if (minutes % 60 === 0) {
    const hours = minutes / 60;
    return hours === 1 ? '1 hour' : `${hours} hours`;
  }
  return minutes === 1 ? '1 minute' : `${minutes} minutes`;
}

export const CATEGORIES = ['Aquatics', 'Arts', 'Sports', 'Gymnastics'] as const;
export type Category = (typeof CATEGORIES)[number];

export interface Kid {
  id: string;
  name: string;
  age: number;
}

export interface Section {
  id: string;
  programId: string;
  day: string;
  time: string;
  capacity: number;
  /** First class (epoch ms). Offer windows and automatic offers depend on it. */
  startsAt: number;
}

export interface Program {
  id: string;
  name: string;
  category: Category;
  minAge: number;
  maxAge: number;
  location: string;
  priceCents: number;
  dates: string;
  description: string;
  /** Why the class size is what it is, e.g. supervision ratios or space. */
  capacityNote: string | null;
  /** When registration opens (epoch ms), or null if it's already open. */
  registrationOpensAt: number | null;
  sections: Section[];
}

export type HoldKind = 'cart' | 'offer';

/**
 * One of this family's temporarily reserved spots: in its cart (5 min) or offered to it from the
 * waitlist (2 h). Other families' holds are never sent; they count toward `SectionLive.taken`.
 */
export interface Hold {
  id: string;
  sectionId: string;
  kind: HoldKind;
  childId: string | null;
  expiresAt: number;
}

export interface Registration {
  id: string;
  sectionId: string;
  childId: string;
  confirmation: string;
  priceCents: number;
  /** Came from an accepted waitlist offer, charged when the family accepted. */
  fromWaitlist: boolean;
}

export interface WaitlistEntry {
  id: string;
  sectionId: string;
  childId: string;
  /** 1-based place in line. */
  position: number;
  /**
   * Set while staff have opened a "last call" on this section with a spot free:
   * any family on the waitlist can claim it until then, first come first served.
   */
  claimableUntil: number | null;
}

export interface SectionLive {
  sectionId: string;
  capacity: number;
  /** Spots unavailable to this family: every active registration plus other families' holds. */
  taken: number;
  /** This family's own holds in the section. */
  holds: Hold[];
  waitlistLength: number;
}

export type Tone = 'good' | 'warn' | 'info';

export interface Notice {
  id: string;
  tone: Tone;
  message: string;
  createdAt: number;
}

export interface StateResponse {
  serverNow: number;
  family: { id: string; name: string };
  kids: Kid[];
  sections: SectionLive[];
  registrations: Registration[];
  waitlist: WaitlistEntry[];
  notices: Notice[];
  /** Programs this family asked to be told about when registration opens. */
  reminders: string[];
  dev: { enabled: boolean; clockOffsetMs: number };
}

export interface CatalogResponse {
  programs: Program[];
}

export interface AddToCartResponse {
  hold: Hold;
  /** This hold took the section's last open spot. */
  lastSpot: boolean;
}

export interface JoinWaitlistResponse {
  entry: WaitlistEntry;
}

export interface CheckoutResponse {
  registrations: Registration[];
  totalCents: number;
}

export type ErrorCode =
  | 'not_found'
  | 'invalid'
  | 'not_eligible'
  | 'already_involved'
  | 'cart_full'
  | 'section_full'
  | 'spots_open'
  | 'expired'
  | 'cart_changed'
  | 'not_open'
  | 'waitlist_priority'
  | 'forbidden';

/** Staff view of one section: everything needed to run its waitlist by hand near class start. */
export interface StaffSection {
  sectionId: string;
  programName: string;
  day: string;
  time: string;
  startsAt: number;
  capacity: number;
  registered: number;
  inCarts: number;
  offers: { familyName: string; childName: string | null; expiresAt: number }[];
  waitlist: { position: number; familyName: string; childName: string | null }[];
  lastCallUntil: number | null;
}

export type WaitlistEventName = 'joined' | 'left' | 'offered' | 'accepted' | 'declined' | 'expired' | 'last_call' | 'claimed';

export interface WaitlistEvent {
  id: string;
  at: number;
  sectionId: string;
  sectionLabel: string;
  event: WaitlistEventName;
  actor: 'family' | 'system' | 'staff';
  familyName: string | null;
  childName: string | null;
  offerExpiresAt: number | null;
  detail: string | null;
}

export interface StaffOverviewResponse {
  serverNow: number;
  sections: StaffSection[];
  events: WaitlistEvent[];
}

export interface ApiError {
  error: { code: ErrorCode; message: string };
}

export function isRegistrationOpen(program: Pick<Program, 'registrationOpensAt'>, now: number): boolean {
  return program.registrationOpensAt === null || now >= program.registrationOpensAt;
}

/** Largest class across a program's sections, for "Up to N kids per class". */
export function classSize(program: Pick<Program, 'sections'>): number {
  return Math.max(0, ...program.sections.map((s) => s.capacity));
}

export function isAgeEligible(age: number, program: Pick<Program, 'minAge' | 'maxAge'>): boolean {
  return age >= program.minAge && age <= program.maxAge;
}
