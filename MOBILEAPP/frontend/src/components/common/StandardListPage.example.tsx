/**
 * ─────────────────────────────────────────────────────────────────────────────
 * StandardListPage — REFERENCE TEMPLATE
 * ─────────────────────────────────────────────────────────────────────────────
 * Copy this file as the starting point for any new list page, or use it as the
 * pattern when migrating an existing page to the global standard UI (the same
 * look & behavior as JobOrder.tsx).
 *
 * The recipe every standard page follows:
 *   1. A memoized Card component (React.memo) for each row.
 *   2. State: searchQuery + debouncedSearch, currentPage, selectedItem, refresh.
 *   3. useMemo pipeline: filter -> sort  (StandardListPage handles pagination).
 *   4. useCallback for every handler passed down.
 *   5. Render <StandardListPage/>, feeding it the filtered+sorted data.
 *
 * This file is a template — it is not wired into navigation.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, Pressable } from 'react-native';
import { Filter } from 'lucide-react-native';
import {
  StandardListPage,
  StatusText,
  StatusFilterModal,
  standardPageStyles as s,
  STANDARD_COLORS,
} from './index';

// 1. Your row shape (replace with a real type from src/types).
interface ExampleRecord {
  id: number | string;
  name?: string | null;
  address?: string | null;
  status?: string | null;
}

// 2. A memoized card — cheap to re-render, matches JobOrder's card layout.
const ExampleCard = React.memo(({ item, selected, onPress }: {
  item: ExampleRecord;
  selected: boolean;
  onPress: (item: ExampleRecord) => void;
}) => (
  <Pressable
    onPress={() => onPress(item)}
    style={[s.cardRow, { backgroundColor: selected ? STANDARD_COLORS.inputBg : 'transparent', borderColor: STANDARD_COLORS.border }]}
  >
    <View style={s.cardInner}>
      <View style={s.cardLeft}>
        <Text style={[s.cardName, { color: STANDARD_COLORS.text }]}>{item.name || '-'}</Text>
        <Text style={[s.cardSub, { color: STANDARD_COLORS.textMuted }]} numberOfLines={2}>
          {item.address || '-'}
        </Text>
      </View>
      <View style={s.cardRight}>
        <StatusText status={item.status} />
      </View>
    </View>
  </Pressable>
));
ExampleCard.displayName = 'ExampleCard';

const STATUS_OPTIONS = [
  { label: 'All Status', value: 'all' },
  { label: 'Active', value: 'active' },
  { label: 'Pending', value: 'pending' },
  { label: 'Cancelled', value: 'cancelled' },
];

const ExampleStandardPage: React.FC = () => {
  // Replace this with your context/service data + loading/error flags.
  const [records] = useState<ExampleRecord[]>([]);
  const [isLoading] = useState(false);
  const [error] = useState<string | null>(null);

  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [showStatusModal, setShowStatusModal] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [selectedItem, setSelectedItem] = useState<ExampleRecord | null>(null);

  // Debounce search so the filter useMemo doesn't run on every keystroke.
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(searchQuery), 300);
    return () => clearTimeout(t);
  }, [searchQuery]);

  // Reset to page 1 whenever the result set changes.
  useEffect(() => { setCurrentPage(1); }, [debouncedSearch, statusFilter]);

  const filtered = useMemo(() => {
    const q = debouncedSearch.toLowerCase();
    return records.filter((r) => {
      const matchesSearch = q === '' ||
        (r.name || '').toLowerCase().includes(q) ||
        (r.address || '').toLowerCase().includes(q);
      if (!matchesSearch) return false;
      if (statusFilter !== 'all' && (r.status || '').toLowerCase() !== statusFilter) return false;
      return true;
    });
  }, [records, debouncedSearch, statusFilter]);

  const sorted = useMemo(
    () => [...filtered].sort((a, b) => (Number(b.id) || 0) - (Number(a.id) || 0)),
    [filtered],
  );

  const handleRefresh = useCallback(async () => {
    setIsRefreshing(true);
    // await refreshRecords();
    setIsRefreshing(false);
  }, []);

  const handleRowPress = useCallback((item: ExampleRecord) => setSelectedItem(item), []);
  const handleCloseDetail = useCallback(() => setSelectedItem(null), []);

  const renderItem = useCallback((item: ExampleRecord) => (
    <ExampleCard item={item} selected={selectedItem?.id === item.id} onPress={handleRowPress} />
  ), [selectedItem, handleRowPress]);

  return (
    <>
    <StandardListPage<ExampleRecord>
      title="Example"
      data={sorted}
      keyExtractor={(item) => String(item.id)}
      renderItem={renderItem}
      searchQuery={searchQuery}
      onSearchChange={setSearchQuery}
      searchPlaceholder="Search examples..."
      isLoading={isLoading}
      error={error}
      loadingText="Loading examples..."
      emptyText="No examples found matching your filters"
      isRefreshing={isRefreshing}
      onRefresh={handleRefresh}
      currentPage={currentPage}
      onPageChange={setCurrentPage}
      selectedItem={selectedItem}
      onCloseDetail={handleCloseDetail}
      renderDetail={(item) => (
        // Drop your <XxxDetails/> component here.
        <View style={{ padding: 16 }}>
          <Text>Detail for {item.name}</Text>
        </View>
      )}
      toolbarActions={
        <Pressable
          onPress={() => setShowStatusModal(true)}
          style={[s.actionBtn, {
            backgroundColor: statusFilter !== 'all' ? STANDARD_COLORS.primary : STANDARD_COLORS.inputBg,
            borderWidth: statusFilter !== 'all' ? 0 : 1,
            borderColor: STANDARD_COLORS.borderInput,
          }]}
        >
          <Filter size={20} color={statusFilter !== 'all' ? 'white' : STANDARD_COLORS.textMuted} />
        </Pressable>
      }
    />

    {/* Page-specific modals live as siblings of StandardListPage. */}
    <StatusFilterModal
      visible={showStatusModal}
      onClose={() => setShowStatusModal(false)}
      options={STATUS_OPTIONS}
      selected={statusFilter}
      onSelect={setStatusFilter}
    />
    </>
  );
};

export default ExampleStandardPage;
