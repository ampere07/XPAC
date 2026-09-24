import React, { useEffect, useRef, useState } from 'react';
import { ArrowDown, ArrowUp, ChevronsUpDown, Columns3, Download, RotateCcw, Search, X } from 'lucide-react';
import type { DataGridColumn, DataGridFilter, SortDirection } from '../hooks/useDataGrid';

/**
 * Presentational pieces for the reconciliation data grids.
 *
 * Pairs with `useDataGrid`, which owns all the state. These render the operator-facing
 * controls in the visual idiom the SmartOLT and MikroTik RADIUS screens already use, so
 * both tables look and behave the same without either page re-implementing them.
 *
 * Theme tokens are derived from `isDarkMode` here rather than passed in, so a caller can
 * never drift the grid's styling away from its neighbours.
 */

const tokens = (isDarkMode: boolean) => ({
  card: isDarkMode ? 'bg-gray-900 border-gray-800' : 'bg-white border-gray-200',
  text: isDarkMode ? 'text-gray-100' : 'text-gray-900',
  muted: isDarkMode ? 'text-gray-400' : 'text-gray-500',
  input: isDarkMode
    ? 'bg-gray-950 border-gray-800 text-gray-100 placeholder-gray-600'
    : 'bg-white border-gray-300 text-gray-900 placeholder-gray-400',
  menu: isDarkMode ? 'bg-gray-900 border-gray-800' : 'bg-white border-gray-200',
  hover: isDarkMode ? 'hover:bg-gray-800/60' : 'hover:bg-gray-50',
});

/** Close a popover on outside click or Escape. */
const useDismiss = (open: boolean, close: () => void) => {
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) close();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close();
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open, close]);

  return ref;
};

// ---- Sortable column header -------------------------------------------------

interface SortableHeaderCellProps {
  label: string;
  sortable: boolean;
  direction: SortDirection | null;
  /** Rank among the active sort rules; null when only one column is sorted. */
  priority: number | null;
  onSort: (additive: boolean) => void;
  align?: 'left' | 'right';
  className?: string;
}

export const SortableHeaderCell: React.FC<SortableHeaderCellProps> = ({
  label,
  sortable,
  direction,
  priority,
  onSort,
  align = 'left',
  className = '',
}) => {
  const alignment = align === 'right' ? 'text-right justify-end' : 'text-left justify-start';

  if (!sortable) {
    return <th className={`px-3 py-2.5 font-semibold ${align === 'right' ? 'text-right' : 'text-left'} ${className}`}>{label}</th>;
  }

  return (
    <th className={`px-3 py-2.5 font-semibold ${align === 'right' ? 'text-right' : 'text-left'} ${className}`}>
      <button
        type="button"
        // Shift-click appends this column to the sort instead of replacing it, which is
        // what makes "group, then username within group" reachable without a UI for it.
        onClick={(event) => onSort(event.shiftKey)}
        title={`Sort by ${label} — shift-click to add as a secondary sort`}
        className={`w-full flex items-center gap-1 uppercase tracking-wide hover:opacity-80 transition-opacity ${alignment}`}
      >
        <span>{label}</span>
        {direction === 'asc' && <ArrowUp className="w-3 h-3 shrink-0 text-cyan-500" />}
        {direction === 'desc' && <ArrowDown className="w-3 h-3 shrink-0 text-cyan-500" />}
        {direction === null && <ChevronsUpDown className="w-3 h-3 shrink-0 opacity-30" />}
        {priority !== null && (
          <span className="text-[10px] font-bold text-cyan-500 leading-none">{priority}</span>
        )}
      </button>
    </th>
  );
};

// ---- Select-all header cell -------------------------------------------------

interface SelectAllHeaderCellProps {
  isDarkMode: boolean;
  /** Every selectable row on this page is ticked. */
  isPageSelected: boolean;
  /** Every selectable row surviving the current filters is ticked. */
  isAllFilteredSelected: boolean;
  selectablePageCount: number;
  selectableFilteredCount: number;
  selectedCount: number;
  onSelectPage: () => void;
  onDeselectPage: () => void;
  onSelectAllFiltered: () => void;
  onClearSelection: () => void;
}

