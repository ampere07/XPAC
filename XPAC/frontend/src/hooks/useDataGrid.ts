import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

/**
 * Headless data-grid state for the reconciliation tools.
 *
 * The SmartOLT and MikroTik RADIUS screens both render large, operator-driven tables
 * over the same idiom — search, narrow, sort, tick rows, act in bulk — so the behaviour
 * lives here once instead of twice. It is deliberately headless: it owns no markup, so
 * each page keeps its own columns and cell rendering while the mechanics stay identical.
 *
 * Nothing here talks to the network. It derives entirely from the rows it is handed, so
 * a caller can swap datasets (tab change, re-sync) without any teardown beyond passing a
 * new array.
 */

export type SortDirection = 'asc' | 'desc';

export interface SortRule {
  key: string;
  direction: SortDirection;
}

/** A value a column can be searched and sorted on. `null` sorts last in both directions. */
export type CellValue = string | number | null | undefined;

export interface DataGridColumn<Row> {
  /** Stable identity — used for persistence, so renaming one resets that column's prefs. */
  key: string;
  label: string;
  /**
   * The comparable/searchable value behind the column. Omit for presentational columns
   * (checkbox, row actions) — they are then neither sortable nor searched.
   */
  value?: (row: Row) => CellValue;
  /** Defaults to true when `value` is supplied. */
  sortable?: boolean;
  /** Defaults to true when `value` is supplied. */
  searchable?: boolean;
  /** Locked columns cannot be hidden or reordered — the checkbox and action columns. */
  locked?: boolean;
  /** Start hidden; the operator can still enable it from the column menu. */
  defaultHidden?: boolean;
}

export interface DataGridFilter<Row> {
  key: string;
  label: string;
  options: Array<{ value: string; label: string }>;
  /** Called only when a non-empty value is picked; empty string means "no filter". */
  predicate: (row: Row, value: string) => boolean;
}

export interface UseDataGridOptions<Row> {
  rows: Row[];
  columns: Array<DataGridColumn<Row>>;
  rowKey: (row: Row) => string;
  /**
   * Rows failing this are never selectable — the header checkbox skips them and their
   * own box renders disabled. Used where an action cannot legally apply to a row.
   */
  isSelectable?: (row: Row) => boolean;
  filters?: Array<DataGridFilter<Row>>;
  initialSort?: SortRule[];
  pageSize?: number;
  /**
   * localStorage namespace for column visibility and order. Omit to keep the grid
   * ephemeral. Persistence is best-effort: a malformed or stale entry is discarded
   * rather than allowed to break the table.
   */
  storageKey?: string;
}

interface ColumnPrefs {
  order: string[];
  hidden: string[];
}

const readPrefs = (storageKey: string): ColumnPrefs | null => {
  try {
    const raw = localStorage.getItem(storageKey);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    const order = Array.isArray(parsed.order) ? parsed.order.filter((k: unknown) => typeof k === 'string') : [];
    const hidden = Array.isArray(parsed.hidden) ? parsed.hidden.filter((k: unknown) => typeof k === 'string') : [];
    return { order, hidden };
  } catch {
    // Quota, private mode, or hand-edited junk. Fall back to the column defaults.
    return null;
  }
};

const compareValues = (a: CellValue, b: CellValue): number => {
  const aEmpty = a === null || a === undefined || a === '';
  const bEmpty = b === null || b === undefined || b === '';
  // Blanks sort last regardless of direction — an operator scanning for a value never
  // wants a page of dashes at the top.
  if (aEmpty && bEmpty) return 0;
  if (aEmpty) return 1;
  if (bEmpty) return -1;

  if (typeof a === 'number' && typeof b === 'number') return a - b;

  const aStr = String(a);
  const bStr = String(b);
  // `numeric` so account numbers and ONU indexes order 2 < 10, not "10" < "2".
  return aStr.localeCompare(bStr, undefined, { numeric: true, sensitivity: 'base' });
};

