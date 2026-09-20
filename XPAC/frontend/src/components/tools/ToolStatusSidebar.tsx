import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronDown, ChevronRight, Layers, SlidersHorizontal } from 'lucide-react';
import GroupTree from './GroupTree';
import type { GroupNode } from '../../utils/groupTree';
import type { StatusSlice } from '../../services/statusSliceService';
import type { ColorPalette } from '../../services/settingsColorPaletteService';

/**
 * The status-filter sidebar every reconciliation tool opens with.
 *
 * Deliberately the same component, the same markup and the same interaction as the
 * pane on Service Orders, Job Orders, Applications and Transactions: an operator who
 * has learned one SYNC list screen has learned all of them, and four tools that each
 * invented their own left rail was the single biggest reason these felt bolted on.
 *
 * What it adds over the originals is that the slice list is not fixed in code — it is
 * whatever the operator configured, in their order, in their colors. The footer
 * button is how they get there.
 */

/** A slice with the count the parent computed for it, and any children to drill into. */
export interface SidebarSlice extends StatusSlice {
  count: number;
  /** Second-level rows, revealed by the chevron. Omit for a flat list. */
  children?: Array<{ id: string; label: string; count: number }>;
}

interface ToolStatusSidebarProps {
  title: string;
  isDarkMode: boolean;
  colorPalette: ColorPalette | null;
  /** Label for the "everything" row, e.g. "All ONUs". */
  allLabel: string;
  allCount: number;
  slices: SidebarSlice[];
  selectedId: string;
  onSelect: (id: string) => void;
  onConfigure: () => void;
  /** Mobile: the pane and the list occupy the same space, one at a time. */
  isMobile?: boolean;
  onViewRecords?: () => void;
  hidden?: boolean;
  /** Extra rows rendered above the slice list — a tab strip, a summary line. */
  header?: React.ReactNode;

  /**
   * The dynamic group tree, when the operator has configured Group By.
   *
   * Present and non-empty, it replaces the curated slice list: the two answer the same
   * question — "which subset am I looking at" — and showing both would give an
   * operator two competing selections over one table.
   */
  groupTree?: GroupNode[];
  /** Opens the Group By / Sort By / Colors editor. */
  onOpenViewOptions?: () => void;
  /** How many group levels are configured, for the footer button caption. */
  groupLevelCount?: number;
}

const SIDEBAR_MIN = 200;
const SIDEBAR_MAX = 500;
const SIDEBAR_DEFAULT = 260;

