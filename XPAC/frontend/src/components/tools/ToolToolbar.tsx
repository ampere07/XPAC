import React, { useRef, useState } from 'react';
import { Columns3, Download, Filter, Menu, RefreshCw, Table } from 'lucide-react';
import GlobalSearch from '../../pages/globalfunctions/GlobalSearch';
import DropdownPortal from '../common/DropdownPortal';
import type { ColorPalette } from '../../services/settingsColorPaletteService';
import type { DataGridColumn } from '../../hooks/useDataGrid';

/**
 * The toolbar that sits above every reconciliation tool's grid.
 *
 * Same six controls, in the same order, as Service Orders and its neighbours: search,
 * funnel filter, column visibility, display mode, export, refresh. The order is not
 * arbitrary and is not a preference — it is muscle memory across eight screens, and a
 * tool that puts Refresh where Export lives costs an operator a mis-click a day.
 *
 * Column visibility is wired straight through to `useDataGrid`, so the menu here and
 * the grid below can never disagree about which columns exist.
 */

export type ToolDisplayMode = 'table' | 'card';

interface ToolToolbarProps<Row> {
  isDarkMode: boolean;
  colorPalette: ColorPalette | null;

  searchQuery: string;
  onSearch: (value: string) => void;
  searchPlaceholder?: string;

  /** Funnel filter. Omit `onOpenFilter` to leave the icon out entirely. */
  onOpenFilter?: () => void;
  activeFilterCount?: number;

  /** Column menu. Driven by the grid, so it lists exactly what the grid renders. */
  columns: Array<DataGridColumn<Row>>;
  hiddenKeys: string[];
  onToggleColumn: (key: string) => void;
  onResetColumns: () => void;

  displayMode?: ToolDisplayMode;
  onDisplayModeChange?: (mode: ToolDisplayMode) => void;

  onExport: () => void;
  exportDisabled?: boolean;

  onRefresh: () => void;
  refreshing?: boolean;
  refreshDisabled?: boolean;
  refreshTitle?: string;
  /** Pulses the refresh button when the server has something newer than the screen. */
  hasNewData?: boolean;

  /** Mobile only: return to the status sidebar. */
  onBackToSidebar?: () => void;
  /** Tool-specific buttons, rendered between the search box and the icon cluster. */
  children?: React.ReactNode;
}

