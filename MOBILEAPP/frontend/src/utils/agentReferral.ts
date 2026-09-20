// Shared helpers for matching a job order's "Referred By" value to an agent account,
// and for classifying a job order's onsite status.

// Normalize a name for comparison: lowercase, strip punctuation (e.g. middle-initial dots),
// and collapse whitespace so " Raven  B. Ampere " => "raven b ampere".
export const normalizeName = (s?: string | null): string =>
  (s || '').toLowerCase().replace(/[.,]/g, ' ').replace(/\s+/g, ' ').trim();

// -- Referrals that name an agent by id --------------------------------------
//
// The "Referred By" pickers store the agent's user id rather than their name, so
// a referral made through the UI points at exactly one account. It is stored
// plain — "37" — in the same column the free text has always lived in.
//
// A NUMBER IS NOT ENOUGH TO MAKE IT AN ID. referred_by already holds free text
// that is entirely digits: mobile numbers typed into the box, account numbers
// like "20220006245", and bare numbers such as "1840" that sit in user-id range.
// So a number only counts as a referral once it resolves against the loaded
// agent roster — see findAgentById, which searches only agents. A number that
// resolves to nobody is displayed exactly as stored.
//
// Everything non-numeric is free text and still goes through the tolerant name
// match below, exactly as it always did.
//
// Mirrors the backend's App\Support\AgentReferral.

/** The stored form of a referral to this agent, or null when the id is unusable. */
export const encodeAgentReferral = (agentId: number | string | null | undefined): string | null => {
  if (agentId === null || agentId === undefined || agentId === '') return null;
  const id = Number(agentId);
  return Number.isInteger(id) && id > 0 ? String(id) : null;
};

/**
 * The user id this value COULD name, or null when it is plainly not one.
 *
 * The cheap syntactic half: it says nothing about whether the id belongs to an
 * agent. Use findAgentById / resolveReferralLabel where that matters.
 */
export const agentReferralId = (value: unknown): number | null => {
  if (value === null || value === undefined) return null;

  const trimmed = String(value).trim();

  // Digits only, so "1e3" and "4.5" read as free text rather than silently
  // becoming ids 1000 and 4. A leading "+" or "-" is refused for the same reason.
  if (!/^\d+$/.test(trimmed)) return null;

  // Leading zeros mean this was never an id: "000201" is a code somebody typed,
  // and ids are not written that way.
  if (trimmed.length > 1 && trimmed[0] === '0') return null;

  const id = Number(trimmed);
  return id > 0 ? id : null;
};

/**
 * Does this referral name an agent on the given roster?
 *
 * Needs the roster because a number on its own proves nothing — that is the
 * whole point of the guard above.
 */
export const isAgentReferral = (value: unknown, agents: any[]): boolean =>
  findAgentById(value, agents) !== null;

// The label the agent pickers render for one agent.
//
// Every picker and every id-to-name lookup goes through this, so the value shown
// for a resolved referral is character-for-character the option in the dropdown —
// which is what lets the selected row highlight and what keeps a legacy referral
// written by the old picker equal to the label shown for the new one.
export const agentDisplayName = (agent: any): string =>
  `${agent?.first_name || ''} ${agent?.middle_initial || ''} ${agent?.last_name || ''}`
    .replace(/\s+/g, ' ')
    .trim();

/**
 * The agent an id-form referral points at, from an already-loaded agent list.
 *
 * Null for free text, and null for an id no longer on the list — a referral
 * pointing at a deleted account has no name to show.
 */
export const findAgentById = (value: unknown, agents: any[]): any | null => {
  const id = agentReferralId(value);
  if (id === null) return null;
  return (agents || []).find(a => Number(a?.id) === id) || null;
};

/**
 * The one agent whose name is exactly this label, or null.
 *
 * Used to recover the id behind a legacy referral that was stored as a name, so
 * re-saving an untouched record upgrades it to an id instead of writing the name
 * back. Deliberately refuses when two agents share a name: guessing between them
 * is how the name matching paid the wrong person in the first place.
 */
export const findAgentByName = (label: string, agents: any[]): any | null => {
  const wanted = normalizeName(label);
  if (!wanted) return null;

  const matches = (agents || []).filter(a => normalizeName(agentDisplayName(a)) === wanted);
  return matches.length === 1 ? matches[0] : null;
};

/**
 * A referral as it should be shown to a person.
 *
 * An id becomes the agent's name; free text is returned untouched. An id that
 * matches no loaded agent falls back to the stored value rather than blanking the
 * field — a referral pointing at a deleted account should look wrong, not empty.
 */
export const resolveReferralLabel = (value: unknown, agents: any[]): string => {
  const raw = value === null || value === undefined ? '' : String(value);
  const agent = findAgentById(raw, agents);
  return agent ? agentDisplayName(agent) : raw;
};

