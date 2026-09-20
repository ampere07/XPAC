/**
 * The dynamic group-by engine, as pure functions.
 *
 * Deliberately free of every service import. The tree, the counts and the path
 * matching are the part of View Options that is worth testing directly — counts that
 * disagree with the table underneath them are the failure operators notice first — and
 * a module that reaches the network cannot be unit tested without standing the whole
 * API client up first.
 *
 * {@link useViewOptions} composes these with the persistence layer; nothing here knows
 * that persistence exists.
 */

/** A column a screen is willing to be grouped, sorted or coloured by. */
export interface GroupableColumn<Row = any> {
  key: string;
  label: string;
  /**
   * The value this column groups on. Returns the raw value; the engine stringifies and
   * buckets it. `null`/`''` become the "(blank)" bucket rather than vanishing.
   */
  value: (row: Row) => string | number | null | undefined;
}

/** The label a blank value is bucketed under. Never rendered as an empty row. */
export const BLANK_GROUP_LABEL = '(blank)';

/** One node of the group tree. Nodes nest to whatever depth the operator configured. */
export interface GroupNode {
  /**
   * Path-scoped identity: `city:Cabuyao`, then `city:Cabuyao/barangay:Pulo`. Scoped so
   * two barangays of the same name under different cities are different nodes, which a
   * bare value key would collapse into one.
   */
  id: string;
  /** The column this level groups on. */
  column: string;
  /** The distinct value, as displayed. */
  label: string;
  /** Rows beneath this node, including every descendant. */
  count: number;
  color: string;
  depth: number;
  children: GroupNode[];
}

/** Bucket key for a row's value at one level. Blanks are a bucket, not a hole. */
export const bucketOf = (raw: string | number | null | undefined): string => {
  if (raw === null || raw === undefined) return BLANK_GROUP_LABEL;
  const value = String(raw).trim();
  return value === '' ? BLANK_GROUP_LABEL : value;
};

/** Blanks last: an operator scanning a tree never wants "(blank)" at the top. */
const compareLabels = (a: string, b: string): number => {
  if (a === BLANK_GROUP_LABEL) return 1;
  if (b === BLANK_GROUP_LABEL) return -1;
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
};

/**
 * Build the N-level group tree.
 *
 * One bucketing pass per level rather than a sort-then-scan: the row count runs to
 * thousands and the tree is rebuilt whenever anything upstream changes, so it stays
 * O(rows x levels). Children are ordered by label so the tree does not reshuffle
 * between renders.
 */
export function buildGroupTree<Row>(
  rows: Row[],
  levels: Array<GroupableColumn<Row>>,
  colorFor: (column: string, value: string) => string,
  parentId = '',
  depth = 0
): GroupNode[] {
  if (levels.length === 0 || rows.length === 0) return [];

  const [level, ...rest] = levels;
  const buckets = new Map<string, Row[]>();

  rows.forEach((row) => {
    const key = bucketOf(level.value(row));
    const bucket = buckets.get(key);
    if (bucket) bucket.push(row);
    else buckets.set(key, [row]);
  });

  return Array.from(buckets.entries())
    .sort((a, b) => compareLabels(a[0], b[0]))
    .map(([label, bucketRows]) => {
      const id = `${parentId}${parentId ? '/' : ''}${level.key}:${label}`;

      return {
        id,
        column: level.key,
        label,
        count: bucketRows.length,
        color: colorFor(level.key, label),
        depth,
        children: buildGroupTree(bucketRows, rest, colorFor, id, depth + 1),
      };
    });
}

/** Does this row sit under the given node path? */
export function rowMatchesGroup<Row>(
  row: Row,
  nodeId: string,
  columns: Array<GroupableColumn<Row>>
): boolean {
  if (nodeId === 'all' || nodeId === '') return true;

  const byKey = new Map(columns.map((column) => [column.key, column]));

  return nodeId.split('/').every((segment) => {
    const split = segment.indexOf(':');
    if (split === -1) return true;

    const column = byKey.get(segment.slice(0, split));
    // A path level naming a column this screen no longer declares cannot be evaluated;
    // treating it as satisfied keeps the rest of the path meaningful instead of
    // emptying the table on a stale preference.
    if (!column) return true;

    return bucketOf(column.value(row)) === segment.slice(split + 1);
  });
}

/** Distinct values a column takes across these rows, blanks bucketed and sorted last. */
export function distinctValuesOf<Row>(rows: Row[], column: GroupableColumn<Row>): string[] {
  const seen = new Set<string>();
  rows.forEach((row) => seen.add(bucketOf(column.value(row))));
  return Array.from(seen).sort(compareLabels);
}
