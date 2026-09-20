import React, { useState, useEffect, useMemo } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
  Dimensions,
  Modal,
  ScrollView,
  Switch,
} from 'react-native';
import { Picker } from '@react-native-picker/picker';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  RefreshCw,
  Columns3,
  Download,
  ArrowUp,
  ArrowDown,
  X,
} from 'lucide-react-native';
import GlobalSearch from './globalfunctions/GlobalSearch';
import { useTableColumns } from './globalfunctions/useTableColumns';
import { useRadiusQueueStore } from '../store/radiusQueueStore';
import { settingsColorPaletteService, ColorPalette } from '../services/settingsColorPaletteService';
import { RadiusQueueRecord } from '../services/radiusQueueService';
import { exportToCSV } from '../utils/exportUtils';

/**
 * The RADIUS operation queue.
 *
 * Every RADIUS call the system could not complete when it was needed — a
 * disconnect, a reconnect, a credential change — is parked in
 * radius_operation_queue and retried. This is that queue, read only: what is
 * waiting, how many times it has been tried, and what the server last said.
 *
 * Laid out as Data Logs is, deliberately — same header block, same column
 * chooser, same sort control, same pagination footer. Somebody who knows that
 * screen knows this one. The web portal's copy makes the same promise about its
 * own Data Logs page, so the two clients stay recognisable to each other.
 *
 * The table on the web becomes a card list here: a phone cannot show fourteen
 * columns side by side, so the visible-column choice decides which fields each
 * card prints rather than which table headers are drawn. Tapping a card opens
 * the full row, which is where the long values — the error and the params —
 * are readable.
 */

const allColumns = [
  { key: 'id', label: 'ID' },
  { key: 'account_no', label: 'Account No.' },
  { key: 'operation', label: 'Operation' },
  { key: 'status', label: 'Status' },
  { key: 'attempts', label: 'Attempts' },
  { key: 'source_type', label: 'Source' },
  { key: 'source_id', label: 'Source ID' },
  { key: 'last_error', label: 'Last Error' },
  { key: 'params', label: 'Params' },
  { key: 'next_retry_at', label: 'Next Retry' },
  { key: 'completed_at', label: 'Completed At' },
  { key: 'created_at', label: 'Created At' },
  { key: 'created_by', label: 'Created By' },
  { key: 'updated_at', label: 'Updated At' },
];

/**
 * "accountNumber" -> "Account Number", "new_username" -> "New Username".
 *
 * The queue's params are written by several different callers, some in camelCase
 * and some in snake_case, so both are handled rather than assuming one.
 */
const humaniseKey = (key: string): string =>
  key
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/(^|\s)\S/g, (c) => c.toUpperCase());

/** A params value as text. Nulls and blanks read as "(empty)" rather than vanishing. */
const formatParamValue = (value: unknown): string => {
  if (value === null || value === undefined || value === '') return '(empty)';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (Array.isArray(value)) return value.length ? value.map((v) => formatParamValue(v)).join(', ') : '(empty)';
  if (typeof value === 'object') {
    return Object.entries(value as Record<string, unknown>)
      .map(([k, v]) => `${humaniseKey(k)}: ${formatParamValue(v)}`)
      .join(' · ');
  }
  return String(value);
};

/**
 * The params panel as label/value pairs.
 *
 * Returns null when the value is not an object — a bare string or a malformed
 * payload is shown as it stands rather than being forced into rows.
 */
const paramEntries = (params: string | null): Array<[string, string]> | null => {
  if (!params) return null;

  try {
    const parsed = JSON.parse(params);

    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;

    return Object.entries(parsed as Record<string, unknown>)
      .map(([k, v]) => [humaniseKey(k), formatParamValue(v)] as [string, string]);
  } catch {
    return null;
  }
};

/** The statuses the queue carries, for the filter and the status pill. */
const STATUS_OPTIONS = ['pending', 'success', 'failed', 'cancelled'];

