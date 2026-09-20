import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ArrowDown, ArrowUp, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, ChevronsUpDown,
} from 'lucide-react';
import type { DataGrid, DataGridColumn } from '../../hooks/useDataGrid';
import type { ColorPalette } from '../../services/settingsColorPaletteService';

/**
 * The grid every reconciliation tool renders its rows through.
 *
 * `useDataGrid` already owns filtering, sorting, paging, selection and column
 * visibility. What it does not own — because they are presentation — are the three
 * things the SYNC list screens have and the tools did not: a sticky header, columns
 * the operator can drag into a different order and drag wider, and the standard
 * pagination footer that reads "Showing X to Y of Z results".
 *
 * Cells stay with the caller. Each tool renders its own badges, diff lines and row
 * actions through `renderCell`, so adopting the shared chrome costs a page nothing in
 * expressiveness — it only stops four screens each inventing a different table.
 *
 * Column widths are per operator per table and live in localStorage, not in the user
 * preference store: a column width is a property of the screen someone is sitting at,
 * and syncing it to a second monitor with a different width would be a regression.
 */

interface ToolDataTableProps<Row> {
  grid: DataGrid<Row>;
  isDarkMode: boolean;
  colorPalette: ColorPalette | null;
  /** Draw one cell. Must return a `<td>`. */
  renderCell: (row: Row, column: DataGridColumn<Row>) => React.ReactNode;
  /** Header cell override — used for the select-all checkbox column. */
  renderHeaderCell?: (column: DataGridColumn<Row>) => React.ReactNode | null;
  rowKey: (row: Row) => string;
  onRowClick?: (row: Row) => void;
  isRowActive?: (row: Row) => boolean;
  emptyMessage?: React.ReactNode;
  loading?: boolean;
  /** localStorage namespace for column widths. Omit to keep them ephemeral. */
  storageKey?: string;
  pageSizeOptions?: number[];
  /** Rendered between the table and the pagination footer. */
  footerNote?: React.ReactNode;
  /**
   * Drive the footer from the server instead of from the grid.
   *
   * Xendit pages server-side — its window can hold tens of thousands of payments and
   * the API caps a page at 200 — so the grid holds one server page at a time and knows
   * nothing about the rest. Without this the footer would confidently report "1 of 1"
   * over a set of 40,000. Everything else about the table is unchanged.
   */
  pagination?: {
    page: number;
    totalPages: number;
    totalRows: number;
    pageSize: number;
    onPageChange: (page: number) => void;
    onPageSizeChange: (size: number) => void;
  };
}

const MIN_COLUMN_WIDTH = 90;

const readWidths = (storageKey: string): Record<string, number> => {
  try {
    const raw = localStorage.getItem(storageKey);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return {};

    const widths: Record<string, number> = {};
    Object.entries(parsed as Record<string, unknown>).forEach(([key, value]) => {
      if (typeof value === 'number' && Number.isFinite(value) && value >= MIN_COLUMN_WIDTH) {
        widths[key] = value;
      }
    });
    return widths;
  } catch {
    // Quota, private mode, or a hand-edited entry. The table renders unsized.
    return {};
  }
};