const ToolStatusSidebar: React.FC<ToolStatusSidebarProps> = ({
  title,
  isDarkMode,
  colorPalette,
  allLabel,
  allCount,
  slices,
  selectedId,
  onSelect,
  onConfigure,
  isMobile = false,
  onViewRecords,
  hidden = false,
  header,
  groupTree,
  onOpenViewOptions,
  groupLevelCount = 0,
}) => {
  const [width, setWidth] = useState(SIDEBAR_DEFAULT);
  const [resizing, setResizing] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const isGrouped = Array.isArray(groupTree) && groupTree.length > 0;
  const startX = useRef(0);
  const startWidth = useRef(SIDEBAR_DEFAULT);

  const accent = colorPalette?.primary || '#7c3aed';

  const beginResize = useCallback((event: React.MouseEvent) => {
    event.preventDefault();
    startX.current = event.clientX;
    startWidth.current = width;
    setResizing(true);
  }, [width]);

  useEffect(() => {
    if (!resizing) return;

    const onMove = (event: MouseEvent) => {
      const next = startWidth.current + (event.clientX - startX.current);
      setWidth(Math.max(SIDEBAR_MIN, Math.min(SIDEBAR_MAX, next)));
    };
    const onUp = () => setResizing(false);

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    return () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
  }, [resizing]);

  const toggleExpansion = (event: React.MouseEvent, id: string) => {
    event.stopPropagation();
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const select = (id: string) => {
    onSelect(id);
    if (isMobile && onViewRecords) onViewRecords();
  };

  /**
   * The selected row's tint.
   *
   * The active palette, not the slice color: the slice color identifies *which*
   * status, the palette identifies *selected*, and letting the dot's color drive the
   * selection tint would mean the same selection looked different on every row.
   */
  const selectedStyle = {
    backgroundColor: `${accent}33`,
    color: accent,
    fontWeight: 500 as const,
  };
  const idleStyle = { color: isDarkMode ? '#d1d5db' : '#374151' };

  return (
    <div
      className={`${hidden ? 'hidden' : 'flex w-full'} md:flex border-r flex-shrink-0 flex-col relative ${
        isDarkMode ? 'bg-gray-900 border-gray-700' : 'bg-white border-gray-200'
      }`}
      style={!isMobile ? { width: `${width}px` } : undefined}
    >
      <div className={`p-4 border-b flex-shrink-0 ${isDarkMode ? 'border-gray-700' : 'border-gray-200'}`}>
        <h2 className={`text-lg font-semibold ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>{title}</h2>
      </div>

      {header}

      <div className="flex-1 overflow-y-auto">
        <button
          onClick={() => select('all')}
          className={`w-full flex items-center justify-between px-4 py-3 text-sm transition-colors ${
            isDarkMode ? 'hover:bg-gray-800' : 'hover:bg-gray-100'
          }`}
          style={selectedId === 'all' ? selectedStyle : idleStyle}
        >
          <span>{allLabel}</span>
          <span
            className={`px-2 py-1 rounded text-xs transition-colors ${
              selectedId === 'all'
                ? 'text-white'
                : isDarkMode
                  ? 'bg-gray-800 text-gray-400'
                  : 'bg-gray-100 text-gray-500'
            }`}
            style={selectedId === 'all' ? { backgroundColor: accent } : undefined}
          >
            {allCount.toLocaleString()}
          </span>
        </button>

        {isGrouped ? (
          <GroupTree
            nodes={groupTree!}
            selectedId={selectedId}
            onSelect={select}
            expanded={expanded}
            onToggleExpand={(id) =>
              setExpanded((prev) => {
                const next = new Set(prev);
                if (next.has(id)) next.delete(id);
                else next.add(id);
                return next;
              })
            }
            isDarkMode={isDarkMode}
            accent={accent}
          />
        ) : (
          slices.map((slice) => {
          const isSelected = selectedId === slice.id || selectedId.startsWith(`${slice.id}:`);
          const isExpanded = expanded.has(slice.id);
          const children = slice.children ?? [];

          return (
            <div key={slice.id}>
              <button
                onClick={() => select(slice.id)}
                className={`w-full flex items-center justify-between px-4 py-3 text-sm transition-colors ${
                  isDarkMode ? 'hover:bg-gray-800' : 'hover:bg-gray-100'
                }`}
                style={selectedId === slice.id ? selectedStyle : idleStyle}
              >
                <div className="flex items-center flex-1 min-w-0">
                  <span
                    className="h-2.5 w-2.5 rounded-full mr-3 shrink-0"
                    style={{ backgroundColor: slice.color }}
                  />
                  <span
                    className={`font-medium truncate text-left ${
                      selectedId === slice.id ? '' : isDarkMode ? 'text-gray-300' : 'text-gray-700'
                    }`}
                    title={slice.label}
                  >
                    {slice.label}
                  </span>
                </div>
                <div className="flex items-center space-x-2 shrink-0">
                  <span
                    className={`px-2 py-0.5 rounded text-[10px] font-bold transition-colors ${
                      selectedId === slice.id
                        ? 'text-white'
                        : isDarkMode
                          ? 'bg-gray-800 text-gray-500'
                          : 'bg-gray-100 text-gray-400'
                    }`}
                    style={selectedId === slice.id ? { backgroundColor: accent } : undefined}
                  >
                    {slice.count.toLocaleString()}
                  </span>
                  {children.length > 0 && (
                    <span
                      role="button"
                      tabIndex={0}
                      onClick={(event) => toggleExpansion(event, slice.id)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' || event.key === ' ') toggleExpansion(event as any, slice.id);
                      }}
                      className={`p-1 rounded transition-colors ${isDarkMode ? 'hover:bg-gray-700' : 'hover:bg-gray-200'}`}
                    >
                      {isExpanded ? (
                        <ChevronDown className={`h-4 w-4 ${isSelected ? 'text-current' : 'text-gray-400'}`} />
                      ) : (
                        <ChevronRight className={`h-4 w-4 ${isSelected ? 'text-current' : 'text-gray-400'}`} />
                      )}
                    </span>
                  )}
                </div>
              </button>

              {isExpanded &&
                children.map((child) => (
                  <button
                    key={child.id}
                    onClick={() => select(child.id)}
                    className={`w-full flex items-center justify-between pl-10 pr-4 py-2 text-xs transition-colors ${
                      isDarkMode ? 'hover:bg-gray-800' : 'hover:bg-gray-100'
                    }`}
                    style={
                      selectedId === child.id
                        ? { backgroundColor: `${accent}33`, color: accent }
                        : { color: isDarkMode ? '#9ca3af' : '#4b5563' }
                    }
                  >
                    <span className="truncate flex-1 text-left">{child.label}</span>
                    <span
                      className={`px-1.5 py-0.5 rounded text-[10px] transition-colors ${
                        selectedId === child.id
                          ? 'text-white'
                          : isDarkMode
                            ? 'bg-gray-800 text-gray-500'
                            : 'bg-gray-100 text-gray-400'
                      }`}
                      style={selectedId === child.id ? { backgroundColor: accent } : undefined}
                    >
                      {child.count.toLocaleString()}
                    </span>
                  </button>
                ))}
            </div>
          );
          })
        )}
      </div>

      <div className={`p-3 border-t flex-shrink-0 space-y-2 ${isDarkMode ? 'border-gray-800' : 'border-gray-200'}`}>
        {onOpenViewOptions && (
          <button
            onClick={onOpenViewOptions}
            title="Group by one or more columns, set the sort order, and colour each value"
            className={`w-full flex items-center justify-center gap-2 py-2 px-3 rounded border text-xs font-medium transition-colors ${
              isDarkMode
                ? 'border-gray-700 text-gray-300 hover:bg-gray-800'
                : 'border-gray-300 text-gray-700 hover:bg-gray-50'
            }`}
          >
            <Layers className="h-3.5 w-3.5" />
            View Options
            {groupLevelCount > 0 && (
              <span className="text-[10px] font-bold px-1.5 rounded text-white" style={{ backgroundColor: accent }}>
                {groupLevelCount}
              </span>
            )}
          </button>
        )}

        {/* The curated status slices are what the tree replaces, so editing them is
            only offered while they are the thing on screen. */}
        {!isGrouped && (
          <button
            onClick={onConfigure}
            title="Choose which statuses appear here, in what order, and in what color"
            className={`w-full flex items-center justify-center gap-2 py-2 px-3 rounded border text-xs font-medium transition-colors ${
              isDarkMode
                ? 'border-gray-700 text-gray-300 hover:bg-gray-800'
                : 'border-gray-300 text-gray-700 hover:bg-gray-50'
            }`}
          >
            <SlidersHorizontal className="h-3.5 w-3.5" />
            Configure Slices &amp; Colors
          </button>
        )}

        {isMobile && onViewRecords && (
          <button
            onClick={onViewRecords}
            className="w-full py-2 px-4 rounded text-white text-xs font-semibold"
            style={{ backgroundColor: accent }}
          >
            View Records
          </button>
        )}
      </div>

      {!isMobile && (
        <div
          className="absolute right-0 top-0 bottom-0 w-1 cursor-col-resize hover:bg-cyan-500 transition-colors z-10"
          onMouseDown={beginResize}
        />
      )}
    </div>
  );
};

export default ToolStatusSidebar;
