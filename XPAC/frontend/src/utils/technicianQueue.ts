// The technician queue rule, once, for every kind of order that has one.
//
// A technician's list reads in the order they are expected to work it:
//
//   In Progress (oldest → newest) → other active work → finished / rescheduled
//
// and they work it one at a time from the top: only the FIRST record in that
// order is actionable and everything else is locked and greyed out.
//
// Work that is waiting on something other than this technician — a reschedule, a
// work order on hold — stops holding the queue up and sinks to the bottom of
// their list, but it stays locked: it is not next, so releasing it is an
// administrator's call. Finished work is never locked; there is nothing left to
// act on.
//
// An administrator can release a specific record early, which is recorded in
// that table's technician_enabled column — so the lock always reflects the
// database, never a local guess.
//
// Job orders and service orders keep their status in differently named columns,
// so the parts that differ are passed in as a config and the algorithm itself
// lives here only once. See technicianJobOrderAccess.ts and
// technicianServiceOrderAccess.ts for the two bindings.
//
// Kept intentionally in sync with MOBILEAPP/frontend/src/utils/technicianQueue.ts,
// and with the matching guards in JobOrderController and ServiceOrderApiController,
// which enforce the same rule server-side.
//
// Every rule here applies to technicians alone. No other role is sorted,
// filtered or locked by any of it.

export const TECHNICIAN_ROLE_ID = 2;

export const isTechnicianUser = (role?: string | null, roleId?: number | string | null): boolean =>
  (role || '').toLowerCase().trim() === 'technician' || String(roleId ?? '') === String(TECHNICIAN_ROLE_ID);

/** Did an administrator release this record to the technician? */
export const isTechnicianEnabled = (record: any): boolean => {
  const raw = record?.technician_enabled ?? record?.technicianEnabled ?? record?.Technician_Enabled;
  return raw === true || raw === 1 || raw === '1' || String(raw).toLowerCase() === 'true';
};

/** Treats a zero date and the various "unset" placeholders as no value. */
export const hasTimeValue = (time?: string | null): boolean => {
  if (!time) return false;
  const lower = String(time).toLowerCase().trim();
  return !['0000-00-00 00:00:00', 'not set', '-', 'none', '', 'null', 'undefined'].includes(lower);
};

/** Message shown when a technician taps a locked record. */
export const TECHNICIAN_LOCKED_MESSAGE =
  'This job order is locked. Finish the job order at the top of your list first, or ask an administrator to enable this one.';

export interface TechnicianQueueConfig {
  /** The status that decides the band, already lowercased and trimmed. */
  statusOf: (record: any) => string;
  /** The instant used for oldest-first ordering. */
  timeOf: (record: any) => number;
  /** Statuses that lead the list — the work actively being carried out. */
  inProgress: readonly string[];
  /** Statuses the queue skips: neither holding the slot nor blocked by it. */
  exempt: readonly string[];
  /**
   * The subset of `exempt` that is finished for good — done, failed, cancelled.
   *
   * These are never locked, because there is nothing left to act on. Whatever
   * else is in `exempt` is deferred work the technician still owes, which keeps
   * out of the queue's way but stays locked until it is either next or released.
   */
  closed: readonly string[];
  /** Has the technician started this record and not yet closed it? */
  inFlight: (record: any) => boolean;
}

export interface TechnicianQueue {
  /**
   * Does the queue skip this record?
   *
   * True once it is finished, failed, cancelled or awaiting a return visit.
   * Such a record never holds the queue up. It may still be locked — see
   * isClosed for the ones that never are.
   */
  isExempt: (record: any) => boolean;
  /**
   * Is this record finished for good — done, failed or cancelled?
   *
   * Nothing is left to act on, so it is never locked and never offered for
   * release. Deferred work answers false here and true to isExempt.
   */
  isClosed: (record: any) => boolean;
  /** Is the technician actively out on this record? */
  isInProgress: (record: any) => boolean;
  /**
   * Which band of the technician's list this record belongs to.
   *
   *   0  In Progress — what they are out on now, so it leads the list
   *   1  other active work — not started yet, and nothing has closed it
   *   2  finished / rescheduled — always at the very end
   */
  rank: (record: any) => number;
  /**
   * The technician's list order: In Progress (oldest → newest) → other active
   * → finished. Oldest → newest applies within every band, tie-broken by id
   * ascending. Does not mutate the input.
   */
  sort: <T>(records: T[]) => T[];
  /**
   * The ids a technician may not act on yet, out of the records assigned to
   * them. Reading is never restricted; starting, editing and closing are.
   *
   * Pass the technician's whole accessible set — not one page and not a
   * search-filtered view — or filtering the list would change which record
   * counts as their next one.
   */
  buildLockedIds: (records: any[]) => Set<string>;
}

export const createTechnicianQueue = (config: TechnicianQueueConfig): TechnicianQueue => {
  const isExempt = (record: any): boolean => config.exempt.includes(config.statusOf(record));
  const isClosed = (record: any): boolean => config.closed.includes(config.statusOf(record));
  const isInProgress = (record: any): boolean => config.inProgress.includes(config.statusOf(record));

  const rank = (record: any): number => {
    if (isExempt(record)) return 2;
    return isInProgress(record) ? 0 : 1;
  };

  const sort = <T,>(records: T[]): T[] =>
    [...records].sort((a, b) => {
      const rankA = rank(a);
      const rankB = rank(b);
      if (rankA !== rankB) return rankA - rankB;

      const timeA = config.timeOf(a);
      const timeB = config.timeOf(b);
      if (timeA !== timeB) return timeA - timeB;

      const idA = parseInt(String((a as any)?.id), 10) || 0;
      const idB = parseInt(String((b as any)?.id), 10) || 0;
      return idA - idB;
    });

  const buildLockedIds = (records: any[]): Set<string> => {
    const locked = new Set<string>();
    if (!Array.isArray(records) || records.length === 0) return locked;

    // Finished work drops out; everything the technician still owes is put in the
    // order their list is painted in. So the head is the oldest In Progress
    // record when there is one, then the oldest piece of other active work, and
    // only when neither is left, the oldest deferred record — which is exactly
    // the row at the top of their screen in each case.
    //
    // Deferred work is ranked here rather than dropped with the finished work.
    // It still sorts to the bottom, so it never takes the slot from active work;
    // dropping it instead left it neither next nor locked, which is how a
    // rescheduled record came to be editable while its start was still blocked.
    const queue = sort(records.filter(record => !isClosed(record)));
    // That head is always actionable, whatever the flag says.
    const headId = queue.length > 0 ? String((queue[0] as any)?.id) : null;

    queue.forEach(record => {
      const id = String((record as any)?.id);
      if (id === headId) return;
      if (isTechnicianEnabled(record) || config.inFlight(record)) return;
      locked.add(id);
    });

    return locked;
  };

  return { isExempt, isClosed, isInProgress, rank, sort, buildLockedIds };
};

/**
 * Parses a date-ish value into an ordering instant.
 *
 * An unusable date sorts first (oldest), so a record is never quietly pushed to
 * the back of the queue.
 */
export const queueTimeFrom = (raw: unknown): number => {
  if (!raw) return 0;

  const parsed = new Date(raw as string).getTime();
  return isNaN(parsed) ? 0 : parsed;
};
