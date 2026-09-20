import { getUserPreference, setUserPreference, deleteUserPreference } from './userPreferenceService';
import type { GroupableColumn } from '../utils/groupTree';

/**
 * Per-user View Options: how a list is grouped, how it is sorted, and what colour
 * each distinct value wears.
 *
 * The AppSheet model, applied to SYNC's list screens. A screen ships with one grouping
 * decided in code, and that decision is wrong for most of the people using it: a
 * dispatcher wants Job Orders by City then Barangay, a supervisor wants them by
 * Technician then Status, and a collections clerk wants them by Billing Status alone.
 * Rather than guess, the grouping becomes the operator's to define — one to N levels,
 * over any column the screen declares as groupable.
 *
 * Sibling of {@link statusSliceService}, and deliberately a separate preference key.
 * The curated status slices are a *vocabulary* the server owns; grouping is an
 * arbitrary hierarchy the operator builds over columns. Storing them together would
 * mean reconfiguring one silently reset the other.
 *
 * Storage is the existing user-preferences pair, so a layout follows an operator to
 * another browser, and localStorage keeps it working on a host where the endpoint is
 * unreachable. Nothing here is load-bearing: a configuration that cannot be read
 * leaves the screen ungrouped, which is exactly what it showed before this existed.
 */

export type SortDirection = 'asc' | 'desc';

export interface ViewSortRule {
  /** Column key, matching a {@link GroupableColumn}. */
  column: string;
  direction: SortDirection;
}

export interface ViewOptions {
  /**
   * Group levels, outermost first. `['city', 'barangay', 'status']` renders City at
   * the top of the tree, Barangay inside each city, Status inside each barangay.
   * Empty means the sidebar falls back to whatever it shows ungrouped.
   */
  groupBy: string[];
  /** Sort rules, applied in order. Empty leaves the grid's own default sort alone. */
  sortBy: ViewSortRule[];
  /** Dot/badge colour per column per distinct value: `colors[column][value]`. */
  colors: Record<string, Record<string, string>>;
}

/**
 * Re-exported so a screen importing View Options gets the column type and the blank
 * label from one place. They live in `utils/groupTree` because the tree engine is pure
 * and must stay importable without dragging the API client in behind it.
 */
export type { GroupableColumn } from '../utils/groupTree';
export { BLANK_GROUP_LABEL } from '../utils/groupTree';

export const EMPTY_VIEW_OPTIONS: ViewOptions = { groupBy: [], sortBy: [], colors: {} };

const PREFERENCE_PREFIX = 'view_options.';

const preferenceKey = (moduleKey: string): string => `${PREFERENCE_PREFIX}${moduleKey}`;

const isHex = (value: unknown): value is string =>
  typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value.trim());

/**
 * The palette a value gets before anyone has chosen one for it.
 *
 * Assigned by hashing the value rather than by its position in the list, so a status
 * keeps the same colour when a new one is added above it — a palette that reshuffled
 * itself on every deploy would be worse than no colour at all.
 */
const DEFAULT_PALETTE = [
  '#3b82f6', '#10b981', '#f59e0b', '#a855f7', '#ef4444', '#06b6d4',
  '#84cc16', '#ec4899', '#6366f1', '#f97316', '#14b8a6', '#64748b',
];

export const autoColor = (value: string): string => {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash * 31 + value.charCodeAt(i)) | 0;
  }
  return DEFAULT_PALETTE[Math.abs(hash) % DEFAULT_PALETTE.length];
};

/**
 * Reconcile stored options against the columns the code declares now.
 *
 * A group level or sort rule naming a column that no longer exists is dropped rather
 * than left to produce an empty tree, and a duplicate level is collapsed — grouping by
 * City twice is not a hierarchy, it is a bug that renders one child per parent.
 */
export const sanitizeViewOptions = (raw: unknown, columns: GroupableColumn[]): ViewOptions => {
  if (!raw || typeof raw !== 'object') return EMPTY_VIEW_OPTIONS;

  const known = new Set(columns.map((column) => column.key));
  const source = raw as Record<string, unknown>;

  const groupBy: string[] = [];
  if (Array.isArray(source.groupBy)) {
    source.groupBy.forEach((key) => {
      if (typeof key === 'string' && known.has(key) && !groupBy.includes(key)) groupBy.push(key);
    });
  }

  const sortBy: ViewSortRule[] = [];
  if (Array.isArray(source.sortBy)) {
    source.sortBy.forEach((rule) => {
      if (!rule || typeof rule !== 'object') return;
      const { column, direction } = rule as Record<string, unknown>;
      if (typeof column !== 'string' || !known.has(column)) return;
      if (sortBy.some((existing) => existing.column === column)) return;
      sortBy.push({ column, direction: direction === 'desc' ? 'desc' : 'asc' });
    });
  }

  const colors: Record<string, Record<string, string>> = {};
  if (source.colors && typeof source.colors === 'object') {
    Object.entries(source.colors as Record<string, unknown>).forEach(([column, values]) => {
      if (!known.has(column) || !values || typeof values !== 'object') return;
      const perValue: Record<string, string> = {};
      Object.entries(values as Record<string, unknown>).forEach(([value, color]) => {
        if (isHex(color)) perValue[value] = color.trim().toLowerCase();
      });
      if (Object.keys(perValue).length > 0) colors[column] = perValue;
    });
  }

  return { groupBy, sortBy, colors };
};

export const viewOptionsService = {
  /**
   * This operator's view options for one module, reconciled against the code.
   *
   * Never rejects: a server that is down, a hand-edited payload or a browser with
   * storage disabled all resolve to "ungrouped", because a screen that will not render
   * because a colour preference failed to load is the worse outcome.
   */
  load: async (moduleKey: string, columns: GroupableColumn[]): Promise<ViewOptions> => {
    try {
      const raw = await getUserPreference(preferenceKey(moduleKey), null);
      return sanitizeViewOptions(raw, columns);
    } catch {
      return EMPTY_VIEW_OPTIONS;
    }
  },

  /** Resolves false when neither the server nor localStorage took it. */
  save: async (moduleKey: string, options: ViewOptions): Promise<boolean> => {
    try {
      return await setUserPreference(preferenceKey(moduleKey), options);
    } catch {
      return false;
    }
  },

  reset: async (moduleKey: string): Promise<void> => {
    try {
      await deleteUserPreference(preferenceKey(moduleKey));
    } catch {
      /* Best-effort: the caller has already re-rendered ungrouped. */
    }

    try {
      localStorage.removeItem(`user_pref_${preferenceKey(moduleKey)}`);
    } catch {
      /* Storage unavailable. The server copy is gone, which is the one that matters. */
    }
  },
};