const STATUS_FILTER_OPTIONS = [
  { label: 'All Statuses', value: 'all' },
  ...STATUS_OPTIONS.map((s) => ({ label: s.charAt(0).toUpperCase() + s.slice(1), value: s })),
];

/** Status colours, by how much attention the row needs. */
const STATUS_TONE: Record<string, { bg: string; fg: string }> = {
  pending: { bg: '#fffbeb', fg: '#b45309' },
  success: { bg: '#ecfdf5', fg: '#047857' },
  failed: { bg: '#fff1f2', fg: '#be123c' },
  cancelled: { bg: '#f3f4f6', fg: '#4b5563' },
};

const toneFor = (status: string) => STATUS_TONE[(status || '').toLowerCase()] || { bg: '#f3f4f6', fg: '#374151' };

const RadiusQueue: React.FC = () => {
  // App is forced light mode.
  const isDarkMode = false;
  const { queueRecords, isLoading, error, fetchQueueRecords, refreshQueueRecords } = useRadiusQueueStore();

  const [searchQuery, setSearchQuery] = useState<string>('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [colorPalette, setColorPalette] = useState<ColorPalette | null>(null);
  const [selectedRow, setSelectedRow] = useState<RadiusQueueRecord | null>(null);
  const [columnsModalOpen, setColumnsModalOpen] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [userOrgId, setUserOrgId] = useState<any>(null);

  const { width } = Dimensions.get('window');
  const isTablet = width >= 768;

  const {
    visibleColumns,
    displayedColumns,
    sortColumn,
    sortDirection,
    handleSort,
    handleToggleColumn,
    handleSelectAllColumns,
    handleDeselectAllColumns,
  } = useTableColumns({
    storageKeyPrefix: 'radiusQueue',
    allColumns,
    defaultVisibleColumns: ['id', 'account_no', 'operation', 'status', 'attempts', 'last_error', 'created_at'],
  });

  // Pagination
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [itemsPerPage, setItemsPerPage] = useState<number>(25);

  const primaryColor = colorPalette?.primary || '#7c3aed';

  useEffect(() => {
    settingsColorPaletteService
      .getActive()
      .then(setColorPalette)
      .catch((err) => console.error('Failed to fetch color palette:', err));
  }, []);

  useEffect(() => {
    const loadOrgId = async () => {
      try {
        const authDataStr = await AsyncStorage.getItem('authData');
        if (authDataStr) {
          const authData = JSON.parse(authDataStr);
          const orgId =
            authData.organization_id ||
            authData.user?.organization_id ||
            authData.organization?.id ||
            authData.user?.organization?.id ||
            null;
          setUserOrgId(orgId);
        }
      } catch (e) {
        // ignore
      }
    };
    loadOrgId();
  }, []);

  useEffect(() => {
    fetchQueueRecords();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto silent-refresh every 15 minutes, matching the sibling log screens.
  useEffect(() => {
    const intervalId = setInterval(() => {
      fetchQueueRecords(true).catch((err) => console.error('Idle refresh failed:', err));
    }, 15 * 60 * 1000);
    return () => clearInterval(intervalId);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    setCurrentPage(1);
  }, [searchQuery, statusFilter]);

  const handleRefresh = async () => {
    setRefreshing(true);
    await refreshQueueRecords();
    setRefreshing(false);
  };

  const filteredRows = useMemo(() => {
    let filtered = queueRecords.filter((row) => {
      // Organisation scope: a user inside an organisation sees that
      // organisation's entries, a global user sees the unscoped ones.
      if (userOrgId) {
        if (row.organization_id !== userOrgId) return false;
      } else if (row.organization_id) {
        return false;
      }

      if (statusFilter !== 'all' && (row.status || '').toLowerCase() !== statusFilter) return false;

      if (searchQuery.trim() !== '') {
        const q = searchQuery.toLowerCase();
        return [
          row.id,
          row.account_no,
          row.operation,
          row.status,
          row.source_type,
          row.source_id,
          row.last_error ?? '',
          row.params ?? '',
          row.created_by,
        ].some((v) => String(v ?? '').toLowerCase().includes(q));
      }

      return true;
    });

    if (sortColumn) {
      filtered = [...filtered].sort((a, b) => {
        const pick = (row: RadiusQueueRecord) => (row as any)[sortColumn] ?? '';
        let aVal: any = pick(a);
        let bVal: any = pick(b);

        if (['next_retry_at', 'completed_at', 'created_at', 'updated_at'].includes(sortColumn)) {
          aVal = aVal ? new Date(aVal).getTime() || 0 : 0;
          bVal = bVal ? new Date(bVal).getTime() || 0 : 0;
        } else if (['attempts', 'id', 'source_id'].includes(sortColumn)) {
          aVal = Number(aVal) || 0;
          bVal = Number(bVal) || 0;
        } else {
          aVal = String(aVal).toLowerCase();
          bVal = String(bVal).toLowerCase();
        }

        if (aVal < bVal) return sortDirection === 'asc' ? -1 : 1;
        if (aVal > bVal) return sortDirection === 'asc' ? 1 : -1;
        return 0;
      });
    }

    return filtered;
  }, [queueRecords, statusFilter, searchQuery, userOrgId, sortColumn, sortDirection]);

  const totalPages = Math.max(1, Math.ceil(filteredRows.length / itemsPerPage));
  const paginatedRows = useMemo(
    () => filteredRows.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage),
    [filteredRows, currentPage, itemsPerPage]
  );

  const handleExport = () => {
    if (!filteredRows.length) return;

    exportToCSV('radius_queue_export', displayedColumns, filteredRows, (record: RadiusQueueRecord, key: string) => {
      if (key === 'attempts') return `${record.attempts} / ${record.max_attempts}`;
      return (record as any)[key] ?? '';
    });
  };

  const StatusPill: React.FC<{ status: string }> = ({ status }) => {
    const tone = toneFor(status);
    return (
      <View style={{ paddingHorizontal: 10, paddingVertical: 3, borderRadius: 999, backgroundColor: tone.bg }}>
        <Text style={{ fontSize: 10, fontWeight: '700', letterSpacing: 0.5, textTransform: 'uppercase', color: tone.fg }}>
          {status || '-'}
        </Text>
      </View>
    );
  };

  const renderItem = ({ item }: { item: RadiusQueueRecord }) => {
    const show = (key: string) => visibleColumns.includes(key);
    return (
      <TouchableOpacity
        activeOpacity={0.7}
        onPress={() => setSelectedRow(item)}
        style={{
          backgroundColor: '#ffffff',
          borderBottomWidth: 1,
          borderBottomColor: '#e5e7eb',
          paddingHorizontal: 16,
          paddingVertical: 14,
        }}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexShrink: 1 }}>
            {show('status') && <StatusPill status={item.status} />}
            {show('operation') && (
              <Text style={{ fontSize: 13, fontWeight: '700', color: '#111827' }} numberOfLines={1}>
                {humaniseKey(item.operation || '-')}
              </Text>
            )}
          </View>
          {show('id') && <Text style={{ fontSize: 12, fontWeight: '700', color: '#6b7280' }}>ID: {item.id}</Text>}
        </View>

        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginTop: 8 }}>
          {show('account_no') && !!item.account_no && <Field label="Account" value={item.account_no} />}
          {show('attempts') && <Field label="Attempts" value={`${item.attempts} / ${item.max_attempts}`} />}
          {show('source_type') && !!item.source_type && <Field label="Source" value={humaniseKey(item.source_type)} />}
          {show('source_id') && !!item.source_id && <Field label="Source ID" value={String(item.source_id)} />}
          {show('next_retry_at') && !!item.next_retry_at && <Field label="Next Retry" value={item.next_retry_at} />}
          {show('completed_at') && !!item.completed_at && <Field label="Completed" value={item.completed_at} />}
          {show('created_at') && !!item.created_at && <Field label="Created" value={item.created_at} />}
          {show('created_by') && !!item.created_by && <Field label="By" value={item.created_by} />}
          {show('updated_at') && !!item.updated_at && <Field label="Updated" value={item.updated_at} />}
        </View>

        {/* The error is why anybody opens this screen, so it gets its own line
            rather than a chip — truncated here, in full on the detail sheet. */}
        {show('last_error') && !!item.last_error && (
          <View style={{ marginTop: 8, padding: 8, borderRadius: 6, backgroundColor: '#fff1f2' }}>
            <Text style={{ fontSize: 11, color: '#be123c' }} numberOfLines={2}>
              {item.last_error}
            </Text>
          </View>
        )}

        {show('params') && !!item.params && (
          <Text style={{ fontSize: 11, color: '#6b7280', marginTop: 6 }} numberOfLines={1}>
            {item.params}
          </Text>
        )}
      </TouchableOpacity>
    );
  };

  return (
    <View style={{ flex: 1, backgroundColor: '#f9fafb' }}>
      {/* Header */}
      <View
        style={{
          paddingHorizontal: 16,
          paddingTop: isTablet ? 16 : 60,
          paddingBottom: 12,
          borderBottomWidth: 1,
          borderBottomColor: '#e5e7eb',
          backgroundColor: '#ffffff',
          gap: 10,
        }}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <Text style={{ fontSize: 14, fontWeight: '700', letterSpacing: 0.5, color: '#111827', textTransform: 'uppercase' }}>
            RADIUS Queue
          </Text>
          <Text style={{ fontSize: 12, color: '#6b7280' }}>{filteredRows.length}</Text>
        </View>

        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <GlobalSearch
            searchQuery={searchQuery}
            setSearchQuery={setSearchQuery}
            isDarkMode={isDarkMode}
            colorPalette={colorPalette}
            placeholder="Search the queue..."
          />
          <TouchableOpacity
            onPress={() => setColumnsModalOpen(true)}
            style={{ padding: 10, borderRadius: 8, borderWidth: 1, borderColor: primaryColor, backgroundColor: '#ffffff', alignItems: 'center', justifyContent: 'center' }}
          >
            <Columns3 size={16} color={primaryColor} />
          </TouchableOpacity>
          <TouchableOpacity
            onPress={handleExport}
            disabled={isLoading || filteredRows.length === 0}
            style={{ padding: 10, borderRadius: 8, borderWidth: 1, borderColor: primaryColor, backgroundColor: '#ffffff', alignItems: 'center', justifyContent: 'center', opacity: isLoading || filteredRows.length === 0 ? 0.5 : 1 }}
          >
            <Download size={16} color={primaryColor} />
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => refreshQueueRecords()}
            disabled={isLoading}
            style={{ padding: 10, borderRadius: 8, borderWidth: 1, borderColor: primaryColor, backgroundColor: '#ffffff', alignItems: 'center', justifyContent: 'center', opacity: isLoading ? 0.5 : 1 }}
          >
            {isLoading ? <ActivityIndicator size="small" color={primaryColor} /> : <RefreshCw size={16} color={primaryColor} />}
          </TouchableOpacity>
        </View>

        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <View style={{ borderWidth: 1, borderColor: statusFilter !== 'all' ? '#ef4444' : '#d1d5db', borderRadius: 6, overflow: 'hidden', flex: 1, height: 40, justifyContent: 'center' }}>
            <Picker
              selectedValue={statusFilter}
              onValueChange={(v) => setStatusFilter(String(v))}
              style={{ color: statusFilter !== 'all' ? '#ef4444' : '#111827' }}
              dropdownIconColor="#6b7280"
            >
              {STATUS_FILTER_OPTIONS.map((opt) => (
                <Picker.Item key={opt.value} label={opt.label} value={opt.value} />
              ))}
            </Picker>
          </View>
          <TouchableOpacity
            onPress={() => handleSort(sortColumn || 'created_at')}
            style={{ flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 12, height: 40, borderRadius: 6, borderWidth: 1, borderColor: '#d1d5db', backgroundColor: '#ffffff' }}
          >
            <Text style={{ fontSize: 12, color: '#374151' }}>
              {sortColumn ? (allColumns.find((c) => c.key === sortColumn)?.label || sortColumn) : 'Sort'}
            </Text>
            {sortColumn ? (sortDirection === 'asc' ? <ArrowUp size={14} color="#374151" /> : <ArrowDown size={14} color="#374151" />) : null}
          </TouchableOpacity>
        </View>
      </View>

      {/* Body */}
      {isLoading && queueRecords.length === 0 ? (
        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', paddingVertical: 80 }}>
          <ActivityIndicator size="large" color={primaryColor} />
          <Text style={{ color: '#6b7280', marginTop: 12 }}>Loading the RADIUS queue...</Text>
        </View>
      ) : error && queueRecords.length === 0 ? (
        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', paddingVertical: 80, gap: 12 }}>
          <Text style={{ fontSize: 16, fontWeight: '600', color: '#ef4444', textAlign: 'center', paddingHorizontal: 24 }}>{error}</Text>
          <TouchableOpacity onPress={() => refreshQueueRecords()} style={{ paddingHorizontal: 24, paddingVertical: 10, borderRadius: 8, backgroundColor: primaryColor }}>
            <Text style={{ color: '#ffffff', fontWeight: '600' }}>Retry</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <FlatList
          data={paginatedRows}
          keyExtractor={(item) => String(item.id)}
          renderItem={renderItem}
          initialNumToRender={20}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={primaryColor} colors={[primaryColor]} />}
          ListEmptyComponent={
            <View style={{ paddingVertical: 80, alignItems: 'center' }}>
              <Text style={{ color: '#6b7280' }}>Nothing in the queue matching your filters</Text>
            </View>
          }
          ListFooterComponent={
            filteredRows.length > 0 ? (
              <PaginationFooter
                currentPage={currentPage}
                totalPages={totalPages}
                itemsPerPage={itemsPerPage}
                totalResults={filteredRows.length}
                primaryColor={primaryColor}
                setCurrentPage={setCurrentPage}
                setItemsPerPage={(n) => {
                  setItemsPerPage(n);
                  setCurrentPage(1);
                }}
              />
            ) : null
          }
        />
      )}

      {/* Column Visibility Modal */}
      <Modal visible={columnsModalOpen} transparent animationType="fade" onRequestClose={() => setColumnsModalOpen(false)}>
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', padding: 16 }}>
          <View style={{ backgroundColor: '#ffffff', borderRadius: 12, maxHeight: '80%', overflow: 'hidden' }}>
            <View style={{ padding: 16, borderBottomWidth: 1, borderBottomColor: '#e5e7eb', flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
              <Text style={{ fontSize: 15, fontWeight: '700', color: '#111827' }}>Column Visibility</Text>
              <TouchableOpacity onPress={() => setColumnsModalOpen(false)}>
                <X size={20} color="#6b7280" />
              </TouchableOpacity>
            </View>
            <View style={{ flexDirection: 'row', gap: 16, paddingHorizontal: 16, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#f3f4f6' }}>
              <TouchableOpacity onPress={handleSelectAllColumns}>
                <Text style={{ fontSize: 13, color: primaryColor, fontWeight: '600' }}>Select All</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={handleDeselectAllColumns}>
                <Text style={{ fontSize: 13, color: primaryColor, fontWeight: '600' }}>Deselect All</Text>
              </TouchableOpacity>
            </View>
            <ScrollView>
              {allColumns.map((column) => (
                <View
                  key={column.key}
                  style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#f3f4f6' }}
                >
                  <Text style={{ fontSize: 14, color: '#111827' }}>{column.label}</Text>
                  <Switch
                    value={visibleColumns.includes(column.key)}
                    onValueChange={() => handleToggleColumn(column.key)}
                    trackColor={{ true: primaryColor, false: '#d1d5db' }}
                    thumbColor="#ffffff"
                  />
                </View>
              ))}
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* Row detail */}
      {selectedRow && (
        <QueueRowModal row={selectedRow} onClose={() => setSelectedRow(null)} primaryColor={primaryColor} />
      )}
    </View>
  );
};

const Field: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
    <Text style={{ fontSize: 10, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5, color: '#9ca3af' }}>
      {label}
    </Text>
    <Text style={{ fontSize: 11, color: '#374151' }} numberOfLines={1}>
      {value}
    </Text>
  </View>
);