export function useDataGrid<Row>(options: UseDataGridOptions<Row>) {
  const {
    rows,
    columns,
    rowKey,
    isSelectable,
    filters = [],
    initialSort = [],
    pageSize: initialPageSize = 100,
    storageKey,
  } = options;

  const [search, setSearchRaw] = useState('');
  const [filterValues, setFilterValues] = useState<Record<string, string>>({});
  const [sort, setSort] = useState<SortRule[]>(initialSort);
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  // Adjustable from the toolbar. `pageSize` was a fixed option; operators working a
  // few thousand ONUs want 500 on screen, and someone triaging a handful wants 25.
  const [pageSize, setPageSizeRaw] = useState(initialPageSize);

  const columnKeys = useMemo(() => columns.map((c) => c.key), [columns]);
  const defaultHidden = useMemo(
    () => columns.filter((c) => c.defaultHidden && !c.locked).map((c) => c.key),
    [columns]
  );

  const [prefs, setPrefs] = useState<ColumnPrefs>(() => {
    const stored = storageKey ? readPrefs(storageKey) : null;
    return stored ?? { order: [], hidden: defaultHidden };
  });

  /**
   * Adopt the stored prefs when the namespace changes.
   *
   * A caller that swaps `storageKey` — the SmartOLT screen does, one namespace per tab —
   * would otherwise keep the first key's prefs for the whole session, because the state
   * initialiser only runs on mount. Guarded by a ref so this fires on an actual change
   * and never fights the write-back effect below.
   */
  const loadedKey = useRef<string | undefined>(storageKey);
  useEffect(() => {
    if (loadedKey.current === storageKey) return;
    loadedKey.current = storageKey;
    const stored = storageKey ? readPrefs(storageKey) : null;
    setPrefs(stored ?? { order: [], hidden: defaultHidden });
  }, [storageKey, defaultHidden]);

  // Persist column prefs. Failure here is cosmetic, never fatal to the table.
  useEffect(() => {
    // Skip while the key is mid-swap: `prefs` still belongs to the previous namespace
    // and writing it here would stamp it onto the new one.
    if (!storageKey || loadedKey.current !== storageKey) return;
    try {
      localStorage.setItem(storageKey, JSON.stringify(prefs));
    } catch {
      /* storage unavailable — the grid still works, it just won't remember. */
    }
  }, [storageKey, prefs]);

  /**
   * Columns in operator order, reconciled against the code's current column set on every
   * render: keys that no longer exist are dropped and newly added ones are appended, so a
   * stored preference from an older build can never hide or duplicate a column.
   */
  const orderedColumns = useMemo(() => {
    const byKey = new Map(columns.map((c) => [c.key, c]));
    const result: Array<DataGridColumn<Row>> = [];
    prefs.order.forEach((key) => {
      const column = byKey.get(key);
      if (column && !result.includes(column)) result.push(column);
    });
    columns.forEach((column) => {
      if (!result.includes(column)) result.push(column);
    });
    return result;
  }, [columns, prefs.order]);

  const hiddenSet = useMemo(() => new Set(prefs.hidden), [prefs.hidden]);

  const visibleColumns = useMemo(
    () => orderedColumns.filter((c) => c.locked || !hiddenSet.has(c.key)),
    [orderedColumns, hiddenSet]
  );

  const toggleColumn = useCallback((key: string) => {
    setPrefs((prev) => {
      const hidden = new Set(prev.hidden);
      if (hidden.has(key)) hidden.delete(key);
      else hidden.add(key);
      return { ...prev, hidden: Array.from(hidden) };
    });
  }, []);

  /** Move a column one slot left (-1) or right (+1) among the reorderable columns. */
  const moveColumn = useCallback(
    (key: string, delta: -1 | 1) => {
      setPrefs((prev) => {
        const current = prev.order.length > 0
          ? orderedColumns.map((c) => c.key)
          : columnKeys.slice();
        const from = current.indexOf(key);
        const to = from + delta;
        if (from === -1 || to < 0 || to >= current.length) return prev;
        const next = current.slice();
        const [moved] = next.splice(from, 1);
        next.splice(to, 0, moved);
        return { ...prev, order: next };
      });
    },
    [orderedColumns, columnKeys]
  );

  const resetColumns = useCallback(() => {
    setPrefs({ order: [], hidden: defaultHidden });
  }, [defaultHidden]);

  const setSearch = useCallback((next: string) => {
    setSearchRaw(next);
    setPage(1);
  }, []);

  const setFilterValue = useCallback((key: string, value: string) => {
    setFilterValues((prev) => ({ ...prev, [key]: value }));
    setPage(1);
  }, []);

  const clearFilters = useCallback(() => {
    setSearchRaw('');
    setFilterValues({});
    setPage(1);
  }, []);

  /**
   * Sorting. A plain click cycles the column asc → desc → unsorted. An additive click
   * (shift, or the caller passing `additive`) appends the column instead of replacing
   * the sort, which is what makes "group, then username within group" possible.
   */
  const toggleSort = useCallback((key: string, additive = false) => {
    setSort((prev) => {
      const existing = prev.find((rule) => rule.key === key);

      if (!additive) {
        if (!existing) return [{ key, direction: 'asc' }];
        if (existing.direction === 'asc') return [{ key, direction: 'desc' }];
        return [];
      }

      if (!existing) return [...prev, { key, direction: 'asc' }];
      if (existing.direction === 'asc') {
        return prev.map((rule) => (rule.key === key ? { key, direction: 'desc' as SortDirection } : rule));
      }
      return prev.filter((rule) => rule.key !== key);
    });
    setPage(1);
  }, []);

  const clearSort = useCallback(() => setSort([]), []);

  const sortStateFor = useCallback(
    (key: string): { direction: SortDirection | null; priority: number | null } => {
      const index = sort.findIndex((rule) => rule.key === key);
      if (index === -1) return { direction: null, priority: null };
      // Priority is only worth showing once more than one column is in play.
      return { direction: sort[index].direction, priority: sort.length > 1 ? index + 1 : null };
    },
    [sort]
  );

  // ---- Derivation: filter → sort → page ----------------------------------

  const searchableColumns = useMemo(
    () => columns.filter((c) => c.value && c.searchable !== false),
    [columns]
  );

  const valueGetters = useMemo(() => {
    const map = new Map<string, (row: Row) => CellValue>();
    columns.forEach((column) => {
      if (column.value) map.set(column.key, column.value);
    });
    return map;
  }, [columns]);

  const filteredRows = useMemo(() => {
    const needle = search.trim().toLowerCase();
    const activeFilters = filters.filter((f) => (filterValues[f.key] ?? '') !== '');

    if (needle === '' && activeFilters.length === 0) return rows;

    return rows.filter((row) => {
      for (const filter of activeFilters) {
        if (!filter.predicate(row, filterValues[filter.key])) return false;
      }
      if (needle === '') return true;
      return searchableColumns.some((column) => {
        const value = column.value!(row);
        if (value === null || value === undefined) return false;
        return String(value).toLowerCase().includes(needle);
      });
    });
  }, [rows, search, filters, filterValues, searchableColumns]);

  const sortedRows = useMemo(() => {
    if (sort.length === 0) return filteredRows;
    // Copy first — the caller's array (often straight off state) must not be mutated.
    return filteredRows.slice().sort((a, b) => {
      for (const rule of sort) {
        const getter = valueGetters.get(rule.key);
        if (!getter) continue;
        const result = compareValues(getter(a), getter(b));
        if (result !== 0) return rule.direction === 'asc' ? result : -result;
      }
      return 0;
    });
  }, [filteredRows, sort, valueGetters]);

  const totalPages = Math.max(1, Math.ceil(sortedRows.length / pageSize));

  /**
   * Resize the page, and go back to the first one.
   *
   * Holding the page number across a resize is meaningless — page 7 of 25-row pages
   * and page 7 of 500-row pages show different records — and on a shrink it can land
   * past the end. Returning to page 1 is the only answer that is right either way.
   */
  const setPageSize = useCallback((size: number) => {
    setPageSizeRaw(Math.max(1, Math.floor(size)));
    setPage(1);
  }, []);

  // Narrowing the set can strand the viewer past the end; pull them back to the last page.
  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [page, totalPages]);

  const pagedRows = useMemo(
    () => sortedRows.slice((page - 1) * pageSize, page * pageSize),
    [sortedRows, page, pageSize]
  );

  // ---- Selection ---------------------------------------------------------

  const selectableOf = useCallback(
    (candidates: Row[]) => (isSelectable ? candidates.filter(isSelectable) : candidates),
    [isSelectable]
  );

  const selectablePageRows = useMemo(() => selectableOf(pagedRows), [selectableOf, pagedRows]);
  const selectableFilteredRows = useMemo(() => selectableOf(sortedRows), [selectableOf, sortedRows]);

  const isPageSelected =
    selectablePageRows.length > 0 && selectablePageRows.every((row) => selected.has(rowKey(row)));

  const isAllFilteredSelected =
    selectableFilteredRows.length > 0 && selectableFilteredRows.every((row) => selected.has(rowKey(row)));

  const toggleRow = useCallback(
    (key: string, checked: boolean) => {
      setSelected((prev) => {
        const next = new Set(prev);
        if (checked) next.add(key);
        else next.delete(key);
        return next;
      });
    },
    []
  );

  const selectPage = useCallback(() => {
    setSelected((prev) => {
      const next = new Set(prev);
      selectablePageRows.forEach((row) => next.add(rowKey(row)));
      return next;
    });
  }, [selectablePageRows, rowKey]);

  const deselectPage = useCallback(() => {
    setSelected((prev) => {
      const next = new Set(prev);
      selectablePageRows.forEach((row) => next.delete(rowKey(row)));
      return next;
    });
  }, [selectablePageRows, rowKey]);

  /** Every row surviving the current search and filters — not just the visible page. */
  const selectAllFiltered = useCallback(() => {
    setSelected((prev) => {
      const next = new Set(prev);
      selectableFilteredRows.forEach((row) => next.add(rowKey(row)));
      return next;
    });
  }, [selectableFilteredRows, rowKey]);

  const clearSelection = useCallback(() => setSelected(new Set()), []);

  /**
   * Selected rows, resolved against the *whole* dataset rather than the filtered view, so
   * narrowing the search after ticking rows does not silently drop them from a batch.
   */
  const selectedRows = useMemo(
    () => rows.filter((row) => selected.has(rowKey(row))),
    [rows, selected, rowKey]
  );

  const hasActiveFilter = search.trim() !== '' || filters.some((f) => (filterValues[f.key] ?? '') !== '');

  /**
   * Export the current view as CSV.
   *
   * Deliberately the *filtered and sorted* rows through the *visible* columns, not
   * the raw dataset: what lands in the file is what the operator sees, so a narrowed
   * table exports the narrowed result rather than silently dumping everything. When
   * rows are selected, only those are written — selection reads as intent.
   *
   * Values come from the same `value()` getters the grid sorts and searches on, so a
   * column can never export something different from what it displays.
   */
  const toCsv = useCallback(
    (filename: string) => {
      const exportable = visibleColumns.filter((c) => typeof c.value === 'function');
      const source = selected.size > 0 ? selectedRows : sortedRows;

      // Excel reads a leading `=`, `+`, `-` or `@` as a formula; the apostrophe keeps
      // an ONU name or a reference number as text.
      const cell = (raw: CellValue): string => {
        const value = raw === null || raw === undefined ? '' : String(raw);
        const safe = /^[=+\-@]/.test(value) ? `'${value}` : value;
        return `"${safe.replace(/"/g, '""')}"`;
      };

      const lines = [
        exportable.map((c) => cell(c.label)).join(','),
        ...source.map((row) => exportable.map((c) => cell(c.value!(row))).join(',')),
      ];

      // BOM so Excel opens UTF-8 subscriber names correctly rather than as mojibake.
      const blob = new Blob(['\uFEFF' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');

      anchor.href = url;
      anchor.download = filename.endsWith('.csv') ? filename : `${filename}.csv`;
      document.body.appendChild(anchor);
      anchor.click();
      document.body.removeChild(anchor);

      // Released on the next tick; revoking synchronously can cancel the download.
      setTimeout(() => URL.revokeObjectURL(url), 0);
    },
    [visibleColumns, sortedRows, selectedRows, selected]
  );

  return {
    // query state
    search,
    setSearch,
    filterValues,
    setFilterValue,
    clearFilters,
    hasActiveFilter,

    // sorting
    sort,
    toggleSort,
    clearSort,
    sortStateFor,

    // columns
    columns: orderedColumns,
    visibleColumns,
    hiddenKeys: prefs.hidden,
    toggleColumn,
    moveColumn,
    resetColumns,

    // rows
    filteredRows: sortedRows,
    pagedRows,
    totalRows: rows.length,
    filteredCount: sortedRows.length,

    // paging
    page,
    setPage,
    totalPages,
    pageSize,
    setPageSize,

    // export
    toCsv,

    // selection
    selected,
    setSelected,
    selectedRows,
    selectedCount: selected.size,
    isPageSelected,
    isAllFilteredSelected,
    selectablePageCount: selectablePageRows.length,
    selectableFilteredCount: selectableFilteredRows.length,
    toggleRow,
    selectPage,
    deselectPage,
    selectAllFiltered,
    clearSelection,
  };
}

export type DataGrid<Row> = ReturnType<typeof useDataGrid<Row>>;