export const SelectAllHeaderCell: React.FC<SelectAllHeaderCellProps> = ({
  isDarkMode,
  isPageSelected,
  isAllFilteredSelected,
  selectablePageCount,
  selectableFilteredCount,
  selectedCount,
  onSelectPage,
  onDeselectPage,
  onSelectAllFiltered,
  onClearSelection,
}) => {
  const t = tokens(isDarkMode);
  const [open, setOpen] = useState(false);
  const ref = useDismiss(open, () => setOpen(false));
  const boxRef = useRef<HTMLInputElement | null>(null);

  // Indeterminate is a DOM property, not an attribute — React cannot set it via JSX.
  useEffect(() => {
    if (boxRef.current) {
      boxRef.current.indeterminate = !isPageSelected && selectedCount > 0;
    }
  }, [isPageSelected, selectedCount]);

  const item = `w-full text-left px-3 py-2 text-xs ${t.text} ${t.hover} disabled:opacity-40 disabled:cursor-not-allowed`;

  return (
    <th className="px-3 py-2.5 w-16">
      <div className="flex items-center gap-1" ref={ref}>
        <input
          ref={boxRef}
          type="checkbox"
          checked={isPageSelected}
          disabled={selectablePageCount === 0}
          onChange={(event) => (event.target.checked ? onSelectPage() : onDeselectPage())}
          title={isPageSelected ? 'Clear this page' : 'Select this page'}
          className="rounded disabled:opacity-30"
        />
        <div className="relative">
          <button
            type="button"
            onClick={() => setOpen((prev) => !prev)}
            title="Selection options"
            className={`p-0.5 rounded ${t.muted} hover:text-cyan-500`}
          >
            <ChevronsUpDown className="w-3 h-3" />
          </button>

          {open && (
            <div className={`absolute left-0 top-full mt-1 z-30 w-56 rounded-lg border shadow-lg overflow-hidden ${t.menu}`}>
              <button
                type="button"
                className={item}
                disabled={selectablePageCount === 0}
                onClick={() => { onSelectPage(); setOpen(false); }}
              >
                Select page ({selectablePageCount})
              </button>
              <button
                type="button"
                className={item}
                disabled={selectableFilteredCount === 0 || isAllFilteredSelected}
                onClick={() => { onSelectAllFiltered(); setOpen(false); }}
              >
                Select all filtered ({selectableFilteredCount})
              </button>
              <button
                type="button"
                className={item}
                disabled={selectedCount === 0}
                onClick={() => { onClearSelection(); setOpen(false); }}
              >
                Clear selection ({selectedCount})
              </button>
            </div>
          )}
        </div>
      </div>
    </th>
  );
};

// ---- Column visibility / ordering menu --------------------------------------

interface ColumnMenuProps<Row> {
  isDarkMode: boolean;
  columns: Array<DataGridColumn<Row>>;
  hiddenKeys: string[];
  onToggle: (key: string) => void;
  onMove: (key: string, delta: -1 | 1) => void;
  onReset: () => void;
}