// A job order is owned by the agent whose account name matches the Referred By value.
//
// A referral made through the picker holds the agent's user id, and that settles
// it outright: an id names exactly one account, so it is checked first and nothing
// else is consulted. Passing agentId is what lets that happen — without it an
// id-form referral can only ever be rejected, because it carries none of the name.
//
// Older referrals are free text, so that match stays tolerant of middle names /
// extra words: every word of the agent's "first_name + last_name" must appear (as
// a whole word) in Referred By. This covers values like "John Rusell Ampere" for
// an account named "John Ampere", while still rejecting unrelated names. Email
// exact-match is also accepted.
/** Tests one Referred By value against an agent fixed when the matcher was made. */
export type AgentReferralMatcher = (referredByRaw: string) => boolean;

/**
 * The ownership test above, with the AGENT's half of it worked out once.
 *
 * Use this wherever a list is scanned. Every screen an agent opens filters the
 * whole job order set through this rule, and the plain call below re-derives the
 * agent's normalized name, its token list and their lowercased email on every
 * row — the same three values, thousands of times over, for a name that cannot
 * change while the screen is open. Hoisting them out is the difference between
 * work proportional to the list and work proportional to the list times the
 * length of the agent's name.
 *
 * The decision itself is unchanged, and is written only here: agentOwnsReferral
 * delegates to it, so the two can never drift apart.
 */
export const createAgentReferralMatcher = (
  fullName: string,
  email: string,
  agentId?: number | string | null
): AgentReferralMatcher => {
  const id = agentId === null || agentId === undefined ? null : Number(agentId);
  // Compared against the RAW referral, not a normalized one: normalizeName turns
  // dots into spaces, so "juan@x.com" would become "juan@x com" and could never
  // equal the address it came from.
  const em = (email || '').toLowerCase().trim();
  const fn = normalizeName(fullName);
  const nameTokens = fn ? fn.split(' ').filter(t => t.length >= 2) : [];

  return (referredByRaw: string): boolean => {
    // An id-form referral is decided here and goes no further: "37" is not a
    // name, and letting it reach the tolerant branch could only ever be wrong.
    const referralId = agentReferralId(referredByRaw);
    if (referralId !== null) return id !== null && id === referralId;

    const ref = normalizeName(referredByRaw);
    if (!ref) return false;

    if (em && (referredByRaw || '').toLowerCase().trim() === em) return true;

    if (!fn) return false;
    if (ref === fn) return true;

    if (nameTokens.length === 0) return false;
    const refTokens = new Set(ref.split(' '));
    return nameTokens.every(t => refTokens.has(t));
  };
};

export const agentOwnsReferral = (
  referredByRaw: string,
  fullName: string,
  email: string,
  agentId?: number | string | null
): boolean => {
  return createAgentReferralMatcher(fullName, email, agentId)(referredByRaw);
};

// Normalized onsite status of a job order.
export const getOnsiteStatus = (jo: any): string =>
  String(jo?.Onsite_Status || jo?.onsite_status || '').toLowerCase().trim();

// Active (still-in-the-field) job orders shown to agents on the Job Order page.
// Agents only see job orders that are in progress or rescheduled.
export const isActiveOnsiteStatus = (status: string): boolean =>
  status === 'inprogress' || status === 'in progress' || status === 'in-progress' ||
  status === 'reschedule' || status === 'rescheduled' || status === 're-schedule';

// Completed job orders shown to agents on the Agent History page.
export const isDoneOnsiteStatus = (status: string): boolean =>
  status === 'done' || status === 'completed';

// Job orders that did not result in an installation.
export const isFailedOnsiteStatus = (status: string): boolean =>
  status === 'failed' || status === 'cancelled' || status === 'suspended' || status === 'disapproved';

// Job orders awaiting another visit.
export const isRescheduleOnsiteStatus = (status: string): boolean =>
  status === 'reschedule' || status === 'rescheduled' || status === 're-schedule';

// Job orders that have not been visited yet.
export const isInProgressOnsiteStatus = (status: string): boolean =>
  status === 'in progress' || status === 'inprogress' || status === 'in-progress' || status === 'pending';

/**
 * Where a job order sits in an agent's own list.
 *
 * An agent reads their referrals as work in flight: the visits happening now
 * first, then the ones waiting on a return visit, then the ones that fell
 * through, with the finished installations filed at the very bottom. A record
 * whose status matches none of those sits just above the finished work rather
 * than being lost among it.
 *
 * Read by both the web portal and the mobile app so an agent's list reads the
 * same on either. Ordering WITHIN a band is each page's own business - both
 * keep their newest-first default.
 */
