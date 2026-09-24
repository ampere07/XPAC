/**
 * Concerns that mean the same thing, collapsed to one label.
 *
 * Service orders in production carry both "For Pullout" and "Pullout" for what is
 * one concern, so the filter used to offer two options that each returned half the
 * rows. They are presented — and matched — as a single "For Pullout".
 *
 * Shared between the filter (which builds the option list) and the page (which
 * matches rows against it): if only one side collapsed them, picking the merged
 * option would return nothing.
 */
const CANONICAL_CONCERNS: Record<string, string> = {
  'pullout': 'For Pullout',
  'for pullout': 'For Pullout',
};

/**
 * The label a concern should be shown and filtered under.
 * Anything not aliased is returned trimmed but otherwise untouched.
 */
export const canonicalConcern = (concern?: string | null): string => {
  const raw = String(concern ?? '').trim();
  return CANONICAL_CONCERNS[raw.toLowerCase()] ?? raw;
};

/** Case-insensitive comparison of two concerns, treating aliases as equal. */
export const concernsMatch = (a?: string | null, b?: string | null): boolean =>
  canonicalConcern(a).toLowerCase() === canonicalConcern(b).toLowerCase();

/**
 * Option list with aliased concerns folded together, sorted for display.
 * Keeps the first spelling seen of any concern that is not aliased.
 */
export const dedupeConcerns = (concerns: string[]): string[] => {
  const seen = new Map<string, string>();

  for (const concern of concerns || []) {
    const label = canonicalConcern(concern);
    if (!label) continue;
    const key = label.toLowerCase();
    if (!seen.has(key)) seen.set(key, label);
  }

  return Array.from(seen.values()).sort((a, b) => a.localeCompare(b));
};
