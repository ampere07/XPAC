import { useCallback, useMemo, useState } from 'react';
import { FilterValues, FunnelColumn, applyFunnelFilters, deriveOptionsByKey } from './TableFunnelFilter';

export interface UseFunnelFilterOptions<T> {
  /** localStorage key the selections persist under. Unique per table. */
  storageKey: string;
  /** The table's columns, in the shape TableFunnelFilter expects. */
  columns: FunnelColumn[];
  /** The rows to filter — already narrowed by search/tabs, so counts agree with what is shown. */
  rows: T[];
  /**
   * Resolves a row's value for a column key. Pass one when the table renders a cell from a
   * differently-named field; the default reads the key verbatim.
   */
  getValue?: (row: T, key: string) => any;
}

/**
 * Everything a table needs to adopt {@see TableFunnelFilter}, in one call.
 *
 * Keeps the panel's state, its persistence, the derived checklist options and the filtered rows
 * together, so a page wires a filter in with a few lines rather than reimplementing the predicate.
 * Reimplementing it per page is exactly how the existing filters drifted apart.
 *
 * ```tsx
 * const filter = useFunnelFilter({ storageKey: 'overdueFunnelFilters', columns, rows: searched });
 * // toolbar:  <button onClick={filter.open}>Filter{filter.activeCount ? ` (${filter.activeCount})` : ''}</button>
 * // table:    filter.filteredRows.map(...)
 * // panel:    <TableFunnelFilter {...filter.panelProps} title="Overdue Filters" />
 * ```
 */
export function useFunnelFilter<T>({ storageKey, columns, rows, getValue }: UseFunnelFilterOptions<T>) {
  const [isOpen, setIsOpen] = useState(false);
  const [activeFilters, setActiveFilters] = useState<FilterValues>(() => {
    const saved = localStorage.getItem(storageKey);
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        if (parsed && typeof parsed === 'object') return parsed as FilterValues;
      } catch (err) {
        console.error('Failed to load saved filters:', err);
      }
    }
    return {};
  });

  // Derived from the rows currently loaded, so a checklist column offers the values that are
  // actually present rather than requiring a lookup endpoint of its own.
  const optionsByKey = useMemo(
    () => deriveOptionsByKey(rows, columns, getValue),
    [rows, columns, getValue]
  );

  const filteredRows = useMemo(
    () => applyFunnelFilters(rows, activeFilters, getValue),
    [rows, activeFilters, getValue]
  );

  const apply = useCallback((filters: FilterValues) => {
    setActiveFilters(filters);
    if (Object.keys(filters).length === 0) {
      localStorage.removeItem(storageKey);
    } else {
      localStorage.setItem(storageKey, JSON.stringify(filters));
    }
  }, [storageKey]);

  /** Drops one column's filter — for the removable chips shown under the toolbar. */
  const remove = useCallback((key: string) => {
    setActiveFilters(prev => {
      const next = { ...prev };
      delete next[key];
      if (Object.keys(next).length === 0) {
        localStorage.removeItem(storageKey);
      } else {
        localStorage.setItem(storageKey, JSON.stringify(next));
      }
      return next;
    });
  }, [storageKey]);

  const labelFor = useCallback(
    (key: string) => columns.find(c => c.key === key)?.label || key,
    [columns]
  );

  return {
    isOpen,
    open: () => setIsOpen(true),
    close: () => setIsOpen(false),
    activeFilters,
    activeCount: Object.keys(activeFilters).length,
    filteredRows,
    apply,
    remove,
    labelFor,
    /** Spread straight onto <TableFunnelFilter>; `title` (and any override) is still yours to pass. */
    panelProps: {
      isOpen,
      onClose: () => setIsOpen(false),
      onApplyFilters: apply,
      currentFilters: activeFilters,
      columns,
      storageKey,
      optionsByKey,
    },
  };
}