interface PaginationFooterProps {
  currentPage: number;
  totalPages: number;
  itemsPerPage: number;
  totalResults: number;
  primaryColor: string;
  setCurrentPage: React.Dispatch<React.SetStateAction<number>>;
  setItemsPerPage: (n: number) => void;
}

const PaginationFooter: React.FC<PaginationFooterProps> = ({
  currentPage,
  totalPages,
  itemsPerPage,
  totalResults,
  primaryColor,
  setCurrentPage,
  setItemsPerPage,
}) => {
  const start = totalResults === 0 ? 0 : (currentPage - 1) * itemsPerPage + 1;
  const end = Math.min(currentPage * itemsPerPage, totalResults);

  const navBtn = (label: string, onPress: () => void, disabled: boolean) => (
    <TouchableOpacity
      onPress={onPress}
      disabled={disabled}
      style={{
        paddingHorizontal: 10,
        paddingVertical: 6,
        borderRadius: 6,
        borderWidth: 1,
        borderColor: disabled ? '#e5e7eb' : '#d1d5db',
        backgroundColor: disabled ? '#f3f4f6' : '#ffffff',
      }}
    >
      <Text style={{ fontSize: 12, color: disabled ? '#9ca3af' : '#111827' }}>{label}</Text>
    </TouchableOpacity>
  );

  return (
    <View style={{ padding: 12, gap: 10, backgroundColor: '#ffffff', borderTopWidth: 1, borderTopColor: '#e5e7eb' }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <Text style={{ fontSize: 12, color: '#6b7280' }}>Show</Text>
          <View style={{ borderWidth: 1, borderColor: '#d1d5db', borderRadius: 6, overflow: 'hidden', height: 36, justifyContent: 'center' }}>
            <Picker
              selectedValue={itemsPerPage}
              onValueChange={(v) => setItemsPerPage(Number(v))}
              style={{ width: 96, color: '#111827' }}
              dropdownIconColor="#6b7280"
            >
              {[10, 25, 50, 100].map((v) => (
                <Picker.Item key={v} label={String(v)} value={v} />
              ))}
            </Picker>
          </View>
        </View>
        <Text style={{ fontSize: 12, color: '#6b7280' }}>
          {start} to {end} of {totalResults}
        </Text>
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, flexWrap: 'wrap' }}>
        {navBtn('« First', () => setCurrentPage(1), currentPage === 1)}
        {navBtn('‹ Prev', () => setCurrentPage((p) => Math.max(p - 1, 1)), currentPage === 1)}
        <Text style={{ fontSize: 13, color: '#111827', paddingHorizontal: 4 }}>
          Page {currentPage} of {totalPages}
        </Text>
        {navBtn('Next ›', () => setCurrentPage((p) => Math.min(p + 1, totalPages)), currentPage === totalPages)}
        {navBtn('Last »', () => setCurrentPage(totalPages), currentPage === totalPages)}
      </View>
    </View>
  );
};