export function ToolDataTable<Row>({
  grid,
  isDarkMode,
  colorPalette,
  renderCell,
  renderHeaderCell,
  rowKey,
  onRowClick,
  isRowActive,
  emptyMessage = 'No records match the current filters.',
  loading = false,
  storageKey,
  pageSizeOptions = [25, 50, 100, 250, 500],
  footerNote,
  pagination,
}: ToolDataTableProps<Row>) {
  const { visibleColumns, pagedRows } = grid;

  // One source of truth for the footer, whichever end owns the paging.
  const page = pagination?.page ?? grid.page;
  const totalPages = pagination?.totalPages ?? grid.totalPages;
  const pageSize = pagination?.pageSize ?? grid.pageSize;
  const filteredCount = pagination?.totalRows ?? grid.filteredCount;
  const goToPage = pagination?.onPageChange ?? grid.setPage;
  const changePageSize = pagination?.onPageSizeChange ?? grid.setPageSize;

  const accent = colorPalette?.primary || '#7c3aed';

  const [widths, setWidths] = useState<Record<string, number>>(() => (storageKey ? readWidths(storageKey) : {}));
  const [resizing, setResizing] = useState<string | null>(null);
  const [dragged, setDragged] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState<string | null>(null);

  const startX = useRef(0);
  const startWidth = useRef(0);

  useEffect(() => {
    if (!storageKey) return;
    try {
      localStorage.setItem(storageKey, JSON.stringify(widths));
    } catch {
      /* Cosmetic. The table still works, it just will not remember. */
    }
  }, [storageKey, widths]);

  const beginResize = useCallback((event: React.MouseEvent, key: string) => {
    event.preventDefault();
    event.stopPropagation();
    startX.current = event.clientX;
    const th = (event.target as HTMLElement).closest('th');
    startWidth.current = th ? th.offsetWidth : MIN_COLUMN_WIDTH;
    setResizing(key);
  }, []);

  useEffect(() => {
    if (!resizing) return;

    const onMove = (event: MouseEvent) => {
      const next = Math.max(MIN_COLUMN_WIDTH, startWidth.current + (event.clientX - startX.current));
      setWidths((prev) => ({ ...prev, [resizing]: next }));
    };
    const onUp = () => setResizing(null);

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    return () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
  }, [resizing]);

  /**
   * Drop a dragged column onto another.
   *
   * Expressed as repeated single steps through the grid's own `moveColumn` rather
   * than as a splice of a local copy: the grid owns column order and persists it, and
   * a second source of truth here would drift from the column menu the moment either
   * one was used.
   */
  const handleDrop = (targetKey: string) => {
    if (!dragged || dragged === targetKey) {
      setDragged(null);
      setDragOver(null);
      return;
    }

    const order = grid.columns.map((column) => column.key);
    const from = order.indexOf(dragged);
    const to = order.indexOf(targetKey);

    if (from !== -1 && to !== -1) {
      const delta: -1 | 1 = to > from ? 1 : -1;
      for (let step = 0; step < Math.abs(to - from); step += 1) {
        grid.moveColumn(dragged, delta);
      }
    }

    setDragged(null);
    setDragOver(null);
  };

  const from = filteredCount === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, filteredCount);

  const headBg = isDarkMode ? 'bg-gray-800' : 'bg-gray-100';
  const headText = isDarkMode ? 'text-gray-400' : 'text-gray-600';
  const border = isDarkMode ? 'border-gray-700' : 'border-gray-200';
  const bodyBorder = isDarkMode ? 'border-gray-800' : 'border-gray-200';
  const muted = isDarkMode ? 'text-gray-400' : 'text-gray-600';

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <div className="flex-1 overflow-auto">
        <table className="w-max min-w-full text-sm border-separate border-spacing-0">
          <thead>
            <tr className={`sticky top-0 z-10 ${headBg}`}>
              {visibleColumns.map((column, index) => {
                const override = renderHeaderCell?.(column);
                if (override) return <React.Fragment key={column.key}>{override}</React.Fragment>;

                const sortable = column.sortable ?? typeof column.value === 'function';
                const { direction, priority } = grid.sortStateFor(column.key);
                const width = widths[column.key];

                return (
                  <th
                    key={column.key}
                    draggable={!column.locked}
                    onDragStart={() => setDragged(column.key)}
                    onDragOver={(event) => {
                      event.preventDefault();
                      setDragOver(column.key);
                    }}
                    onDragLeave={() => setDragOver((current) => (current === column.key ? null : current))}
                    onDrop={(event) => {
                      event.preventDefault();
                      handleDrop(column.key);
                    }}
                    onDragEnd={() => {
                      setDragged(null);
                      setDragOver(null);
                    }}
                    className={`text-left py-3 px-3 font-normal whitespace-nowrap relative group border-b ${border} ${headBg} ${headText} ${
                      index < visibleColumns.length - 1 ? `border-r ${border}` : ''
                    } ${column.locked ? '' : 'cursor-move'} ${dragged === column.key ? 'opacity-50' : ''}`}
                    style={{
                      width: width ? `${width}px` : undefined,
                      backgroundColor: dragOver === column.key ? `${accent}22` : undefined,
                    }}
                  >
                    <div className="flex items-center justify-between gap-2">
                      {sortable ? (
                        <button
                          type="button"
                          onClick={(event) => grid.toggleSort(column.key, event.shiftKey)}
                          title={`Sort by ${column.label} — shift-click to add a secondary sort`}
                          className="flex items-center gap-1 uppercase tracking-wide text-xs hover:opacity-80"
                        >
                          <span>{column.label}</span>
                          {direction === 'asc' && <ArrowUp className="h-3 w-3" style={{ color: accent }} />}
                          {direction === 'desc' && <ArrowDown className="h-3 w-3" style={{ color: accent }} />}
                          {direction === null && <ChevronsUpDown className="h-3 w-3 opacity-30" />}
                          {priority !== null && (
                            <span className="text-[10px] font-bold leading-none" style={{ color: accent }}>
                              {priority}
                            </span>
                          )}
                        </button>
                      ) : (
                        <span className="uppercase tracking-wide text-xs">{column.label}</span>
                      )}
                    </div>

                    {index < visibleColumns.length - 1 && (
                      <div
                        className="absolute right-0 top-0 bottom-0 w-1 cursor-col-resize hover:bg-cyan-500 group-hover:bg-gray-500/40"
                        onMouseDown={(event) => beginResize(event, column.key)}
                      />
                    )}
                  </th>
                );
              })}
            </tr>
          </thead>

          <tbody>
            {pagedRows.length > 0 ? (
              pagedRows.map((row) => {
                const key = rowKey(row);
                const active = isRowActive?.(row) ?? false;

                return (
                  <tr
                    key={key}
                    onClick={onRowClick ? () => onRowClick(row) : undefined}
                    className={`border-b transition-colors ${bodyBorder} ${
                      onRowClick ? 'cursor-pointer' : ''
                    } ${isDarkMode ? 'hover:bg-gray-800/60' : 'hover:bg-gray-50'} ${
                      active ? (isDarkMode ? 'bg-gray-800' : 'bg-gray-100') : ''
                    }`}
                  >
                    {visibleColumns.map((column) => (
                      <React.Fragment key={column.key}>{renderCell(row, column)}</React.Fragment>
                    ))}
                  </tr>
                );
              })
            ) : (
              <tr>
                <td
                  colSpan={Math.max(1, visibleColumns.length)}
                  className={`px-4 py-12 text-center border-b ${bodyBorder} ${muted}`}
                >
                  {loading ? 'Loading…' : emptyMessage}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {footerNote}

      <div
        className={`border-t p-3 flex flex-col md:flex-row items-center md:justify-between gap-3 flex-shrink-0 ${
          isDarkMode ? 'bg-gray-900 border-gray-700' : 'bg-white border-gray-200'
        }`}
      >
        <div className={`flex flex-col sm:flex-row items-center gap-3 text-sm ${muted}`}>
          <div className="flex items-center gap-2">
            <span className="hidden sm:inline">Show</span>
            <select
              value={pageSize}
              onChange={(event) => changePageSize(Number(event.target.value))}
              className={`px-2 py-1 rounded border focus:outline-none text-xs ${
                isDarkMode ? 'bg-gray-800 border-gray-700 text-white' : 'bg-white border-gray-300 text-gray-900'
              }`}
            >
              {pageSizeOptions.map((size) => (
                <option key={size} value={size}>
                  {size}
                </option>
              ))}
            </select>
            <span className="hidden sm:inline">entries</span>
          </div>
          <div>
            Showing <span className="font-medium">{from.toLocaleString()}</span> to{' '}
            <span className="font-medium">{to.toLocaleString()}</span> of{' '}
            <span className="font-medium">{filteredCount.toLocaleString()}</span> results
          </div>
        </div>

        <div className="flex items-center flex-wrap justify-center gap-1">
          <button
            onClick={() => goToPage(1)}
            disabled={page === 1}
            title="First page"
            className={`p-1 rounded transition-colors disabled:opacity-30 disabled:cursor-not-allowed ${
              isDarkMode ? 'text-white hover:bg-gray-800' : 'text-gray-700 hover:bg-gray-100'
            }`}
          >
            <ChevronsLeft className="h-5 w-5" />
          </button>
          <button
            onClick={() => goToPage(Math.max(1, page - 1))}
            disabled={page === 1}
            title="Previous page"
            className={`p-1 rounded transition-colors disabled:opacity-30 disabled:cursor-not-allowed ${
              isDarkMode ? 'text-white hover:bg-gray-800' : 'text-gray-700 hover:bg-gray-100'
            }`}
          >
            <ChevronLeft className="h-5 w-5" />
          </button>
          <span className={`px-2 text-sm whitespace-nowrap ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>
            {page} / {totalPages || 1}
          </span>
          <button
            onClick={() => goToPage(Math.min(totalPages, page + 1))}
            disabled={page >= totalPages}
            title="Next page"
            className={`p-1 rounded transition-colors disabled:opacity-30 disabled:cursor-not-allowed ${
              isDarkMode ? 'text-white hover:bg-gray-800' : 'text-gray-700 hover:bg-gray-100'
            }`}
          >
            <ChevronRight className="h-5 w-5" />
          </button>
          <button
            onClick={() => goToPage(totalPages)}
            disabled={page >= totalPages}
            title="Last page"
            className={`p-1 rounded transition-colors disabled:opacity-30 disabled:cursor-not-allowed ${
              isDarkMode ? 'text-white hover:bg-gray-800' : 'text-gray-700 hover:bg-gray-100'
            }`}
          >
            <ChevronsRight className="h-5 w-5" />
          </button>
        </div>
      </div>
    </div>
  );
}

export default ToolDataTable;
