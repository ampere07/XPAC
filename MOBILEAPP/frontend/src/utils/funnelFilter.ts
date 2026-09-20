// The funnel-filter matcher, once, for every list screen that has one.
//
// Each funnel filter (Application, Customer, SOA, Invoice, Payment Portal…)
// produces the same shape: a map of column key to { type, value | from/to }. The
// matching rules are identical across screens — only the lookup from a record to
// a column's value differs, so that part is passed in.
//
// Kept behaviourally identical to the copy inlined in pages/PaymentPortal.tsx,
// which is what the ported screens were written against.

export type FunnelFilterEntry = {
  type: 'checklist' | 'text' | 'number' | 'date';
  value?: string | string[];
  from?: string | number;
  to?: string | number;
};

export type FunnelFilters = Record<string, FunnelFilterEntry>;

/**
 * How to read a column's value off a record.
 *
 * Screens keep records in camelCase, snake_case, or a mix of both depending on
 * which service built them, so each caller supplies its own reader rather than
 * this file guessing.
 */
export type FunnelValueReader = (record: any, key: string) => any;

const defaultReader: FunnelValueReader = (record, key) => record?.[key];

/** Location columns are matched against the address too, not just the column. */
const LOCATION_KEYS = ['barangay', 'city', 'region'];

const matchesEntry = (
  record: any,
  key: string,
  filter: FunnelFilterEntry,
  readValue: FunnelValueReader
): boolean => {
  const val = readValue(record, key);

  if (filter.type === 'checklist') {
    if (!filter.value || !Array.isArray(filter.value) || filter.value.length === 0) return true;

    // A record can carry its barangay/city/region only inside the address string,
    // so both are checked before calling it a miss.
    if (LOCATION_KEYS.includes(key)) {
      const direct = String(record?.[key] ?? '').toLowerCase().trim();
      const address = String(record?.address ?? '').toLowerCase();
      return (filter.value as string[]).some(option => {
        const o = option.toLowerCase().trim();
        return direct === o || address.includes(o);
      });
    }

    const valStr = String(val ?? '').toLowerCase().trim();
    return (filter.value as string[]).some(option => valStr === option.toLowerCase().trim());
  }

  if (filter.type === 'text') {
    if (!filter.value) return true;
    return String(val ?? '').toLowerCase().includes(String(filter.value).toLowerCase());
  }

  if (filter.type === 'number') {
    const n = Number(val);
    if (isNaN(n)) return false;
    if (filter.from !== undefined && filter.from !== '' && n < Number(filter.from)) return false;
    if (filter.to !== undefined && filter.to !== '' && n > Number(filter.to)) return false;
    return true;
  }

  if (filter.type === 'date') {
    if (!val) return false;
    const dt = new Date(val).getTime();
    if (isNaN(dt)) return false;
    if (filter.from && dt < new Date(filter.from as string).getTime()) return false;
    if (filter.to) {
      // An inclusive upper bound: a filter "to 05 Aug" has to keep 05 Aug 23:59.
      const toDate = new Date(filter.to as string);
      toDate.setHours(23, 59, 59, 999);
      if (dt > toDate.getTime()) return false;
    }
    return true;
  }

  return true;
};

/** Does this record satisfy every active filter? An empty filter set matches all. */
export const matchesFunnelFilters = (
  record: any,
  filters: FunnelFilters,
  readValue: FunnelValueReader = defaultReader
): boolean => {
  const entries = Object.entries(filters || {});
  if (entries.length === 0) return true;

  return entries.every(([key, filter]) => matchesEntry(record, key, filter as FunnelFilterEntry, readValue));
};

/** Labels for the chip row: the columns that currently narrow the list. */
export const activeFunnelKeys = (filters: FunnelFilters): string[] =>
  Object.entries(filters || {})
    .filter(([, filter]) => {
      const f = filter as FunnelFilterEntry;
      if (f.type === 'checklist') return Array.isArray(f.value) && f.value.length > 0;
      if (f.type === 'text') return !!f.value;
      return (f.from !== undefined && f.from !== '') || (f.to !== undefined && f.to !== '');
    })
    .map(([key]) => key);
