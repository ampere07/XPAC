import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { autoColor, viewOptionsService, EMPTY_VIEW_OPTIONS, type ViewOptions } from '../services/viewOptionsService';
import {
  buildGroupTree,
  distinctValuesOf,
  rowMatchesGroup,
  type GroupableColumn,
} from '../utils/groupTree';

/**
 * The dynamic group-by / sort-by engine behind the list sidebars.
 *
 * Everything here derives from the rows it is handed, so a caller can swap datasets
 * (tab change, re-sync, a filter narrowing the set) and the tree, the counts and the
 * sort all follow with no teardown.
 *
 * The tree maths itself lives in `utils/groupTree`, which imports nothing: this file
 * is the part that talks to the preference store, and keeping the two apart is what
 * makes the engine unit-testable.
 */

export type { GroupNode } from '../utils/groupTree';

export function useViewOptions<Row>(moduleKey: string, columns: Array<GroupableColumn<Row>>, rows: Row[]) {
  const [options, setOptions] = useState<ViewOptions>(EMPTY_VIEW_OPTIONS);
  const [loaded, setLoaded] = useState(false);

  // Columns are declared at module scope in every caller, but a caller building them
  // inline would otherwise re-run the load on every render.
  const columnsRef = useRef(columns);
  columnsRef.current = columns;

  useEffect(() => {
    let cancelled = false;

    (async () => {
      const stored = await viewOptionsService.load(moduleKey, columnsRef.current as GroupableColumn[]);
      if (cancelled) return;
      setOptions(stored);
      setLoaded(true);
    })();

    return () => {
      cancelled = true;
    };
  }, [moduleKey]);

  const save = useCallback(
    async (next: ViewOptions): Promise<boolean> => {
      // Optimistic: the operator has already seen the tree they asked for, and making
      // them wait on a round trip to see their own grouping would be worse than the
      // rare write that fails and is reported after the fact.
      setOptions(next);
      return viewOptionsService.save(moduleKey, next);
    },
    [moduleKey]
  );

  const reset = useCallback(async () => {
    setOptions(EMPTY_VIEW_OPTIONS);
    await viewOptionsService.reset(moduleKey);
  }, [moduleKey]);

  /** A value's colour: the operator's choice, else a stable hashed default. */
  const colorFor = useCallback(
    (column: string, value: string): string => options.colors[column]?.[value] ?? autoColor(value),
    [options.colors]
  );

  const levels = useMemo(
    () =>
      options.groupBy
        .map((key) => columns.find((column) => column.key === key))
        .filter((column): column is GroupableColumn<Row> => column !== undefined),
    [options.groupBy, columns]
  );

  const tree = useMemo(
    () => buildGroupTree(rows, levels, colorFor),
    [rows, levels, colorFor]
  );

  /**
   * Distinct values per column, for the colour editor.
   *
   * Read off the rows on screen rather than from a lookup endpoint, so a column is
   * colourable the moment it is groupable and no column needs a second definition.
   */
  const distinctValues = useCallback(
    (columnKey: string): string[] => {
      const column = columns.find((entry) => entry.key === columnKey);
      return column ? distinctValuesOf(rows, column) : [];
    },
    [columns, rows]
  );

  /**
   * The configured sort, as rules the data grid understands.
   *
   * Handed to `useDataGrid` rather than applied here: the grid already sorts, and a
   * second sort layered on top of it would fight the column headers an operator can
   * still click.
   */
  const sortRules = useMemo(
    () => options.sortBy.map((rule) => ({ key: rule.column, direction: rule.direction })),
    [options.sortBy]
  );

  /** Narrow rows to a selected node, by its path. `'all'` narrows nothing. */
  const filterByGroup = useCallback(
    (source: Row[], nodeId: string): Row[] =>
      nodeId === 'all' ? source : source.filter((row) => rowMatchesGroup(row, nodeId, columns)),
    [columns]
  );

  return {
    options,
    loaded,
    save,
    reset,
    tree,
    levels,
    colorFor,
    distinctValues,
    sortRules,
    filterByGroup,
    isGrouped: levels.length > 0,
  };
}