export function ToolToolbar<Row>({
  isDarkMode,
  colorPalette,
  searchQuery,
  onSearch,
  searchPlaceholder = 'Search records...',
  onOpenFilter,
  activeFilterCount = 0,
  columns,
  hiddenKeys,
  onToggleColumn,
  onResetColumns,
  displayMode = 'table',
  onDisplayModeChange,
  onExport,
  exportDisabled = false,
  onRefresh,
  refreshing = false,
  refreshDisabled = false,
  refreshTitle,
  hasNewData = false,
  onBackToSidebar,
  children,
}: ToolToolbarProps<Row>) {
  const [columnsOpen, setColumnsOpen] = useState(false);
  const [modeOpen, setModeOpen] = useState(false);

  // Anchors for the portalled menus. The toolbar row is `overflow-x-auto` so the
  // buttons can scroll sideways on a narrow window, which also makes it a clipping
  // box: an absolutely positioned menu inside it is cut off at the toolbar edge.
  // Both menus render into document.body and measure their position from these.
  const columnsRef = useRef<HTMLButtonElement | null>(null);
  const modeRef = useRef<HTMLButtonElement | null>(null);

  const accent = colorPalette?.primary || '#7c3aed';
  const hidden = new Set(hiddenKeys);
  const adjustable = columns.filter((column) => !column.locked);

  const iconButton = `flex-shrink-0 px-3 py-2 rounded text-sm transition-colors flex items-center ${
    isDarkMode ? 'hover:bg-gray-800 text-white' : 'hover:bg-gray-100 text-gray-900'
  }`;

  const menu = isDarkMode ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-300';

  /** Export and Refresh are outlined in the palette accent, as on every list screen. */
  const accentButton: React.CSSProperties = {
    backgroundColor: isDarkMode ? 'transparent' : '#ffffff',
    borderColor: accent,
    color: accent,
  };

  return (
    <div
      className={`p-4 border-b flex-shrink-0 ${
        isDarkMode ? 'bg-gray-900 border-gray-700' : 'bg-white border-gray-200'
      }`}
    >
      <div className="flex items-center justify-between gap-3 overflow-x-auto scrollbar-none pb-1 -mb-1 w-full">
        <div className="flex items-center gap-3 flex-1 min-w-[220px]">
          {onBackToSidebar && (
            <button
              onClick={onBackToSidebar}
              title="Back to filters"
              className={`md:hidden p-2 rounded-lg border transition-colors flex items-center justify-center flex-shrink-0 ${
                isDarkMode
                  ? 'bg-gray-800 border-gray-700 text-gray-300 hover:bg-gray-700'
                  : 'bg-white border-gray-300 text-gray-700 hover:bg-gray-50'
              }`}
            >
              <Menu className="h-5 w-5" />
            </button>
          )}
          <div className="flex-1 w-full">
            <GlobalSearch
              searchQuery={searchQuery}
              setSearchQuery={onSearch}
              isDarkMode={isDarkMode}
              colorPalette={colorPalette}
              placeholder={searchPlaceholder}
            />
          </div>
        </div>

        {children}

        <div className="flex items-center gap-1 flex-shrink-0">
          {onOpenFilter && (
            <button
              onClick={onOpenFilter}
              title={activeFilterCount > 0 ? `${activeFilterCount} column filter(s) active` : 'Filter columns'}
              className={
                activeFilterCount > 0
                  ? 'flex-shrink-0 px-3 py-2 rounded text-sm transition-colors flex items-center text-red-500 hover:bg-red-500/10'
                  : iconButton
              }
            >
              <Filter className="h-5 w-5" />
            </button>
          )}

          {displayMode === 'table' && (
            <div className="flex-shrink-0">
              <button
                ref={columnsRef}
                onClick={() => setColumnsOpen((open) => !open)}
                title="Column visibility"
                className={iconButton}
              >
                <Columns3 className="h-5 w-5" />
                {hidden.size > 0 && (
                  <span className="ml-1 text-[10px] font-bold" style={{ color: accent }}>
                    {adjustable.length - hidden.size}
                  </span>
                )}
              </button>

              <DropdownPortal
                anchorRef={columnsRef}
                open={columnsOpen}
                onClose={() => setColumnsOpen(false)}
                align="right"
                width={288}
                className={`border rounded shadow-lg flex flex-col ${menu}`}
              >
                <div
                  className={`p-3 border-b flex items-center justify-between shrink-0 ${
                    isDarkMode ? 'border-gray-700' : 'border-gray-200'
                  }`}
                >
                  <span className={`text-sm font-medium ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>
                    Column Visibility
                  </span>
                  <button onClick={onResetColumns} className="text-xs" style={{ color: accent }}>
                    Reset
                  </button>
                </div>
                <div className="overflow-y-auto flex-1">
                  {adjustable.map((column) => (
                    <label
                      key={column.key}
                      className={`flex items-center px-4 py-2 cursor-pointer text-sm ${
                        isDarkMode ? 'hover:bg-gray-700 text-white' : 'hover:bg-gray-100 text-gray-900'
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={!hidden.has(column.key)}
                        onChange={() => onToggleColumn(column.key)}
                        className="mr-3 h-4 w-4 rounded"
                      />
                      <span className="truncate">{column.label}</span>
                    </label>
                  ))}
                </div>
              </DropdownPortal>
            </div>
          )}

          {onDisplayModeChange && (
            <div className="flex-shrink-0">
              <button
                ref={modeRef}
                onClick={() => setModeOpen((open) => !open)}
                title="Display mode"
                className={`${iconButton} gap-1.5`}
              >
                <Table className="h-5 w-5" />
                <span className="hidden sm:inline text-xs">{displayMode === 'card' ? 'Card' : 'Table'}</span>
              </button>
              <DropdownPortal
                anchorRef={modeRef}
                open={modeOpen}
                onClose={() => setModeOpen(false)}
                align="right"
                width={144}
                className={`border rounded shadow-lg overflow-hidden ${menu}`}
              >
                {(['table', 'card'] as ToolDisplayMode[]).map((mode) => (
                  <button
                    key={mode}
                    onClick={() => {
                      onDisplayModeChange(mode);
                      setModeOpen(false);
                    }}
                    className={`block w-full text-left px-4 py-2 text-sm transition-colors ${
                      isDarkMode ? 'hover:bg-gray-700' : 'hover:bg-gray-100'
                    }`}
                    style={displayMode === mode ? { color: accent } : { color: isDarkMode ? '#ffffff' : '#111827' }}
                  >
                    {mode === 'table' ? 'Table View' : 'Card View'}
                  </button>
                ))}
              </DropdownPortal>
            </div>
          )}

          <button
            onClick={onExport}
            disabled={exportDisabled}
            title="Export the current view to CSV"
            className="relative flex-shrink-0 p-2 rounded-lg transition-colors flex items-center justify-center shadow-sm disabled:opacity-40 disabled:cursor-not-allowed border"
            style={accentButton}
          >
            <Download className="h-5 w-5" />
          </button>

          <button
            onClick={onRefresh}
            disabled={refreshDisabled || refreshing}
            title={refreshTitle ?? 'Refresh'}
            className="relative flex-shrink-0 p-2 rounded-lg transition-colors flex items-center justify-center shadow-sm disabled:opacity-40 disabled:cursor-not-allowed border"
            style={accentButton}
          >
            <RefreshCw className={`h-5 w-5 ${refreshing ? 'animate-spin' : ''}`} />
            {hasNewData && (
              <span className="absolute -top-1 -right-1 flex h-3 w-3">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75" />
                <span className="relative inline-flex rounded-full h-3 w-3 bg-red-500" />
              </span>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

export default ToolToolbar;
