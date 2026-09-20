import { useState, useEffect, useRef, useMemo } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

export interface TableColumn {
  key: string;
  label: string;
  width?: string;
}

export interface UseTableColumnsOptions {
  storageKeyPrefix: string;
  allColumns: TableColumn[];
  defaultVisibleColumns: string[];
}

/**
 * RN port of the web table-columns hook. Column visibility + order are persisted via
 * AsyncStorage (hydrated after mount, since AsyncStorage is async). Web-only behaviours
 * — mouse column-resize, HTML5 drag-to-reorder, document click-outside — are no-ops in RN
 * (mobile renders cards, not a resizable/draggable table). Sorting + visibility + the
 * memoized displayedColumns remain fully functional; the return shape is unchanged so
 * existing consumers compile.
 */
export function useTableColumns({ storageKeyPrefix, allColumns, defaultVisibleColumns }: UseTableColumnsOptions) {
  const [visibleColumns, setVisibleColumns] = useState<string[]>(defaultVisibleColumns);
  const [columnOrder, setColumnOrder] = useState<string[]>(allColumns.map((col) => col.key));

  const [sortColumn, setSortColumn] = useState<string | null>(null);
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');

  // Web-only UI state kept for return-shape compatibility (unused in RN).
  const [columnWidths] = useState<Record<string, number>>({});
  const [resizingColumn] = useState<string | null>(null);
  const [draggedColumn, setDraggedColumn] = useState<string | null>(null);
  const [dragOverColumn, setDragOverColumn] = useState<string | null>(null);
  const [filterDropdownOpen, setFilterDropdownOpen] = useState<boolean>(false);
  const filterDropdownRef = useRef<any>(null);

  // Hydrate persisted visibility/order from AsyncStorage.
  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const [savedVisible, savedOrder] = await Promise.all([
          AsyncStorage.getItem(`${storageKeyPrefix}VisibleColumns`),
          AsyncStorage.getItem(`${storageKeyPrefix}ColumnOrder`),
        ]);
        if (!active) return;
        if (savedVisible) setVisibleColumns(JSON.parse(savedVisible));
        if (savedOrder) setColumnOrder(JSON.parse(savedOrder));
      } catch (err) {
        console.error('Failed to load table column prefs:', err);
      }
    })();
    return () => {
      active = false;
    };
  }, [storageKeyPrefix]);

  const persist = (key: string, value: any) => {
    AsyncStorage.setItem(`${storageKeyPrefix}${key}`, JSON.stringify(value)).catch(() => {});
  };

  const handleSort = (columnKey: string) => {
    if (sortColumn === columnKey) {
      if (sortDirection === 'desc') {
        setSortColumn(null);
        setSortDirection('asc');
      } else {
        setSortDirection('desc');
      }
    } else {
      setSortColumn(columnKey);
      setSortDirection('asc');
    }
  };

  const handleToggleColumn = (key: string) => {
    setVisibleColumns((prev) => {
      const next = prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key];
      persist('VisibleColumns', next);
      return next;
    });
  };

  const handleSelectAllColumns = () => {
    const allKeys = allColumns.map((c) => c.key);
    setVisibleColumns(allKeys);
    persist('VisibleColumns', allKeys);
  };

  const handleDeselectAllColumns = () => {
    setVisibleColumns([]);
    persist('VisibleColumns', []);
  };

  const reorderColumn = (fromKey: string, toKey: string) => {
    if (fromKey === toKey) return;
    const newOrder = [...columnOrder];
    const fromIdx = newOrder.indexOf(fromKey);
    const toIdx = newOrder.indexOf(toKey);
    if (fromIdx < 0 || toIdx < 0) return;
    newOrder.splice(fromIdx, 1);
    newOrder.splice(toIdx, 0, fromKey);
    setColumnOrder(newOrder);
    persist('ColumnOrder', newOrder);
  };

  // No-op web drag/resize handlers (kept for return-shape compatibility).
  const noop = () => {};

  const displayedColumns = useMemo(() => {
    return allColumns
      .filter((col) => visibleColumns.includes(col.key))
      .sort((a, b) => columnOrder.indexOf(a.key) - columnOrder.indexOf(b.key));
  }, [visibleColumns, columnOrder, allColumns]);

  return {
    visibleColumns,
    displayedColumns,
    columnOrder,
    sortColumn,
    sortDirection,
    columnWidths,
    draggedColumn,
    dragOverColumn,
    resizingColumn,
    filterDropdownOpen,
    setFilterDropdownOpen,
    filterDropdownRef,
    handleSort,
    handleDragStart: noop,
    handleDragOver: noop,
    handleDragLeave: noop,
    handleDrop: noop,
    handleDragEnd: noop,
    handleMouseDownResize: noop,
    reorderColumn,
    handleToggleColumn,
    handleSelectAllColumns,
    handleDeselectAllColumns,
    setSortColumn,
    setSortDirection,
    setDraggedColumn,
    setDragOverColumn,
  };
}
