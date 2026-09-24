/**
 * Reconciles a user's saved table-column preferences with columns added after they were saved.
 *
 * Column visibility and order are persisted per user in localStorage. A saved list was written
 * against whatever columns existed at the time, so any column added afterwards is simply absent
 * from it — and because the table renders `allColumns.filter(c => visibleColumns.includes(...))`,
 * an absent key means the new column never appears for anyone who has used the page before.
 * Only brand-new users would see it.
 *
 * `newKeys` is deliberately the list of RECENTLY ADDED columns, not every column. Hiding a
 * column works by removing it from the saved list, so merging against the full column set would
 * silently re-show everything the user had chosen to hide. Restricting the merge to columns the
 * user has never had the chance to decide about preserves their choices exactly.
 *
 * New keys are appended rather than inserted, so a customised column order stays intact and the
 * new columns land at the end where they can be dragged into place.
 */
export const mergeSavedColumns = (
  saved: unknown,
  newKeys: string[],
  fallback: string[],
  migrationKey?: string
): string[] => {
  if (!Array.isArray(saved)) return [...fallback];

  const savedKeys = saved.filter((k): k is string => typeof k === 'string');

  // The merge must run exactly ONCE per user. A saved list records only the visible columns, so
  // after the first run there is no way to distinguish "this column is new to you" from "you
  // hid this column" — and re-merging every load would resurrect a new column each time the
  // user hid it. The flag marks the introduction as delivered; from then on the saved
  // preference is authoritative.
  if (migrationKey) {
    try {
      if (localStorage.getItem(migrationKey) === 'done') return savedKeys;
    } catch {
      // Storage unavailable (private mode): fall through and merge. Showing a column the user
      // hid is a far smaller failure than never showing a new one.
    }
  }

  const known = new Set(savedKeys);
  const result = [...savedKeys, ...newKeys.filter(k => !known.has(k))];

  if (migrationKey) {
    try {
      localStorage.setItem(migrationKey, 'done');
    } catch {
      // Non-fatal: the merge just runs again next load.
    }
  }

  return result;
};

/**
 * Columns added in the July 2026 billing-attributes change. Listed explicitly so the merge above
 * can tell "new column the user has never seen" apart from "column the user hid on purpose".
 */
export const BILLING_ATTRIBUTE_COLUMN_KEYS = [
  'vatType',
  'generationType',
  'expirationDate',
  'vip'
];