export function ColumnMenu<Row>({
  isDarkMode,
  columns,
  hiddenKeys,
  onToggle,
  onMove,
  onReset,
}: ColumnMenuProps<Row>) {
  const t = tokens(isDarkMode);
  const [open, setOpen] = useState(false);
  const ref = useDismiss(open, () => setOpen(false));

  // Locked columns (checkbox, row actions) are structural — not offered here.
  const adjustable = columns.filter((column) => !column.locked);
  const hidden = new Set(hiddenKeys);

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        title="Show, hide and reorder columns"
        className={`px-3 py-2 rounded-lg border text-xs font-medium flex items-center gap-1.5 ${t.card} ${t.text} hover:border-cyan-500/50`}
      >
        <Columns3 className="w-3.5 h-3.5" /> Columns
        {hidden.size > 0 && <span className="text-cyan-500 font-bold">({adjustable.length - hidden.size})</span>}
      </button>

      {open && (
        <div className={`absolute right-0 top-full mt-1 z-30 w-72 rounded-lg border shadow-lg ${t.menu}`}>
          <div className={`px-3 py-2 text-[11px] uppercase tracking-wide border-b ${t.muted} ${isDarkMode ? 'border-gray-800' : 'border-gray-200'}`}>
            Columns
          </div>

          <div className="max-h-72 overflow-y-auto py-1">
            {adjustable.map((column, index) => (
              <div key={column.key} className={`flex items-center gap-2 px-3 py-1.5 ${t.hover}`}>
                <input
                  type="checkbox"
                  checked={!hidden.has(column.key)}
                  onChange={() => onToggle(column.key)}
                  className="rounded shrink-0"
                />
                <span className={`flex-1 text-xs truncate ${t.text}`} title={column.label}>
                  {column.label}
                </span>
                <button
                  type="button"
                  onClick={() => onMove(column.key, -1)}
                  disabled={index === 0}
                  title="Move left"
                  className={`p-0.5 rounded ${t.muted} hover:text-cyan-500 disabled:opacity-20 disabled:hover:text-current`}
                >
                  <ArrowUp className="w-3 h-3" />
                </button>
                <button
                  type="button"
                  onClick={() => onMove(column.key, 1)}
                  disabled={index === adjustable.length - 1}
                  title="Move right"
                  className={`p-0.5 rounded ${t.muted} hover:text-cyan-500 disabled:opacity-20 disabled:hover:text-current`}
                >
                  <ArrowDown className="w-3 h-3" />
                </button>
              </div>
            ))}
          </div>

          <button
            type="button"
            onClick={() => { onReset(); setOpen(false); }}
            className={`w-full px-3 py-2 text-xs flex items-center gap-1.5 border-t ${t.muted} ${t.hover} ${isDarkMode ? 'border-gray-800' : 'border-gray-200'}`}
          >
            <RotateCcw className="w-3 h-3" /> Reset to defaults
          </button>
        </div>
      )}
    </div>
  );
}

// ---- Search + dropdown filter bar -------------------------------------------

interface GridFilterBarProps<Row> {
  isDarkMode: boolean;
  search: string;
  onSearch: (value: string) => void;
  placeholder: string;
  filters: Array<DataGridFilter<Row>>;
  filterValues: Record<string, string>;
  onFilterChange: (key: string, value: string) => void;
  hasActiveFilter: boolean;
  onClear: () => void;
  /** Rows surviving the filters, out of the whole dataset — shown when narrowed. */
  filteredCount: number;
  totalRows: number;
  children?: React.ReactNode;
}

