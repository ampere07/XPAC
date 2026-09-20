import React, { useState, useEffect, useRef, useMemo } from 'react';

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

export function useTableColumns({
  storageKeyPrefix,
  allColumns,
  defaultVisibleColumns,
}: UseTableColumnsOptions) {
  // Column Visibility
  const [visibleColumns, setVisibleColumns] = useState<string[]>(() => {
    const saved = localStorage.getItem(`${storageKeyPrefix}VisibleColumns`);
    if (saved) {
      try {
        return JSON.parse(saved);
      } catch (err) {
        console.error('Failed to load column visibility:', err);
      }
    }
    return defaultVisibleColumns;
  });

  // Sorting
  const [sortColumn, setSortColumn] = useState<string | null>(null);
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');

  // Resizing
  const [columnWidths, setColumnWidths] = useState<Record<string, number>>({});
  const [resizingColumn, setResizingColumn] = useState<string | null>(null);
  const colStartXRef = useRef<number>(0);
  const colStartWidthRef = useRef<number>(0);

  // Drag and Drop reordering
  const [draggedColumn, setDraggedColumn] = useState<string | null>(null);
  const [dragOverColumn, setDragOverColumn] = useState<string | null>(null);
  const [columnOrder, setColumnOrder] = useState<string[]>(() => {
    const saved = localStorage.getItem(`${storageKeyPrefix}ColumnOrder`);
    if (saved) {
      try {
        return JSON.parse(saved);
      } catch (err) {
        console.error('Failed to load column order:', err);
      }
    }
    return allColumns.map(col => col.key);
  });

  // Dropdown UI state
  const [filterDropdownOpen, setFilterDropdownOpen] = useState<boolean>(false);
  const filterDropdownRef = useRef<HTMLDivElement>(null);

  // Handle Resize Mouse Events
  useEffect(() => {
    if (!resizingColumn) return;
    const handleMouseMove = (e: MouseEvent) => {
      const diff = e.clientX - colStartXRef.current;
      const newWidth = Math.max(80, colStartWidthRef.current + diff);
      setColumnWidths(prev => ({ ...prev, [resizingColumn]: newWidth }));
    };
    const handleMouseUp = () => setResizingColumn(null);
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [resizingColumn]);

  // Handle Click Outside Dropdown
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (filterDropdownRef.current && !filterDropdownRef.current.contains(event.target as Node)) {
        setFilterDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleMouseDownResize = (e: React.MouseEvent, columnKey: string) => {
    e.preventDefault();
    e.stopPropagation();
    setResizingColumn(columnKey);
    colStartXRef.current = e.clientX;
    const th = (e.target as HTMLElement).closest('th');
    if (th) colStartWidthRef.current = th.offsetWidth;
  };

  // Sorting Handler
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

  // Drag and Drop Handlers
  const handleDragStart = (e: React.DragEvent, columnKey: string) => {
    setDraggedColumn(columnKey);
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDragOver = (e: React.DragEvent, columnKey: string) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (draggedColumn && draggedColumn !== columnKey) setDragOverColumn(columnKey);
  };

  const handleDragLeave = () => setDragOverColumn(null);

  const handleDrop = (e: React.DragEvent, targetKey: string) => {
    e.preventDefault();
    if (!draggedColumn || draggedColumn === targetKey) {
      setDraggedColumn(null);
      setDragOverColumn(null);
      return;
    }
    const newOrder = [...columnOrder];
    const fromIdx = newOrder.indexOf(draggedColumn);
    const toIdx = newOrder.indexOf(targetKey);
    newOrder.splice(fromIdx, 1);
    newOrder.splice(toIdx, 0, draggedColumn);
    setColumnOrder(newOrder);
    localStorage.setItem(`${storageKeyPrefix}ColumnOrder`, JSON.stringify(newOrder));
    setDraggedColumn(null);
    setDragOverColumn(null);
  };

  const handleDragEnd = () => {
    setDraggedColumn(null);
    setDragOverColumn(null);
  };

  // Visibility Handlers
  const handleToggleColumn = (key: string) => {
    setVisibleColumns(prev => {
      const next = prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key];
      localStorage.setItem(`${storageKeyPrefix}VisibleColumns`, JSON.stringify(next));
      return next;
    });
  };

  const handleSelectAllColumns = () => {
    const allKeys = allColumns.map(c => c.key);
    setVisibleColumns(allKeys);
    localStorage.setItem(`${storageKeyPrefix}VisibleColumns`, JSON.stringify(allKeys));
  };

  const handleDeselectAllColumns = () => {
    setVisibleColumns([]);
    localStorage.setItem(`${storageKeyPrefix}VisibleColumns`, JSON.stringify([]));
  };

  // Memoized sorted/filtered list of columns to render
  const displayedColumns = useMemo(() => {
    return allColumns
      .filter(col => visibleColumns.includes(col.key))
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
    handleDragStart,
    handleDragOver,
    handleDragLeave,
    handleDrop,
    handleDragEnd,
    handleMouseDownResize,
    handleToggleColumn,
    handleSelectAllColumns,
    handleDeselectAllColumns,
    setSortColumn,
    setSortDirection,
  };
}