/**
 * One queue entry in full.
 *
 * The card list truncates the two fields that matter when something has gone
 * wrong — the last error and the params the operation was called with. This is
 * where they are read, so both are laid out to be scrolled rather than clipped.
 */
const QueueRowModal: React.FC<{ row: RadiusQueueRecord; onClose: () => void; primaryColor: string }> = ({
  row,
  onClose,
  primaryColor,
}) => {
  const entries = paramEntries(row.params);
  const tone = toneFor(row.status);

  const Line: React.FC<{ label: string; value?: string | number | null }> = ({ label, value }) => (
    <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 10, paddingVertical: 6 }}>
      <Text style={{ width: 110, fontSize: 11, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5, color: '#9ca3af' }}>
        {label}
      </Text>
      <Text style={{ flex: 1, fontSize: 13, color: '#111827' }}>
        {value === null || value === undefined || value === '' ? '-' : String(value)}
      </Text>
    </View>
  );

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', padding: 16 }}>
        <View style={{ backgroundColor: '#ffffff', borderRadius: 12, maxHeight: '85%', overflow: 'hidden' }}>
          <View style={{ padding: 16, borderBottomWidth: 1, borderBottomColor: '#e5e7eb', flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexShrink: 1 }}>
              <Text style={{ fontSize: 15, fontWeight: '700', color: '#111827' }}>Queue Entry #{row.id}</Text>
              <View style={{ paddingHorizontal: 10, paddingVertical: 3, borderRadius: 999, backgroundColor: tone.bg }}>
                <Text style={{ fontSize: 10, fontWeight: '700', letterSpacing: 0.5, textTransform: 'uppercase', color: tone.fg }}>
                  {row.status || '-'}
                </Text>
              </View>
            </View>
            <TouchableOpacity onPress={onClose}>
              <X size={20} color="#6b7280" />
            </TouchableOpacity>
          </View>

          <ScrollView contentContainerStyle={{ padding: 16 }}>
            <Line label="Account No." value={row.account_no} />
            <Line label="Operation" value={humaniseKey(row.operation || '')} />
            <Line label="Attempts" value={`${row.attempts} / ${row.max_attempts}`} />
            <Line label="Source" value={row.source_type ? humaniseKey(row.source_type) : ''} />
            <Line label="Source ID" value={row.source_id} />
            <Line label="Next Retry" value={row.next_retry_at} />
            <Line label="Completed At" value={row.completed_at} />
            <Line label="Created At" value={row.created_at} />
            <Line label="Created By" value={row.created_by} />
            <Line label="Updated At" value={row.updated_at} />

            {!!row.last_error && (
              <View style={{ marginTop: 12 }}>
                <Text style={{ fontSize: 11, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5, color: '#9ca3af', marginBottom: 6 }}>
                  Last Error
                </Text>
                <View style={{ padding: 10, borderRadius: 8, backgroundColor: '#fff1f2' }}>
                  <Text style={{ fontSize: 12, color: '#be123c' }}>{row.last_error}</Text>
                </View>
              </View>
            )}

            {!!row.params && (
              <View style={{ marginTop: 12 }}>
                <Text style={{ fontSize: 11, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5, color: '#9ca3af', marginBottom: 6 }}>
                  Params
                </Text>
                <View style={{ padding: 10, borderRadius: 8, backgroundColor: '#f9fafb' }}>
                  {entries ? (
                    entries.map(([k, v]) => (
                      <View key={k} style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 8, paddingVertical: 3 }}>
                        <Text style={{ width: 120, fontSize: 11, fontWeight: '600', color: '#6b7280' }}>{k}</Text>
                        <Text style={{ flex: 1, fontSize: 12, color: '#111827' }}>{v}</Text>
                      </View>
                    ))
                  ) : (
                    // Not an object, or malformed: shown as it stands rather
                    // than forced into rows that would misrepresent it.
                    <Text style={{ fontSize: 12, color: '#111827' }}>{row.params}</Text>
                  )}
                </View>
              </View>
            )}
          </ScrollView>

          <View style={{ padding: 12, borderTopWidth: 1, borderTopColor: '#e5e7eb' }}>
            <TouchableOpacity
              onPress={onClose}
              style={{ paddingVertical: 12, borderRadius: 8, backgroundColor: primaryColor, alignItems: 'center' }}
            >
              <Text style={{ color: '#ffffff', fontWeight: '600' }}>Close</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
};

export default RadiusQueue;
