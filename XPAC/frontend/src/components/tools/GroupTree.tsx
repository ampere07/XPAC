import React from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import type { GroupNode } from '../../utils/groupTree';

/**
 * The dynamic group tree, rendered into the status sidebar.
 *
 * One recursive component for however many levels the operator configured. It reuses
 * the exact row shape the curated status slices use — colour dot, label, count badge,
 * chevron — so switching a screen from slices to grouping does not change how the
 * sidebar reads, only what it is grouped by.
 *
 * Indentation is computed from `depth` rather than from a fixed set of classes,
 * because the depth is whatever the operator chose and a three-level ladder of
 * hardcoded padding would cap it at three.
 */

interface GroupTreeProps {
  nodes: GroupNode[];
  selectedId: string;
  onSelect: (id: string) => void;
  expanded: Set<string>;
  onToggleExpand: (event: React.MouseEvent, id: string) => void;
  isDarkMode: boolean;
  accent: string;
}

const GroupTree: React.FC<GroupTreeProps> = ({
  nodes,
  selectedId,
  onSelect,
  expanded,
  onToggleExpand,
  isDarkMode,
  accent,
}) => (
  <>
    {nodes.map((node) => {
      const isSelected = selectedId === node.id;
      // A node on the path to the selection stays open so the selected row is never
      // hidden inside a collapsed ancestor after a reload.
      const isOpen = expanded.has(node.id) || selectedId.startsWith(`${node.id}/`);
      const hasChildren = node.children.length > 0;

      // 16px per level, on top of the 16px base — matching the rhythm of the sidebar ladder
      const indent = 16 + node.depth * 20;

      return (
        <div key={node.id}>
          <button
            onClick={() => onSelect(node.id)}
            className={`w-full flex items-center justify-between py-2 pr-4 transition-colors ${
              isDarkMode ? 'hover:bg-gray-800' : 'hover:bg-gray-100'
            }`}
            style={{
              paddingLeft: `${indent}px`,
              fontSize: node.depth === 0 ? '0.875rem' : '0.75rem',
              ...(isSelected
                ? { backgroundColor: `${accent}33`, color: accent, fontWeight: 500 }
                : { color: isDarkMode ? '#d1d5db' : '#374151' }),
            }}
          >
            <div className="flex items-center flex-1 min-w-0">
              <span
                className="h-2.5 w-2.5 rounded-full mr-3 shrink-0"
                style={{ backgroundColor: node.color }}
              />
              <span className="truncate text-left" title={node.label}>
                {node.label}
              </span>
            </div>

            <div className="flex items-center gap-2 shrink-0 ml-2">
              <span
                className={`px-2 py-0.5 rounded text-[10px] font-bold transition-colors ${
                  isSelected
                    ? 'text-white'
                    : isDarkMode
                      ? 'bg-gray-800 text-gray-500'
                      : 'bg-gray-100 text-gray-400'
                }`}
                style={isSelected ? { backgroundColor: accent } : undefined}
              >
                {node.count.toLocaleString()}
              </span>

              {hasChildren && (
                <span
                  role="button"
                  tabIndex={0}
                  onClick={(event) => {
                    event.stopPropagation();
                    onToggleExpand(event, node.id);
                  }}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.stopPropagation();
                      onToggleExpand(event as any, node.id);
                    }
                  }}
                  className={`p-1 rounded transition-colors ${isDarkMode ? 'hover:bg-gray-700' : 'hover:bg-gray-200'}`}
                >
                  {isOpen ? (
                    <ChevronDown className={`h-4 w-4 ${isSelected ? 'text-current' : 'text-gray-400'}`} />
                  ) : (
                    <ChevronRight className={`h-4 w-4 ${isSelected ? 'text-current' : 'text-gray-400'}`} />
                  )}
                </span>
              )}
            </div>
          </button>

          {hasChildren && isOpen && (
            <GroupTree
              nodes={node.children}
              selectedId={selectedId}
              onSelect={onSelect}
              expanded={expanded}
              onToggleExpand={onToggleExpand}
              isDarkMode={isDarkMode}
              accent={accent}
            />
          )}
        </div>
      );
    })}
  </>
);

export default GroupTree;