export const agentJobOrderBand = (jo: any): number => {
  const status = getOnsiteStatus(jo);
  if (isInProgressOnsiteStatus(status)) return 0;
  if (isRescheduleOnsiteStatus(status)) return 1;
  if (isFailedOnsiteStatus(status)) return 2;
  if (isDoneOnsiteStatus(status)) return 4;
  return 3;
};

// The agent view's cut-off date, or null for no cut-off at all.
//
// Currently null: agents see their FULL referral history, the same as everyone
// else. Nothing is hidden for being old.
//
// Setting a date here restores the cut-off — agents would then only see job
// orders raised on or after it. It is read by both the web and the mobile Job
// Order pages so the two can never disagree, and it must be kept in step with
// `agent.start_date` in the backend's config/agent.php, which decides the same
// thing for incentives and achievements. A date here without the matching
// backend value would show an agent referrals that earn them nothing.
export const AGENT_JOB_ORDER_START_DATE: string | null = null;

/**
 * The date a job order belongs to, for the purposes of the agent cut-off.
 *
 * Uses the job order's own timestamp — when the record was raised — falling
 * back to the installation date and then the created date, so a record with a
 * missing timestamp is still placed rather than silently dropped.
 */
export const jobOrderDate = (jo: any): Date | null => {
  const raw = jo?.Timestamp || jo?.timestamp
    || jo?.Date_Installed || jo?.date_installed
    || jo?.created_at || jo?.Created_At;

  if (!raw) return null;

  const parsed = new Date(raw);
  return isNaN(parsed.getTime()) ? null : parsed;
};

/**
 * Is this job order on or after the agent cut-off?
 *
 * With no cut-off set (the current setting) every job order qualifies, so an
 * agent's whole history is shown.
 *
 * A record with no usable date is kept rather than hidden: losing a referral
 * from an agent's own list is worse than showing one that is slightly old.
 */
export const isOnOrAfterAgentStartDate = (jo: any): boolean => {
  if (!AGENT_JOB_ORDER_START_DATE) return true;

  const date = jobOrderDate(jo);
  if (!date) return true;

  // Compared at day resolution so the whole of the start date is included,
  // whatever time of day the record carries.
  const start = new Date(`${AGENT_JOB_ORDER_START_DATE}T00:00:00`);
  return date.getTime() >= start.getTime();
};

// Onboarding achievements. Each tier rewards a number of onboarded referrals
// reached within a period, and resets when that period rolls over — so the
// weekly reward can be earned again next week.
//
// These mirror the server's configuration and the web app's copy. The dashboard
// prefers the figures the API returns and falls back to these, so the clients
// never disagree with the server for long.
export interface AchievementTier {
  key: 'weekly' | 'monthly';
  label: string;
  target: number;
  reward: number;
}

export const ACHIEVEMENT_TIERS: AchievementTier[] = [
  { key: 'weekly',  label: 'Weekly Achievement',  target: 25,  reward: 1000 },
  { key: 'monthly', label: 'Monthly Achievement', target: 100, reward: 15000 },
];

// -- Reset countdown ---------------------------------------------------------
//
// Each tier resets when its period rolls over: the weekly count returns to zero
// at the start of a new week, the monthly count at the start of a new month.
// The two run on independent clocks and are counted independently.
//
// The server decides when a period ends and sends that instant back as an
// absolute time. The dashboards only count down to it — they never work the
// boundary out themselves, because a device in another timezone (or with a
// wrong clock) would land on a different moment than the server resets on.

/** How long the countdown has left, in milliseconds. Never negative. */
export const millisUntilReset = (resetsAt: number | null, serverNow: number): number => {
  if (resetsAt === null || !isFinite(resetsAt)) return 0;
  return Math.max(0, resetsAt - serverNow);
};

/**
 * A countdown for display: "6d 04:13:56" once a day or more is left, and
 * "04:13:56" below that, so the final day reads as a plain clock.
 */
export const formatCountdown = (ms: number): string => {
  const total = Math.max(0, Math.floor(ms / 1000));
  const days = Math.floor(total / 86400);
  const hours = Math.floor((total % 86400) / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;

  const pad = (n: number) => String(n).padStart(2, '0');
  const clock = `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
  return days > 0 ? `${days}d ${clock}` : clock;
};

/** Parses the reset instant the server sent. Returns null if it is unusable. */
export const parseResetsAt = (raw: unknown): number | null => {
  if (typeof raw !== 'string' || !raw) return null;
  const ms = new Date(raw).getTime();
  return isNaN(ms) ? null : ms;
};

/**
 * How far the device clock is behind the server's, in milliseconds.
 *
 * Added to the device time to get the server's view of "now", so a phone set to
 * the wrong time still counts down to the right moment. Zero when the server
 * did not say, which leaves the device clock trusted as before.
 */
export const clockSkewFrom = (serverTime: unknown, deviceNow: number): number => {
  const server = parseResetsAt(serverTime);
  return server === null ? 0 : server - deviceNow;
};
