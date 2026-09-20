import {
  BLANK_GROUP_LABEL,
  buildGroupTree,
  rowMatchesGroup,
  type GroupableColumn,
  type GroupNode,
} from '../utils/groupTree';

/**
 * The group engine is pure, so it is the one part of the View Options feature worth
 * testing directly: counts that disagree with the table underneath them are the
 * failure mode operators notice first, and multi-level nesting is where an off-by-one
 * hides.
 */

interface Row {
  id: number;
  city: string;
  barangay: string;
  status: string | null;
}

const rows: Row[] = [
  { id: 1, city: 'Cabuyao', barangay: 'Pulo', status: 'Active' },
  { id: 2, city: 'Cabuyao', barangay: 'Pulo', status: 'Active' },
  { id: 3, city: 'Cabuyao', barangay: 'Marinig', status: 'Suspended' },
  { id: 4, city: 'Calamba', barangay: 'Pulo', status: 'Active' },
  { id: 5, city: 'Calamba', barangay: 'Real', status: null },
];

const columns: Array<GroupableColumn<Row>> = [
  { key: 'city', label: 'City', value: (row) => row.city },
  { key: 'barangay', label: 'Barangay', value: (row) => row.barangay },
  { key: 'status', label: 'Status', value: (row) => row.status },
];

const flat = (nodes: GroupNode[]): GroupNode[] =>
  nodes.flatMap((node) => [node, ...flat(node.children)]);

const stubColor = () => '#000000';

describe('buildGroupTree', () => {
  it('groups one level and counts each bucket', () => {
    const tree = buildGroupTree(rows, columns.slice(0, 1), stubColor);

    expect(tree.map((node) => [node.label, node.count])).toEqual([
      ['Cabuyao', 3],
      ['Calamba', 2],
    ]);
  });

  it('nests three levels and keeps parent counts equal to the sum of their children', () => {
    const tree = buildGroupTree(rows, columns, stubColor);

    const cabuyao = tree.find((node) => node.label === 'Cabuyao')!;
    expect(cabuyao.count).toBe(3);
    expect(cabuyao.children.map((node) => [node.label, node.count])).toEqual([
      ['Marinig', 1],
      ['Pulo', 2],
    ]);

    const pulo = cabuyao.children.find((node) => node.label === 'Pulo')!;
    expect(pulo.children).toEqual([
      expect.objectContaining({ label: 'Active', count: 2, depth: 2 }),
    ]);

    // Every parent equals the sum of its children — the invariant an operator reads.
    flat(tree)
      .filter((node) => node.children.length > 0)
      .forEach((node) => {
        expect(node.count).toBe(node.children.reduce((sum, child) => sum + child.count, 0));
      });
  });

  it('buckets blanks rather than dropping the rows, and sorts them last', () => {
    const tree = buildGroupTree(rows, [columns[2]], stubColor);

    expect(tree.map((node) => node.label)).toEqual(['Active', 'Suspended', BLANK_GROUP_LABEL]);
    expect(tree.reduce((sum, node) => sum + node.count, 0)).toBe(rows.length);
  });

  it('scopes node ids by path so same-named children of different parents stay distinct', () => {
    const tree = buildGroupTree(rows, columns.slice(0, 2), stubColor);
    const ids = flat(tree).map((node) => node.id);

    expect(ids).toContain('city:Cabuyao/barangay:Pulo');
    expect(ids).toContain('city:Calamba/barangay:Pulo');
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('rowMatchesGroup', () => {
  it('matches only the rows beneath a node path', () => {
    const matched = rows.filter((row) => rowMatchesGroup(row, 'city:Cabuyao/barangay:Pulo', columns));
    expect(matched.map((row) => row.id)).toEqual([1, 2]);
  });

  it('matches the blank bucket', () => {
    const matched = rows.filter((row) => rowMatchesGroup(row, 'status:' + BLANK_GROUP_LABEL, columns));
    expect(matched.map((row) => row.id)).toEqual([5]);
  });

  it('narrows nothing for the "all" selection', () => {
    expect(rows.filter((row) => rowMatchesGroup(row, 'all', columns))).toHaveLength(rows.length);
  });
});
