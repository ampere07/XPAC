/* eslint-disable @typescript-eslint/no-unused-vars */
/**
 * StandardPage — reference page.
 *
 * Copy this file, rename it, swap the type and the service call. The shape is
 * always the same:
 *
 *   1. state: search, page, page size, selection, filters
 *   2. fetch into state
 *   3. useMemo: filter, then sort  (StandardPage slices the page itself)
 *   4. a RecordCard renderer
 *   5. <StandardPage/>, fed the FULL filtered list
 *
 * Nothing here renders a table. If a record has more fields than a card can
 * show, they belong in the detail view, not in columns the phone has to scroll
 * sideways to reach.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Text, TouchableOpacity } from 'react-native';
import { Plus } from 'lucide-react-native';
import apiClient from '../../config/api';
import { settingsColorPaletteService, ColorPalette } from '../../services/settingsColorPaletteService';
import { StandardPage, RecordCard, FilterChip } from './index';

interface ExampleRecord {
  id: number;
  customer_name: string;
  address?: string;
  created_at?: string;
  status?: string;
}

const ExamplePage: React.FC = () => {
  const [records, setRecords] = useState<ExampleRecord[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<string | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(25);

  const [selected, setSelected] = useState<ExampleRecord | null>(null);
  const [colorPalette, setColorPalette] = useState<ColorPalette | null>(null);

  useEffect(() => {
    settingsColorPaletteService.getActive().then(setColorPalette).catch(() => {});
  }, []);

  const load = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await apiClient.get('/example-records');
      setRecords(res.data?.data ?? []);
    } catch (e: any) {
      setError(e?.message || 'Failed to load records');
    } finally {
      setIsLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // Filtering and sorting belong to the page; pagination belongs to the shell.
  const visible = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return records
      .filter((r) => !statusFilter || (r.status || '').toLowerCase() === statusFilter)
      .filter((r) => !q || `${r.customer_name} ${r.address ?? ''}`.toLowerCase().includes(q))
      .sort((a, b) => String(b.created_at ?? '').localeCompare(String(a.created_at ?? '')));
  }, [records, searchQuery, statusFilter]);

  // Any change that shrinks the list sends the reader back to page one, so a
  // search does not land on an empty page.
  useEffect(() => {
    setCurrentPage(1);
  }, [searchQuery, statusFilter]);

  const chips: FilterChip[] = statusFilter
    ? [{ key: 'status', label: 'Status', value: statusFilter }]
    : [];

  const renderItem = useCallback(
    (item: ExampleRecord) => (
      <RecordCard
        title={item.customer_name}
        subtitle={[item.created_at, item.address].filter(Boolean).join(' | ')}
        status={item.status}
        selected={selected?.id === item.id}
        onPress={() => setSelected(item)}
      />
    ),
    [selected],
  );

  return (
    <StandardPage<ExampleRecord>
      data={visible}
      keyExtractor={(item) => String(item.id)}
      renderItem={renderItem}
      searchQuery={searchQuery}
      onSearchChange={setSearchQuery}
      searchPlaceholder="Search records..."
      isLoading={isLoading}
      error={error}
      onRetry={load}
      emptyText="No records found"
      onPullRefresh={() => {
        setRefreshing(true);
        load();
      }}
      pullRefreshing={refreshing}
      onRefresh={load}
      chips={chips}
      onRemoveChip={() => setStatusFilter(null)}
      onClearChips={() => setStatusFilter(null)}
      currentPage={currentPage}
      onPageChange={setCurrentPage}
      itemsPerPage={itemsPerPage}
      onItemsPerPageChange={setItemsPerPage}
      colorPalette={colorPalette}
      // Passing `detail` hides the list without unmounting it, so scroll
      // position and the current page survive the round trip.
      detail={selected ? <Text onPress={() => setSelected(null)}>Detail for {selected.customer_name}</Text> : null}
      toolbarActions={
        <TouchableOpacity
          onPress={() => {}}
          style={{
            width: 38,
            height: 38,
            borderRadius: 8,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: colorPalette?.primary || '#7c3aed',
          }}
        >
          <Plus size={20} color="#fff" />
        </TouchableOpacity>
      }
    />
  );
};

export default ExamplePage;