export function GridFilterBar<Row>({
  isDarkMode,
  search,
  onSearch,
  placeholder,
  filters,
  filterValues,
  onFilterChange,
  hasActiveFilter,
  onClear,
  filteredCount,
  totalRows,
  children,
}: GridFilterBarProps<Row>) {
  const t = tokens(isDarkMode);

  return (
    <div className="flex flex-col md:flex-row md:items-center gap-3 flex-1">
      <div className="relative flex-1 min-w-[200px]">
        <Search className={`w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 ${t.muted}`} />
        <input
          value={search}
          onChange={(event) => onSearch(event.target.value)}
          placeholder={placeholder}
          className={`w-full pl-9 pr-3 py-2 rounded-lg border text-sm ${t.input}`}
        />
      </div>

      {filters.map((filter) => (
        <select
          key={filter.key}
          value={filterValues[filter.key] ?? ''}
          onChange={(event) => onFilterChange(filter.key, event.target.value)}
          title={filter.label}
          className={`px-3 py-2 rounded-lg border text-sm ${t.input}`}
        >
          <option value="">{filter.label}: All</option>
          {filter.options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      ))}

      {hasActiveFilter && (
        <div className="flex items-center gap-2">
          <span className={`text-xs whitespace-nowrap ${t.muted}`}>
            {filteredCount} of {totalRows}
          </span>
          <button
            type="button"
            onClick={onClear}
            title="Clear search and filters"
            className={`px-2 py-2 rounded-lg border text-xs flex items-center gap-1 ${t.card} ${t.muted} hover:border-cyan-500/50`}
          >
            <X className="w-3 h-3" /> Clear
          </button>
        </div>
      )}

      {children}
    </div>
  );
}

// ---- Selection summary bar --------------------------------------------------

interface SelectionBarProps {
  isDarkMode: boolean;
  selectedCount: number;
  /** Offered when the operator has ticked a page but more rows match the filters. */
  selectableFilteredCount: number;
  isAllFilteredSelected: boolean;
  onSelectAllFiltered: () => void;
  onClearSelection: () => void;
  children?: React.ReactNode;
}

export const SelectionBar: React.FC<SelectionBarProps> = ({
  isDarkMode,
  selectedCount,
  selectableFilteredCount,
  isAllFilteredSelected,
  onSelectAllFiltered,
  onClearSelection,
  children,
}) => {
  const t = tokens(isDarkMode);
  if (selectedCount === 0) return null;

  return (
    <div className="rounded-xl border border-indigo-500/40 bg-indigo-500/10 p-3 mb-4 flex flex-wrap items-center gap-2">
      <span className={`text-sm font-medium ${t.text}`}>{selectedCount} selected</span>

      {!isAllFilteredSelected && selectableFilteredCount > selectedCount && (
        <button
          type="button"
          onClick={onSelectAllFiltered}
          className="text-xs font-medium text-cyan-500 hover:underline"
        >
          Select all {selectableFilteredCount} filtered
        </button>
      )}

      <div className="flex-1" />
      {children}

      <button
        type="button"
        onClick={onClearSelection}
        className={`px-3 py-1.5 rounded-lg border text-xs font-medium ${t.card} ${t.muted}`}
      >
        Clear
      </button>
    </div>
  );
};


// ---- Rows per page ----------------------------------------------------------

interface PageSizeSelectorProps {
  isDarkMode: boolean;
  pageSize: number;
  onPageSizeChange: (size: number) => void;
  /** Rows surviving the filters — what the choice is actually paging through. */
  filteredCount: number;
  options?: number[];
}

/**
 * How many rows a page holds.
 *
 * The sizes span two real working styles: 25 for triaging a handful of exceptions,
 * 500 for reading a whole estate in one scroll. The hook resets to page 1 on change,
 * so a resize can never strand the viewer past the end of the table.
 */
export const PageSizeSelector: React.FC<PageSizeSelectorProps> = ({
  isDarkMode,
  pageSize,
  onPageSizeChange,
  filteredCount,
  options = [25, 50, 100, 250, 500],
}) => {
  const t = tokens(isDarkMode);

  return (
    <div className="flex items-center gap-2">
      <label className={`text-xs whitespace-nowrap ${t.muted}`} htmlFor="grid-page-size">
        Rows
      </label>
      <select
        id="grid-page-size"
        value={pageSize}
        onChange={(event) => onPageSizeChange(Number(event.target.value))}
        className={`px-2 py-1.5 rounded-lg border text-xs font-medium ${t.input}`}
      >
        {options.map((size) => (
          <option key={size} value={size}>
            {size}
          </option>
        ))}
      </select>
      <span className={`text-xs whitespace-nowrap ${t.muted}`}>of {filteredCount.toLocaleString()}</span>
    </div>
  );
};

// ---- Export -----------------------------------------------------------------

interface ExportButtonProps {
  isDarkMode: boolean;
  onExport: () => void;
  /** Rows the export will actually write, for the label. */
  rowCount: number;
  /** True when a selection is what gets written rather than the filtered set. */
  isSelection?: boolean;
  disabled?: boolean;
  label?: string;
}

/**
 * Download the current view as CSV.
 *
 * The label names what will be written — the selection when there is one, otherwise
 * the filtered set — because "Export" over a narrowed table is ambiguous in exactly
 * the way that produces a wrong file and a confused operator.
 */
export const ExportButton: React.FC<ExportButtonProps> = ({
  isDarkMode,
  onExport,
  rowCount,
  isSelection = false,
  disabled = false,
  label = 'Export CSV',
}) => {
  const t = tokens(isDarkMode);
  const inert = disabled || rowCount === 0;

  return (
    <button
      type="button"
      onClick={onExport}
      disabled={inert}
      title={
        inert
          ? 'Nothing to export.'
          : `${label} — ${rowCount.toLocaleString()} ${isSelection ? 'selected' : 'filtered'} row(s).`
      }
      className={`flex items-center gap-2 px-3 py-2 rounded-lg border text-xs font-medium transition-colors ${t.card} ${t.text} ${
        inert ? 'opacity-50 cursor-not-allowed' : t.hover
      }`}
    >
      <Download className="w-4 h-4" />
      <span className="hidden sm:inline">{label}</span>
      {rowCount > 0 && (
        <span className={`text-[11px] ${t.muted}`}>({rowCount.toLocaleString()})</span>
      )}
    </button>
  );
};
