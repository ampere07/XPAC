/**
 * One status→colour table for the whole app.
 *
 * The vocabulary is ApplicationManagement.tsx's `getStatusColor` — the page the
 * standard card view is modelled on — widened with the statuses the other list
 * pages use (job/service order outcomes, billing states, RADIUS session states)
 * so a status word means the same colour wherever it is drawn.
 *
 * Add here rather than inline in a page: a second local map is how "Pending"
 * ends up orange on one screen and grey on the next.
 */

/** Shown when a row's status column is blank. */
export const EMPTY_STATUS_LABEL = 'Empty';

const NEUTRAL = '#6b7280';
const EMPTY = '#9ca3af';

const GREEN = '#16a34a';
const BLUE = '#2563eb';
const ORANGE = '#ea580c';
const RED = '#dc2626';
const PURPLE = '#9333ea';
const PINK = '#db2777';

const STATUS_COLORS: Record<string, string> = {
  // ── ApplicationManagement's own vocabulary (verbatim) ───────────────────
  schedule: GREEN,
  scheduled: GREEN,
  confirmed: GREEN,
  completed: GREEN,
  'no facility': RED,
  cancelled: RED,
  'no slot': PURPLE,
  duplicate: PINK,
  'in progress': BLUE,
  pending: ORANGE,
  empty: EMPTY,

  // ── job / service / work order outcomes ────────────────────────────────
  done: GREEN,
  resolved: GREEN,
  approved: GREEN,
  success: GREEN,
  inprogress: BLUE,
  'in-progress': BLUE,
  ongoing: BLUE,
  processing: BLUE,
  reschedule: BLUE,
  rescheduled: BLUE,
  onhold: ORANGE,
  'on hold': ORANGE,
  waiting: ORANGE,
  failed: RED,
  canceled: RED,
  rejected: RED,
  declined: RED,
  expired: RED,

  // ── billing ────────────────────────────────────────────────────────────
  paid: GREEN,
  settled: GREEN,
  partial: ORANGE,
  unpaid: RED,
  overdue: RED,
  void: EMPTY,
  refunded: PURPLE,

  // ── account / RADIUS session ───────────────────────────────────────────
  active: GREEN,
  online: GREEN,
  connected: GREEN,
  offline: NEUTRAL,
  idle: NEUTRAL,
  inactive: EMPTY,
  restricted: ORANGE,
  suspended: RED,
  disconnected: RED,
  terminated: RED,
};

/** The colour for a status word. Unknown words get a readable neutral grey. */
export const getStatusColor = (status?: string | null): string => {
  const key = String(status ?? '').trim().toLowerCase();
  if (!key) return EMPTY;
  return STATUS_COLORS[key] ?? NEUTRAL;
};

/** A blank status reads "Empty" rather than an empty gap, as the reference page does. */
export const getStatusLabel = (status?: string | null): string => {
  const raw = String(status ?? '').trim();
  return raw === '' ? EMPTY_STATUS_LABEL : raw;
};
