// Contract shared by the API server and the web client.

/** How long a spot added to the cart is held before it is released. */
export const HOLD_MS = 5 * 60 * 1000;
/** How long a family has to accept a spot offered from the waitlist. */
export const OFFER_MS = 2 * 60 * 60 * 1000;
/** Most spots one family can hold in its cart at once. */
export const CART_MAX = 3;

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

/** A spot temporarily reserved: in a cart (5 min) or offered from the waitlist (2 h). */
export interface Hold {
  id: string;
  sectionId: string;
  /** False for other families' holds; their ids and children are never exposed. */
  mine: boolean;
  kind: HoldKind;
  childId: string | null;
  /** The cart hold came from an accepted waitlist offer. */
  accepted: boolean;
  expiresAt: number;
}

export interface Registration {
  id: string;
  sectionId: string;
  childId: string;
  confirmation: string;
  priceCents: number;
  /** Registered straight from the waitlist and charged without a checkout. */
  autoRegistered: boolean;
}

export interface WaitlistEntry {
  id: string;
  sectionId: string;
  childId: string;
  /** 1-based place in line. */
  position: number;
  /** When a spot opens: register and charge right away instead of offering it for 2 hours. */
  autoRegister: boolean;
}

export interface SectionLive {
  sectionId: string;
  capacity: number;
  /** Active registrations, every family included. */
  enrolled: number;
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
  | 'not_open';

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
