import { getUserPreference, setUserPreference, deleteUserPreference } from './userPreferenceService';

/**
 * Per-user status slices for the reconciliation tools' left pane.
 *
 * The four tools each open on a fixed list of statuses in a fixed order wearing fixed
 * colours, decided in code. That is wrong for the way they are actually used: a
 * collections clerk lives in "Confirmed Paid (Unposted)" and never looks at "Expired",
 * while a NOC operator wants the opposite, and both spend their day scrolling past the
 * other's slices. This is the AppSheet answer to that — the operator decides which
 * slices exist on their own screen, in what order, and in what colour.
 *
 * Storage is the existing user-preferences pair, not a new table: `setUserPreference`
 * already writes through to `user_preferences` and mirrors into localStorage, and
 * already falls back to localStorage alone when the server refuses. So a preference
 * survives a new browser, and an operator on a host where the endpoint is unreachable
 * still keeps their layout locally instead of losing it.
 *
 * Nothing here is load-bearing. A slice configuration that cannot be read leaves the
 * screen on the code defaults, which is exactly what it showed before this existed.
 */

/** A slice as the code declares it: the identity, and what it looks like unconfigured. */
export interface SliceDefinition {
  /** Stable identity. Renaming one resets that slice's preferences, by design. */
  id: string;
  label: string;
  /** Default dot colour, as a hex string. */
  color: string;
  /**
   * Slices the operator may not hide.
   *
   * Reserved for a slice whose absence would leave the screen unable to show a row
   * at all. Nothing else is locked — the point of this feature is that the operator
   * decides, and a tool that overrules them on taste has learned nothing.
   */
  locked?: boolean;
}

/** A slice after the operator's preferences have been applied to a definition. */
export interface StatusSlice extends SliceDefinition {
  hidden: boolean;
}

/** What is persisted. Deliberately sparse: only what differs from the definition. */
interface StoredSlicePrefs {
  order: string[];
  hidden: string[];
  colors: Record<string, string>;
}

const PREFERENCE_PREFIX = 'tool_slices.';

const preferenceKey = (moduleKey: string): string => `${PREFERENCE_PREFIX}${moduleKey}`;

/** A `#rrggbb` string, or null. Anything else is discarded rather than rendered. */
const sanitizeColor = (value: unknown): string | null =>
  typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value.trim()) ? value.trim().toLowerCase() : null;

const sanitizePrefs = (raw: unknown): StoredSlicePrefs => {
  const empty: StoredSlicePrefs = { order: [], hidden: [], colors: {} };

  if (!raw || typeof raw !== 'object') return empty;

  const source = raw as Record<string, unknown>;
  const strings = (value: unknown): string[] =>
    Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : [];

  const colors: Record<string, string> = {};
  if (source.colors && typeof source.colors === 'object') {
    Object.entries(source.colors as Record<string, unknown>).forEach(([id, value]) => {
      const color = sanitizeColor(value);
      if (color) colors[id] = color;
    });
  }

  return { order: strings(source.order), hidden: strings(source.hidden), colors };
};

/**
 * Apply stored preferences to the code's current slice definitions.
 *
 * Reconciled on every read against what the code declares now, exactly as the data
 * grid reconciles its column preferences: a stored id the code no longer defines is
 * dropped, and a slice added in a later build is appended visible rather than
 * inheriting "hidden" from a preference that predates it. A stale preference can
 * therefore never hide a slice the operator has never seen, nor resurrect one that
 * no longer exists.
 */
export const applySlicePrefs = (
  definitions: SliceDefinition[],
  prefs: StoredSlicePrefs
): StatusSlice[] => {
  const byId = new Map(definitions.map((definition) => [definition.id, definition]));
  const hidden = new Set(prefs.hidden);
  const ordered: SliceDefinition[] = [];

  prefs.order.forEach((id) => {
    const definition = byId.get(id);
    if (definition && !ordered.includes(definition)) ordered.push(definition);
  });

  definitions.forEach((definition) => {
    if (!ordered.includes(definition)) ordered.push(definition);
  });

  return ordered.map((definition) => ({
    ...definition,
    color: prefs.colors[definition.id] ?? definition.color,
    hidden: definition.locked ? false : hidden.has(definition.id),
  }));
};

/** Reduce a configured list back to the sparse shape that is persisted. */
export const toStoredPrefs = (slices: StatusSlice[], definitions: SliceDefinition[]): StoredSlicePrefs => {
  const defaults = new Map(definitions.map((definition) => [definition.id, definition.color]));
  const colors: Record<string, string> = {};

  slices.forEach((slice) => {
    const fallback = defaults.get(slice.id);
    if (fallback && slice.color.toLowerCase() !== fallback.toLowerCase()) {
      colors[slice.id] = slice.color.toLowerCase();
    }
  });

  return {
    order: slices.map((slice) => slice.id),
    hidden: slices.filter((slice) => slice.hidden && !slice.locked).map((slice) => slice.id),
    colors,
  };
};

export const statusSliceService = {
  /**
   * This operator's slices for one module, already reconciled against the code.
   *
   * Never rejects. A server that is down, a payload someone hand-edited, a browser
   * with storage disabled — all of them resolve to the code defaults, because a
   * screen that will not render because a colour preference failed to load is a worse
   * outcome than a screen that renders in the wrong colour.
   */
  load: async (moduleKey: string, definitions: SliceDefinition[]): Promise<StatusSlice[]> => {
    try {
      const raw = await getUserPreference(preferenceKey(moduleKey), null);
      return applySlicePrefs(definitions, sanitizePrefs(raw));
    } catch {
      return applySlicePrefs(definitions, { order: [], hidden: [], colors: {} });
    }
  },

  /**
   * Persist this operator's slices.
   *
   * Resolves false when neither the server nor localStorage took it, so the caller
   * can say so rather than showing a confirmation for a save that did not happen.
   */
  save: async (moduleKey: string, slices: StatusSlice[], definitions: SliceDefinition[]): Promise<boolean> => {
    try {
      return await setUserPreference(preferenceKey(moduleKey), toStoredPrefs(slices, definitions));
    } catch {
      return false;
    }
  },

  /** Forget this module's configuration and go back to the code defaults. */
  reset: async (moduleKey: string): Promise<void> => {
    try {
      await deleteUserPreference(preferenceKey(moduleKey));
    } catch {
      /* Best-effort: the caller has already re-rendered on the defaults. */
    }

    try {
      localStorage.removeItem(`user_pref_${preferenceKey(moduleKey)}`);
    } catch {
      /* Storage unavailable. The server copy is gone, which is the one that matters. */
    }
  },
};
